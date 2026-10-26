/* 安全员工作台 · 证件识别「真链路」自检（需先启动本机识别服务）
   用法：
     1) 先起服务：python safety-desk_dev/local_ocr_server.py
     2) 再跑：    node safety-desk_dev/smoke_ocr_live.js [url]
   覆盖：config 指向本机服务 → /health 连通 → 编辑弹窗放证件样图 → 点「识别图片」
        → 真实 RapidOCR 识别 → 8 个字段填满 → 保存后落库
   说明：与 smoke_ocr.js 的区别——那个用 stub（无需服务，适合日常回归），
        这个走真实 HTTP + 真实模型（验证端到端，耗时约 1~3 秒/张）。
   样例图：safety-desk_dev/_ocr_cert_sample.png（由 make_cert_sample.py 生成）
*/
/* 端到端：页面「识别图片」→ 本机 RapidOCR 服务 → 真实识别 → 字段自动填满 */
const { JSDOM, requestInterceptor } = require('jsdom');
const fs = require('fs');
const skipPrint = requestInterceptor(r => { if (String(r.url).indexOf('print-only.css') >= 0) return new Response('', { headers: { 'Content-Type': 'text/css' } }); });
const wait = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n + (x ? ' => ' + x : '')); } else { fail++; console.log('  FAIL ' + n + (x ? ' => ' + x : '')); } };

(async () => {
  const URL_ = process.argv[2] || 'http://127.0.0.1:8124/index.html';
  const dom = await JSDOM.fromURL(URL_, {
    runScripts: 'dangerously', resources: { interceptors: [skipPrint] }, pretendToBeVisual: true,
    beforeParse(win) {
      win.matchMedia = q => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      win.fetch = (u, o) => globalThis.fetch(u, o);
      win.Headers = globalThis.Headers; win.Request = globalThis.Request;
      win.Response = globalThis.Response; win.AbortController = globalThis.AbortController;
    },
  });
  const win = dom.window, doc = win.document;
  for (let i = 0; i < 80 && !(win.SD && win.SD.app && win.SD.app.state.summary); i++) await wait(150);
  const SD = win.SD;
  // 2026-10-25：工作台默认「受限用户」，测试先解锁为安全员（等同输入六位密码）
  SD.auth.set('safety_officer');
  if (SD.app.refreshAll) SD.app.refreshAll();
  await wait(300);


  console.log('== 0. 配置与服务连通 ==');
  ok('config 已指向本机服务', /127\.0\.0\.1:8123/.test(SD.CONFIG.ocr.endpoint), SD.CONFIG.ocr.endpoint);
  ok('ocr.ready() 为真', SD.comp.ocr.ready() === true);
  let health = null;
  try {
    const r = await win.fetch('http://127.0.0.1:8123/health');
    health = await r.json();
  } catch (e) { health = { error: String(e && e.message) }; }
  ok('本机服务 /health 正常', !!health && health.ok === true, JSON.stringify(health));

  console.log('== 1. 进入编辑弹窗 ==');
  win.location.hash = '#/specPersonnel';
  await wait(500);
  let rows = Array.from(doc.querySelectorAll('#view tbody tr'));
  if (!rows.length) {                       // 空白版：先造一条
    await SD.api.createSpecialPersonnel({
      code: 'TZZY-001', name: '待识别', dept: '生产一部', category: '电工作业',
      operation: '低压电工作业', certNo: 'PLACEHOLDER01', issuer: '',
      validFrom: '2020-01-01', validTo: '2026-01-01', reviewDate: '2024-01-01', status: 'valid'
    });
    if (SD.app.reload) SD.app.reload();
    await wait(1200);
    win.location.hash = '#/specPersonnel';
    await wait(600);
    rows = Array.from(doc.querySelectorAll('#view tbody tr'));
  }
  ok('台账有数据行', rows.length > 0, rows.length + ' 行');

  doc.querySelector('#view [data-act="sops"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(250);
  const menu = doc.querySelector('.dd-menu');
  Array.from(menu.querySelectorAll('.dd-item')).find(x => /编辑/.test(x.textContent))
    .dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(350);
  const modal = doc.querySelector('.mask');
  ok('编辑弹窗打开', !!modal);
  ok('识别工具条存在', !!modal.querySelector('.ocr-bar'));

  console.log('== 2. 放入证件样图并点识别（真实 OCR）==');
  const png = fs.readFileSync(__dirname + '/_ocr_cert_sample.png').toString('base64');
  const dataUrl = 'data:image/png;base64,' + png;
  const box = modal.querySelector('#ff_photos');
  box._ph.set([dataUrl]);
  ok('证件照已放入', box._ph.get().length === 1);

  // 先把关键字段清成旧值，确保断言能证明是「识别写入的」
  ['name', 'certNo', 'issuer', 'operation'].forEach(function (k) {
    const el = modal.querySelector('#ff_' + k);
    if (el) el.value = 'OLD-' + k;
  });

  const t0 = Date.now();
  modal.querySelector('.js-ocr').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  // 等真实识别（本地 CPU 约 2~4s）+ 回填
  for (let i = 0; i < 60; i++) {
    await wait(500);
    const v = (modal.querySelector('#ff_certNo') || {}).value;
    if (v === 'T32012020018200') break;
  }
  const cost = Date.now() - t0;
  const v = id => (modal.querySelector('#ff_' + id) || {}).value;
  ok('姓名被识别写入', v('name') === '张伟', v('name'));
  ok('作业类别写入', v('category') === '电工作业', v('category'));
  ok('操作项目写入', v('operation') === '低压电工作业', v('operation'));
  ok('证书编号写入', v('certNo') === 'T32012020018200', v('certNo'));
  ok('发证机关写入', v('issuer') === '江苏省应急管理厅', v('issuer'));
  ok('有效期起写入', v('validFrom') === '2020-01-15', v('validFrom'));
  ok('有效期止写入', v('validTo') === '2026-01-14', v('validTo'));
  ok('复审日期写入', v('reviewDate') === '2024-01-15', v('reviewDate'));
  const tip = modal.querySelector('.js-ocr-tip').textContent;
  ok('提示条显示填入项数', /已填入 \d+ 项/.test(tip), tip.slice(0, 36));
  console.log('  （端到端耗时 ' + cost + 'ms，含本地 OCR）');

  console.log('== 3. 保存后真的落库 ==');
  modal.querySelector('.js-ok').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  for (let i = 0; i < 40; i++) { await wait(500); if (!doc.querySelector('.mask')) break; }
  await wait(800);
  const saved = SD.app.state.summary.specialPersonnel.find(x => x.certNo === 'T32012020018200');
  ok('台账里出现识别后的证书编号', !!saved, saved && saved.name + ' / ' + saved.certNo);
  ok('姓名也落库', !!saved && saved.name === '张伟', saved && saved.name);
  ok('有效期与复审落库', !!saved && saved.validFrom === '2020-01-15' && saved.reviewDate === '2024-01-15',
    saved && (saved.validFrom + ' ~ ' + saved.validTo));

  console.log('\n结果：通过 ' + pass + ' / 失败 ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('异常:', (e && e.stack) || e); process.exit(1); });
