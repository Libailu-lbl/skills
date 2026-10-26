/* 照片打印页 · 旋转判定单元测试（Node 直跑，不依赖 jsdom）
   用法：node unit_rot.js [printPhotos.js 路径 ...]
        默认同时测 safety-desk 与 safety-desk-blank 两份。
   为什么用 Node 直跑：
     jsdom 没有 canvas（getContext 返回 null），rotateSrc 会直接原样返回，
     看不出「到底有没有打算转」。这里把 Image 与 canvas 都打桩，
     就能验证「决定转不转」的逻辑本身，包含证件照。

   覆盖（2026-10-22 新版语义：一排一张横长条 + 长边横向）：
     · rotOf 纯函数仍按「照片长宽比 vs 格子长宽比」判定（提升不足 1.08 倍不转）
     · autoRotate 的格子是一排一张的横长条（高 ≤ 行宽/1.2）→ 竖图转 90°、横图不转
     · 证件照与现场照片同一规则；竖版证件照也转（长边横向，不再因格子竖高而豁免）
     · 旋转真实发生（生成新图、宽高互换）
*/
const path = require('path');

const DEFAULT = [
  path.resolve(__dirname, '..', 'safety-desk', 'assets', 'js', 'components', 'printPhotos.js'),
  path.resolve(__dirname, '..', 'safety-desk-blank', 'assets', 'js', 'components', 'printPhotos.js')
];
const files = process.argv.length > 2 ? process.argv.slice(2) : DEFAULT;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  OK  ' + name + (extra != null ? ' => ' + extra : '')); }
  else { fail++; console.log('  FAIL ' + name + (extra != null ? ' => ' + extra : '')); }
}

/** 打桩环境：Image 解析 src 里的 宽x高；canvas 返回 ROT::新宽x新高 */
function stubEnv() {
  const win = { SD: {} };
  global.window = win;
  global.SD = win.SD;                      // 模块里用的是裸 SD
  win.SD.utils = { esc: s => String(s) };
  win.SD.comp = {};
  win.SD.icons = { get: () => '' };        // 只有 open() 用得到，这里不调
  win.SD.api = { updateWorkPermit: () => Promise.resolve() };

  global.Image = function () {
    const self = this;
    this._src = '';
    Object.defineProperty(this, 'src', {
      get() { return self._src; },
      set(v) {
        self._src = v;
        const m = /(\d+)x(\d+)/.exec(String(v));
        self.naturalWidth = m ? Number(m[1]) : 4;
        self.naturalHeight = m ? Number(m[2]) : 3;
        setTimeout(function () { if (self.onload) self.onload(); }, 0);
      }
    });
  };

  global.document = {
    createElement(tag) {
      if (tag !== 'canvas') return {};
      const c = { width: 0, height: 0 };
      c.getContext = () => ({
        fillRect() {}, translate() {}, rotate() {}, drawImage() {},
        set fillStyle(v) {}, get fillStyle() { return '#fff'; }
      });
      c.toDataURL = () => 'ROT::' + c.width + 'x' + c.height;   // 旋转后宽高互换
      return c;
    }
  };
  return win;
}

function rot(items) {                       // 把回调式 autoRotate 包成 Promise
  return new Promise(function (res) {
    global.window.SD.comp.printPhotos.autoRotate(items, res);
  });
}

async function run(file) {
  const tag = file.indexOf('blank') >= 0 ? 'safety-desk-blank' : 'safety-desk';
  console.log('\n== ' + tag + ' ==');
  delete require.cache[require.resolve(file)];
  stubEnv();
  require(file);
  const PP = global.window.SD.comp.printPhotos;

  /* ---- 1. 判定函数本身 ---- */
  ok('rotOf 存在', typeof PP.rotOf === 'function');
  ok('横图（640×480）在窄高格子 → 转 90°', PP.rotOf(640, 480, 179, 392) === 90, PP.rotOf(640, 480, 179, 392));
  ok('竖图（420×560）在竖高格子 → 不转', PP.rotOf(420, 560, 179, 392) === 0, PP.rotOf(420, 560, 179, 392));
  ok('竖图（420×560）在宽扁格子 → 转 90°', PP.rotOf(420, 560, 392, 179) === 90, PP.rotOf(420, 560, 392, 179));
  ok('接近正方形（500×520）不折腾', PP.rotOf(500, 520, 179, 392) === 0, PP.rotOf(500, 520, 179, 392));

  /* ---- 2. 新版语义：横长条格子里「竖图转、横图不转」 ---- */
  const items = [
    { src: 'fake://480x640', cap: '张三 · 电工作业 · 证件照' },   // 竖版证件照
    { src: 'fake://640x480', cap: '' }, { src: 'fake://640x480', cap: '' },
    { src: 'fake://640x480', cap: '' }, { src: 'fake://640x480', cap: '' },
    { src: 'fake://640x480', cap: '' }
  ];
  const out = await rot(items);
  ok('出件张数不变', out.length === 6, out.length);
  ok('★ 竖版证件照转 90°（长边横向）', out[0].rot === 90, out[0].rot);
  ok('★ 证件照已被真实旋转（生成新图）', String(out[0].src).indexOf('ROT::') === 0, String(out[0].src));
  ok('旋转后宽高互换（480×640 → 640×480）', String(out[0].src) === 'ROT::640x480', String(out[0].src));
  ok('横图现场照片不转（规则一致）', out.slice(1).every(x => x.rot === 0 && String(x.src).indexOf('fake://') === 0),
    out.slice(1).map(x => x.rot).join(','));

  /* ---- 3. 单张也不误转（格子仍是横长条） ---- */
  const one = await rot([{ src: 'fake://640x480', cap: '' }]);
  ok('单张横图不转（格子未变成竖高）', one[0].rot === 0 && String(one[0].src) === 'fake://640x480',
    one[0].rot + ' / ' + String(one[0].src));
  const oneV = await rot([{ src: 'fake://480x640', cap: '' }]);
  ok('单张竖图转横', oneV[0].rot === 90 && String(oneV[0].src) === 'ROT::640x480',
    oneV[0].rot + ' / ' + String(oneV[0].src));

  /* ---- 4. 方图不折腾 ---- */
  const sq = await rot([{ src: 'fake://600x600', cap: '' }, { src: 'fake://600x600', cap: '' }]);
  ok('方图不旋转', sq.every(x => x.rot === 0), sq.map(x => x.rot).join(','));
}

(async function main() {
  for (const f of files) await run(f);
  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
