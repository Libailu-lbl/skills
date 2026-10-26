/* 安全员工作台（单机离线 · 空白版）冒烟自检
   用法：node smoke_blank.js [url]   （默认 http://127.0.0.1:8125/index.html）
   覆盖：
    ① 空白初始状态：所有集合为空、SD.initial 存在、SD.mock 已移除
    ② 无演示控件：顶栏无「数据源切换 / 模拟故障」，「重置示例」改为「清空数据」
    ③ 十二个页面在全空数据下渲染空态，且全程无 JS 报错
    ④ 零网络请求：启动 + 逐页导航期间 fetch / XHR 零调用
    ⑤ 功能可用：隐患登记→流转→作废、巡检/培训/通知/作业票/人员增删、看板现算
    ⑥ 备份恢复：导出 JSON → 清空 → 导入恢复
    ⑦ 清空数据：确认后恢复空白初始状态
    ⑧ 报表导出：空数据下日报/周报可渲染，xlsxWriter 产出合法 .xlsx（PK 头）
    ⑨ 角色权限：受限用户进不了特种作业
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

const URL_ = process.argv[2] || 'http://127.0.0.1:8125/index.html';
const wait = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  OK  ' + name + (extra != null ? ' => ' + extra : '')); }
  else { fail++; console.log('  FAIL ' + name + (extra != null ? ' => ' + extra : '')); }
}

(async () => {
  const errors = [];
  const netCalls = [];   // 页面主动发起的网络请求（应为 0）
  const dom = await JSDOM.fromURL(URL_, {
    runScripts: 'dangerously', resources: { interceptors: [noPrintSheet] }, pretendToBeVisual: true,
    beforeParse(win) {
      win.matchMedia = q => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      // 网络间谍：只记录、不转发——空白版任何情况下都不该发起请求
      win.fetch = function () { netCalls.push('fetch ' + arguments[0]); return Promise.reject(new Error('blank 版不应发起网络请求')); };
      win.Headers = globalThis.Headers; win.Request = globalThis.Request;
      win.Response = globalThis.Response; win.AbortController = globalThis.AbortController;
      if (win.XMLHttpRequest && win.XMLHttpRequest.prototype) {
        const _open = win.XMLHttpRequest.prototype.open;
        win.XMLHttpRequest.prototype.open = function (m, u) { netCalls.push('xhr ' + m + ' ' + u); return _open.apply(this, arguments); };
      }
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
  const modal = () => doc.querySelector('.mask');
  const submit = async (m, ms = 1600) => { m.querySelector('.js-ok').dispatchEvent(new win.MouseEvent('click', { bubbles: true })); await wait(ms); };
  const set = (m, id, v) => { const e = m.querySelector('#' + id); if (e) e.value = v; return !!e; };
  const errText = m => { const e = m && m.querySelector('.field-err'); return e && !e.hidden ? e.textContent : ''; };
  const n = k => (SD.app.state.summary[k] || []).length;

  /* ---------- 1. 空白初始状态 ---------- */
  console.log('== 1. 空白初始状态 ==');
  ok('SD.initial 存在（空白状态工厂）', !!SD.initial && typeof SD.initial.build === 'function');
  const blank = SD.initial.build();
  ok('build() 返回全空集合', Object.keys(blank).filter(k => Array.isArray(blank[k])).every(k => blank[k].length === 0),
    Object.keys(blank).join(','));
  ok('SD.mock 已彻底移除', typeof SD.mock === 'undefined');
  ok('SD.dict 存在（枚举字典保留）', !!SD.dict && SD.dict.DICT.permitType.length === 8 && SD.dict.DICT.hazardStatus.length === 6);
  ok('dataSource 数据源为本机', SD.api.source() === 'local', SD.api.source());
  const d0 = SD.app.state.data;
  ['hazards', 'inspections', 'trainings', 'certificates', 'notices', 'trend', 'deptTrend', 'specialPersonnel', 'workPermits']
    .forEach(k => ok('data.' + k + ' 为空数组', Array.isArray(d0[k]) && d0[k].length === 0, d0[k] && d0[k].length));
  // 空白状态无需落盘：首次打开不产生脏快照（为空或是一份合法快照）
  let rawSnap = null;
  try { rawSnap = win.localStorage.getItem('sd_safety_desk_v1'); } catch (e) {}
  let snapOk = true;
  if (rawSnap) { try { snapOk = !!JSON.parse(rawSnap).data; } catch (e) { snapOk = false; } }
  ok('首次打开无脏快照（localStorage 为空或合法）', snapOk, rawSnap ? '已有快照' : '空');

  /* ---------- 2. 顶栏与导航（无演示控件） ---------- */
  console.log('== 2. 顶栏与导航 ==');
  ok('无「数据源切换」下拉', !doc.getElementById('sourceSel'));
  ok('无「模拟故障」开关', !doc.getElementById('chkFault'));
  ok('「重置示例」已改为「清空数据」', doc.getElementById('btnReset').textContent.trim() === '清空数据');
  ok('侧栏数据来源显示「本机数据」', doc.getElementById('srcLabel').textContent === '本机数据');
  const navText = doc.getElementById('sidebar').textContent;
  ok('导航含「报表」组（日报/周报）', navText.indexOf('报表') >= 0 && navText.indexOf('日报') >= 0 && navText.indexOf('周报') >= 0);
  const quicks = Array.from(doc.querySelectorAll('.js-sidebar-quick .quick, .js-sidebar-quick .qk, .js-sidebar-quick button'))
    .map(b => b.textContent.trim());
  ok('侧栏「常用功能」有 6 个快捷入口', quicks.length === 6, quicks.join('/'));
  ok('特种作业类别含「吊装作业」', SD.dict.DICT.specialCategory.indexOf('吊装作业') >= 0,
    SD.dict.DICT.specialCategory.join('/'));
  ok('无「整改通知单 / 应急联络」占位入口', quicks.every(q => q.indexOf('整改通知单') < 0 && q.indexOf('应急联络') < 0));

  /* ---------- 3. 十二页面空态渲染 ---------- */
  console.log('== 3. 全空数据下十二页面渲染 ==');
  const ROUTES = ['overview', 'todo', 'hazard', 'inspection', 'training', 'dashboard', 'notice',
    'special', 'specPersonnel', 'specPermit', 'dailyReport', 'weeklyReport'];
  for (const r of ROUTES) {
    await go(r);
    const v = view();
    // 空态页面（隐患/巡检）不包 .card，直接是筛选条 + 空态卡，按「有内容节点」判定
    const nodes = v.querySelectorAll('.card, .state, .filters').length;
    ok('#' + r + ' 渲染出内容（节点 ' + nodes + '）', nodes > 0);
    ok('#' + r + ' 无骨架屏残留', !v.querySelector('.sk-card'));
  }
  await go('hazard');
  ok('隐患页空态引导（还没有隐患记录）', view().textContent.indexOf('还没有隐患记录') >= 0);
  ok('隐患页空态带「登记第一条隐患」动作', !!Array.from(view().querySelectorAll('button')).find(b => /登记第一条隐患/.test(b.textContent)));
  await go('inspection');
  ok('巡检页空态引导（安全巡检）', view().textContent.indexOf('还没有安全巡检任务') >= 0);
  ok('巡检页空态带新增动作', view().textContent.indexOf('新增第一条巡检') >= 0);
  await go('overview');
  ok('概览有 4 张指标卡', view().querySelectorAll('.stat').length === 4, view().querySelectorAll('.stat').length);
  ok('概览「今天要处理」为空态', view().textContent.indexOf('今天没有待处理事项') >= 0);
  await go('dashboard');
  ok('看板「暂无趋势数据」空态', view().textContent.indexOf('暂无趋势数据') >= 0);
  ok('看板「暂无部门趋势数据」空态', view().textContent.indexOf('暂无部门趋势数据') >= 0);
  ok('看板「暂无部门数据」空态', view().textContent.indexOf('暂无部门数据') >= 0);
  await go('notice');
  ok('通知页说明卡指向侧栏快捷入口',
    view().textContent.indexOf('已移至左侧导航下方') >= 0);
  await go('dailyReport');
  const secHeads = Array.from(view().querySelectorAll('.card-head h3')).map(h => h.textContent.trim());
  ['隐患排查与治理', '安全巡检执行', '安全教育培训', '危险作业票', '通知公告', '资质预警']
    .forEach(k => ok('日报含分节：' + k, secHeads.some(h => h.indexOf(k) >= 0)));
  ok('日报空数据给「当日无…」提示', view().textContent.indexOf('当日无新登记隐患') >= 0);
  await go('weeklyReport');
  ok('周报空数据给「本周无…」提示', view().textContent.indexOf('本周无新登记隐患') >= 0);

  /* ---------- 4. 零网络请求 ---------- */
  console.log('== 4. 离线保证 ==');
  ok('启动 + 逐页导航期间零网络请求', netCalls.length === 0, netCalls.join(' | '));
  ok('全程无 JS 报错', errors.length === 0, errors.slice(0, 3).join(' | '));

  /* ---------- 5. 功能可用（CRUD 全链路） ---------- */
  console.log('== 5. 功能可用 ==');
  const T = SD.app.state.summary.today;
  const Y = String(new Date().getFullYear());   // 编号手改用（预填值可改可清空，2026-10-24 起）
  // 隐患：登记 → 列表/待办联动 → 流转 → 作废
  let hz = await SD.api.createHazard({
    code: 'FZYH-0000001', title: '冒烟-消防通道堆放物料', type: '消防', severity: 'general', statutoryLevel: 'general',
    dept: '生产一部', owner: '测试员', location: 'A 区', source: '日常巡检',
    foundDate: T, originalDueDate: T, dueDate: T, measure: '清理并划线', note: ''
  });
  ok('登记隐患成功（编号为手填值）', !!hz && hz.code === 'FZYH-0000001', hz && hz.code);
  await SD.app.reload();
  ok('隐患列表 +1', n('hazards') === 1, n('hazards'));
  ok('未整改 +1', SD.app.state.summary.openCount === 1, SD.app.state.summary.openCount);
  ok('今日到期进待办', SD.app.state.summary.todos.length === 1, SD.app.state.summary.todos.length);
  await go('hazard');
  ok('隐患表格渲染出该行', view().textContent.indexOf('冒烟-消防通道堆放物料') >= 0);
  await go('dashboard');
  ok('看板部门趋势现算出部门', SD.app.state.summary.deptTrend.depts.length === 1 &&
    SD.app.state.summary.deptTrend.depts[0].dept === '生产一部' &&
    SD.app.state.summary.deptTrend.depts[0].total === 1,
    JSON.stringify(SD.app.state.summary.deptTrend.depts));
  await go('overview');
  hz = SD.app.state.data.hazards[0];
  await SD.api.advanceHazard(hz.id, 'fixing', { note: '开始整改' });
  await SD.app.reload();
  const hzAfter = SD.app.state.data.hazards[0];
  ok('状态流转 fixing 且留痕 2 条', hzAfter.status === 'fixing' && hzAfter.flow.length === 2, hzAfter.flow.length);
  await SD.api.voidHazard(hzAfter.id, '登记有误', '测试员');
  await SD.app.reload();
  ok('作废后退出在办口径', SD.app.state.summary.openCount === 0 && SD.app.state.summary.voidCount === 1);
  ok('作废记录仍在台账（留痕）', n('hazards') === 1);

  // 巡检 / 培训 / 通知 / 作业票 / 人员：增 → 删（各来一轮；编号均为手填）
  const insp = await SD.api.createInspection({ code: 'FZXJ-' + Y + '-001', planName: '冒烟-巡检', type: '日常巡检', area: 'A 区', dept: '安环部', executor: '测试员', scheduledDate: T });
  ok('新增巡检成功', !!insp && insp.code === 'FZXJ-' + Y + '-001', insp && insp.code);
  const tr = await SD.api.createTraining({ code: 'FZPX-' + Y + '-001', name: '冒烟-培训', type: '专项培训', target: '全员', trainer: '测试员', startDate: T, endDate: T, required: 10, actual: 8 });
  ok('新增培训成功', !!tr && tr.code === 'FZPX-' + Y + '-001', tr && tr.code);
  const nt = await SD.api.createNotice({ code: 'FZTG-' + Y + '-001', title: '冒烟-通知', level: 'normal', source: '安环部', publishAt: T, summary: '测试' });
  ok('发布通知成功', !!nt && nt.code === 'FZTG-' + Y + '-001', nt && nt.code);
  const sp = await SD.api.createSpecialPersonnel({ code: 'TZZY-001', name: '冒烟-证人', dept: '生产一部', category: '电工作业', operation: '低压电工作业', certNo: 'T-TEST-001', issuer: '市应急管理局', validFrom: T, validTo: SD.utils.shift(T, 300), reviewDate: SD.utils.shift(T, 300), status: 'valid' });
  ok('新增特种作业人员成功', !!sp && sp.code === 'TZZY-001', sp && sp.code);
  const wp = await SD.api.createWorkPermit({ code: 'FZZY-0000001', type: '动火作业', location: 'B 区', dept: '生产二部', applicant: '测试员', leader: '测试员', guardian: '监护人', workers: ['测试员'], risk: '火灾', measures: '配灭火器', planStart: T, planEnd: T, status: 'draft' });
  ok('新增作业票成功', !!wp && wp.code === 'FZZY-0000001', wp && wp.code);
  await SD.app.reload();
  ok('五类记录全部落库', n('inspections') === 1 && n('trainings') === 1 && n('notices') === 1 &&
    n('specialPersonnel') === 1 && n('workPermits') === 1);
  await SD.api.removeNotice(nt.id);
  await SD.app.reload();
  ok('删除通知成功', n('notices') === 0);

  /* ---------- 6. 导出 / 导入 / 清空 ---------- */
  console.log('== 6. 备份恢复与清空 ==');
  const json = SD.store.exportJSON();
  const parsed = JSON.parse(json);
  ok('导出 JSON 可解析且带全量数据', parsed.data && parsed.data.hazards.length === 1 && parsed.data.inspections.length === 1,
    'hazards=' + (parsed.data && parsed.data.hazards.length));
  const bad = SD.store.importJSON('{oops');
  ok('导入非法 JSON 被拦截', bad.ok === false && /JSON/.test(bad.msg), bad.msg);
  const noData = SD.store.importJSON(JSON.stringify({ foo: 1 }));
  ok('导入无隐患数据的文件被拦截', noData.ok === false, noData.msg);
  // 编号手动必填后，导入同样校验：空号备份拒入
  const noCode = JSON.parse(json);
  noCode.data.inspections[0] = Object.assign({}, noCode.data.inspections[0], { code: '' });
  const badCode = SD.store.importJSON(JSON.stringify(noCode));
  ok('含空编号的备份被拦截', badCode.ok === false && /编号校验未通过/.test(badCode.msg), badCode.msg);
  const imp = SD.store.importJSON(json);
  ok('导入自己的备份成功', imp.ok === true, imp.msg);
  await SD.app.reload();
  ok('导入后数据恢复', n('hazards') === 1 && n('workPermits') === 1);

  // 清空数据：点按钮 → **清空数据专用密码**校验（2026-10-25 起，不再只是二次确认）
  await go('overview');
  click(doc.getElementById('btnReset'));
  await wait(250);
  let m = modal();
  ok('「清空数据」弹出专用密码校验框',
    !!m && /清空数据/.test(m.textContent) && /专用密码/.test(m.textContent), m && m.textContent.slice(0, 40));
  const purgeInp = m && m.querySelector('.js-purge-inp');
  ok('有专用密码输入框（6 位）', !!purgeInp && purgeInp.maxLength === 6);

  // 先输错 → 必须拦住、数据不动
  if (purgeInp) purgeInp.value = '000000';
  await submit(m, 500);
  ok('专用密码错误：被拦下且数据没动', n('hazards') === 1 && !!modal() && /专用密码不正确/.test(modal().textContent),
    (modal() && modal().textContent.slice(0, 60)) + ' hazards=' + n('hazards'));

  // 再输对 → 清空
  if (purgeInp) purgeInp.value = SD.auth.DEFAULT_PURGE_PIN;
  await submit(modal());
  ok('清空后恢复空白初始状态', n('hazards') === 0 && n('inspections') === 0 && n('workPermits') === 0 &&
    n('specialPersonnel') === 0 && n('trainings') === 0 && n('notices') === 0);
  const snap = JSON.parse(win.localStorage.getItem('sd_safety_desk_v1'));
  ok('本机快照同步为空白', snap.data.hazards.length === 0 && snap.data.trend.length === 0);

  /* ---------- 7. 报表导出（空数据） ---------- */
  console.log('== 7. 报表 Excel 导出 ==');
  const aggD = SD.report.daily(SD.app.state.data, T);
  const aggW = SD.report.weekly(SD.app.state.data, T);
  ok('日报预览 7 个分节', aggD && SD.report.sections('daily', aggD).length === 7);
  ok('周报预览 7 个分节', aggW && SD.report.sections('weekly', aggW).length === 7);
  ok('日报导出 4 个分节', SD.report.exportSections('daily', aggD).length === 4);
  ok('周报导出 4 个分节', SD.report.exportSections('weekly', aggW).length === 4);
  ok('导出不含通知公告/资质预警',
    !SD.report.exportSections('daily', aggD).some(s => /通知公告|资质预警/.test(s.title)));
  const sheets = SD.report.toSheets('daily', aggD, { title: '安全生产日报', period: T, reporter: '测试', dept: '安环部', generatedAt: T });
  const blob = SD.comp.xlsxWriter.build(sheets);
  ok('生成 .xlsx Blob', !!blob && blob.size > 1500, blob && blob.size + ' bytes');
  ok('MIME 为 xlsx', blob.type.indexOf('spreadsheetml') >= 0, blob.type);
  let magic = '';
  try {
    const buf = new Uint8Array(await blob.arrayBuffer());
    magic = Array.from(buf.slice(0, 4)).map(b => String.fromCharCode(b)).join('');
  } catch (e) { magic = 'arrayBuffer 不可用'; }
  ok('ZIP 头为 PK\\x03\\x04（合法 xlsx）', magic === 'PK\x03\x04', magic);

  /* ---------- 7.5 单据编号默认填入（可手改） ---------- */
  console.log('== 7.5 单据编号默认填入（可手改） ==');
  ok('规则表七类齐全', ['hazard', 'inspection', 'training', 'certificate', 'notice', 'special', 'permit']
    .every(t => SD.CONFIG.codeRules[t] && SD.CONFIG.codeRules[t].prefix));
  ok('默认值顺延生成（SD.code.next 存在，不自动落库）',
    typeof SD.code.next === 'function' && typeof SD.code.nextCode !== 'function');
  ok('空编号报错', /不能为空/.test(SD.code.check('hazard', '') || ''));
  ok('格式不符报错', /格式应形如/.test(SD.code.check('hazard', 'ABC') || ''));
  await go('inspection');
  const addBtn = Array.from(doc.querySelectorAll('#view .btn')).find(x => /新增巡检/.test(x.textContent || ''));
  ok('有「新增巡检」按钮', !!addBtn);
  click(addBtn);
  await wait(260);
  let cm = modal();
  ok('巡检表单有编号输入框', !!cm && !!cm.querySelector('#ff_code'));
  ok('编号预填下一个可用编号（可手改）',
    cm && cm.querySelector('#ff_code').value === SD.code.next('inspection'),
    cm && cm.querySelector('#ff_code').value);
  ok('无「默认」按钮', !(cm && cm.querySelector('.js-code-def')));
  ok('巡检表单有状态下拉（默认待执行）',
    cm && !!cm.querySelector('#ff_status') && cm.querySelector('#ff_status').value === 'planned',
    cm && cm.querySelector('#ff_status') && cm.querySelector('#ff_status').value);
  set(cm, 'ff_planName', '编号冒烟'); set(cm, 'ff_area', 'A 区'); set(cm, 'ff_executor', '王安全');
  set(cm, 'ff_code', 'BAD');
  await submit(cm, 700);
  ok('格式不符被拦下', /格式应形如/.test(errText(modal())), errText(modal()));
  set(cm, 'ff_code', '');
  await submit(cm, 700);
  ok('空编号被拦下', /不能为空/.test(errText(modal())), errText(modal()));
  set(cm, 'ff_code', 'FZXJ-' + Y + '-500');
  await submit(cm);
  const madeIns = SD.app.state.summary.inspections.find(x => x.planName === '编号冒烟');
  ok('自定义编号落库', madeIns && madeIns.code === 'FZXJ-' + Y + '-500', madeIns && madeIns.code);
  ok('同类重复被拦下', /已存在/.test(SD.code.check('inspection', 'FZXJ-' + Y + '-500') || ''));
  ok('跨类型不冲突（隐患可用同一个号）', SD.code.isDup('hazard', 'FZXJ-' + Y + '-500') === false);

  /* ---------- 7.6 待办四类口径 ---------- */
  console.log('== 7.6 待办四类口径 ==');
  await go('todo');
  await wait(200);
  {
    const chips = Array.from(view().querySelectorAll('.chip')).map(c => c.textContent.trim());
    ['全部', '隐患', '逾期整改', '今日到期', '待我验收', '巡检任务', '作业票', '培训']
      .forEach(k => ok('待办筛选有「' + k + '」', chips.some(c => c.indexOf(k) === 0), chips.join(' | ')));
    ok('待办页有搜索框', !!view().querySelector('.filters input'));
    ok('待办页有排序下拉', !!view().querySelector('select.ctl-select'));
  }

  /* ---------- 7.7 搜索框焦点保持 + 导航「更多」分组 ---------- */
  console.log('== 7.7 搜索焦点与导航分组 ==');
  await go('inspection');
  await wait(300);
  {
    const q = view().querySelector('[data-keep-focus="insp"]');
    ok('巡检页搜索框带 keep-focus 标记', !!q);
    if (q) {
      q.focus();
      for (const ch of ['A', 'B', 'C']) {
        q.value += ch;
        q.dispatchEvent(new win.Event('input', { bubbles: true }));
        await wait(90);
      }
      await wait(450);
      const qNow = view().querySelector('[data-keep-focus="insp"]');
      // ★ 核心：搜索只重绘列表，输入框 DOM 不重建（否则连续打字与中文输入法都会被打断）
      ok('连续输入时输入框 DOM 未被重建（同一元素）', qNow === q, qNow === q ? '同一元素' : '被替换');
      ok('连续输入的文字完整保留', qNow && qNow.value === 'ABC', qNow && qNow.value);
      ok('焦点始终在输入框', doc.activeElement === qNow);
    }
    // 导航分组：常用 5 项常驻；看板/通知/日报/周报 在「更多」里
    const primary = Array.from(doc.querySelectorAll('#navPrimary .nav-item .txt')).map(x => x.textContent.trim());
    ok('常用组含 概览/待办/隐患/巡检/培训/特种作业',
      ['安全概览', '待办任务', '隐患管理', '安全巡检', '安全培训', '特种作业'].every(k => primary.indexOf(k) >= 0),
      primary.join('/'));
    ok('特种作业父级与两子菜单都在常用区',
      !!doc.querySelector('#navPrimary [data-route="special"].has-children') &&
      !!doc.querySelector('#navPrimary .nav-children [data-route="specPersonnel"]') &&
      !!doc.querySelector('#navPrimary .nav-children [data-route="specPermit"]'));
    const sec = doc.getElementById('navSecondary');
    const moreNames = Array.from(sec.querySelectorAll('.nav-item .txt')).map(x => x.textContent.trim());
    ok('「更多」组含 数据看板/通知公告/日报/周报',
      ['数据看板', '通知公告', '日报', '周报'].every(k => moreNames.indexOf(k) >= 0), moreNames.join('/'));
    ok('「更多」组有「报表」小标题',
      Array.from(sec.querySelectorAll('.nav-sub-title')).some(x => x.textContent.trim() === '报表'));
  }

  /* ---------- 8. 角色权限 ---------- */
  console.log('== 8. 角色权限 ==');
  SD.auth.set('restricted');
  await go('special');
  ok('受限用户看到无权限页', !!view().querySelector('.forbidden-card'));
  SD.auth.set('safety_officer');
  SD.app.refreshAll();   // 与顶栏角色下拉的行为一致：切角色立即重渲
  await wait(200);
  ok('安全员可正常进入', !view().querySelector('.forbidden-card') && view().querySelectorAll('.card').length > 0);
  SD.auth.set('safety_officer');

  /* ---------- 汇总 ---------- */
  console.log('\n结果：通过 ' + pass + ' / 失败 ' + fail);
  console.log('网络请求次数：' + netCalls.length + '；JS 错误数：' + errors.length);
  if (fail > 0 || errors.length > 0 || netCalls.length > 0) process.exit(1);
  dom.window.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
