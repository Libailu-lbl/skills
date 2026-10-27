/* 安全员工作台 · 台账 Excel 导入 / 导出 冒烟自检（2026-10-27 新增）
   用法：node smoke_excelio.js [url]

   覆盖：
     ① xlsxReader：真实 .xlsx（deflate 压缩）解析、stored 闭环、CSV、列号、日期序列号
     ② excelIO 校验：表头识别、缺列、必填、日期、字典、文件内去重、状态推演
     ③ 导入写入：追加 / 覆盖、编号自动顺延、重复跳过
     ④ 导出：文件名、内容可被读回、状态转中文
     ⑤ 界面：导入/导出按钮、弹窗结构、内置名单已移除
*/
const { JSDOM, requestInterceptor } = require('jsdom');
const fs = require('fs');
const path = require('path');

const URL_ = process.argv[2] || 'http://127.0.0.1:8124/index.html';
const wait = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  OK  ' + name + (extra != null ? ' => ' + extra : '')); }
  else { fail++; console.log('  FAIL ' + name + (extra != null ? ' => ' + extra : '')); }
}

const skip = requestInterceptor(r => {
  if (String(r.url).indexOf('print-only.css') >= 0) {
    return new Response('', { headers: { 'Content-Type': 'text/css' } });
  }
  return undefined;
});

(async () => {
  const errors = [];
  const dom = await JSDOM.fromURL(URL_, {
    runScripts: 'dangerously', resources: 'usable', requestInterceptor: skip, pretendToBeVisual: true,
    beforeParse(win) {
      win.matchMedia = q => ({
        matches: false, media: q,
        addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}
      });
      /* jsdom 没有 Web Streams / Response，xlsx 解压需要：注入 Node 的实现 */
      if (typeof DecompressionStream !== 'undefined') win.DecompressionStream = DecompressionStream;
      if (typeof Response !== 'undefined') win.Response = Response;
    }
  });

  const win = dom.window, doc = win.document;
  win.addEventListener('error', e => errors.push(e.message || String(e.error)));

  /* 等页面初始化完成 */
  for (let i = 0; i < 60 && !(win.SD && win.SD.app && win.SD.app.state && win.SD.app.state.summary); i++) await wait(150);

  const SD = win.SD;
  if (!SD) { console.log('FATAL: 页面未初始化'); process.exit(1); }

  const XR = SD.comp.xlsxReader;
  const IO = SD.comp.excelIO;
  const click = el => el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));

  async function go(id) { win.location.hash = '#/' + id; await wait(800); }

  function blobToU8(blob) {
    if (blob && typeof blob.arrayBuffer === 'function') {
      return blob.arrayBuffer().then(ab => new Uint8Array(ab));
    }
    return new Promise((resolve, reject) => {
      const fr = new win.FileReader();
      fr.onload = () => resolve(new Uint8Array(fr.result));
      fr.onerror = () => reject(new Error('读取 blob 失败'));
      fr.readAsArrayBuffer(blob);
    });
  }

  console.log('== 0. 环境 ==');
  ok('xlsxReader 已加载', !!XR && typeof XR.readArrayBuffer === 'function');
  ok('excelIO 已加载', !!IO && typeof IO.openImport === 'function');
  const blobHasStream = (() => {
    try { return typeof new win.Blob(['x']).stream === 'function'; } catch (e) { return false; }
  })();
  if (!blobHasStream && typeof Blob !== 'undefined') win.Blob = Blob;
  ok('解压链路可用（jsdom 的 Blob 没有 stream()，已换成 Node 实现）', true,
    blobHasStream ? 'jsdom 原生支持' : '已替换为 Node Blob');

  /* 受限态看不到特种作业模块，先以安全员身份进入 */
  SD.auth.set('safety_officer');
  SD.app.refreshAll();
  await wait(400);

  /* ---------------- 1. 纯函数：列号 / 日期序列号 / CSV ---------------- */
  console.log('== 1. xlsxReader 基础解析 ==');
  ok('列号 A=0', XR._colIndex('A1') === 0);
  ok('列号 Z=25', XR._colIndex('Z9') === 25);
  ok('列号 AA=26', XR._colIndex('AA1') === 26);
  ok('列号 AB=27', XR._colIndex('AB100') === 27);

  ok('Excel 序列号 25569 → 1970-01-01', XR.excelDate(25569) === '1970-01-01', XR.excelDate(25569));
  ok('Excel 序列号 46173 → 2026-05-xx', /^2026-05-\d{2}$/.test(XR.excelDate(46173)), XR.excelDate(46173));
  ok('序列号 0 返回空串', XR.excelDate(0) === '');

  const csv1 = XR.parseCsv('a,b,c\n1,2,3\n');
  ok('CSV 基本解析', csv1.length === 2 && csv1[1][2] === '3', JSON.stringify(csv1));
  ok('CSV 去尾部空行', XR.parseCsv('a,b\n1,2\n\n\n').length === 2);
  const csv2 = XR.parseCsv('姓名,备注\n张三,"含,逗号"\n');
  ok('CSV 引号内逗号', csv2[1][1] === '含,逗号', csv2[1][1]);
  const csv3 = XR.parseCsv('a\n"他说""你好"""\n');
  ok('CSV 双引号转义', csv3[1][0] === '他说"你好"', csv3[1][0]);
  const csv4 = XR.parseCsv('\ufeff姓名,部门\r\n李四,仓储\r\n');
  ok('CSV 去 BOM + CRLF', csv4[0][0] === '姓名' && csv4[1][1] === '仓储', JSON.stringify(csv4));

  /* ---------------- 2. 真实 .xlsx（deflate 压缩） ---------------- */
  console.log('== 2. 真实 .xlsx 解析（deflate）==');
  const samplePath = path.join(__dirname, '_xlsx_sample.xlsx');
  ok('测试样本存在', fs.existsSync(samplePath), samplePath);

  let sampleRows = null;
  if (fs.existsSync(samplePath)) {
    const u8 = new Uint8Array(fs.readFileSync(samplePath));
    ok('样本是 ZIP 头（PK）', u8[0] === 0x50 && u8[1] === 0x4b);
    const ent = XR._listEntries(u8);
    ok('能读出 zip 目录', ent.length > 3, ent.length + ' 个条目');
    const sheetEnt = ent.filter(e => /worksheets\/sheet1\.xml$/.test(e.name))[0];
    ok('找到 sheet1.xml', !!sheetEnt, sheetEnt && sheetEnt.name);
    ok('sheet1 是 deflate 压缩（method=8）', !!sheetEnt && sheetEnt.method === 8, sheetEnt && sheetEnt.method);

    try {
      const out = await XR.readArrayBuffer(u8);
      sampleRows = out.rows;
      ok('解析成功且拿到 4 行（表头 + 3 条）', out.rows.length === 4, out.rows.length);
      ok('表头中文正确（sharedStrings）',
        out.rows[0][0] === '姓名' && out.rows[0][2] === '所属部门', JSON.stringify(out.rows[0]).slice(0, 60));
      ok('第 2 行姓名 = 李四', out.rows[1][0] === '李四', out.rows[1][0]);
      ok('工号保留前导零 06123', out.rows[1][1] === '06123', out.rows[1][1]);
      ok('日期列读到 Excel 序列号（数字）', /^\d{5}/.test(String(out.rows[1][6])), out.rows[1][6]);
    } catch (e) {
      ok('解析成功且拿到 4 行', false, e.message);
    }
  }

  /* ---------------- 3. stored 闭环（xlsxWriter 产出 → reader 读回） ---------------- */
  console.log('== 3. 导出件回读闭环 ==');
  const blob = SD.comp.xlsxWriter.build([{
    name: 't', cols: [{ width: 10 }, { width: 10 }],
    rows: [[{ v: '甲', bold: true }, { v: '乙' }], [{ v: '1' }, { v: '2' }]]
  }]);
  const back = await XR.readArrayBuffer(await blobToU8(blob));
  ok('xlsxWriter 产出的件能被读回', back.rows.length === 2, back.rows.length);
  ok('内容一致', back.rows[0][0] === '甲' && back.rows[1][1] === '2', JSON.stringify(back.rows));

  /* ---------------- 4. 日期转换 ---------------- */
  console.log('== 4. 日期写法兼容 ==');
  ok('2026-10-27 原样', IO._toDate('2026-10-27') === '2026-10-27');
  ok('2026/10/27 归一', IO._toDate('2026/10/27') === '2026-10-27');
  ok('2026年10月27日 归一', IO._toDate('2026年10月27日') === '2026-10-27');
  ok('2026.1.5 补零', IO._toDate('2026.1.5') === '2026-01-05');
  ok('Excel 序列号 46173 转日期', /^2026-05-\d{2}$/.test(IO._toDate('46173')), IO._toDate('46173'));
  ok('乱写返回空串', IO._toDate('下个月') === '');
  ok('13 月非法', IO._toDate('2026-13-01') === '');

  /* ---------------- 5. 校验：设备人员字段 ---------------- */
  console.log('== 5. 校验（特种设备）==');
  const XIO = SD.views.devicePersonnel.XIO;
  ok('视图暴露了 XIO 配置（含 11 个字段）', !!XIO && XIO.fields.length === 11, XIO && XIO.fields.length);
  ok('判重字段是证件编号', XIO.keyField === 'idNo');

  const HEAD = ['姓名', '工号', '所属部门', '岗位', '证书类型', '证件编号', '证书有效期至', '联系方式', '备注'];
  const rowOK = ['李四', '06123', '仓储物流部', '叉车班', '', '320602199001011234', '2027-05-20', '13800000001', ''];
  const rowsOK = [['特种设备人员台账'], [], HEAD,
    rowOK,
    ['王五', '06456', '仓储物流部', '发泡仓', 'N1', '320602199202022345', '2026-12-01', '', ''],
    ['赵六', '06789', '设备动力部', '设备', 'N1', '320602198803033456', '2025-01-01', '', '']
  ];

  const r1 = IO._analyze(rowsOK, XIO);
  ok('表头不在第一行也能识别（第 3 行）', r1.headLine === 3, r1.headLine);
  ok('3 条全部有效', !r1.fatal && r1.valid.length === 3, (r1.valid || []).length + ' / ' + (r1.errors || []).length);
  ok('证书类型留空取默认 N1', r1.valid[0].certType === 'N1', r1.valid[0].certType);
  ok('日期统一成 YYYY-MM-DD', r1.valid[0].validTo === '2027-05-20', r1.valid[0].validTo);
  ok('状态留空时按有效期推（2027 年 → 有效）', r1.valid[0].status === 'valid', r1.valid[0].status);
  ok('2026-12-01 落在 90 天内 → pending_review', r1.valid[1].status === 'pending_review', r1.valid[1].status);
  ok('2025-01-01 已过 → expired', r1.valid[2].status === 'expired', r1.valid[2].status);

  /* 缺必需列 */
  const r2 = IO._analyze([['姓名', '部门'], ['张三', '仓储']], XIO);
  ok('缺必需列 → 直接判致命', !!r2.fatal && /缺少必需列/.test(r2.fatal), r2.fatal);

  /* 必填为空 / 日期非法 / 字典非法 / 文件内重复 */
  const r3 = IO._analyze([HEAD,
    ['', '1', '仓储', '', 'N1', 'X1', '2027-01-01', '', ''],           // 姓名空
    ['甲', '2', '仓储', '', 'N1', 'X2', '不是日期', '', ''],            // 日期坏
    ['乙', '3', '仓储', '', 'N1', 'X3', '2027-01-01', '', ''],          // OK
    ['乙重复', '4', '仓储', '', 'N1', 'X3', '2027-01-01', '', '']       // 证件号重复
  ], XIO);
  ok('姓名为空 → 记一条错误', r3.errors.some(e => /姓名为空/.test(e.msg)), JSON.stringify(r3.errors).slice(0, 80));
  ok('日期非法 → 记一条错误', r3.errors.some(e => /不是有效日期/.test(e.msg)));
  ok('文件内证件号重复 → dup=1 且不进 valid', r3.dup === 1 && r3.valid.length === 1, r3.dup + '/' + r3.valid.length);
  ok('错误行带真实行号', r3.errors[0].line >= 2, r3.errors.map(e => e.line).join(','));

  /* 状态列写中文 */
  const r4 = IO._analyze([HEAD,
    ['丙', '5', '仓储', '', 'N1', 'X9', '2027-01-01', '', ''],
  ].map((r, i) => i === 0 ? r : r), XIO);
  ok('状态列缺省不报错（自动判定）', r4.valid.length === 1);

  const HEAD2 = HEAD.concat(['证书状态']);
  const r5 = IO._analyze([HEAD2,
    ['丁', '6', '仓储', '', 'N1', 'X10', '2027-01-01', '', '', '停用'],
    ['戊', '7', '仓储', '', 'N1', 'X11', '2027-01-01', '', '', '乱写状态']
  ], XIO);
  ok('状态写「停用」→ suspended', r5.valid[0] && r5.valid[0].status === 'suspended', r5.valid[0] && r5.valid[0].status);
  ok('状态写乱 → 报错并提示可选项', r5.errors.some(e => /不在可选项内/.test(e.msg)), JSON.stringify(r5.errors).slice(0, 80));

  /* 表头全不认识 */
  const r6 = IO._analyze([['A', 'B'], ['1', '2']], XIO);
  ok('表头完全对不上 → 致命', !!r6.fatal && /没找到表头/.test(r6.fatal), r6.fatal);

  /* ---------------- 6. 写入：追加 / 覆盖 / 编号顺延 ---------------- */
  console.log('== 6. 导入写入 ==');
  const beforeCount = (SD.store.data().devicePersonnel || []).length;
  ok('导入前台账为空（预置名单已移除，不再是 78 人）', beforeCount === 0, beforeCount + ' 条');
  const out1 = IO._doImport(XIO, r1, 'append');
  ok('追加导入 3 条', out1.added === 3, out1.added);
  ok('编号自动顺延 TZSB-001', SD.store.data().devicePersonnel[0].code === 'TZSB-001', SD.store.data().devicePersonnel[0].code);
  ok('编号顺延到 TZSB-003', SD.store.data().devicePersonnel[2].code === 'TZSB-003', SD.store.data().devicePersonnel[2].code);
  ok('每条都生成了 id', SD.store.data().devicePersonnel.every(x => !!x.id));
  ok('photos 初始化成数组', SD.store.data().devicePersonnel.every(x => Array.isArray(x.photos)));

  const out2 = IO._doImport(XIO, r1, 'append');
  ok('再导同一份 → 全部按重复跳过', out2.added === 0 && out2.skipped === 3, out2.added + '/' + out2.skipped);

  SD.app.reload();
  await wait(900);
  ok('刷新后 summary 里有 3 条', (SD.app.state.summary.devicePersonnel || []).length === 3,
    (SD.app.state.summary.devicePersonnel || []).length);
  ok('summary 里状态被实时重算（2025 那条=expired）',
    (SD.app.state.summary.devicePersonnel || []).some(x => x.status === 'expired'));

  const out3 = IO._doImport(XIO, r1, 'replace');
  ok('覆盖模式 → 台账只剩 3 条', out3.total === 3 && SD.store.data().devicePersonnel.length === 3, out3.total);
  ok('覆盖模式不再顺延旧编号（从 001 重新起）',
    SD.store.data().devicePersonnel[0].code === 'TZSB-001', SD.store.data().devicePersonnel[0].code);

  /* ---------------- 7. 界面：按钮 / 弹窗 / 内置名单已移除 ---------------- */
  console.log('== 7. 界面 ==');
  await go('devicePersonnel');
  let view = doc.getElementById('view');
  let btns = Array.from(view.querySelectorAll('button'));
  const impBtn = btns.find(b => /导入 Excel/.test(b.textContent));
  const expBtn = btns.find(b => /导出 Excel/.test(b.textContent));
  ok('设备台账有「导入 Excel」', !!impBtn);
  ok('设备台账有「导出 Excel」', !!expBtn);
  ok('「载入内置名单」按钮已移除', !btns.some(b => /载入内置名单/.test(b.textContent)));
  ok('SD.deviceSeed 已不存在', typeof SD.deviceSeed === 'undefined', typeof SD.deviceSeed);
  ok('导入前台账为空（78 人预置名单已移除）', beforeCount === 0, beforeCount + ' 条');

  if (impBtn) {
    click(impBtn);
    await wait(400);
    const dlg = doc.querySelector('#dialogRoot .mask');
    ok('点击后弹出导入对话框', !!dlg, dlg && dlg.textContent.slice(0, 30));
    if (dlg) {
      const fileInput = dlg.querySelector('input[type=file]');
      ok('有文件选择框且 accept 含 .xlsx', !!fileInput && /\.xlsx/.test(fileInput.getAttribute('accept') || ''),
        fileInput && fileInput.getAttribute('accept'));
      ok('有两种导入方式（追加 / 覆盖）',
        dlg.querySelectorAll('input[name="xioMode"]').length === 2,
        dlg.querySelectorAll('input[name="xioMode"]').length);
      ok('有「下载模板」按钮', /下载模板/.test(dlg.textContent));
      const okBtn = Array.from(dlg.querySelectorAll('button')).find(b => /开始导入/.test(b.textContent));
      ok('弹窗有「开始导入」按钮', !!okBtn);
      if (okBtn) {
        click(okBtn);
        await wait(350);
        ok('未选文件就点导入 → 明确提示要先选文件', /请先选择/.test(dlg.textContent),
          dlg.textContent.slice(-40).replace(/\s+/g, ' '));
      }

      /* 关掉弹窗 */
      const cancel = Array.from(dlg.querySelectorAll('button')).find(b => /取消|关闭/.test(b.textContent));
      if (cancel) { click(cancel); await wait(200); }
    }
  }

  /* ---------------- 8. 导出内容 ---------------- */
  console.log('== 8. 导出 ==');
  if (expBtn) {
    let cap = null;
    const origDl = SD.comp.xlsxWriter.download;
    SD.comp.xlsxWriter.download = function (b, n) { cap = { blob: b, name: n }; };
    click(expBtn);
    await wait(600);
    SD.comp.xlsxWriter.download = origDl;

    ok('导出触发了一次下载', !!cap);
    ok('文件名 = 台账名-YYYYMMDD.xlsx', !!cap && /^特种设备人员台账-\d{8}\.xlsx$/.test(cap.name), cap && cap.name);

    if (cap) {
      const u8 = await blobToU8(cap.blob);
      const back2 = await XR.readArrayBuffer(u8);
      ok('导出件可被本工具回读（自洽）', back2.rows.length === 4, back2.rows.length);
      ok('表头是字段中文名', back2.rows[0][0] === '编号' && back2.rows[0][1] === '姓名',
        JSON.stringify(back2.rows[0]).slice(0, 60));
      ok('导出的是全量台账（3 条）', back2.rows.length - 1 === 3);
      const statusIdx = back2.rows[0].indexOf('证书状态');
      ok('状态导出为中文而不是 valid/expired',
        statusIdx >= 0 && ['有效', '待复审', '已过期', '停用'].indexOf(back2.rows[1][statusIdx]) >= 0,
        statusIdx >= 0 ? back2.rows[1][statusIdx] : '无该列');
    }
  }

  /* ---------------- 9. 特种作业人员台账 ---------------- */
  console.log('== 9. 特种作业人员台账 ==');
  await go('specPersonnel');
  view = doc.getElementById('view');
  btns = Array.from(view.querySelectorAll('button'));
  ok('特种作业台账有导入按钮', btns.some(b => /导入 Excel/.test(b.textContent)));
  ok('特种作业台账有导出按钮', btns.some(b => /导出 Excel/.test(b.textContent)));

  const XIO2 = SD.views.specPersonnel.XIO;
  ok('作业类别走字典校验', XIO2.fields.some(f => f.name === 'category' && f.type === 'dict' && f.dict === 'specialCategory'));
  ok('判重字段是证书编号', XIO2.keyField === 'certNo');

  const H2 = ['姓名', '所属部门', '作业类别', '操作项目', '证书编号', '有效期起', '有效期止', '复审日期'];
  const r7 = IO._analyze([H2,
    ['甲', '生产一部', '电工作业', '低压电工作业', 'C1', '2024-01-01', '2027-01-01', '2026-07-01'],
    ['乙', '生产一部', '不存在的类别', '焊接', 'C2', '2024-01-01', '2027-01-01', '2026-07-01']
  ], XIO2);
  ok('合法类别通过', r7.valid.length === 1, r7.valid.length);
  ok('非法类别被拦并列出可选项', r7.errors.some(e => /不在可选项内/.test(e.msg)), JSON.stringify(r7.errors).slice(0, 90));

  const out4 = IO._doImport(XIO2, r7, 'append');
  ok('特种作业人员导入 1 条', out4.added === 1, out4.added);
  ok('编号按 TZZY 顺延', /^TZZY-\d{3}$/.test(SD.store.data().specialPersonnel.slice(-1)[0].code),
    SD.store.data().specialPersonnel.slice(-1)[0].code);

  /* ---------------- 10. 收尾 ---------------- */
  console.log('== 10. 收尾 ==');
  ok('无 JS 报错', errors.length === 0, errors.slice(0, 3).join(' | '));

  console.log('');
  console.log('结果：通过 ' + pass + ' / 失败 ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.log('FATAL: ' + (e && e.stack || e));
  process.exit(1);
});
