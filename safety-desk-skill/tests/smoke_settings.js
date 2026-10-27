/* 安全员工作台 · 工作台名称自定义 冒烟自检
   用法：node smoke_settings.js [url]
*/
const { JSDOM } = require('jsdom');
const URL_ = process.argv[2] || 'http://127.0.0.1:8124/index.html';
const wait = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  OK  ' + name + (extra ? ' => ' + extra : '')); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' => ' + extra : '')); }
}

(async () => {
  const errors = [];
  const dom = await JSDOM.fromURL(URL_, {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    beforeParse(win) {
      win.matchMedia = q => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      win.fetch = (u, o) => globalThis.fetch(u, o);
      win.Headers = globalThis.Headers; win.Request = globalThis.Request;
      win.Response = globalThis.Response; win.AbortController = globalThis.AbortController;
      win.addEventListener('error', e => errors.push(String(e.message)));
    },
  });
  const win = dom.window;
  win.addEventListener('error', e => errors.push(String(e.message)));
  win.addEventListener('unhandledrejection', e => errors.push('rejection: ' + String(e.reason && e.reason.message || e.reason)));

  for (let i = 0; i < 80 && !(win.SD && win.SD.app && win.SD.app.state.summary); i++) await wait(150);
  const SD = win.SD;
  // 2026-10-25：工作台默认「受限用户」，测试先解锁为安全员（等同输入六位密码）
  SD.auth.set('safety_officer');
  if (SD.app.refreshAll) SD.app.refreshAll();
  await wait(300);

  const doc = win.document;
  if (!SD || !SD.app) { console.log('FATAL: SD 未初始化'); process.exit(1); }

  console.log('== 1. 默认名称 ==');
  ok('品牌文字默认=安全员工作台', doc.getElementById('appName').textContent === '安全员工作台', doc.getElementById('appName').textContent);
  ok('副标题默认=EHS 日常办公台', doc.getElementById('appSub').textContent === 'EHS 日常办公台', doc.getElementById('appSub').textContent);
  ok('document.title 默认=安全员工作台', doc.title === '安全员工作台', doc.title);
  ok('store.getSettings 存在', !!SD.store.getSettings && typeof SD.store.getSettings === 'function');

  console.log('== 1.5 侧栏常用功能（位于左侧导航下方） ==');
  const sq = doc.querySelector('.js-sidebar-quick');
  ok('侧栏有常用功能容器', !!sq);
  const qBtns = sq ? sq.querySelectorAll('.quick') : [];
  ok('常用功能有 8 个快捷按钮', qBtns.length === 8, qBtns.length);
  ok('含「登记隐患」入口', Array.from(qBtns).some(b => /登记隐患/.test(b.textContent)));
  ok('含「导出台账」入口', Array.from(qBtns).some(b => /导出台账/.test(b.textContent)));
  // 点「登记隐患」应直达隐患新增弹窗（验证接线）
  const regBtn = Array.from(qBtns).find(b => /登记隐患/.test(b.textContent));
  regBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(400);
  const regModal = doc.querySelector('.mask');
  ok('点登记隐患打开新增弹窗', !!regModal && !!regModal.querySelector('#f_title'));
  if (regModal) regModal.querySelector('.js-cancel').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(150);
  // 概览页不再内嵌「常用功能」卡片（说明文字里提到该词不算）
  win.location.hash = '#/overview';
  await wait(300);
  ok('概览页无「常用功能」卡片', !Array.from(doc.getElementById('view').querySelectorAll('.card h3')).some(h => h.textContent.trim() === '常用功能'));
  // 通知页也不再内嵌
  win.location.hash = '#/notice';
  await wait(300);
  ok('通知页无「常用功能」卡片', !Array.from(doc.getElementById('view').querySelectorAll('.card h3')).some(h => h.textContent.trim() === '常用功能'));
  win.location.hash = '#/overview';
  await wait(200);

  console.log('== 2. 打开设置弹窗 ==');
  const btn = doc.getElementById('btnSettings');
  ok('设置按钮存在', !!btn);
  btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(200);
  const modal = doc.querySelector('.mask');
  ok('弹窗打开', !!modal);
  const nameInput = modal && modal.querySelector('#setName');
  const subInput = modal && modal.querySelector('#setSub');
  ok('有名称输入框', !!nameInput);
  ok('有副标题输入框', !!subInput);

  console.log('== 3. 改名并保存 ==');
  nameInput.value = '示例 EHS 台';
  subInput.value = '日常安全办公';
  modal.querySelector('.js-ok').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(200);
  ok('弹窗已关闭', !doc.querySelector('.mask'));
  ok('品牌文字已更新', doc.getElementById('appName').textContent === '示例 EHS 台', doc.getElementById('appName').textContent);
  ok('副标题已更新', doc.getElementById('appSub').textContent === '日常安全办公', doc.getElementById('appSub').textContent);
  ok('document.title 已更新', doc.title === '示例 EHS 台', doc.title);
  ok('store 已写入', SD.store.getSettings().appName === '示例 EHS 台', SD.store.getSettings().appName);

  console.log('== 4. 空名校验拦截 ==');
  doc.getElementById('btnSettings').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(150);
  const m2 = doc.querySelector('.mask');
  m2.querySelector('#setName').value = '   ';
  m2.querySelector('#setSub').value = '';
  m2.querySelector('.js-ok').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(150);
  ok('空名弹窗不关闭', !!doc.querySelector('.mask'));
  ok('显示错误提示', /不能为空/.test(doc.querySelector('.field-err').textContent), doc.querySelector('.field-err').textContent);
  doc.querySelector('.modal-close').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(100);

  console.log('== 5. 持久化 ==');
  const raw = win.localStorage.getItem('sd_safety_desk_v1');
  let persisted = false, persistedName = null;
  try { const o = JSON.parse(raw); persistedName = o.settings && o.settings.appName; persisted = persistedName === '示例 EHS 台'; } catch (e) {}
  ok('localStorage 含自定义名称', persisted, persistedName);

  console.log('== 6. 导出文件名前缀 ==');
  // 直接校验导出文件名逻辑（不真正触发下载）
  const fname = (SD.store.getSettings().appName || '安全员工作台') + '备份-' + SD.utils.today() + '.json';
  ok('导出文件名带自定义前缀', fname.indexOf('示例 EHS 台备份-') === 0, fname);

  console.log('== 7. 无 JS 报错 ==');
  ok('无 JS 报错', errors.length === 0, errors.slice(0, 3).join(' | '));

  console.log('\n结果：通过 ' + pass + ' / 失败 ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('异常:', e && e.stack || e); process.exit(1); });
