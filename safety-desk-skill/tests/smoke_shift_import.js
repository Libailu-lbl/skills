/* 安全员工作台 · 交接班记录「从每日安全记录导入」冒烟自检（2026-11-03）
   用法：node safety-desk_dev/smoke_shift_import.js [url]

   覆盖：
     ① 纯函数映射：normalizeDailyDate（序列号/日期串/斜杠）、composeDailyEvent、
        dailyEventsFor（日期只在每天首行、只取目标日期、空主要工作跳过）
     ② 真实文件读取：读《每日安全记录.xlsx》，按 11-01 提取 10 条事件，
        与 11月1日的 D/E/F 内容一致
     ③ 界面：备注区出现「从每日记录导入」按钮（只读态不出现）
*/
const { JSDOM } = require('jsdom');
const path = require('path');
const URL_ = process.argv[2] || 'http://127.0.0.1:8124/index.html';
/* 真实《每日安全记录.xlsx》路径由第三个参数传入（仓库里不放业务表格）；
   不传则只跑「映射逻辑 + 界面」两组，真实文件那组给出明确跳过提示。 */
const XLSX = process.argv[3] || '';
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
    },
  });
  const win = dom.window;
  win.addEventListener('error', e => errors.push(String(e.message)));
  win.addEventListener('unhandledrejection', e => errors.push('rejection: ' + String((e.reason && e.reason.message) || e.reason)));

  for (let i = 0; i < 80 && !(win.SD && win.SD.app && win.SD.app.state.summary); i++) await wait(150);
  const SD = win.SD;
  SD.auth.set('safety_officer');
  if (SD.app.refreshAll) SD.app.refreshAll();
  await wait(300);
  if (!SD || !SD.app) { console.log('FATAL: SD 未初始化'); process.exit(1); }

  const V = SD.views.shiftLog;

  /* ================= 1. 纯函数映射 ================= */
  console.log('== 1. 日期与事件拼接纯函数 ==');
  ok('序列号 46327 → 2026-11-01', V._normalizeDailyDate('46327') === '2026-11-01', V._normalizeDailyDate('46327'));
  ok('已是日期串原样返回', V._normalizeDailyDate('2026-11-01') === '2026-11-01');
  ok('斜杠日期归一', V._normalizeDailyDate('2026/11/1') === '2026-11-01', V._normalizeDailyDate('2026/11/1'));
  ok('非日期返回空', V._normalizeDailyDate('日期') === '' && V._normalizeDailyDate('') === '');

  ok('拼接：工作 + 完成情况 + 备注',
    V._composeDailyEvent('基建部第三方生活区宿舍、食堂装修', '进行中', '巡查无异常') ===
      '基建部第三方生活区宿舍、食堂装修 — 巡查无异常',
    V._composeDailyEvent('基建部第三方生活区宿舍、食堂装修', '进行中', '巡查无异常'));
  ok('拼接：「进行中」省略括号',
    V._composeDailyEvent('某工作', '进行中', '') === '某工作',
    V._composeDailyEvent('某工作', '进行中', ''));
  ok('拼接：已完成带括号、无备注',
    V._composeDailyEvent('安装隔离护栏', '已完成', '') === '安装隔离护栏（已完成）',
    V._composeDailyEvent('安装隔离护栏', '已完成', ''));

  /* 手工二维数组：模拟《每日安全记录》结构（日期只在每天首行，且日期行本身带工作） */
  console.log('== 2. dailyEventsFor 只取目标日期 ==');
  const fake = [
    ['日期', '星期', '班次', '主要工作', '完成情况', '备注'],   // 表头（第 2 行）
    ['46327', '日', '白班', 'A工作', '进行中', '巡查无异常'],   // 日期行本身带 A 工作
    ['', '', '', 'B工作', '已完成', ''],
    ['', '', '', '', '', '这一行主要工作为空，应跳过'],
    ['46328', '一', '白班', 'C工作（11-02）', '进行中', '巡查无异常'],
    ['', '', '', 'D工作（11-02）', '进行中', ''],
  ];
  const ev1101 = V._dailyEventsFor(fake, '2026-11-01');
  ok('11-01 提取当天 2 条（含日期行 A 工作，跳过空行与 11-02）',
    ev1101.length === 2 &&
    ev1101[0] === 'A工作 — 巡查无异常' &&
    ev1101[1] === 'B工作（已完成）',
    JSON.stringify(ev1101));
  const ev1102 = V._dailyEventsFor(fake, '2026-11-02');
  ok('11-02 提取 2 条', ev1102.length === 2 && ev1102[0].indexOf('C工作') === 0, JSON.stringify(ev1102));
  ok('目标日期不存在 → 空数组', V._dailyEventsFor(fake, '2026-10-31').length === 0);

  /* ================= 3. 真实文件读取（jsdom 无 DecompressionStream，
       用 python 预先生成的 CSV 走 parseCsv 路径做端到端校验） ================= */
  console.log('== 3. 真实《每日安全记录.xlsx》内容映射 ==');
  const { execFileSync } = require('child_process');
  let csvText = '';
  if (!XLSX) console.log('  -- 未传真实表格路径（第 3 个参数），跳过真实文件断言');
  if (XLSX) try {
    csvText = execFileSync('python', ['-c',
      "import openpyxl,io,sys,csv\n" +
      "wb=openpyxl.load_workbook(r'" + XLSX + "',data_only=True)\n" +
      "ws=wb['每日简记']\n" +
      "o=io.StringIO(); w=csv.writer(o)\n" +
      "for row in ws.iter_rows(values_only=True): w.writerow(['' if c is None else c for c in row])\n" +
      "sys.stdout.write(o.getvalue())"
    ], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  } catch (e) { console.log('  -- python 转 CSV 失败，跳过真实文件断言：' + e.message); }

  if (csvText) {
    const rows = SD.comp.xlsxReader.parseCsv(csvText);
    ok('CSV 解析出行', rows.length >= 30, rows.length);
    const all1101 = V._dailyEventsFor(rows, '2026-11-01');
    ok('11月1日提取 10 条事件', all1101.length === 10, all1101.length);
    ok('第 1 条 = 宿舍食堂装修 — 巡查无异常',
      all1101[0] === '基建部第三方生活区宿舍、食堂装修 — 巡查无异常', all1101[0]);
    ok('含「已完成」括注（安装隔离护栏）',
      all1101.some(t => t === '基建部第三方生活区安装隔离护栏（已完成） — 巡查无异常'),
      JSON.stringify(all1101[9]));
    ok('含「提醒防护措施未强制」备注',
      all1101.some(t => t.indexOf('提醒防护措施未强制') >= 0));
    ok('11月2日也有 10 条', V._dailyEventsFor(rows, '2026-11-02').length === 10);
    ok('11月3日有事件', V._dailyEventsFor(rows, '2026-11-03').length > 0);
  } else {
    console.log('  -- 真实文件断言整体跳过');
  }

  /* ================= 4. 界面按钮 ================= */
  console.log('== 4. 界面「从每日记录导入」按钮 ==');
  const doc = win.document;
  win.location.hash = '#/shiftLog';
  await wait(350);
  ok('备注区有「从每日记录导入」按钮', !!doc.querySelector('.sl-ev-import'),
    doc.querySelector('.sl-ev-import') ? doc.querySelector('.sl-ev-import').textContent : '');
  ok('有隐藏的 file 输入', !!doc.querySelector('.sl-ev-tool input[type=file]'));
  ok('有「＋ 添加一条」按钮', !!doc.querySelector('.sl-ev-add'));

  /* 切受限角色 → 按钮不出现 */
  SD.auth.set('restricted');
  if (SD.app.refreshAll) SD.app.refreshAll();
  await wait(350);
  ok('受限角色下不出现导入按钮', !doc.querySelector('.sl-ev-import'));
  SD.auth.set('safety_officer');
  if (SD.app.refreshAll) SD.app.refreshAll();
  await wait(300);

  console.log('== 5. 无 JS 报错 ==');
  ok('运行期无 JS 错误', errors.length === 0, errors.slice(0, 3).join(' | '));

  console.log('\n结果：通过 ' + pass + ' / 失败 ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FATAL', e); process.exit(1); });
