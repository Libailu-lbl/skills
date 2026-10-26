/* 骨架自检（assets/skeleton）—— 克隆后先跑这一条，确认骨架能跑通
   用法：
     node tests/serve.js 8132 assets/skeleton        # 另开一个终端
     node tests/smoke_skeleton.js http://127.0.0.1:8132/index.html
   覆盖：示例数据 / 今天要处理置顶 / 受限态只读 / 解锁后可写 / 落盘 / 导出 /
        清空需专用密码 / 空闲自动退回受限 / 无 JS 报错
*/
const { JSDOM, requestInterceptor, VirtualConsole } = require('jsdom');
const wait = ms => new Promise(r => setTimeout(r, ms));

let P = 0, F = 0;
function ok(name, cond, extra) {
  if (cond) { P++; console.log('  OK   ' + name + (extra !== undefined ? ' => ' + extra : '')); }
  else { F++; console.log('  FAIL ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : '')); }
}

(async () => {
  const errs = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errs.push(e.message));
  vc.on('error', m => errs.push(String(m)));

  const dom = await JSDOM.fromURL(process.argv[2] || 'http://127.0.0.1:8132/index.html', {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    beforeParse(win) {
      win.matchMedia = q => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      win.scrollTo = () => {};
      win.URL.createObjectURL = () => 'blob:stub';
      win.URL.revokeObjectURL = () => {};
    },
    virtualConsole: vc
  });
  const win = dom.window, doc = win.document;
  for (let i = 0; i < 100 && !(win.SD && win.SD.app); i++) await wait(100);
  await wait(400);
  const SD = win.SD;
  const click = el => el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  const text = () => doc.getElementById('view').textContent;

  ok('SD 命名空间与各模块都在',
    !!(SD.CONFIG && SD.utils && SD.store && SD.auth && SD.router && SD.app));
  ok('首次打开有示例数据（不是空白页）', SD.store.items().length === 4, SD.store.items().length);
  ok('「今天要处理」在最上面', /今天要处理/.test(text()) && /今天没有要处理的事/.test(text()) === false);
  ok('有 1 条逾期且标红（.overdue）', doc.querySelectorAll('.todo-item.overdue').length === 1,
    doc.querySelectorAll('.todo-item.overdue').length);

  ok('默认是受限用户', SD.auth.current() === 'restricted', SD.auth.current());
  ok('受限态不出现「完成 / 删除」按钮',
    !doc.querySelector('#view .js-done') && !doc.querySelector('#view .js-del'));
  ok('受限态不出现新增表单', !doc.getElementById('btnAdd'));

  /* ---------- 解锁 ---------- */
  win.SD.auth.unlock(SD.auth.DEFAULT_PIN);
  SD.app.refreshAll();
  await wait(200);
  ok('输对六位密码后进入安全员', SD.auth.current() === 'safety_officer');
  ok('解锁后出现新增表单与操作按钮',
    !!doc.getElementById('btnAdd') && !!doc.querySelector('#view .js-done'));

  /* ---------- 新增 + 落盘 ---------- */
  doc.getElementById('newTitle').value = '骨架自检新增的一条';
  click(doc.getElementById('btnAdd'));
  await wait(300);
  ok('新增后条数 +1', SD.store.items().length === 5, SD.store.items().length);
  const raw = win.localStorage.getItem(SD.CONFIG.storageKey);
  ok('已写入 localStorage（含新标题）', !!raw && raw.indexOf('骨架自检新增的一条') >= 0);

  /* ---------- 完成 / 撤销 ---------- */
  const target = SD.store.items().filter(x => x.title === '骨架自检新增的一条')[0];
  SD.store.toggle(target.id);
  ok('一键完成生效', SD.store.data().items.filter(x => x.id === target.id)[0].status === 'done');

  /* ---------- 导出 ---------- */
  let text2 = SD.store.exportJSON();
  ok('导出 JSON 含全部数据', JSON.parse(text2).data.items.length === 5);

  /* ---------- 清空需要专用密码 ---------- */
  const before = SD.store.items().length;
  click(doc.getElementById('btnGear'));
  await wait(80);
  click(doc.getElementById('btnReset'));
  await wait(200);
  ok('清空弹的是专用密码框', !!doc.querySelector('#dialogRoot .js-purge'));
  doc.querySelector('#dialogRoot .js-purge').value = '000000';
  click(doc.querySelector('#dialogRoot .js-ok'));
  await wait(150);
  ok('专用密码错 → 不执行且有提示',
    /专用密码不正确/.test(doc.querySelector('#dialogRoot').textContent) &&
    SD.store.items().length === before, SD.store.items().length);
  doc.querySelector('#dialogRoot .js-purge').value = SD.CONFIG.security.defaultPurgePin;
  click(doc.querySelector('#dialogRoot .js-ok'));
  await wait(300);
  ok('专用密码对 → 清空回初始态', SD.store.items().length === 4, SD.store.items().length);

  /* ---------- 空闲锁 ---------- */
  SD.auth.set('safety_officer');
  ok('默认空闲阈值 30 分钟', SD.app.idle.ms() === 30 * 60000, SD.app.idle.ms());
  const old = SD.CONFIG.security.idleLockMin;
  SD.CONFIG.security.idleLockMin = 0.01;       // 0.6s
  SD.app.idle.touch();
  await wait(800);
  ok('超时后自动退回受限', SD.app.idle.check() === true && SD.auth.current() === 'restricted');
  SD.CONFIG.security.idleLockMin = old;

  ok('全程无 JS 报错', errs.length === 0, errs.slice(0, 2).join(' | '));
  console.log('\n结果：通过 ' + P + ' / 失败 ' + F);
  process.exit(F ? 1 : 0);
})().catch(e => { console.log('ERR', e.stack); process.exit(1); });
