/* 安全员工作台 · 日报 / 周报 冒烟自检
   用法：node smoke_reports.js [url]
   覆盖：① 左侧「更多」折叠组内的「报表」小分组（日报/周报）与跳转
        ② 日报/周报视图渲染（周期选择 + 指标卡 + 分节预览 + 导出按钮）
        ③ 聚合口径（当日/本周巡检、隐患等）与手工核对一致
        ④ 一键导出 Excel：文件名与生成的 .xlsx Blob 有效
        ⑤ .xlsx OOXML 结构（列定义不重叠 / 无臆造 pane state / rels 闭环）
*/
const { JSDOM } = require('jsdom');
const URL_ = process.argv[2] || 'http://127.0.0.1:8124/index.html';
const wait = ms => new Promise(r => setTimeout(r, ms));

/* stored（不压缩）ZIP 解包：xlsxWriter/docxWriter 产出的条目都是 stored */
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

  /* 2026-10-27：特种设备台账改为 Excel 导入、不再内置名单 →
     这里先导入 2 条（1 条已过期、1 条有效），否则报表的「特种设备」来源会没有数据。 */
  if (SD.views && SD.views.devicePersonnel && SD.views.devicePersonnel.XIO && SD.comp.excelIO) {
    const XIO_R = SD.views.devicePersonnel.XIO;
    const rowsR = [
      ['姓名', '所属部门', '证件编号', '证书有效期至'],
      ['报表测试甲', '仓储物流部', '320682199001019999', '2025-06-30'],
      ['报表测试乙', '设备动力部', '320682199001018888', '2027-06-30']
    ];
    const resR = SD.comp.excelIO._analyze(rowsR, XIO_R);
    if (resR && !resR.fatal && resR.valid.length) {
      SD.comp.excelIO._doImport(XIO_R, resR, 'replace');
      if (SD.app.reload) SD.app.reload();
      await wait(1300);
    }
  }

  const go = async r => { win.location.hash = '#/' + r; await wait(360); };
  const view = () => doc.getElementById('view');
  const click = el => el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  const fire = (el, type) => el.dispatchEvent(new win.Event(type, { bubbles: true }));

  /* ---------- 1. 模块与导航 ---------- */
  console.log('== 1. 模块与「报表」导航 ==');
  ok('SD.report 存在', !!SD.report && typeof SD.report.daily === 'function');
  ok('xlsxWriter 存在', !!SD.comp.xlsxWriter && typeof SD.comp.xlsxWriter.build === 'function');
  ok('dailyReport / weeklyReport 视图已注册', !!SD.views.dailyReport && !!SD.views.weeklyReport);

  await go('dailyReport');
  /* 2026-10-24 起报表归入左侧「更多」折叠组（数据看板/通知公告 + 报表小分组） */
  const navSecondary = doc.getElementById('navSecondary');
  ok('「更多」组含「报表」小标题', !!navSecondary && !!navSecondary.querySelector('.nav-sub-title'),
    navSecondary && Array.from(navSecondary.querySelectorAll('.nav-sub-title')).map(x => x.textContent).join('/'));
  const navNames = navSecondary ? Array.from(navSecondary.querySelectorAll('.nav-item .txt')).map(x => x.textContent.trim()) : [];
  ok('报表小分组含 日报 与 周报', navNames.indexOf('日报') >= 0 && navNames.indexOf('周报') >= 0, navNames.join('/'));
  ok('「更多」因当前页在组内而自动展开', navSecondary && !navSecondary.hidden);
  ok('当前激活项为 日报', !!navSecondary.querySelector('[data-route="dailyReport"].active'));

  /* ---------- 2. 日报视图渲染 ---------- */
  console.log('== 2. 日报视图渲染 ==');
  ok('顶部标题为「日报」', doc.getElementById('viewTitle').textContent === '日报', doc.getElementById('viewTitle').textContent);
  ok('周期日期输入存在', !!view().querySelector('#rptDate'));
  ok('周期标签存在', !!view().querySelector('#rptPeriod'));
  ok('导出按钮存在', !!view().querySelector('#rptExport'));
  ok('有指标卡（≥4）', view().querySelectorAll('.stat').length >= 4, view().querySelectorAll('.stat').length);
  const heads = Array.from(view().querySelectorAll('.card-head h3')).map(h => h.textContent.trim());
  ['隐患排查与治理', '安全巡检执行', '安全教育培训', '危险作业票', '通知公告', '资质预警'].forEach(k => {
    ok('含分节：' + k, heads.some(h => h.indexOf(k) >= 0));
  });

  /* ---------- 3. 聚合口径核对 ---------- */
  console.log('== 3. 聚合口径与手工核对一致 ==');
  const data = SD.app.state.data;
  const T = SD.app.state.summary.today;
  const aggD = SD.report.daily(data, T);
  const expPlanned = data.inspections.filter(t => t.scheduledDate === T && t.status !== 'cancelled').length;
  const expDone = data.inspections.filter(t => t.completedAt === T && t.status === 'done').length;
  const expCreated = data.hazards.filter(h => h.foundDate === T).length;
  ok('日报：当日计划巡检一致', aggD.inspections.plannedN === expPlanned, aggD.inspections.plannedN + ' / ' + expPlanned);
  ok('日报：当日完成巡检一致', aggD.inspections.doneN === expDone, aggD.inspections.doneN + ' / ' + expDone);
  ok('日报：当日登记隐患一致', aggD.hazards.createdN === expCreated, aggD.hazards.createdN + ' / ' + expCreated);

  const secs = SD.report.sections('daily', aggD);
  ok('页面预览分节为 7 节（新增待办）', secs.length === 7, secs.length);
  ok('每节都有 kv', secs.every(x => Array.isArray(x.kv) && x.kv.length > 0));
  ok('第七节是「人员资质预警」', /人员资质预警/.test(secs[6].title), secs[6].title);

  /* 2026-10-24：报表按工作台实际内容对齐 */
  const hzSec = secs[0];
  ok('隐患节含「待我验收」', hzSec.kv.some(k => /待我验收/.test(k.k)));
  const todoSec = secs.find(x => /待办事项/.test(x.title));
  ok('有「待办事项」节', !!todoSec, todoSec && todoSec.title);
  const expectTodos = SD.metrics.buildTodos(data, T).length;
  ok('待办总数与待办任务页同一口径', !!todoSec && todoSec.kv[0].v === expectTodos,
    (todoSec && todoSec.kv[0].v) + ' vs ' + expectTodos);
  ok('待办按四类拆分（隐患/巡检/作业票/培训）',
    !!todoSec && todoSec.kv.length === 5 &&
    /隐患/.test(todoSec.kv[1].k) && /巡检/.test(todoSec.kv[2].k) &&
    /作业票/.test(todoSec.kv[3].k) && /培训/.test(todoSec.kv[4].k),
    todoSec && todoSec.kv.map(k => k.k + '=' + k.v).join(','));
  ok('待办明细行数 = 待办总数', !!todoSec && todoSec.tables[0].rows.length === expectTodos,
    (todoSec && todoSec.tables[0].rows.length) + ' / ' + expectTodos);
  ok('待办明细首行是「逾期整改」（最急在前）', (function () {
    var rows = (todoSec && todoSec.tables[0].rows) || [];
    if (!rows.length) return true;                 // 空数据（空白版）没有明细，视为通过
    return /逾期整改/.test(rows[0][0]);
  })(), (function () {
    var rows = (todoSec && todoSec.tables[0].rows) || [];
    return rows.length ? rows[0].join(' | ') : '(无待办)';
  })());

  const warnSec = secs[6];
  const warnRows = (warnSec && warnSec.tables[0].rows) || [];
  ok('资质预警含「特种设备」来源', !warnRows.length || warnRows.some(r => /特种设备/.test(r[0])),
    warnRows.length ? warnRows.slice(0, 2).map(r => r[0]).join(',') : '(空台账无预警)');
  ok('资质预警含「特种作业」来源', !warnRows.length || warnRows.some(r => /特种作业/.test(r[0])));
  ok('资质预警人数 = 两类之和',
    warnSec.kv[0].v === (aggD.certWarnSpecialN + aggD.certWarnDeviceN),
    warnSec.kv[0].v + ' vs ' + aggD.certWarnSpecialN + '+' + aggD.certWarnDeviceN);
  ok('预警 note 写出两类各多少人', /特种作业人员 \d+ 人/.test(warnSec.kv[0].note) && /特种设备人员 \d+ 人/.test(warnSec.kv[0].note),
    warnSec.kv[0].note);

  /* 2026-10-21：导出只取前四节（通知公告 / 资质预警 不进 Excel） */
  const xsecs = SD.report.exportSections('daily', aggD);
  ok('导出分节为 4 节', xsecs.length === 4, xsecs.length);
  ok('导出四节 = 隐患 / 巡检 / 培训 / 作业票',
    /隐患排查与治理/.test(xsecs[0].title) && /安全巡检执行/.test(xsecs[1].title) &&
    /安全教育培训/.test(xsecs[2].title) && /危险作业票/.test(xsecs[3].title),
    xsecs.map(s => s.title).join(' | '));
  ok('导出不含「通知公告」节', !xsecs.some(s => /通知公告/.test(s.title)));
  ok('导出不含「资质预警」节', !xsecs.some(s => /资质预警/.test(s.title)));
  ok('导出不含「待办事项」节', !xsecs.some(s => /待办事项/.test(s.title)));
  ok('表述已精简（无「……中的隐患总数」这类冗长 note）',
    !xsecs.some(s => s.kv.some(k => /隐患总数|以完成时间为准|起止区间覆盖期末/.test(k.note || ''))));

  const aggW = SD.report.weekly(data, T);
  ok('周报：周期 = 本周一~周日', aggW.ws === SD.app.state.summary.weekStart && aggW.we === SD.app.state.summary.weekEnd,
    aggW.ws + ' ~ ' + aggW.we);
  const xsecsW = SD.report.exportSections('weekly', aggW);
  ok('周报导出分节同为 4 节（与日报一致）', xsecsW.length === 4, xsecsW.length);
  ok('日报/周报导出节标题仅「当日/本周」之别',
    JSON.stringify(xsecs.map(s => s.title.replace(/（当日）/, ''))) ===
    JSON.stringify(xsecsW.map(s => s.title.replace(/（本周）/, ''))),
    xsecsW.map(s => s.title).join(' | '));
  const sheets = SD.report.toSheets('daily', aggD, { title: '安全生产日报', period: T, sheetName: '安全日报' });
  ok('toSheets 产出一张工作表', sheets.length === 1);
  ok('工作表行数充足（含标题/元信息/分节/备注）', sheets[0].rows.length > 10, sheets[0].rows.length);
  ok('首行是报表标题', sheets[0].rows[0][0].v === '安全生产日报', sheets[0].rows[0][0].v);
  // 导出的单元格里不应再出现「通知公告 / 资质预警」两节
  const sheetText = JSON.stringify(sheets[0].rows);
  ok('导出内容不含「通知公告」节', sheetText.indexOf('五、通知公告') < 0);
  ok('导出内容不含「资质预警」节', sheetText.indexOf('六、特种作业人员资质预警') < 0);
  ok('导出内容保留前四节', sheetText.indexOf('一、隐患排查与治理') >= 0 && sheetText.indexOf('四、危险作业票') >= 0);

  /* ---------- 4. 导出 Excel（拦截 download，不触发真实下载） ---------- */
  console.log('== 4. 一键导出 Excel ==');
  let captured = null;
  const origDownload = SD.comp.xlsxWriter.download;
  SD.comp.xlsxWriter.download = (blob, name) => { captured = { blob, name }; };

  click(view().querySelector('#rptExport'));
  await wait(200);
  ok('点击导出触发 download', !!captured);
  ok('日报文件名规范', captured && /^安全日报-\d{4}-\d{2}-\d{2}\.xlsx$/.test(captured.name), captured && captured.name);
  ok('生成有效 .xlsx（体积>1KB）', captured && captured.blob && captured.blob.size > 1024, captured && captured.blob && captured.blob.size);
  /* 2026-10-22：用户反馈「Excel 打开报错」。根因是两个 OOXML 硬伤：
     ① cols 全部 min=1/max=1 重叠定义；② sheetView 的 pane 写了臆造的
     state="visible"（合法值只有 frozen/split/frozenSplit）。严格解析器
     （新版 Excel / WPS / openpyxl）直接判「工作表损坏」。这里解包锁死。 */
  {
    const buf = new Uint8Array(await captured.blob.arrayBuffer());
    const xf = unzipStored(buf);
    const sheet = new TextDecoder().decode(xf['xl/worksheets/sheet1.xml']);
    const mins = Array.from(sheet.matchAll(/<col min="(\d+)" max="(\d+)"/g)).map(m => m[1] + ':' + m[2]);
    ok('xlsx 列定义 min 依次递增（不再全部挤在 1 列）',
      mins.length >= 2 && new Set(mins).size === mins.length && mins[0] === '1:1' && mins[1] === '2:2',
      mins.join(' '));
    ok('xlsx 无臆造 pane state（不含 state="visible"）', !/state="visible"/.test(sheet));
    ok('xlsx 含合并单元格与 sheetData', /<mergeCells count="\d+">/.test(sheet) && /<sheetData>/.test(sheet));
    ok('xlsx Content-Types 覆盖 document/worksheet',
      /PartName="\/xl\/worksheets\/sheet1.xml"/.test(new TextDecoder().decode(xf['[Content_Types].xml'])));
  }

  /* ---------- 5. 周报 ---------- */
  console.log('== 5. 周报视图与导出 ==');
  await go('weeklyReport');
  ok('周报标题为「周报」', doc.getElementById('viewTitle').textContent === '周报', doc.getElementById('viewTitle').textContent);
  ok('周报周期输入存在', !!view().querySelector('#rptDate'));
  const wHeads = Array.from(view().querySelectorAll('.card-head h3')).map(h => h.textContent.trim());
  ok('周报含「隐患排查与治理（本周）」', wHeads.some(h => /隐患排查与治理（本周）/.test(h)));

  captured = null;
  click(view().querySelector('#rptExport'));
  await wait(200);
  ok('周报导出触发 download', !!captured);
  ok('周报文件名规范', captured && /^安全周报-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.xlsx$/.test(captured.name), captured && captured.name);
  ok('周报生成有效 .xlsx', captured && captured.blob && captured.blob.size > 1024, captured && captured.blob && captured.blob.size);
  SD.comp.xlsxWriter.download = origDownload;

  /* ---------- 6. 切换周期 ---------- */
  console.log('== 6. 切换周期后仍可正常渲染 ==');
  const dIn = view().querySelector('#rptDate');
  dIn.value = SD.app.state.summary.weekStart; // 选本周一
  fire(dIn, 'change');
  await wait(360);
  ok('切换后导出按钮仍在', !!view().querySelector('#rptExport'));
  ok('切换后无 JS 报错', errors.length === 0, errors.join('; ') || 'none');

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  if (errors.length) console.log('运行时错误：\n - ' + errors.join('\n - '));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
