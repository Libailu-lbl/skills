/* 安全员工作台 · 导出（出件）门禁自检（2026-11-10 新增，v1.3.3）
   用法：node smoke_export_gate.js [url]     默认 http://127.0.0.1:8124/index.html

   背景：用户要求「受限模式下的所有导出一并收紧」。
   覆盖：
     ① 权限模型：data.export 能力点、canExport()、唯一提示文案、lockBtn/unlockBtn
     ② 下载落点（第三层）：xlsxWriter / docxWriter 的 download 在受限下不出文件
     ③ 函数入口：excelIO.exportExcel / openImport / downloadTemplate、photoWatermark.open
     ④ 顶栏「导出备份」：标锁定态、点了先弹六位密码框、不弹就算没导
     ⑤ 报表（日报 / 周报）：按钮置灰 + 小字说明 + 强解 disabled 也导不出
     ⑥ 交接班：导出按钮置灰
     ⑦ 通知书 / 作业票照片页：「保存为 Word」置灰、「打印」仍可用、提示语说明
     ⑧ 培训「下载照片」：菜单项禁用；弹窗入口直接拦下
     ⑨ 全局兜底 installExportGuard：任意 [data-export] 元素被捕获阶段拦掉
     ⑩ 解锁后全部恢复：按钮可用、弹窗可开、文件真的下出来
*/
const { JSDOM, requestInterceptor, VirtualConsole } = require('jsdom');

const skipPrint = requestInterceptor(r => {
  if (String(r.url).indexOf('print-only.css') >= 0) return new Response('', { headers: { 'Content-Type': 'text/css' } });
});
const wait = ms => new Promise(r => setTimeout(r, ms));

let P = 0, F = 0;
function ok(name, cond, extra) {
  if (cond) P++;
  else { F++; console.log('  FAIL ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : '')); }
}

(async () => {
  const errs = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errs.push('jsdomError: ' + e.message));
  vc.on('error', m => errs.push('console.error: ' + m));

  const dom = await JSDOM.fromURL(process.argv[2] || 'http://127.0.0.1:8124/index.html', {
    runScripts: 'dangerously', resources: { interceptors: [skipPrint] }, pretendToBeVisual: true,
    beforeParse(win) {
      win.matchMedia = q => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      win.fetch = (u, o) => globalThis.fetch(u, o);
      win.Headers = globalThis.Headers; win.Request = globalThis.Request;
      win.Response = globalThis.Response; win.AbortController = globalThis.AbortController;
      win.URL.createObjectURL = () => 'blob:stub';
      win.URL.revokeObjectURL = () => {};
      win.scrollTo = () => {};
      win.print = () => {};
    },
    virtualConsole: vc
  });
  const win = dom.window, doc = win.document;
  for (let i = 0; i < 120 && !(win.SD && win.SD.app && win.SD.app.state.summary); i++) await wait(120);
  const SD = win.SD;
  const view = () => doc.getElementById('view');
  const go = async (id) => { win.location.hash = '#/' + id; await wait(650); };
  const dlgOpen = () => !!doc.querySelector('#dialogRoot .mask');

  /* 记录「真的下出文件」的次数：所有落点最后都是 URL.createObjectURL(blob) */
  let blobCalls = 0;
  win.URL.createObjectURL = function () { blobCalls++; return 'blob:stub'; };
  const resetBlob = () => { blobCalls = 0; };

  /* 记录 toast 文案（各模块都是动态调 U.toast，改一处即全局生效） */
  let toasts = [];
  const origToast = SD.utils.toast;
  SD.utils.toast = function (msg, type) { toasts.push({ msg: String(msg), type: type }); return origToast.apply(SD.utils, arguments); };
  const resetToast = () => { toasts = []; };
  const denied = () => toasts.some(t => /需要安全员权限/.test(t.msg));

  /* 空白版初始没数据：造一条培训（带照片）+ 一条设备人员台账，
     这样「操作 ▾ → 下载照片」「导出台账」才有东西可测 */
  const db = SD.store.data();
  db.trainings = [{
    id: 'TR-GATE', code: 'PX-9000001', name: '门禁自检培训', type: '三级教育',
    target: '全员', trainer: '安全科', startDate: SD.utils.today(), status: 'done',
    photos: ['data:image/png;base64,iVBORw0KGgo=']
  }];
  db.devicePersonnel = [{
    id: 'DP-GATE', code: 'SB-9000001', name: '张三', dept: '仓储物流部',
    certType: 'N1', idNo: 'T9000001', validTo: SD.utils.shift(SD.utils.today(), 200), status: 'ok'
  }];
  SD.store.save();
  await SD.app.reload();
  await wait(500);

  console.log('== 1. 权限模型 ==');
  ok('打开即受限', SD.auth.current() === 'restricted', SD.auth.current());
  ok('受限：canExport() 为 false', SD.auth.canExport() === false);
  ok('受限：can("data.export") 为 false', SD.auth.can('data.export') === false);
  ok('安全员角色声明了 data.export 能力点',
    (SD.auth.ROLES.safety_officer.perms || []).indexOf('data.export') >= 0);
  ok('受限角色没有 data.export', (SD.auth.ROLES.restricted.perms || []).indexOf('data.export') < 0);
  ok('有唯一提示文案 DENY_EXPORT_MSG', typeof SD.auth.DENY_EXPORT_MSG === 'string' && /安全员权限/.test(SD.auth.DENY_EXPORT_MSG));
  ok('受限角色描述改成「只能查看与打印」', /只能查看与打印/.test(SD.auth.ROLES.restricted.desc), SD.auth.ROLES.restricted.desc);
  ok('lockBtn / unlockBtn / denyExport 都导出', typeof SD.auth.lockBtn === 'function' &&
    typeof SD.auth.unlockBtn === 'function' && typeof SD.auth.denyExport === 'function');
  const tmpBtn = doc.createElement('button');
  tmpBtn.textContent = 'x';
  SD.auth.lockBtn(tmpBtn, '测试锁定');
  ok('lockBtn：禁用 + is-locked + aria + title',
    tmpBtn.disabled === true && tmpBtn.classList.contains('is-locked') &&
    tmpBtn.getAttribute('aria-disabled') === 'true' && tmpBtn.getAttribute('title') === '测试锁定');
  SD.auth.unlockBtn(tmpBtn, '恢复');
  ok('unlockBtn：复原（可点 / 去类 / 去 aria）',
    tmpBtn.disabled === false && !tmpBtn.classList.contains('is-locked') && !tmpBtn.hasAttribute('aria-disabled'));

  console.log('== 2. 下载落点（第三层）：受限下不出文件 ==');
  resetBlob(); resetToast();
  SD.comp.xlsxWriter.download(new win.Blob(['x']), 'a.xlsx');
  ok('xlsxWriter.download 被拦，没有生成文件', blobCalls === 0, blobCalls + ' 次 createObjectURL');
  ok('xlsxWriter.download 被拦时给了提示', denied());
  resetBlob(); resetToast();
  SD.comp.docxWriter.download(new win.Blob(['x']), 'a.docx');
  ok('docxWriter.download 被拦，没有生成文件', blobCalls === 0, blobCalls + ' 次 createObjectURL');
  ok('docxWriter.download 被拦时给了提示', denied());

  console.log('== 3. 函数入口（第三层）==');
  const XIO = {
    collection: 'devicePersonnel', sheetName: '特种设备人员台账', fileBase: '特种设备人员台账',
    fields: [{ name: 'name', label: '姓名' }, { name: 'dept', label: '部门' }]
  };
  resetBlob(); resetToast();
  SD.comp.excelIO.exportExcel(XIO);
  ok('excelIO.exportExcel 被拦（台账号称的整份导出）', blobCalls === 0, blobCalls);
  ok('excelIO.exportExcel 有提示', denied());
  resetBlob(); resetToast();
  const impDlg = SD.comp.excelIO.openImport(Object.assign({ title: '从 Excel 导入', fields: XIO.fields }, XIO));
  ok('excelIO.openImport 在受限下直接拦下（不返回弹窗）', impDlg == null);
  ok('openImport 被拦时有提示', denied());
  resetBlob(); resetToast();
  const wm = SD.comp.photoWatermark.open(['data:image/png;base64,iVBORw0KGgo='], { code: 'PX-1', title: '测试' });
  ok('photoWatermark.open 在受限下直接拦下（弹窗不打开）', wm == null);
  ok('photoWatermark 被拦时有提示', denied());
  ok('被拦后页面上没有水印弹窗', !doc.querySelector('.wm-mask'));

  console.log('== 4. 顶栏「导出备份」==');
  const gearExport = doc.getElementById('btnExport');
  ok('齿轮里有「导出备份」菜单项', !!gearExport);
  ok('受限时标 is-locked', !!gearExport && gearExport.classList.contains('is-locked'));
  ok('受限时不禁用（点了要先输密码）', !!gearExport && gearExport.disabled !== true);
  ok('提示语写「需解锁」', !!gearExport && /需解锁/.test((gearExport.querySelector('.gi-hint') || {}).textContent || ''),
    (gearExport.querySelector('.gi-hint') || {}).textContent);
  resetBlob(); resetToast();
  if (gearExport) gearExport.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(400);
  ok('点它先弹六位密码框，而不是直接导出', dlgOpen() && !!doc.querySelector('#pinInput'));
  ok('没验密码之前一个文件都没出', blobCalls === 0, blobCalls);

  /* 端到端：密码错 → 不导且弹窗还在；密码对 → 直接导出 */
  const pinEl = doc.querySelector('#pinInput');
  if (pinEl) {
    pinEl.value = '000000';
    doc.querySelector('#dialogRoot .js-ok').click();
    await wait(300);
    ok('密码错：不放行、也不导出', blobCalls === 0 && SD.auth.current() === 'restricted', blobCalls);
    ok('密码错：弹窗仍在', !!doc.querySelector('#pinInput'));
    doc.querySelector('#pinInput').value = SD.auth.DEFAULT_PIN;
    doc.querySelector('#dialogRoot .js-ok').click();
    await wait(600);
    ok('密码对：解锁并真的导出备份', blobCalls > 0, blobCalls);
  }
  /* 退回受限，继续后面的用例 */
  SD.auth.lock();
  await SD.app.reload();
  await wait(400);
  ok('退回受限后 canExport() 又变 false', SD.auth.canExport() === false);

  console.log('== 5. 报表（周报 / 日报）==');
  await go('weeklyReport');
  const rptBtn = view().querySelector('#rptExport');
  ok('周报「生成 Excel」按钮存在', !!rptBtn);
  ok('受限时置灰（disabled）', !!rptBtn && rptBtn.disabled === true);
  ok('受限时有 is-locked 标记', !!rptBtn && rptBtn.classList.contains('is-locked'));
  ok('带 data-export 标记（全局兜底认得）', !!rptBtn && rptBtn.getAttribute('data-export') === '1');
  ok('旁边有「导出已锁定」说明', /导出已锁定/.test(view().textContent));
  resetBlob(); resetToast();
  if (rptBtn) { rptBtn.disabled = false; rptBtn.click(); }
  await wait(500);
  ok('绕过 disabled 直接点也被入口守卫拦住', blobCalls === 0, blobCalls);
  ok('绕过时给的是导出专用提示', denied());

  await go('dailyReport');
  const rptBtn2 = view().querySelector('#rptExport');
  ok('日报「生成 Excel」同样置灰', !!rptBtn2 && rptBtn2.disabled === true && rptBtn2.classList.contains('is-locked'));

  console.log('== 6. 交接班记录 ==');
  await go('shiftLog');
  const slBtn = view().querySelector('.js-sl-xls');
  ok('交接班导出按钮存在且置灰', !!slBtn && slBtn.disabled === true && slBtn.classList.contains('is-locked'));
  ok('交接班导出按钮带 data-export', !!slBtn && slBtn.getAttribute('data-export') === '1');
  ok('交接班仍可打印（纸面留痕不受限）',
    Array.from(view().querySelectorAll('.btn')).some(b => /打印/.test(b.textContent) && !b.disabled));

  console.log('== 7. 通知书 / 作业票照片页：锁 Word、留打印 ==');
  const hz = {
    id: 'HZ-GATE', code: 'FZYH-9000001', title: '门禁自检隐患', dept: '生产一部',
    severity: 'general', type: '消防', status: 'pending',
    foundDate: SD.utils.today(), dueDate: SD.utils.shift(SD.utils.today(), 3),
    owner: '测试员', desc: '自检用隐患描述', photos: []
  };
  const pn = SD.comp.printNotice.open(hz, { ctx: { reload() {} } });
  await wait(300);
  const pnDoc = doc.querySelector('.pn-overlay .js-doc');
  const pnPrint = doc.querySelector('.pn-overlay .js-print');
  ok('通知书预览能打开（受限也能看）', !!doc.querySelector('.pn-overlay'));
  ok('「保存为 Word」置灰 + is-locked', !!pnDoc && pnDoc.disabled === true && pnDoc.classList.contains('is-locked'));
  ok('「打印」仍然可点', !!pnPrint && pnPrint.disabled !== true);
  ok('工具栏提示改成「可打印，保存为 Word 已锁定」', /保存为 Word 已锁定/.test(doc.querySelector('.pn-tip').textContent),
    doc.querySelector('.pn-tip').textContent);
  ok('「上传现场照片」置灰（属写操作）', doc.querySelector('.pn-overlay .js-upload').disabled === true);
  resetBlob(); resetToast();
  if (pnDoc) { pnDoc.disabled = false; pnDoc.click(); }
  await wait(600);
  ok('绕过按钮点「保存为 Word」也没出 .docx', blobCalls === 0, blobCalls);
  if (pn) pn.close();
  await wait(200);

  const wp = { id: 'WP-GATE', code: 'FZDH-9000001', type: '动火作业', place: '一号车间', date: SD.utils.today(), photos: [] };
  const pp = SD.comp.printPhotos.open(wp, { ctx: { reload() {} } });
  await wait(300);
  const ppDoc = doc.querySelector('.pp-overlay .js-doc');
  ok('照片页预览能打开', !!doc.querySelector('.pp-overlay'));
  ok('照片页「保存为 Word」置灰', !!ppDoc && ppDoc.disabled === true && ppDoc.classList.contains('is-locked'));
  ok('照片页「打印」仍可点', doc.querySelector('.pp-overlay .js-print').disabled !== true);
  ok('照片页提示说明受限', /保存为 Word 已锁定/.test(doc.querySelector('.pp-tip').textContent));
  resetBlob();
  if (ppDoc) { ppDoc.disabled = false; ppDoc.click(); }
  await wait(600);
  ok('照片页绕过按钮也不会出 .docx', blobCalls === 0, blobCalls);
  if (pp) pp.close();
  await wait(200);

  console.log('== 8. 培训「下载照片」==');
  await go('training');
  const trOps = view().querySelector('[data-act="tops"]');
  ok('培训列表渲染出「操作 ▾」', !!trOps);
  if (trOps) {
    trOps.click();
    await wait(250);
    const ddItems = Array.from(doc.querySelectorAll('.dd-item'));
    const dl = ddItems.filter(x => /下载照片/.test(x.textContent))[0];
    ok('菜单里「下载照片」标为受限不可用', !!dl && /受限模式不可用/.test(dl.textContent),
      dl && dl.textContent);
    ok('该项带 disabled 标记', !!dl && (dl.getAttribute('aria-disabled') === 'true' || dl.classList.contains('is-disabled') || dl.disabled === true));
    resetBlob(); resetToast();
    if (dl) dl.click();
    await wait(400);
    ok('点禁用项不会打开水印弹窗', !doc.querySelector('.wm-mask'));
    ok('也没有下出任何照片文件', blobCalls === 0, blobCalls);
    doc.body.click();
    await wait(150);
  }

  console.log('== 9. 全局兜底 installExportGuard ==');
  let hitCount = 0;
  const ghost = doc.createElement('button');
  ghost.setAttribute('data-export', '1');
  ghost.textContent = '假导出';
  ghost.addEventListener('click', () => { hitCount++; });
  doc.body.appendChild(ghost);
  resetToast();
  ghost.click();
  await wait(200);
  ok('受限下任意 [data-export] 元素在捕获阶段被拦（回调不执行）', hitCount === 0, hitCount);
  ok('拦截时给出统一提示', denied(), JSON.stringify(toasts));
  ghost.parentNode.removeChild(ghost);

  console.log('== 10. 解锁后全部恢复 ==');
  SD.auth.set('safety_officer');
  await SD.app.reload();
  await wait(500);
  ok('解锁后 canExport() 为 true', SD.auth.canExport() === true);

  const gear2 = doc.getElementById('btnExport');
  ok('顶栏「导出备份」取消锁定态', !!gear2 && !gear2.classList.contains('is-locked'));
  ok('顶栏提示回到「JSON」', /JSON/.test((gear2.querySelector('.gi-hint') || {}).textContent || ''));
  resetBlob(); resetToast();
  gear2.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(500);
  ok('解锁后点顶栏导出直接出文件（不再弹密码框）', blobCalls > 0 && !doc.querySelector('#pinInput'), blobCalls);

  await go('weeklyReport');
  const rpt3 = view().querySelector('#rptExport');
  ok('周报导出按钮恢复可点', !!rpt3 && rpt3.disabled !== true && !rpt3.classList.contains('is-locked'));
  resetBlob();
  if (rpt3) rpt3.click();
  await wait(600);
  ok('周报真的生成 .xlsx', blobCalls > 0, blobCalls);

  await go('shiftLog');
  const sl3 = view().querySelector('.js-sl-xls');
  ok('交接班导出按钮恢复可点', !!sl3 && sl3.disabled !== true && !sl3.classList.contains('is-locked'));

  resetBlob(); resetToast();
  SD.comp.excelIO.exportExcel(XIO);
  ok('台账导出恢复可用', blobCalls > 0, blobCalls);

  const wm2 = SD.comp.photoWatermark.open(['data:image/png;base64,iVBORw0KGgo='], { code: 'PX-1', title: '测试' });
  await wait(400);
  ok('培训照片弹窗恢复可打开', !!doc.querySelector('.wm-mask'));
  if (wm2 && wm2.close) wm2.close();
  await wait(200);

  const pn2 = SD.comp.printNotice.open(hz, { ctx: { reload() {} } });
  await wait(250);
  ok('通知书「保存为 Word」恢复可点', doc.querySelector('.pn-overlay .js-doc').disabled !== true);
  if (pn2) pn2.close();
  await wait(150);

  /* jsdom 对 <a download> 的 blob 导航会报 "Not implemented: navigation"，
     这是 jsdom 的环境限制，不是页面脚本报错，单独排除 */
  const realErrs = errs.filter(e => !/navigation to another Document/.test(e));
  ok('全程没有脚本报错', realErrs.length === 0, realErrs.slice(0, 3));

  console.log('\n结果：通过 ' + P + ' / 失败 ' + F + (realErrs.length ? ' （脚本报错 ' + realErrs.length + ' 条）' : ''));
  process.exit(F ? 1 : 0);
})();
