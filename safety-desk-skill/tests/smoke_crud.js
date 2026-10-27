/* 安全员工作台 · 录入能力回归（新增 / 编辑 / 删除）
   用法：node smoke_crud.js [url]
   覆盖：巡检、培训、证书、通知 四模块 CRUD + 隐患编辑/作废 + 表单校验拦截
   注：2026-10-21 起单据编号为手动必填，新增时表单需手填编号
*/
const { JSDOM, requestInterceptor } = require('jsdom');
/* jsdom 不评估 media="print"：print-only.css 的 display:none !important 会把整个 .app 子树
   在测试环境里打成不可聚焦（焦点类断言全假失败）——拦截该请求返回空 CSS，
   屏幕规则不受影响（该表本身的规则断言由 smoke_print.js 负责） */
const noPrintSheet = requestInterceptor(function (request) {
  if (String(request.url).indexOf('print-only.css') >= 0) {
    return new Response('', { headers: { 'Content-Type': 'text/css' } });
  }
});

const URL_ = process.argv[2] || 'http://127.0.0.1:8124/index.html';
const wait = ms => new Promise(r => setTimeout(r, ms));

/* stored（不压缩）ZIP 解包：docxWriter 产出的条目都是 stored，读本地头即可 */
function unzipStored(buf) {
  const out = {};
  let p = 0;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  while (p + 30 <= buf.length && dv.getUint32(p, true) === 0x04034b50) {
    const nameLen = dv.getUint16(p + 26, true);
    const extraLen = dv.getUint16(p + 28, true);
    const compSize = dv.getUint32(p + 18, true);
    const name = Buffer.from(buf.slice(p + 30, p + 30 + nameLen)).toString('utf8');
    const dataStart = p + 30 + nameLen + extraLen;
    out[name] = buf.slice(dataStart, dataStart + compSize);
    p = dataStart + compSize;
  }
  return out;
}

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  OK  ' + name + (extra ? ' => ' + extra : '')); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' => ' + extra : '')); }
}

(async () => {
  const errors = [];
  const dom = await JSDOM.fromURL(URL_, {
    runScripts: 'dangerously', resources: { interceptors: [noPrintSheet] }, pretendToBeVisual: true,
    beforeParse(win) {
      win.matchMedia = q => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      win.fetch = (u, o) => globalThis.fetch(u, o);
      win.Headers = globalThis.Headers; win.Request = globalThis.Request;
      win.Response = globalThis.Response; win.AbortController = globalThis.AbortController;
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

  /* ---------- 工具 ---------- */
  const go = async r => { win.location.hash = '#/' + r; await wait(320); };
  const clickText = (sel, re) => {
    const b = Array.from(doc.querySelectorAll(sel)).find(x => re.test(x.textContent || ''));
    if (b) b.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    return !!b;
  };
  /* 2026-10-19 起所有模块操作列统一收成「操作 ▾」下拉：
     点触发按钮 → 在 .dd-menu 里点匹配文字的菜单项。返回 {ok, id, why}。 */
  const pickOps = async (act, re, id) => {
    const sel = '#view [data-act="' + act + '"]' + (id ? '[data-id="' + id + '"]' : '');
    const btn = doc.querySelector(sel);
    if (!btn) return { ok: false, why: 'no-btn' };
    const rid = btn.dataset.id;
    btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await wait(220);
    const menu = doc.querySelector('.dd-menu');
    if (!menu) return { ok: false, id: rid, why: 'no-menu' };
    const item = Array.from(menu.querySelectorAll('.dd-item')).find(x => re.test(x.textContent || ''));
    if (!item) return { ok: false, id: rid, why: 'no-item', menu: menu };
    item.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await wait(220);
    return { ok: true, id: rid, menu: menu };
  };
  const modal = () => doc.querySelector('.mask');
  const view = () => doc.querySelector('#view');
  const set = (m, id, v) => { const e = m.querySelector('#' + id); if (e) e.value = v; return !!e; };
  const submit = async (m, ms = 1700) => {
    m.querySelector('.js-ok').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await wait(ms);
  };
  const errText = m => { const e = m && m.querySelector('.field-err'); return e && !e.hidden ? e.textContent : ''; };
  const n = k => (SD.app.state.summary[k] || []).length;
  const Y = String(new Date().getFullYear());
  /* 1×1 JPEG，测试里当照片用（不解码，只走 dataURL 字符串流程） */
  const P1 = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
    'HBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPDs0NDT/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy' +
    'MjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIE' +
    'AwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZ' +
    'WmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx' +
    '8vP09fb3+Pn6/9oACAEBAAA/APn+gD//2Q==';


  console.log('== 1. 巡检：新增 ==');
  await go('inspection');
  const i0 = n('inspections');
  ok('找到「新增巡检」按钮', clickText('#view .btn', /新增巡检/));
  await wait(200);
  let m = modal();
  ok('弹窗打开', !!m);
  ok('表单字段齐全', !!m.querySelector('#ff_planName') && !!m.querySelector('#ff_scheduledDate'));
  set(m, 'ff_planName', '冒烟-临时用电专项巡检');
  set(m, 'ff_code', 'FZXJ-' + Y + '-998');
  set(m, 'ff_area', 'B 区配电室');
  set(m, 'ff_executor', '王安全');
  await submit(m);
  const i1 = n('inspections');
  ok('巡检 +1', i1 === i0 + 1, i0 + ' → ' + i1);
  const newIns = SD.app.state.summary.inspections.find(x => x.planName === '冒烟-临时用电专项巡检');
  ok('编号为手填值 FZXJ-' + Y + '-998', !!newIns && newIns.code === 'FZXJ-' + Y + '-998', newIns && newIns.code);
  ok('新巡检状态为待执行', newIns && newIns.status === 'planned', newIns && newIns.status);

  console.log('== 2. 巡检：编辑（操作列已改下拉） ==');
  await go('inspection');
  const insOps = await pickOps('iops', /编辑/);
  ok('操作列是下拉菜单，可选「编辑」', insOps.ok, insOps.why || '');
  await wait(200);
  m = modal();
  ok('编辑弹窗打开', !!m);
  // 按被点那一行的 id 取，不能用 summary[0]：巡检页默认按「本周」筛选，
  // 表格第一行未必是 summary 里的第一条（且会随当天是周几漂移）
  const insTarget = SD.app.state.summary.inspections.find(x => x.id === insOps.id);
  set(m, 'ff_planName', '冒烟-已改名巡检');
  await submit(m);
  const insAfter = SD.app.state.summary.inspections.find(x => x.id === insTarget.id);
  ok('名称已更新', insAfter && insAfter.planName === '冒烟-已改名巡检', insAfter && insAfter.planName);

  console.log('== 3. 巡检：删除 ==');
  await go('inspection');
  const i2 = n('inspections');
  const insDel = await pickOps('iops', /删除/);
  ok('下拉里可选「删除」', insDel.ok, insDel.why || '');
  const delId = insDel.id;
  m = modal();
  ok('删除二次确认弹出', !!m && /删除巡检任务/.test(m.textContent));
  await submit(m);
  const i3 = n('inspections');
  ok('巡检 -1', i3 === i2 - 1, i2 + ' → ' + i3);
  ok('被删记录确实消失', !SD.app.state.summary.inspections.some(x => x.id === delId));
  console.log('== 4. 巡检：区域独立列 + 巡查照片 ==');
  await go('inspection');
  {
    const heads = Array.from(view().querySelectorAll('th')).map(th => th.textContent.trim());
    ok('表头有独立「区域」列', heads.indexOf('区域') >= 0, heads.join(' | '));
    ok('计划名称格不再带区域小字', !Array.from(view().querySelectorAll('.cell-sub')).some(d => /B 区配电室|A 区/.test(d.textContent)));
  }
  // 4b. 新增一条带照片的巡检
  const ip0 = n('inspections');
  ok('找到「新增巡检」按钮', clickText('#view .btn', /新增巡检/));
  await wait(260);
  m = modal();
  ok('巡检弹窗打开', !!m);
  const ipSlot = m && m.querySelector('#ff_photos');
  ok('新增表单有「巡查照片」位', !!ipSlot,
    !!m && Array.from(m.querySelectorAll('.field > span')).map(x => x.textContent).join(' | '));
  if (ipSlot && ipSlot._ph) ipSlot._ph.set([P1]);
  ok('照片选择器回读到 1 张', !!(ipSlot && ipSlot._ph && ipSlot._ph.get().length === 1));
  set(m, 'ff_planName', '冒烟-带照片巡检');
  set(m, 'ff_code', 'FZXJ-' + Y + '-997');
  set(m, 'ff_area', 'C 区空压机房');
  set(m, 'ff_executor', '王安全');
  await submit(m);
  const ipNew = SD.app.state.summary.inspections.find(x => x.planName === '冒烟-带照片巡检');
  ok('巡检 +1', n('inspections') === ip0 + 1, ip0 + ' → ' + n('inspections'));
  ok('照片随巡检存进记录', !!ipNew && (ipNew.photos || []).length === 1,
    ipNew && String((ipNew.photos || []).length));
  // 4c. 点区域名 → 开大图（首图、标题、角标）
  await go('inspection');
  const areaEl = Array.from(view().querySelectorAll('.js-insp-area'))
    .find(el => el.dataset.id === (ipNew && ipNew.id));
  ok('列表里找到该巡检的区域格', !!areaEl);
  ok('有照片时区域名挂「照片 1」角标', !!areaEl && /照片 1/.test(areaEl.textContent), areaEl && areaEl.textContent);
  ok('区域名有 link 样式（可点）', !!areaEl && /link/.test(areaEl.className), areaEl && areaEl.className);
  if (areaEl) areaEl.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(240);
  let lb = doc.querySelector('.lb-mask');
  ok('点区域名打开大图', !!lb);
  ok('大图首张为该巡检照片', !!lb && lb.querySelector('.lb-img').getAttribute('src') === ipNew.photos[0]);
  ok('大图标题带编号与区域', !!lb && new RegExp(ipNew.code).test(lb.querySelector('.lb-cap').textContent),
    lb && lb.querySelector('.lb-cap').textContent);
  if (lb) lb.querySelector('.lb-close').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(160);
  ok('大图已关闭', !doc.querySelector('.lb-mask'));
  // 4d. 无照片的巡检：点区域只提示，不弹图
  const np0 = n('inspections');
  ok('再新增一条不带照片的巡检', clickText('#view .btn', /新增巡检/));
  await wait(260);
  m = modal();
  ok('巡检弹窗打开（无照片版）', !!m);
  set(m, 'ff_planName', '冒烟-无照片巡检');
  set(m, 'ff_code', 'FZXJ-' + Y + '-996');
  set(m, 'ff_area', 'D 区危化品库');
  set(m, 'ff_executor', '王安全');
  await submit(m);
  const npNew = SD.app.state.summary.inspections.find(x => x.planName === '冒烟-无照片巡检');
  ok('巡检 +1（无照片版）', n('inspections') === np0 + 1, np0 + ' → ' + n('inspections'));
  await go('inspection');
  const noneEl = Array.from(view().querySelectorAll('.js-insp-area'))
    .find(el => el.dataset.id === (npNew && npNew.id));
  ok('找到无照片巡检的区域格', !!noneEl);
  if (noneEl) noneEl.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(200);
  ok('无照片点了不弹大图', !doc.querySelector('.lb-mask'));
  // 4e. 先标记完成，再看执行记录弹窗：照片行 + 查看按钮
  const doneIns = await pickOps('iops', /标记完成/, ipNew && ipNew.id);
  ok('待执行状态下拉里可选「标记完成」', doneIns.ok, doneIns.why || '');
  m = modal();
  ok('完成弹窗打开', !!m);
  if (m) {
    set(m, 'i_findings', '冒烟-完成验收：存量正常');
    set(m, 'i_hz', '0');
    await submit(m);
  }
  await go('inspection');
  const recIns = await pickOps('iops', /执行记录/, ipNew && ipNew.id);
  ok('已完成巡检下拉里有「执行记录」', recIns.ok, recIns.why || '');
  m = modal();
  ok('执行记录弹窗打开', !!m);
  ok('弹窗里有「巡查照片」行', !!m && /巡查照片/.test(m.textContent), m && m.textContent.slice(0, 120));
  const phBtn = m && m.querySelector('.js-insp-ph');
  ok('有「查看 1 张照片」按钮', !!phBtn, phBtn && phBtn.textContent);
  if (phBtn) phBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(220);
  lb = doc.querySelector('.lb-mask');
  ok('弹窗内点查看也开大图', !!lb && lb.querySelector('.lb-img').getAttribute('src') === ipNew.photos[0]);
  if (lb) lb.querySelector('.lb-close').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(160);
  ok('大图已关闭（弹窗）', !doc.querySelector('.lb-mask'));
  if (m) m.querySelector('.js-cancel').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(150);


  console.log('== 4. 培训：新增 / 删除 ==');
  await go('training');
  const t0 = n('trainings');
  ok('找到「新增培训」按钮', clickText('#view .btn', /新增培训/));
  await wait(200);
  m = modal();
  ok('培训弹窗打开', !!m);
  set(m, 'ff_name', '冒烟-有限空间作业专项培训');
  set(m, 'ff_code', 'FZPX-' + Y + '-998');
  set(m, 'ff_target', '有限空间作业人员');
  set(m, 'ff_startDate', SD.utils.today());
  set(m, 'ff_endDate', SD.utils.shift(SD.utils.today(), 2));
  set(m, 'ff_required', '20');
  set(m, 'ff_actual', '18');
  await submit(m);
  const t1 = n('trainings');
  ok('培训 +1', t1 === t0 + 1, t0 + ' → ' + t1);
  const newTr = SD.app.state.summary.trainings.find(x => x.name === '冒烟-有限空间作业专项培训');
  ok('编号为手填值 FZPX-' + Y + '-998', !!newTr && newTr.code === 'FZPX-' + Y + '-998', newTr && newTr.code);

  // 校验：实到 > 应到 必须被拦（编号先填合法值，确保拦的是人数规则）
  await go('training');
  clickText('#view .btn', /新增培训/);
  await wait(200);
  m = modal();
  set(m, 'ff_name', '冒烟-人数校验');
  set(m, 'ff_code', 'FZPX-' + Y + '-997');
  set(m, 'ff_target', '测试对象');
  set(m, 'ff_startDate', SD.utils.today());
  set(m, 'ff_endDate', SD.utils.shift(SD.utils.today(), 1));
  set(m, 'ff_required', '10');
  set(m, 'ff_actual', '99');
  await submit(m, 400);
  ok('实到>应到被拦截', !!modal() && /实到人数不能大于应到人数/.test(errText(modal())), errText(modal()));
  ok('拦截时弹窗不关闭', !!modal());
  modal().querySelector('.js-cancel').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(150);

  /* 2026-10-19 起「培训与证书」精简为纯培训：证书 UI 已整体移除，
     这里改为校验「删除 + 确无证书入口」，证书本身的数据/API 仍在。 */
  console.log('== 5. 培训：删除 / 模块已无证书入口 ==');
  await go('training');
  const t2 = n('trainings');
  const trDel = await pickOps('tops', /删除/);
  ok('培训操作列是下拉菜单，可选「删除」', trDel.ok, trDel.why || '');
  const trDelId = trDel.id;
  m = modal();
  ok('培训删除二次确认', !!m && /删除培训计划/.test(m.textContent));
  await submit(m);
  ok('培训 -1', n('trainings') === t2 - 1, t2 + ' → ' + n('trainings'));
  ok('被删培训确实消失', !SD.app.state.summary.trainings.some(x => x.id === trDelId));
  ok('培训页已无「新增证书」入口',
    !Array.from(doc.querySelectorAll('#view .btn')).some(b => /新增证书/.test(b.textContent || '')));
  ok('培训页已无证书台账', !/证书台账/.test(doc.querySelector('#view').textContent || ''));
  ok('证书数据仍在（只是不展示）', n('certificates') > 0, String(n('certificates')));

  console.log('== 6. 通知：发布 / 置顶 / 删除 ==');
  await go('notice');
  const n0 = n('notices');
  ok('找到「发布通知」按钮', clickText('#view .btn', /发布通知/));
  await wait(200);
  m = modal();
  ok('通知弹窗打开', !!m);
  set(m, 'ff_title', '冒烟-四季度消防专项检查通知');
  set(m, 'ff_code', 'FZTG-' + Y + '-998');
  set(m, 'ff_source', '安环部');
  set(m, 'ff_summary', '请各部门于本周五前完成自查。');
  const pin = m.querySelector('#ff_pinned');
  ok('有置顶开关', !!pin);
  if (pin) pin.checked = true;
  await submit(m);
  const n1 = n('notices');
  ok('通知 +1', n1 === n0 + 1, n0 + ' → ' + n1);
  const newNt = SD.app.state.summary.notices.find(x => x.title === '冒烟-四季度消防专项检查通知');
  ok('置顶已生效', !!newNt && newNt.pinned === true, String(newNt && newNt.pinned));
  ok('通知编号为手填值', !!newNt && newNt.code === 'FZTG-' + Y + '-998', newNt && newNt.code);

  // 通知条目的编辑/删除同样收成「操作 ▾」下拉
  const ntDel = await pickOps('nops', /删除/);
  ok('通知操作是下拉菜单，可选「删除」', ntDel.ok, ntDel.why || '');
  m = modal();
  ok('通知删除二次确认', !!m && /删除公告/.test(m.textContent || ''), m ? '' : '无弹窗');
  if (m) await submit(m);
  ok('通知 -1', n('notices') === n1 - 1, n1 + ' → ' + n('notices'));
  ok('被删通知确实消失', !SD.app.state.summary.notices.some(x => x.id === ntDel.id));

  console.log('== 7. 隐患：编辑（改期限必须留痕） ==');
  await go('hazard');
  SD.app.state.filters.hazard.q = '';
  SD.app.state.filters.hazard.status = 'all';
  SD.app.refreshAll();
  await wait(300);
  const hz = SD.app.state.summary.hazards.find(h => h.status === 'pending' || h.status === 'fixing');
  ok('取到一条在办隐患', !!hz, hz && hz.code);
  const editId = hz && hz.id;
  const opsE = doc.querySelector('#view [data-act="ops"][data-id="' + editId + '"]');
  ok('取到该行的操作下拉菜单', !!opsE);
  opsE.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(220);
  const menuE = doc.querySelector('.dd-menu');
  const editBtn = menuE && Array.from(menuE.querySelectorAll('.dd-item')).find(el => /编辑/.test(el.textContent));
  ok('菜单里有「编辑」', !!editBtn, editBtn && editBtn.textContent);
  editBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(220);
  m = modal();
  ok('隐患编辑弹窗打开', !!m && /编辑隐患/.test(m.textContent));
  const target = SD.app.state.summary.hazards.find(h => h.id === editId);
  const origDue = target.originalDueDate || target.dueDate;
  const flow0 = (target.flow || []).length;
  set(m, 'ff_dueDate', SD.utils.shift(SD.utils.today(), 30));
  await submit(m, 400);   // 不填变更说明
  ok('改期限未填说明被拦截', !!modal() && /变更说明/.test(errText(modal())), errText(modal()));
  set(modal(), 'ff_note', '供应商备件到货延迟，经批准顺延');
  await submit(modal());
  const after = SD.app.state.summary.hazards.find(h => h.id === editId);
  ok('期限已更新', after && after.dueDate === SD.utils.shift(SD.utils.today(), 30), after && after.dueDate);
  ok('原始期限未被改写', after && after.originalDueDate === origDue, origDue + ' → ' + (after && after.originalDueDate));
  ok('流转记录已追加留痕', after && (after.flow || []).length === flow0 + 1, flow0 + ' → ' + (after && (after.flow || []).length));

  console.log('== 8. 隐患：作废（不物理删除，且退出在办口径） ==');
  await go('hazard');
  const open0 = SD.app.state.summary.openCount;
  const total0 = SD.app.state.summary.hazards.length;
  // 操作列已收成下拉菜单：点「操作」→ 菜单里选「作废」
  const opsBtn = doc.querySelector('#view [data-act="ops"]');
  ok('操作列是下拉菜单', !!opsBtn);
  const voidId = opsBtn && opsBtn.dataset.id;
  opsBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(220);
  const menu = doc.querySelector('.dd-menu');
  ok('下拉菜单已弹出', !!menu);
  const voidBtn = menu && Array.from(menu.querySelectorAll('.dd-item')).find(el => /作废/.test(el.textContent));
  ok('菜单里有「作废」', !!voidBtn, voidBtn && voidBtn.textContent);
  voidBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(220);
  m = modal();
  ok('作废弹窗打开', !!m && /作废隐患/.test(m.textContent));
  await submit(m, 400);   // 原因必填，先空提交
  ok('作废未填原因被拦截', !!modal() && /作废原因/.test(errText(modal())), errText(modal()));
  set(modal(), 'ff_reason', '冒烟测试：重复登记');
  await submit(modal());
  const vz = SD.app.state.summary.hazards.find(h => h.id === voidId);
  ok('状态已置为 void', vz && vz.status === 'void', vz && vz.status);
  ok('台账条数不减（留痕）', SD.app.state.summary.hazards.length === total0, total0 + ' → ' + SD.app.state.summary.hazards.length);
  ok('未闭环数 -1', SD.app.state.summary.openCount === open0 - 1, open0 + ' → ' + SD.app.state.summary.openCount);
  ok('作废项不计逾期', vz && vz._overdue === false);
  ok('作废项有留痕记录', vz && (vz.flow || []).some(f => /作废/.test(f.to || '') || /作废/.test(f.note || '')));

  console.log('== 9. 必填校验（通用表单） ==');
  await go('inspection');
  clickText('#view .btn', /新增巡检/);
  await wait(200);
  m = modal();
  set(m, 'ff_planName', '');
  await submit(m, 400);
  ok('必填为空被拦截', !!modal() && /不能为空/.test(errText(modal())), errText(modal()));
  modal().querySelector('.js-cancel').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(150);


  console.log('== 10. 登记隐患：照片随单保存 ==');
  await go('hazard');
  const hz0 = n('hazards');
  ok('找到「登记隐患」按钮', clickText('#view .btn', /登记隐患/));
  await wait(260);
  m = modal();
  ok('登记弹窗打开', !!m);
  const phSlot = m && m.querySelector('#f_photos');
  ok('登记表单有照片位', !!phSlot);
  ok('照片选择器已挂载（onMount 生效）', !!(phSlot && phSlot._ph && typeof phSlot._ph.get === 'function'));
  if (phSlot && phSlot._ph) phSlot._ph.set([P1]);
  ok('选择器回读到 1 张', !!(phSlot && phSlot._ph && phSlot._ph.get().length === 1));
  set(m, 'f_code', 'FZYH-0000996');
  set(m, 'f_title', '冒烟-带照片隐患');
  set(m, 'f_due', SD.utils.shift(SD.utils.today(), 7));
  await submit(m);
  const hzNew = SD.app.state.summary.hazards.find(x => x.title === '冒烟-带照片隐患');
  ok('隐患 +1', n('hazards') === hz0 + 1, hz0 + ' → ' + n('hazards'));
  ok('照片随隐患存进台账', !!hzNew && (hzNew.photos || []).length === 1,
    hzNew && String((hzNew.photos || []).length));

  console.log('== 11. 作业票：照片字段 + 单页 A4 出件 ==');
  await go('specPermit');
  const wp0 = n('workPermits');
  ok('找到「新增作业票」按钮', clickText('#view .btn', /新增作业票/));
  await wait(260);
  m = modal();
  ok('作业票弹窗打开', !!m);
  const wpSlot = m && m.querySelector('#ff_photos');
  ok('作业票表单有照片位', !!wpSlot);
  ok('照片选择器已挂载', !!(wpSlot && wpSlot._ph));
  if (wpSlot && wpSlot._ph) wpSlot._ph.set([P1, P1]);
  set(m, 'ff_code', 'FZDH-0000996');
  set(m, 'ff_location', '冒烟-照片打印测试位');
  set(m, 'ff_dept', '安环部');
  set(m, 'ff_applicant', '王安全');
  set(m, 'ff_leader', '王安全');
  set(m, 'ff_guardian', '孙浩');
  set(m, 'ff_planStart', SD.utils.today());
  set(m, 'ff_planEnd', SD.utils.today());
  await submit(m);
  const wpNew = SD.app.state.summary.workPermits.find(x => x.location === '冒烟-照片打印测试位');
  ok('作业票 +1', n('workPermits') === wp0 + 1, wp0 + ' → ' + n('workPermits'));
  ok('照片随作业票保存', !!wpNew && (wpNew.photos || []).length === 2,
    wpNew && String((wpNew.photos || []).length));

  // 操作 → 照片（打印 / Word）
  await go('specPermit');
  const wpOps = Array.from(doc.querySelectorAll('#view [data-act="pops"]'))
    .find(b => wpNew && b.dataset.id === wpNew.id);
  ok('取到该作业票的操作菜单', !!wpOps);
  wpOps.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(240);
  const wpMenu = doc.querySelector('.dd-menu');
  const photoItem = wpMenu && Array.from(wpMenu.querySelectorAll('.dd-item'))
    .find(el => /照片/.test(el.textContent || ''));
  ok('菜单里有「照片（打印 / Word）」', !!photoItem, photoItem && photoItem.textContent);
  photoItem.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(340);
  const ov = doc.querySelector('.pp-overlay');
  ok('照片出件页打开', !!ov);
  ok('纸张已渲染网格', !!doc.querySelector('.pp-sheet .pp-grid'));
  ok('两张照片都排上', doc.querySelectorAll('.pp-cell img').length === 2,
    String(doc.querySelectorAll('.pp-cell img').length));
  ok('2 张 → 2 列（不撑出第二页）', SD.comp.printPhotos.colsOf(2) === 2);
  ok('12 张仍是 4 列', SD.comp.printPhotos.colsOf(12) === 4);
  ok('有打印与 Word 按钮', !!ov && /打印/.test(ov.textContent) && /Word/.test(ov.textContent));
  if (ov) ov.querySelector('.js-close').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(160);

  // Word 导出：真 .docx 内嵌照片（Word 不认 data:URI，.docx 走 media 部件 + DrawingML 引用）
  const spec = SD.comp.printPhotos.docSpec(wpNew, { photos: (wpNew.photos || []).slice() },
    [{ w: 800, h: 600 }, { w: 600, h: 800 }]);
  ok('docx 出件只有照片表格（无抬头/无备注）', spec.blocks.length === 1 && !!spec.blocks[0].table,
    spec.blocks.length + ' blocks');
  // 一排一张：800×600 横图满行宽（20 列）一行，600×800 竖图 6 列一行
  ok('横竖图各自成行（2 行，span 20 + 6）',
    spec.blocks[0].table.rows.length === 2 &&
    spec.blocks[0].table.rows[0].cells[0].span === 20 && spec.blocks[0].table.rows[1].cells[0].span === 6,
    spec.blocks[0].table.rows.map(r => r.cells[0].span).join(','));
  const bytes = SD.comp.docxWriter.buildBytes(spec);
  const files = unzipStored(bytes);
  ok('.docx 内嵌 2 个图片部件', !!files['word/media/image1.jpg'] && !!files['word/media/image2.jpg'],
    Object.keys(files).filter(k => k.indexOf('media/') >= 0).join(','));
  const dXml = new TextDecoder().decode(files['word/document.xml']);
  ok('document.xml 两条 blip 引用', (dXml.match(/<a:blip r:embed="rId\d+"\/>/g) || []).length === 2,
    (dXml.match(/<a:blip r:embed="rId\d+"\/>/g) || []).length);
  ok('图片按单元格尺寸缩放（EMU 宽高都给了）', /<wp:extent cx="\d+" cy="\d+"\/>/.test(dXml));

  console.log('== 12. 新增功能：状态可选项 / 搜索 / 排序 / 待办一键完成 ==');

  /* 12a. 巡检状态改为编辑表单内可选项（默认待执行；done 自动补完成时间与执行记录） */
  await go('inspection');
  ok('找到「新增巡检」按钮', clickText('#view .btn', /新增巡检/));
  await wait(260);
  m = modal();
  ok('巡检弹窗打开', !!m);
  ok('表单内有状态下拉 #ff_status', !!m && !!m.querySelector('#ff_status'),
    !!m && Array.from(m.querySelectorAll('.field > span')).map(x => x.textContent).join(' | '));
  ok('状态默认「待执行」', !!m && m.querySelector('#ff_status').value === 'planned',
    m && m.querySelector('#ff_status') && m.querySelector('#ff_status').value);
  set(m, 'ff_status', 'done');
  set(m, 'ff_planName', '冒烟-状态已完成巡检');
  set(m, 'ff_code', 'FZXJ-' + Y + '-994');
  set(m, 'ff_area', 'D 区危化品库');
  set(m, 'ff_executor', '李伯陆');
  await submit(m);
  const insDone = SD.app.state.summary.inspections.find(x => x.planName === '冒烟-状态已完成巡检');
  ok('选「已完成」后落库状态为 done', !!insDone && insDone.status === 'done', insDone && insDone.status);
  ok('done 自动补完成时间', !!insDone && !!insDone.completedAt, insDone && insDone.completedAt);
  ok('done 无执行记录时落默认执行记录', !!insDone && !!insDone.record, insDone && insDone.record && insDone.record.findings);
  const doneId = insDone && insDone.id;
  // 编辑回显 + 离开 done 清联动字段
  const edDone = await pickOps('iops', /编辑/, doneId);
  ok('可再编辑这条巡检', edDone.ok, edDone.why || '');
  await wait(200);
  m = modal();
  ok('编辑弹窗状态下拉回显 done', !!m && m.querySelector('#ff_status').value === 'done',
    m && m.querySelector('#ff_status') && m.querySelector('#ff_status').value);
  set(m, 'ff_status', 'planned');
  await submit(m);
  const insBack = SD.app.state.summary.inspections.find(x => x.id === doneId);
  ok('改回待执行后完成时间与记录被清空', !!insBack && !insBack.completedAt && !insBack.record);
  // 清理
  const delDone = await pickOps('iops', /删除/, doneId);
  ok('可删除这条巡检', delDone.ok, delDone.why || '');
  m = modal();
  ok('删除确认弹出', !!m && /删除巡检任务/.test(m.textContent));
  await submit(m);
  ok('删除后记录消失', !SD.app.state.summary.inspections.some(x => x.id === doneId));

  /* 12b. 巡检：关键词搜索（按编号精确命中，不存在词出空态，清空恢复） */
  await go('inspection');
  await wait(200);
  {
    const qBox = view().querySelector('.filters input');
    ok('巡检页有搜索框', !!qBox, !!qBox && qBox.placeholder);
    const rows0 = Array.from(view().querySelectorAll('tbody tr'));
    ok('当前有数据行', rows0.length > 0, rows0.length + ' 行');
    if (qBox && rows0.length) {
      const code0 = rows0[0].querySelector('td').textContent.trim();
      qBox.value = code0;
      qBox.dispatchEvent(new win.Event('input', { bubbles: true }));
      await wait(450);
      const rows1 = Array.from(view().querySelectorAll('tbody tr'));
      ok('按编号只搜到 1 行', rows1.length === 1 && rows1[0].textContent.indexOf(code0) >= 0,
        rows1.length + ' 行，关键词 ' + code0);
      qBox.value = 'zzz-不存在-zzz';
      qBox.dispatchEvent(new win.Event('input', { bubbles: true }));
      await wait(450);
      const rows2 = Array.from(view().querySelectorAll('tbody tr'));
      ok('搜不存在词出空态（0 行 + 提示）', rows2.length === 0 && /没有匹配/.test(view().textContent),
        rows2.length + ' 行');
      qBox.value = '';
      qBox.dispatchEvent(new win.Event('input', { bubbles: true }));
      await wait(450);
      const rows3 = Array.from(view().querySelectorAll('tbody tr'));
      ok('清空搜索后恢复', rows3.length === rows0.length, rows0.length + ' → ' + rows3.length);

      // 连续输入：搜索只重绘列表，输入框 DOM 不重建（连续打字 / 中文输入法都不被打断）
      const liveBox = view().querySelector('[data-keep-focus="insp"]');
      liveBox.focus();
      for (const ch of ['F', 'Z', 'X']) {
        liveBox.value += ch;
        liveBox.dispatchEvent(new win.Event('input', { bubbles: true }));
        await wait(90);
      }
      await wait(450);
      ok('连续输入时输入框 DOM 未被重建（同一元素）',
        view().querySelector('[data-keep-focus="insp"]') === liveBox);
      ok('连续输入的文字完整保留', liveBox.value === 'FZX', liveBox.value);
      ok('焦点始终在输入框', doc.activeElement === liveBox);
    }
  }

  /* 12c. 巡检：表头排序（点列切升降，箭头回显） */
  await go('inspection');
  await wait(200);
  {
    const ths = Array.from(view().querySelectorAll('th.sortable'));
    ok('表头有可排序列', ths.length >= 6, ths.map(t => t.textContent.replace(/[▲▼]/g, '').trim()).join(' | '));
    const thCode = ths.find(t => t.textContent.replace(/[▲▼]/g, '').trim() === '编号');
    ok('编号列可点排序', !!thCode);
    if (thCode) {
      thCode.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      await wait(300);
      ok('排序状态切到编号列', SD.app.state.sort.insp.key === 'code', JSON.stringify(SD.app.state.sort.insp));
      ok('表头出现排序箭头', !!view().querySelector('th .arrow.on'));
      // 重渲析后旧 th 已脱落（闭包里的 dir 还是渲析时的值），必须重新取
      const thCode2 = Array.from(view().querySelectorAll('th.sortable'))
        .find(t => t.textContent.replace(/[▲▼]/g, '').trim() === '编号');
      thCode2.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      await wait(300);
      ok('再点一次切降序', SD.app.state.sort.insp.dir === 'desc', JSON.stringify(SD.app.state.sort.insp));
    }
  }

  /* 12d. 其余版块的搜索框 / 排序控件是否齐备 */
  await go('training');
  await wait(200);
  ok('培训页有搜索框', !!view().querySelector('.filters input'));
  ok('培训页有可排序列', view().querySelectorAll('th.sortable').length >= 4,
    view().querySelectorAll('th.sortable').length + ' 列');

  await go('specPermit');
  await wait(200);
  ok('作业票页有搜索框', !!view().querySelector('.filters input'));
  ok('作业票页有可排序列', view().querySelectorAll('th.sortable').length >= 5,
    view().querySelectorAll('th.sortable').length + ' 列');

  await go('specPersonnel');
  await wait(200);
  ok('特种人员页有搜索框', !!view().querySelector('.filters input'));
  ok('特种人员页有可排序列', view().querySelectorAll('th.sortable').length >= 5,
    view().querySelectorAll('th.sortable').length + ' 列');

  await go('notice');
  await wait(200);
  ok('通知页有搜索框', !!view().querySelector('.js-head input'),
    !!view().querySelector('.js-head input') && view().querySelector('.js-head input').placeholder);
  ok('通知页有排序下拉', !!view().querySelector('select.ctl-select'));

  /* 12e. 待办：四类未完成项 + 一键完成（作业票按状态机推进，培训直接完成） */
  await go('todo');
  await wait(450);
  {
    const items = Array.from(view().querySelectorAll('.todo-item'));
    ok('待办列表有条目', items.length > 0, items.length + ' 条');
    const permitEl = items.find(el => /作业票/.test(el.textContent));
    const trainingEl = items.find(el => /培训/.test(el.textContent));
    const inspEl = items.find(el => /巡检/.test(el.textContent));
    ok('待办含巡检条目', !!inspEl);
    ok('待办含作业票条目', !!permitEl);
    ok('待办含培训条目', !!trainingEl);
    /* mock 延迟 180~520ms：pi + reload 最长约 1s，固定等待会隔零灵器，改轮询 */
    const until = async (pred, maxMs) => {
      for (let i = 0; i < maxMs / 100; i++) {
        if (pred()) return true;
        await wait(100);
      }
      return pred();
    };
    if (permitEl) {
      const code = (permitEl.textContent.match(/FZ[A-Z]{2}-\d+/) || [])[0];
      const before = SD.app.state.summary.workPermits.find(p => p.code === code);
      ok('取到作业票单据 ' + code, !!before, before && before.status);
      permitEl.querySelector('.todo-check').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      await until(() => {
        const a = SD.app.state.summary.workPermits.find(p => p.code === code);
        return !!a && !!before && a.status !== before.status;
      }, 1600);
      const after = SD.app.state.summary.workPermits.find(p => p.code === code);
      ok('一键完成后作业票状态推进', !!after && !!before && after.status !== before.status,
        before && before.status + ' → ' + (after && after.status));
    }
    if (trainingEl) {
      const code = (trainingEl.textContent.match(/FZPX-[\d-]+/) || [])[0];
      const before = SD.app.state.summary.trainings.find(t => t.code === code);
      ok('取到培训单据 ' + code, !!before, before && before.status);
      trainingEl.querySelector('.todo-check').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      await until(() => {
        const a = SD.app.state.summary.trainings.find(t => t.code === code);
        return !!a && a.status === 'done';
      }, 1600);
      const after = SD.app.state.summary.trainings.find(t => t.code === code);
      ok('一键完成后培训标记完成', !!after && after.status === 'done',
        before && before.status + ' → ' + (after && after.status));
    }
  }

  console.log('== 13. 无 JS 报错 ==');
  ok('无 JS 报错', errors.length === 0, errors.slice(0, 3).join(' | '));

  console.log('\n结果：通过 ' + pass + ' / 失败 ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('异常:', (e && e.stack) || e); process.exit(1); });
