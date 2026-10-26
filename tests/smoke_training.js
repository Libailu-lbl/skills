/* 安全员工作台 · 培训照片 冒烟自检
   用法：node smoke_training.js [url]
   覆盖：① 培训表单新增「培训照片」项（photoPicker 挂载）
        ② 点「培训名称」看照片大图（有照片：主色 + 角标 + lightbox）
        ③ 无照片：只提示不开图
        ④ 编辑表单带出 / 保存不清空已有照片
        ⑤ photoPicker 控件本身（value/max/get/set/移除）
*/
const { JSDOM } = require('jsdom');
const URL_ = process.argv[2] || 'http://127.0.0.1:8124/index.html';
const wait = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  OK  ' + name + (extra != null ? ' => ' + extra : '')); }
  else { fail++; console.log('  FAIL ' + name + (extra != null ? ' => ' + extra : '')); }
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
  win.addEventListener('unhandledrejection', e => errors.push('rejection: ' + String((e.reason && e.reason.message) || e.reason)));

  for (let i = 0; i < 80 && !(win.SD && win.SD.app && win.SD.app.state.summary); i++) await wait(150);
  const SD = win.SD;
  // 2026-10-25：工作台默认「受限用户」，测试先解锁为安全员（等同输入六位密码）
  SD.auth.set('safety_officer');
  if (SD.app.refreshAll) SD.app.refreshAll();
  await wait(300);

  if (!SD || !SD.app) { console.log('FATAL: SD 未初始化'); process.exit(1); }
  const doc = win.document;

  const go = async r => { win.location.hash = '#/' + r; await wait(340); };
  const view = () => doc.getElementById('view');
  const click = el => el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  const key = (el, k) => el.dispatchEvent(new win.KeyboardEvent('keydown', { key: k, bubbles: true }));
  const modal = () => doc.querySelector('.mask');
  const n = k => (SD.app.state.summary[k] || []).length;

  /* ---------- 1. 数据 ---------- */
  console.log('== 1. 数据：培训照片 ==');
  const s0 = SD.app.state.summary;
  const trPhotos = s0.trainings.filter(t => (t.photos || []).length);
  ok('有带照片的培训（示例）', trPhotos.length > 0, trPhotos.length + ' 条');
  ok('培训照片是数组', Array.isArray(s0.trainings[0].photos) || s0.trainings.every(t => Array.isArray(t.photos || [])),
    JSON.stringify((s0.trainings[0] || {}).photos || []));

  /* ---------- 2. 新增培训表单：照片项 ---------- */
  console.log('== 2. 新增培训表单：「培训照片」项 ==');
  await go('training');
  const addBtn = Array.from(view().querySelectorAll('.btn')).find(b => /新增培训/.test(b.textContent));
  ok('找到「新增培训」按钮', !!addBtn);
  click(addBtn);
  await wait(280);
  let m = modal();
  ok('弹窗打开', !!m);
  const phSlot = m && m.querySelector('#ff_photos');
  ok('表单有「培训照片」项', !!phSlot);
  ok('photoPicker 已挂载（.ph-pick + 添加按钮 + 文件输入）',
    !!phSlot && !!phSlot.querySelector('.ph-pick') && !!phSlot.querySelector('.js-ph-add') && !!phSlot.querySelector('.js-ph-file'));
  ok('上限 6 张（计数文案）', !!phSlot && /0 \/ 6 张/.test(phSlot.textContent),
    phSlot && phSlot.querySelector('.ph-count') && phSlot.querySelector('.ph-count').textContent);
  ok('控件实例挂在容器上（表单回读用）', !!phSlot && !!phSlot._ph);
  ok('get() 初值为空数组', !!phSlot && phSlot._ph && Array.isArray(phSlot._ph.get()) && phSlot._ph.get().length === 0);
  // 关弹窗（不提交）
  const cancelBtn = m && m.querySelector('.js-cancel');
  if (cancelBtn) click(cancelBtn);
  await wait(200);
  ok('弹窗可关闭', !modal());

  /* ---------- 3. 表格：名称列样式 ---------- */
  console.log('== 3. 表格：培训名称列（有照片才可点） ==');
  await go('training');
  const withPh = SD.app.state.summary.trainings.find(t => (t.photos || []).length > 0);
  const noPh = SD.app.state.summary.trainings.find(t => !(t.photos || []).length);
  const titleWith = view().querySelector('.js-tr-title[data-id="' + withPh.id + '"]');
  const titleNone = view().querySelector('.js-tr-title[data-id="' + noPh.id + '"]');
  ok('名称列带 js-tr-title 钩子', !!titleWith && !!titleNone);
  ok('有照片：标题带 link 类（主色可点）', !!titleWith && titleWith.classList.contains('link'));
  ok('有照片：挂「照片 N」角标', !!titleWith && new RegExp('照片 ' + withPh.photos.length).test(titleWith.textContent),
    titleWith && titleWith.textContent.trim());
  ok('有照片：悬停提示张数', !!titleWith && new RegExp('点击查看培训照片（' + withPh.photos.length + ' 张）').test(titleWith.getAttribute('title') || ''));
  ok('无照片：标题不带 link 类', !!titleNone && !titleNone.classList.contains('link'));
  ok('无照片：不挂角标', !!titleNone && !/照片 \\d/.test(titleNone.textContent));

  /* ---------- 4. 点名称看大图 ---------- */
  console.log('== 4. 点培训名称看照片大图 ==');
  click(titleWith);
  await wait(260);
  let lb = doc.querySelector('.lb-mask');
  ok('大图已打开', !!lb);
  ok('显示第一张照片', !!lb && lb.querySelector('.lb-img').getAttribute('src') === withPh.photos[0]);
  ok('大图标题带培训编号', !!lb && new RegExp(withPh.code).test(lb.querySelector('.lb-cap').textContent),
    lb && lb.querySelector('.lb-cap').textContent);
  ok('计数正确（1 / N）', !!lb && new RegExp('1 / ' + withPh.photos.length).test(lb.querySelector('.lb-cap').textContent),
    lb && lb.querySelector('.lb-cap').textContent);
  key(doc, 'Escape');
  await wait(180);
  ok('Esc 关闭大图', !doc.querySelector('.lb-mask'));

  /* ---------- 5. 无照片：只提示 ---------- */
  console.log('== 5. 无照片培训：只提示不开图 ==');
  click(titleNone);
  await wait(220);
  ok('不弹大图', !doc.querySelector('.lb-mask'));
  const toast = doc.querySelector('#toastRoot .toast');
  ok('有 toast 提示', !!toast && /还没有照片/.test(toast.textContent), toast && toast.textContent);

  /* ---------- 6. 编辑：带出 / 保存不清空 ---------- */
  console.log('== 6. 编辑培训：照片带出与保留 ==');
  const opsBtn = view().querySelector('[data-act="tops"][data-id="' + withPh.id + '"]');
  ok('找到该行操作按钮', !!opsBtn);
  click(opsBtn);
  await wait(220);
  const dd = doc.querySelector('.dd-menu');
  const editItem = Array.from((dd || { querySelectorAll: () => [] }).querySelectorAll('.dd-item'))
    .find(b => /编辑/.test(b.textContent));
  ok('操作菜单有「编辑」', !!editItem);
  click(editItem);
  await wait(320);
  m = modal();
  ok('编辑弹窗打开', !!m);
  const phBoxes = m ? m.querySelectorAll('#ff_photos .ph-box') : [];
  ok('编辑时带出已有照片', phBoxes.length === withPh.photos.length,
    phBoxes.length + ' / ' + withPh.photos.length);
  click(m.querySelector('.js-ok'));
  await wait(1500);
  const after = SD.app.state.summary.trainings.find(t => t.id === withPh.id);
  ok('保存后照片没被清空', !!after && (after.photos || []).length === withPh.photos.length,
    after && (after.photos || []).length);
  ok('照片内容不变', !!after && after.photos[0] === withPh.photos[0]);

  /* ---------- 7. photoPicker 控件单测 ---------- */
  console.log('== 7. photoPicker 控件（value/max/get/set/移除） ==');
  const P1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const P2 = P1 + 'x';
  const holder = doc.createElement('div');
  doc.body.appendChild(holder);
  const inst = SD.comp.photoPicker.mount(holder, { value: [P1, P2], max: 6 });
  ok('挂载后渲染 2 个缩略图', holder.querySelectorAll('.ph-box').length === 2,
    holder.querySelectorAll('.ph-box').length);
  ok('计数 2 / 6', /2 \/ 6 张/.test(holder.textContent), holder.querySelector('.ph-count').textContent);
  ok('get() 带回初值', inst.get().length === 2 && inst.get()[0] === P1);
  click(holder.querySelector('.ph-del'));
  await wait(120);
  ok('点 × 移除一张', inst.get().length === 1 && inst.get()[0] === P2);
  inst.set([P1]);
  ok('set() 整体替换', inst.get().length === 1 && inst.get()[0] === P1 && holder.querySelectorAll('.ph-box').length === 1);
  holder.remove();

  /* ---------- 结果 ---------- */
  console.log('\n结果：通过 ' + pass + ' / 失败 ' + fail);
  if (errors.length) { console.log('页面报错：'); errors.slice(0, 5).forEach(e => console.log('  - ' + e)); }
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FATAL', e); process.exit(1); });
