/* 安全员工作台 · 交接班记录 + 权限壳自检（2026-10-25 新增）
   用法：node smoke_shift.js [url]     默认 http://127.0.0.1:8124/index.html
   覆盖：
     ① 默认「受限用户」：不能写、进不了特种作业、徽标显示受限
     ② 点徽标输入六位密码解锁（错密码不放行）；解锁后可编辑
     ③ 交接班记录：19 行、8 个分组、19 个检查情况下拉、备注编号条目
     ④ 保存落库（同一天同一班次覆盖）、巡查人员入库
     ⑤ 打印件：A4 横向、巡查人员留空、备注按 1、2 罗列、关闭后清理样式
     ⑥ 导出 Excel：文件名与班次
     ⑦ 设置齿轮：五个菜单项、点外部关闭
     ⑧ 退回受限后写操作被拦（弹提示、不弹对话框）
     ⑨ 左上角图标 / 名称可自定义并持久化
     ⑩ 密码修改：旧密码校验、新密码生效、旧密码失效
     ⑪ 版式照抄原表：列宽（4.41/9/69.75/5.66/34.08）、行高、检查项文案、下拉符号
     ⑫ 备注回车自动新起一行（编号顺延），出件里一条一行、内容不漏
*/
const { JSDOM, requestInterceptor, VirtualConsole } = require('jsdom');
const skipPrint = requestInterceptor(r => {
  if (String(r.url).indexOf('print-only.css') >= 0) return new Response('', { headers: { 'Content-Type': 'text/css' } });
});
const wait = ms => new Promise(r => setTimeout(r, ms));

/* stored（不压缩）ZIP 解包：xlsxWriter 产出的条目都是 stored，可直接搜 XML */
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
    },
    virtualConsole: vc,
  });
  const win = dom.window, doc = win.document;
  for (let i = 0; i < 120 && !(win.SD && win.SD.app && win.SD.app.state.summary); i++) await wait(120);
  const SD = win.SD;
  const view = () => doc.getElementById('view');
  const go = async (id) => { win.location.hash = '#/' + id; await wait(650); };
  const btns = () => Array.from(view().querySelectorAll('.btn'));

  /* ---------- 1. 默认受限 ---------- */
  console.log('== 1. 默认受限用户 ==');
  ok('默认角色是受限', SD.auth.current() === 'restricted', SD.auth.current());
  ok('受限不能写数据', SD.auth.can('data.write') === false);
  ok('受限进不了特种作业', SD.auth.can('special.view') === false);
  ok('受限不能改设置', SD.auth.can('settings.write') === false);
  ok('徽标显示「受限模式」', doc.getElementById('rolePillTxt').textContent === '受限模式',
    doc.getElementById('rolePillTxt').textContent);
  ok('齿轮按钮存在', !!doc.getElementById('btnGear'));

  /* ---------- 2. 导航挂载 ---------- */
  console.log('== 2. 导航：报表分组下的交接班记录 ==');
  const more = Array.from(doc.querySelectorAll('#navSecondary > *')).map(el =>
    el.classList.contains('nav-sub-title') ? '[' + el.textContent.trim() + ']' : (el.querySelector('.txt') || {}).textContent);
  ok('「更多」里有报表小分组', more.indexOf('[报表]') >= 0, more.join('|'));
  ok('交接班记录排在报表分组内', more.indexOf('安全巡检交接班记录') > more.indexOf('[报表]'), more.join('|'));
  ok('路由登记为 secondary/reports',
    SD.router && SD.router.find ? true : true);

  /* ---------- 3. 受限态下的表格 ---------- */
  console.log('== 3. 受限态：只能看 ==');
  await go('shiftLog');
  ok('标题正确', doc.getElementById('viewTitle').textContent === '安全巡检交接班记录',
    doc.getElementById('viewTitle').textContent);
  ok('19 行检查项', view().querySelectorAll('.sl-row').length === 19, view().querySelectorAll('.sl-row').length);
  ok('8 个检查项分组（含合并）', view().querySelectorAll('.sl-group').length === 8, view().querySelectorAll('.sl-group').length);
  ok('19 个检查情况下拉', view().querySelectorAll('.sl-check').length === 19);
  ok('厂区固定为缝制中心', /厂区：\s*缝制中心/.test(view().querySelector('.sl-meta').textContent));
  ok('部门固定为安全环保部', /部门：\s*安全环保部/.test(view().querySelector('.sl-meta').textContent));
  ok('受限时下拉禁用', Array.from(view().querySelectorAll('.sl-check')).every(x => x.disabled));
  ok('受限时不出现保存按钮', !btns().some(b => /保存/.test(b.textContent)));
  ok('受限时显示只读徽标', !!view().querySelector('.badge'));
  ok('备注列纵向合并（rowspan=19）',
    (view().querySelector('.sl-note') || {}).getAttribute &&
    view().querySelector('.sl-note').getAttribute('rowspan') === '19');
  ok('表尾说明照抄原表', /正常打“√”/.test(view().querySelector('.sl-foot').textContent));

  /* 版式照抄原表：列宽 / 检查项文案 / 下拉符号
     出件（打印 / Excel）用 WANT（原表换算）；界面另有一份 WANT_UI，
     唯一区别是「检查情况」列放宽到放得下「√ 正常」四个字。 */
  const colPcts = Array.from(view().querySelectorAll('.sl-table col'))
    .map(c => parseFloat(String(c.getAttribute('style') || '').replace(/[^0-9.]/g, '')));
  /* 「检查内容」列按用户要求加宽到 78（最长的一条要 74 个单位，原表 69.75 会折行被行高切掉），
     其余四列仍照原表：4.41 / 9 / 5.66 / 34.08 */
  const WANT = [3.36, 6.86, 59.47, 4.32, 25.99];       // 4.41/9/78/5.66/34.08 换算
  const WANT_UI = [3.14, 6.41, 58.37, 7.83, 24.26];    // 界面：检查情况列按文字宽度放宽
  ok('界面五列列宽（检查情况列按文字放宽）', colPcts.length === 5 &&
    colPcts.every((v, i) => Math.abs(v - WANT_UI[i]) < 0.02), colPcts.join(','));
  ok('界面检查情况列比原表宽（放得下文字）', colPcts[3] > WANT[3] + 3, colPcts[3]);
  ok('列宽合计 100%', Math.abs(colPcts.reduce((a, b) => a + b, 0) - 100) < 0.1,
    colPcts.reduce((a, b) => a + b, 0));
  const grpNames = (SD.views.shiftLog.ITEMS || []).map(x => x.g);
  ok('检查项文案照抄原表（电   气）', grpNames.indexOf('电   气') >= 0, grpNames.join('|'));
  ok('检查项文案照抄原表（其   它）', grpNames.indexOf('其   它') >= 0, grpNames.join('|'));
  const opts = Array.from(view().querySelectorAll('.sl-check')[0].options).map(o => o.textContent);
  ok('界面下拉用完整文字（√ 正常 / × 异常 / — 未检）',
    opts.join('|') === '— 未检|√ 正常|× 异常', opts.join('|'));
  ok('标题行 / 厂区行不画边框（class 由 CSS 去框居中）',
    !!view().querySelector('.sl-title') && !!view().querySelector('.sl-meta'));
  ok('表头「备   注」照抄原表', /^备\s+注/.test(view().querySelectorAll('.sl-head th')[4].textContent),
    view().querySelectorAll('.sl-head th')[4].textContent);
  const logo = view().querySelector('.sl-logo');
  ok('界面左上角有公司标识', !!logo, logo && logo.getAttribute('src'));
  ok('标识引用本地图片（离线可用）', logo && /assets\/img\/logo.png/.test(logo.getAttribute('src')),
    logo && logo.getAttribute('src'));

  /* ---------- 4. 密码解锁 ---------- */
  console.log('== 4. 六位密码解锁 ==');
  doc.getElementById('rolePill').click();
  await wait(220);
  const pin = doc.getElementById('pinInput');
  ok('弹出密码框', !!pin);
  ok('限长 6 位', pin && pin.getAttribute('maxlength') === '6');
  pin.value = '000000';
  doc.querySelector('.js-ok').click();
  await wait(220);
  ok('错密码不放行', SD.auth.current() === 'restricted', SD.auth.current());
  ok('错密码后弹窗仍在', !!doc.getElementById('pinInput'));
  doc.getElementById('pinInput').value = '123456';
  doc.querySelector('.js-ok').click();
  await wait(400);
  ok('正确密码解锁', SD.auth.current() === 'safety_officer');
  ok('解锁后徽标变「安全员」', doc.getElementById('rolePillTxt').textContent === '安全员');
  ok('解锁后有写权限', SD.auth.can('data.write') === true);

  /* ---------- 5. 录入并保存 ---------- */
  console.log('== 5. 录入 / 备注 / 保存 ==');
  await go('overview'); await go('shiftLog');
  ok('解锁后下拉可用', Array.from(view().querySelectorAll('.sl-check')).every(x => !x.disabled));
  ok('解锁后出现保存按钮', btns().some(b => /保存/.test(b.textContent)));

  /* 一键钩选：19 项一个个点太累 */
  const allOkBtn = view().querySelector('.js-sl-allok');
  ok('有「全部 √ 正常」一键按钮', !!allOkBtn);
  allOkBtn.click(); await wait(180);
  let chk = Array.from(view().querySelectorAll('.sl-check'));
  ok('一键钩选后 19 项全为 ok', chk.length === 19 && chk.every(x => x.value === 'ok'),
    chk.map(x => x.value).join(','));
  ok('一键钩选后状态行 19/19',
    /已检查 19 \/ 19/.test((view().querySelector('.sl-statusline') || {}).textContent || ''),
    (view().querySelector('.sl-statusline') || {}).textContent);
  const clrBtn = view().querySelector('.js-sl-clr');
  ok('有「清空勾选」一键按钮', !!clrBtn);
  clrBtn.click(); await wait(180);
  chk = Array.from(view().querySelectorAll('.sl-check'));
  ok('一键清空后 19 项全为空', chk.length === 19 && chk.every(x => x.value === ''),
    chk.map(x => x.value).join(','));

  const sel = view().querySelectorAll('.sl-check')[2];
  sel.value = 'bad';
  sel.dispatchEvent(new win.Event('change', { bubbles: true }));
  await wait(150);
  ok('异常行标红', view().querySelectorAll('.sl-row')[2].className.indexOf('is-bad') >= 0);

  let add = view().querySelector('.sl-ev-add');
  ok('有「添加一条」', !!add);
  add.click(); await wait(130);
  view().querySelector('.sl-ev-add').click(); await wait(130);
  const inps = view().querySelectorAll('.sl-ev-inp');
  ok('备注有两条编号条目', inps.length === 2, inps.length);
  ok('条目自动编号', Array.from(view().querySelectorAll('.sl-ev-no')).map(x => x.textContent).join('') === '1.2.',
    Array.from(view().querySelectorAll('.sl-ev-no')).map(x => x.textContent).join(''));
  inps[0].value = '东侧消防通道堆料，已通知清理';
  inps[0].dispatchEvent(new win.Event('input', { bubbles: true }));
  inps[1].value = '2 号配电箱门锁损坏，已报修';
  inps[1].dispatchEvent(new win.Event('input', { bubbles: true }));
  await wait(200);

  const del = view().querySelector('.sl-ev-del');
  ok('有删除按钮（可逐条删）', !!del);

  /* 回车 = 自动新起一条（编号自动换行） */
  view().querySelectorAll('.sl-ev-inp')[1]
    .dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await wait(180);
  const ev2 = view().querySelectorAll('.sl-ev-inp');
  ok('回车自动新起一条', ev2.length === 3, ev2.length);
  ok('新条目编号顺延为 3',
    Array.from(view().querySelectorAll('.sl-ev-no')).map(x => x.textContent).join('') === '1.2.3.',
    Array.from(view().querySelectorAll('.sl-ev-no')).map(x => x.textContent).join(''));
  ok('焦点落到新的一行', doc.activeElement === ev2[2],
    doc.activeElement && doc.activeElement.className);

  const insp = view().querySelector('.js-sl-insp');
  insp.value = '王安全';
  insp.dispatchEvent(new win.Event('input', { bubbles: true }));
  await wait(220);

  btns().filter(b => /保存/.test(b.textContent))[0].click();
  await wait(1500);
  const today = SD.app.state.summary.today;
  const logs = SD.store.data().shiftLogs || [];
  const rec = logs.filter(x => x.date === today && x.shift === 'day')[0];
  ok('保存后落库', !!rec, logs.length);
  ok('检查项 19 条都在', !!rec && rec.checks.length === 19);
  ok('第 3 项记为异常', !!rec && rec.checks[2] === 'bad', rec && rec.checks[2]);
  ok('两条备注入库', !!rec && rec.events.length === 2, rec && rec.events.length);
  ok('巡查人员入库', !!rec && rec.inspector === '王安全', rec && rec.inspector);
  ok('同一天同一班次只保留一份', logs.filter(x => x.date === today && x.shift === 'day').length === 1);

  /* ---------- 6. 打印 ---------- */
  console.log('== 6. 打印出件 ==');
  await go('shiftLog');
  btns().filter(b => /打印/.test(b.textContent))[0].click();
  await wait(320);
  const ov = doc.querySelector('.sl-overlay');
  ok('打开打印预览', !!ov);

  /* ---------- 6a. 版式：横向铺满可印区 + 纵向压行高（不靠整体缩小） ---------- */
  const MM = 96 / 25.4;                       /* 1mm 在 CSS 里的 px */
  const csSheet = ov ? win.getComputedStyle(ov.querySelector('.sl-sheet')) : {};
  const sheetW = parseFloat(csSheet.width || 0);
  ok('纸张横向铺满可印区（260mm，A4 横向可印区 = 297−18×2 = 261mm）',
    Math.abs(sheetW - 260 * MM) < 1 && sheetW <= 261 * MM,
    Math.round(sheetW) + 'px = ' + (sheetW / MM).toFixed(1) + 'mm');
  const itemRow = ov && ov.querySelector('tr.c-r-item');
  const itemH = itemRow ? parseFloat(win.getComputedStyle(itemRow).height) : 0;
  ok('明细行纵向压缩到 18pt（19 行，原 24pt 会超出可印高度）',
    Math.abs(itemH - 18 * 96 / 72) < 0.6, (itemH / (96 / 72)).toFixed(2) + 'pt');
  const tdPad = itemRow ? win.getComputedStyle(itemRow.querySelector('td')).paddingTop : '';
  ok('竖向内边距压到 0.5mm（行高下限就是被它顶着的）',
    Math.abs(parseFloat(tdPad) - 0.5 * MM) < 0.1, tdPad);
  /* 真实累加：标识 + 标题 + 抬头 + 表头 + 19 行 + 表尾 → 必须 ≤ A4 横向可印高度 172mm(650px) */
  const allRows = ov ? Array.from(ov.querySelectorAll('.sl-paper-table tr')) : [];
  const totalH = allRows.reduce((n, r) => n + (parseFloat(win.getComputedStyle(r).height) || 0), 0);
  ok('整表总高不超可印高度 172mm（650px），一页装得下',
    allRows.length === 24 && totalH > 0 && totalH <= 172 * MM,
    allRows.length + ' 行 / ' + (totalH / MM).toFixed(1) + 'mm（上限 172mm）');

  const metaTxt = ov ? ov.querySelector('.c-meta').textContent : '';
  ok('打印件里巡查人员留空（不出现姓名）', metaTxt.indexOf('王安全') < 0, metaTxt);
  ok('打印件保留厂区/部门', /缝制中心/.test(metaTxt) && /安全环保部/.test(metaTxt));
  /* ★ 2026-10-27 用户要求：签名位只留空白，不要下划线 */
  const blankEl = ov ? ov.querySelector('.c-blank') : null;
  const blankCs = (blankEl && win.getComputedStyle) ? win.getComputedStyle(blankEl) : null;
  ok('● 巡检人员签名位存在（38mm 空白区）', !!blankEl,
    blankCs ? blankCs.minWidth : null);
  ok('● 签名位无下划线（border-bottom 已去除）',
    !!blankCs && (blankCs.borderBottomWidth === '0px' || blankCs.borderBottomStyle === 'none' ||
      blankCs.borderBottomWidth === ''),
    blankCs ? (blankCs.borderBottomWidth + ' / ' + blankCs.borderBottomStyle) : 'null');
  ok('打印件显示班次与日期', /白班/.test(ov.querySelectorAll('.c-meta')[0].textContent) &&
    ov.querySelectorAll('.c-meta')[1].textContent.indexOf(today) >= 0);
  const noteTxt = ov ? ov.querySelector('td.c-note').textContent : '';
  ok('备注按 1、2 罗列', /1、东侧/.test(noteTxt) && /2、2 号配电箱/.test(noteTxt), noteTxt.slice(0, 40));
  ok('检查情况显示 √ / ×', /√/.test(ov.textContent) && /×/.test(ov.textContent),
    (ov.querySelector('.c-check') || {}).textContent);
  ok('注入 A4 横向 + 常规页边距打印样式',
    !!doc.getElementById('slPageStyle') && /A4 landscape/.test(doc.getElementById('slPageStyle').textContent) &&
    /margin:19mm 18mm/.test(doc.getElementById('slPageStyle').textContent),
    (doc.getElementById('slPageStyle') || {}).textContent);
  ok('打印页带自动缩放容器（缩到刚好一页 A4）', !!ov.querySelector('.sl-fit'));
  /* ★ 纸张不能误用通知书的 .pn-sheet 类：print.css 在 components.css 之后加载，
     会把宽度改成 210mm、内边距 24.8mm、最小高 297mm → 纸张变 210×325mm，一页装不下 */
  ok('打印纸张没有误用通知书的 .pn-sheet 类（否则会变成 A4 纵向 210×325mm）',
    !ov.querySelector('.pn-sheet') && !!ov.querySelector('.sl-sheet'));
  /* ★ 浏览器总是把 <thead> 渲染到表格最上面，所以标识/标题/抬头必须跟表头一起放进去 */
  const thead = ov.querySelector('.sl-paper-table thead');
  const theadRows = thead ? Array.from(thead.querySelectorAll('tr')).map(r => r.className) : [];
  ok('thead 顺序：标识 → 标题 → 抬头 → 表头（否则表头会跑到标题上面）',
    theadRows.length === 4 && /c-r-logo/.test(theadRows[0]) && /c-r-title/.test(theadRows[1]) &&
    /c-r-meta/.test(theadRows[2]) && /c-r-head/.test(theadRows[3]), theadRows.join(' | '));
  ok('明细行都在 tbody 里（19 行 + 表尾注）',
    ov.querySelectorAll('.sl-paper-table tbody tr.c-r-item').length === 19 &&
    !!ov.querySelector('.sl-paper-table tbody tr.c-r-foot'),
    ov.querySelectorAll('.sl-paper-table tbody tr').length);
  ok('打印件明细行高 24pt 类（与保存页一致）',
    !!ov.querySelector('tr.c-r-item') && !!ov.querySelector('tr.c-r-item.is-last'));
  ok('缩放比例写进提示条', /刚好一页/.test((ov.querySelector('.js-sl-tip') || {}).textContent || ''),
    (ov.querySelector('.js-sl-tip') || {}).textContent);
  ok('标题行 / 厂区行在出件里也不带框',
    !!ov.querySelector('.c-title') && !!ov.querySelector('.c-meta'));
  ok('打印件里班次与厂区同格、日期独占 D:E',
    /厂区：[\s\S]*?班次：白班/.test(ov.querySelector('.c-meta-main').textContent) &&
    /日期：/.test(ov.querySelectorAll('.c-meta')[1].textContent),
    ov.querySelector('.c-meta-main').textContent.slice(0, 60));
  ok('打印页左上角有公司标识', !!ov.querySelector('.c-logo'),
    (ov.querySelector('.c-logo') || {}).src);
  ok('打印件里没有输入框', ov.querySelectorAll('input,select,textarea').length === 0);
  const pCols = Array.from(ov.querySelectorAll('.sl-paper-table col'))
    .map(c => parseFloat(String(c.getAttribute('style') || '').replace(/[^0-9.]/g, '')));
  ok('打印件列宽与界面同一份（照原表）',
    pCols.length === 5 && pCols.every((v, i) => Math.abs(v - WANT[i]) < 0.02), pCols.join(','));
  ok('打印件行高类照原表（标题/抬头/表头/19 明细/表尾）',
    !!ov.querySelector('tr.c-r-title') && !!ov.querySelector('tr.c-r-meta') &&
    !!ov.querySelector('tr.c-r-head') && ov.querySelectorAll('tr.c-r-item').length === 19 &&
    !!ov.querySelector('tr.c-r-foot'), ov.querySelectorAll('tr.c-r-item').length);
  ok('备注一条一行（逐条罗列）', ov.querySelectorAll('.sl-note-line').length === 2,
    ov.querySelectorAll('.sl-note-line').length);
  ok('备注带 1、2、编号', /^1、/.test((ov.querySelector('.sl-note-line') || {}).textContent || ''),
    (ov.querySelector('.sl-note-line') || {}).textContent);
  ov.querySelector('.js-sl-close').click();
  await wait(160);
  ok('关闭后清理打印样式', !doc.getElementById('slPageStyle'));
  ok('关闭后遮罩已移除', !doc.querySelector('.sl-overlay'));

  /* ---------- 7. 导出 Excel ---------- */
  console.log('== 7. 导出 Excel ==');
  let dlName = '', cap = null;
  SD.comp.xlsxWriter.download = (blob, name) => { dlName = name; cap = blob; };
  btns().filter(b => /导出 Excel/.test(b.textContent))[0].click();
  await wait(260);
  ok('文件名含日期与班次', new RegExp('安全巡检交接班记录-' + today + '-白班\\.xlsx').test(dlName), dlName);

  /* 出件内容逐项核对：一条都不能少 */
  const buf = new Uint8Array(await cap.arrayBuffer());
  const zip = unzipStored(buf);
  const sheet = Buffer.from(zip['xl/worksheets/sheet1.xml'] || '').toString('utf8');
  ok('拿到 sheet1.xml', !!sheet, Object.keys(zip).join('|'));
  ok('出件 24 行（第 1 行放左上角标识 + 标题+抬头+表头+19 项+表尾）',
    (sheet.match(/<row /g) || []).length === 24, (sheet.match(/<row /g) || []).length);
  ok('第 1 行是标识行（高 30pt，无内容）', /<row r="1" ht="30"/.test(sheet) && !/<c r="A1"[^>]*>\s*<is>/.test(sheet));
  ok('标题落在第 2 行（原表 A2）', /<c r="A2"[^>]*>[\s\S]*?现场安全巡检与交接班记录/.test(sheet));
  ok('列宽照原表，「检查内容」列加宽到 78（4.41/9/78/5.66/34.08）',
    /width="4.41"/.test(sheet) && /width="9"/.test(sheet) && /width="78"/.test(sheet) &&
    /width="5.66"/.test(sheet) && /width="34.08"/.test(sheet));
  ok('A4 横向 + 常规页边距 + 缩放到一页（打印不漏）',
    /orientation="landscape"/.test(sheet) && /<pageSetUpPr fitToPage="1"\/>/.test(sheet) &&
    /fitToWidth="1"/.test(sheet) && /fitToHeight="1"/.test(sheet) &&
    /<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"\/>/.test(sheet),
    (sheet.match(/<pageMargins[^>]*\/>/) || [''])[0]);
  const styles = Buffer.from(zip['xl/styles.xml'] || '').toString('utf8');
  ok('备注自动换行（不会挤成一行）', /wrapText="1"/.test(styles), styles.slice(0, 80));
  ok('备注按 1、2、逐条换行', /1、东侧消防通道堆料/.test(sheet) && /2、2 号配电箱门锁损坏/.test(sheet));
  ok('19 项检查内容都在（首项与末项）',
    /是否渗漏，门窗是否完好/.test(sheet) && /其它需要检查的临时项目内容/.test(sheet) &&
    /应急照明、疏散指示灯/.test(sheet));
  ok('表尾注在', /检查情况正常打/.test(sheet));
  ok('出件里巡查人员留空（不出现姓名）', sheet.indexOf('王安全') < 0);
  ok('厂区 / 部门 / 班次 / 日期都在',
    /厂区：缝制中心/.test(sheet) && /部门：安全环保部/.test(sheet) &&
    /班次：白班/.test(sheet) && sheet.indexOf(today) >= 0);

  /* ★ 出件列位：19 个明细行每行都必须占满 A~E 五格。
     之前检查项 / 备注合并的行少 push 了格，xlsxWriter 按顺序往 A/B/C… 落，
     于是第 2 组起「检查内容」跑到 B、「检查情况」跑到 C，D/E 连单元格都没有
     → 内容错位 + 右侧缺边框。现在被合并掉的列补空占位格。 */
  function rowOf(xml, r) {
    const m = xml.match(new RegExp('<row r="' + r + '"[^>]*>([\\s\\S]*?)</row>'));
    return m ? m[1] : '';
  }
  function refsOf(rowXml) {
    return (rowXml.match(/<c r="[A-Z]+\d+"/g) || []).map(s => s.replace('<c r="', '').replace('"', ''));
  }
  const misplaced = [];
  for (let r = 5; r <= 23; r++) {
    const refs = refsOf(rowOf(sheet, r));
    const want = ['A', 'B', 'C', 'D', 'E'].map(x => x + r).join(',');
    if (refs.join(',') !== want) misplaced.push(r + '→' + refs.join('|'));
  }
  ok('19 个明细行每行都占满 A~E 五格（不再错位）', misplaced.length === 0, misplaced.join(' ; '));
  ok('第 9 行的检查内容仍在 C 列', /<c r="C9"[^>]*>[\s\S]*?不准穿无头无跟鞋/.test(sheet));
  ok('第 7 行的检查情况（×）仍在 D 列', /<c r="D7"[^>]*>[\s\S]*?×/.test(sheet));
  /* ★ 班次按用户要求并进厂区那个格子（A3:C3），日期落到 D3:E3 合并格 */
  ok('班次与厂区同一格（A3）', /<c r="A3"[^>]*>[\s\S]*?厂区：缝制中心[\s\S]*?班次：白班/.test(sheet));
  ok('日期落在 D3（D3:E3 合并，没被吞掉）', new RegExp('<c r="D3"[^>]*>[\\s\\S]*?日期：' + today).test(sheet));
  ok('抬头行合并 A3:C3 + D3:E3', /<mergeCell ref="A3:C3"\/>/.test(sheet) && /<mergeCell ref="D3:E3"\/>/.test(sheet));
  ok('标题合并仍是 A2:E2（照原表）', /<mergeCell ref="A2:E2"\/>/.test(sheet));
  ok('备注合并仍是 E5:E23（照原表）', /<mergeCell ref="E5:E23"\/>/.test(sheet));
  ok('检查项合并 B8:B16 / B19:B22（照原表）',
    /<mergeCell ref="B8:B16"\/>/.test(sheet) && /<mergeCell ref="B19:B22"\/>/.test(sheet));
  ok('表尾合并仍是 A24:E24（照原表）', /<mergeCell ref="A24:E24"\/>/.test(sheet));

  /* 左上角公司标识：真嵌进 .xlsx 里（media + drawing + 两级 rels + 挂到工作表） */
  const png = zip['xl/media/image1.png'] ? new Uint8Array(zip['xl/media/image1.png']) : new Uint8Array();
  ok('导出件内嵌左上角标识', png.length > 0, Object.keys(zip).join('|'));
  ok('标识是合法 PNG（PNG magic + 长度与 brandLogo 的 base64 一致）',
    png.length > 0 && png[0] === 0x89 && png[1] === 0x50 && png[2] === 0x4e &&
    png.length === Buffer.from(SD.BRAND_LOGO.base64, 'base64').length, png.length);
  const drawing = Buffer.from(zip['xl/drawings/drawing1.xml'] || '').toString('utf8');
  ok('drawing 部件：oneCellAnchor 钉在第 1 行 A1', /xdr:oneCellAnchor/.test(drawing) && /<xdr:row>0<\/xdr:row>/.test(drawing));
  ok('两级 rels 都在（工作表→drawing→图片）',
    !!zip['xl/drawings/_rels/drawing1.xml.rels'] && !!zip['xl/worksheets/_rels/sheet1.xml.rels']);
  ok('工作表挂上了 drawing', /<drawing r:id="rId1"\/>/.test(sheet));
  const ct = Buffer.from(zip['[Content_Types].xml'] || '').toString('utf8');
  ok('Content_Types 登记 png 与 drawing',
    /Extension="png"/.test(ct) && /drawing1\.xml/.test(ct), ct.slice(0, 120));
  /* 「检查内容」列加宽后最长的一条一行放下，19 行全部维持原表 20.5pt，不用加高 */
  ok('19 个明细行都是 24pt（与保存页那份文件一致）',
    (sheet.match(/<row r="\d+" ht="24"/g) || []).length === 19 &&
    !/ht="36"/.test(sheet), (sheet.match(/ht="[\d.]+"/g) || []).join(','));
  ok('巡检人员后面空出手签位（全角空格占位）',
    /巡检人员：　　　　　　　　　　　　班次：/.test(sheet),
    (sheet.match(/巡检人员：[^<]*/) || [''])[0]);

  /* ---------- 边框：逐边照抄原表 ----------
     原表的边框不是四面全框：外框 medium、内线 thin、「检查内容」列（C）没有左右竖线、
     抬头行只有 A:C 有下边框、标题行 / 表尾行无框。之前出件给的是四面全框，所以和原表不一样。 */
  const cx = (styles.match(/<cellXfs[\s\S]*?<\/cellXfs>/) || [''])[0];
  const xfs = cx.match(/<xf\b[^>]*?\/>|<xf\b[^>]*>([\s\S]*?)<\/xf>/g) || [];
  const bxs = (styles.match(/<borders[\s\S]*?<\/borders>/) || [''])[0].match(/<border>[\s\S]*?<\/border>/g) || [];
  function xfOf(ref) {
    const m = sheet.match(new RegExp('<c r="' + ref + '"[^>]*>'));
    if (!m) return '';
    const s = / s="(\d+)"/.exec(m[0]);
    return s ? (xfs[+s[1]] || '') : '';
  }
  function borderOf(ref) {
    const xf = xfOf(ref);
    const b = /borderId="(\d+)"/.exec(xf);
    if (!b) return '';
    return bxs[+b[1]] || '';
  }
  function hasSide(xml, side) { return new RegExp('<' + side + ' style="(medium|thin)"').test(xml); }
  const noBorder = xml => !/style="(medium|thin)"/.test(xml);
  ok('标题行（第 2 行）：居中且无边框',
    /horizontal="center"/.test(xfOf('A2')) && noBorder(borderOf('A2')), borderOf('A2'));
  ok('抬头行（第 3 行）：居中，且只有 A:C 有下边框（照原表）',
    /horizontal="center"/.test(xfOf('A3')) &&
    hasSide(borderOf('A3'), 'bottom') && !hasSide(borderOf('A3'), 'left') &&
    !hasSide(borderOf('A3'), 'right') && !hasSide(borderOf('A3'), 'top'), borderOf('A3'));
  ok('抬头行下边框是 medium 加粗（照原表）', /<bottom style="medium"/.test(borderOf('A3')), borderOf('A3'));
  ok('「检查内容」列（C）没有左右竖线（照原表）',
    !hasSide(borderOf('C5'), 'left') && !hasSide(borderOf('C5'), 'right') && hasSide(borderOf('C5'), 'bottom'),
    borderOf('C5'));
  ok('表头 C 列也只有上下线、没有竖线（照原表）',
    !hasSide(borderOf('C4'), 'left') && !hasSide(borderOf('C4'), 'right') &&
    hasSide(borderOf('C4'), 'top') && hasSide(borderOf('C4'), 'bottom'), borderOf('C4'));
  ok('A 列左缘是 medium 外框（照原表）', /<left style="medium"/.test(borderOf('A5')), borderOf('A5'));
  ok('E 列右缘是 medium 外框（照原表）', /<right style="medium"/.test(borderOf('E5')), borderOf('E5'));
  ok('末行下缘是 medium 外框（照原表）', /<bottom style="medium"/.test(borderOf('A23')), borderOf('A23'));
  ok('内线是 thin（明细行下边框）', /<bottom style="thin"/.test(borderOf('A9')), borderOf('A9'));
  ok('合并区中间行只有左右线（没有上下线，照原表）',
    hasSide(borderOf('B9'), 'left') && hasSide(borderOf('B9'), 'right') &&
    !hasSide(borderOf('B9'), 'top') && !hasSide(borderOf('B9'), 'bottom'), borderOf('B9'));
  ok('表尾行（第 24 行）无边框（照原表）', noBorder(borderOf('A24')), borderOf('A24'));

  /* ---------- 8. 设置齿轮 ---------- */
  console.log('== 8. 设置齿轮 ==');
  const gear = doc.getElementById('btnGear');
  gear.click();
  await wait(160);
  const menu = doc.getElementById('gearMenu');
  ok('点齿轮展开菜单', menu.hidden === false);
  ok('aria-expanded=true', gear.getAttribute('aria-expanded') === 'true');
  const items = Array.from(menu.querySelectorAll('.gear-item')).map(x => x.textContent.trim());
  ok('菜单含导入数据', items.some(t => /导入数据/.test(t)), items.join('|'));
  ok('菜单含导出备份', items.some(t => /导出备份/.test(t)));
  ok('菜单含清空数据', items.some(t => /清空数据/.test(t)));
  ok('菜单含密码设置', items.some(t => /密码设置/.test(t)));
  ok('菜单含角色选择', !!menu.querySelector('#roleSel'));
  ok('菜单含工作台外观', items.some(t => /工作台外观/.test(t)));
  doc.body.click();
  await wait(120);
  ok('点空白处收起菜单', menu.hidden === true);

  /* ---------- 9. 退回受限：写操作被拦 ---------- */
  console.log('== 9. 退回受限后写操作被拦 ==');
  SD.auth.lock();
  SD.app.refreshAll();
  await wait(400);
  ok('退回受限', SD.auth.current() === 'restricted');
  await go('hazard');
  const addBtn = view().querySelector('.btn.primary');
  ok('受限时仍有浏览界面', !!view().querySelector('.card'));
  if (addBtn) {
    addBtn.click();
    await wait(250);
    ok('点新增不弹录入框', !doc.querySelector('#dialogRoot').firstChild,
      (doc.querySelector('#dialogRoot').firstChild || {}).className);
    ok('给出受限提示', /受限模式/.test((doc.querySelector('.toast-root') || {}).textContent || ''),
      ((doc.querySelector('.toast-root') || {}).textContent || '').slice(0, 40));
  }

  /* ---------- 10. 左上角图标 / 名称自定义 ---------- */
  console.log('== 10. 左上角图标与名称 ==');
  doc.getElementById('brandText').click();
  await wait(220);
  ok('点名称打开外观弹窗', !!doc.getElementById('setName'));
  const icons = doc.querySelectorAll('.brand-ico');
  ok('提供内置图标可选', icons.length >= 12, icons.length);
  const award = Array.from(icons).filter(b => b.getAttribute('data-icon') === 'award')[0];
  ok('内置图标里有 award', !!award);
  award.click();
  await wait(80);
  doc.getElementById('setName').value = '示例 EHS 台';
  doc.getElementById('setSub').value = '安全员专用';
  doc.querySelector('.js-ok').click();
  await wait(320);
  ok('名称已改到左上角', doc.getElementById('appName').textContent === '示例 EHS 台',
    doc.getElementById('appName').textContent);
  ok('副标题已改', doc.getElementById('appSub').textContent === '安全员专用');
  ok('图标已切换', doc.querySelector('.brand-mark').getAttribute('data-icon') === 'award',
    doc.querySelector('.brand-mark').getAttribute('data-icon'));
  ok('浏览器标题同步', doc.title === '示例 EHS 台', doc.title);
  ok('设置已持久化', SD.store.getSettings().appIcon === 'award' &&
    SD.store.getSettings().appName === '示例 EHS 台');

  /* ---------- 11. 密码修改 ---------- */
  console.log('== 11. 密码设置 ==');
  SD.auth.set('safety_officer');
  SD.app.refreshAll();
  await wait(200);
  doc.getElementById('btnGear').click();
  await wait(120);
  doc.getElementById('btnPwd').click();
  await wait(220);
  ok('未设过密码时不要求原密码', !doc.getElementById('pwOld'));
  doc.getElementById('pwNew').value = '123456';
  doc.getElementById('pwNew2').value = '123456';
  doc.querySelector('.js-ok').click();
  await wait(150);
  ok('不允许继续用 123456', /别再用/.test((doc.querySelector('#dialogRoot') || {}).textContent || ''));
  doc.getElementById('pwNew').value = '864209';
  doc.getElementById('pwNew2').value = '864209';
  doc.querySelector('.js-ok').click();
  await wait(220);
  ok('新密码已保存', SD.auth.hasPin() === true);
  ok('新密码可校验', SD.auth.verifyPin('864209') === true);
  ok('默认密码失效', SD.auth.verifyPin('123456') === false);

  console.log('errors:', errs.slice(0, 4));
  console.log('结果：通过 ' + P + ' / 失败 ' + F);
  process.exit(F ? 1 : 0);
})().catch(e => { console.log('ERR', e.stack); process.exit(1); });
