/* 安全员工作台 · 冒烟自检
   用法：node smoke.js [url]
   覆盖：加载 → 七页渲染 → 三态（失败/空）→ 登记隐患 → 状态流转 → 改期 → 阈值 → 导出
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
      win.addEventListener('error', e => errors.push(String(e.message)));
    },
  });
  const win = dom.window;
  win.addEventListener('error', e => errors.push(String(e.message)));
  win.addEventListener('unhandledrejection', e => errors.push('rejection: ' + String(e.reason && e.reason.message || e.reason)));

  // 等待首屏数据
  for (let i = 0; i < 80 && !(win.SD && win.SD.app && win.SD.app.state.summary); i++) await wait(150);
  const SD = win.SD;
  // 2026-10-25：工作台默认「受限用户」，测试先解锁为安全员（等同输入六位密码）
  SD.auth.set('safety_officer');
  if (SD.app.refreshAll) SD.app.refreshAll();
  await wait(300);

  if (!SD || !SD.app) { console.log('FATAL: SD 未初始化'); process.exit(1); }

  const doc = win.document;
  console.log('== 1. 启动与数据 ==');
  const s = SD.app.state.summary;
  ok('取到数据', !!s);
  ok('隐患 12 条', s.hazards.length === 12, s.hazards.length);
  ok('巡检 9 条', s.inspections.length === 9, s.inspections.length);
  ok('证书 7 本', s.certificates.length === 7, s.certificates.length);
  ok('通知 4 条', s.notices.length === 4, s.notices.length);
  ok('趋势 12 个月', s.trend.length === 12, s.trend.length);

  console.log('== 2. 口径核对 ==');
  ok('逾期 = 3 条', s.overdueCount === 3, s.overdueCount);
  ok('临期 = 2 条', s.soonCount === 2, s.soonCount);
  ok('延期跟进 ≥1', s.delayedCount >= 1, s.delayedCount);
  ok('今日待办 > 0', s.todos.length > 0, s.todos.length);
  ok('本周巡检率非空', s.inspectionWeek.rate != null, s.inspectionWeek.rate);
  ok('排序：首条是逾期且最久', s.hazards[0]._overdue === true, s.hazards[0].code + ' 逾期' + s.hazards[0]._overdueDays + '天');
  ok('延期项不计逾期', s.hazards.filter(h => h.status === 'delayed').every(h => !h._overdue));
  ok('证书已过期 2 本', s.certSummary.expired === 2, s.certSummary.expired);
  ok('证书即将到期 2 本', s.certSummary.warn === 2, s.certSummary.warn);

  console.log('== 3. 七页渲染 ==');
  const routes = ['overview', 'todo', 'hazard', 'inspection', 'training', 'dashboard', 'notice'];
  for (const r of routes) {
    win.location.hash = '#/' + r;
    await wait(260);
    const v = doc.getElementById('view');
    const txt = (v.textContent || '').trim();
    ok('渲染 ' + r, txt.length > 30 && !/加载失败/.test(txt), txt.length + ' 字');
    ok('  ' + r + ' 无报错', errors.length === 0, errors[0] || '');
  }

  console.log('== 3.5 导航分组与「更多」折叠 + 搜索框焦点保持 ==');
  win.location.hash = '#/overview';
  await wait(300);
  {
    const primary = Array.from(doc.querySelectorAll('#navPrimary .nav-item .txt')).map(x => x.textContent.trim());
    ok('常用组含 概览/待办/隐患/巡检/培训/特种作业',
      ['安全概览', '待办任务', '隐患管理', '安全巡检', '安全培训', '特种作业'].every(k => primary.indexOf(k) >= 0),
      primary.join('/'));
    ok('特种作业父级带子菜单（人员 + 设备人员 + 作业票 都在常用区内）',
      !!doc.querySelector('#navPrimary [data-route="special"].has-children') &&
      !!doc.querySelector('#navPrimary .nav-children [data-route="specPersonnel"]') &&
      !!doc.querySelector('#navPrimary .nav-children [data-route="devicePersonnel"]') &&
      !!doc.querySelector('#navPrimary .nav-children [data-route="specPermit"]'));
    ok('特种设备人员台帐入口常驻可见（子菜单不折叠、无 hidden）',
      (() => {
        const box = doc.querySelector('#navPrimary [data-route="special"]');
        const kids = box && box.parentNode.querySelector('.nav-children');
        return !!kids && !kids.hasAttribute('hidden') &&
          !!kids.querySelector('[data-route="devicePersonnel"]');
      })(),
      (doc.querySelector('#navPrimary .nav-children') || {}).outerHTML);
    ok('常用组不含看板/通知/报表',
      !['数据看板', '通知公告', '日报', '周报'].some(k => primary.indexOf(k) >= 0));
    const sec = doc.getElementById('navSecondary');
    const moreBtn = doc.getElementById('navMoreBtn');
    ok('「更多」默认折叠（在常用页）', sec.hidden === true);
    const secNames = () => Array.from(sec.querySelectorAll('.nav-item .txt')).map(x => x.textContent.trim());
    moreBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await wait(150);
    ok('点「更多」展开', sec.hidden === false && moreBtn.getAttribute('aria-expanded') === 'true');
    ok('更多组含 数据看板/通知公告/日报/周报',
      ['数据看板', '通知公告', '日报', '周报'].every(k => secNames().indexOf(k) >= 0), secNames().join('/'));
    ok('更多组有「报表」小标题',
      Array.from(sec.querySelectorAll('.nav-sub-title')).some(x => x.textContent.trim() === '报表'));
    moreBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await wait(150);
    ok('再点「更多」收起', sec.hidden === true && moreBtn.getAttribute('aria-expanded') === 'false');
    // 当前页在更多组时自动展开
    win.location.hash = '#/dashboard';
    await wait(300);
    ok('进入更多组页面时自动展开', sec.hidden === false);
    // 展开状态不被刷新收回（搜索输入触发 refresh）+ 焦点保持
    win.location.hash = '#/inspection';
    await wait(300);
    moreBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await wait(150);
    const q = doc.querySelector('#view [data-keep-focus="insp"]');
    ok('巡检页有带 keep-focus 标记的搜索框', !!q);
    if (q) {
      q.focus();
      const rowsBefore = doc.querySelectorAll('#view tbody tr').length;
      // 连续打字：每 90ms 一个字符，跨越 debounce 窗口（模拟真实输入）
      for (const ch of ['配', '电', '室']) {
        q.value += ch;
        q.dispatchEvent(new win.Event('input', { bubbles: true }));
        await wait(90);
      }
      await wait(450);
      const qNow = doc.querySelector('#view [data-keep-focus="insp"]');
      // ★ 核心：搜索只重绘列表，输入框 DOM 不重建 —— 这是「能连续打字」的前提
      ok('连续输入时输入框 DOM 未被重建（同一元素）', qNow === q, qNow === q ? '同一元素' : '被替换');
      ok('连续输入的文字完整保留', qNow && qNow.value === '配电室', qNow && qNow.value);
      ok('焦点始终在输入框', doc.activeElement === qNow);
      ok('列表已按关键词过滤', doc.querySelectorAll('#view tbody tr').length === 1,
        rowsBefore + ' → ' + doc.querySelectorAll('#view tbody tr').length + ' 行');
      ok('搜索时「更多」保持展开（不被收回）', sec.hidden === false);
    }
  }

  console.log('== 4. 图表与三态 ==');
  win.location.hash = '#/dashboard';
  await wait(300);
  ok('折线图 SVG', doc.querySelectorAll('#view svg path').length > 0);
  ok('环形图 SVG', doc.querySelectorAll('#view svg circle').length > 0);
  ok('条形图', doc.querySelectorAll('#view .bar-row').length > 0);

  // 加载失败态：打开模拟故障
  doc.getElementById('chkFault').checked = true;
  doc.getElementById('chkFault').dispatchEvent(new win.Event('change'));
  await wait(900);
  ok('失败态展示', /数据加载失败/.test(doc.getElementById('view').textContent));
  ok('失败态有重试按钮', !!doc.querySelector('#view .state.err .btn'));
  // 关掉故障并重试
  doc.getElementById('chkFault').checked = false;
  doc.getElementById('chkFault').dispatchEvent(new win.Event('change'));
  await wait(1200);
  ok('重试后恢复', !/数据加载失败/.test(doc.getElementById('view').textContent));

  // 空数据态：切到一个必然无结果的筛选
  win.location.hash = '#/hazard';
  await wait(300);
  const q = doc.querySelector('.filters input.input');
  q.value = 'zzz-不存在的关键字-zzz';
  q.dispatchEvent(new win.Event('input'));
  await wait(600);
  ok('空数据态展示', /没有符合条件的隐患/.test(doc.getElementById('view').textContent));

  console.log('== 5. 交互：登记隐患 ==');
  win.location.hash = '#/hazard';
  await wait(400);
  const before = SD.app.state.summary.hazards.length;
  // 点「登记隐患」
  const addBtn = Array.from(doc.querySelectorAll('#view .btn')).find(b => /登记隐患/.test(b.textContent));
  ok('找到登记按钮', !!addBtn);
  addBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(200);
  const modal = doc.querySelector('.mask');
  ok('弹窗打开', !!modal);
  modal.querySelector('#f_code').value = 'FZ-0000901';
  modal.querySelector('#f_title').value = '冒烟测试隐患';
  modal.querySelector('#f_due').value = SD.utils.shift(SD.app.state.summary.today, 3);
  modal.querySelector('.js-ok').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(1500);
  ok('隐患已新增', SD.app.state.summary.hazards.length === before + 1,
     before + ' → ' + SD.app.state.summary.hazards.length);

  console.log('== 6. 交互：状态流转 ==');
  // 清掉上一节留下的搜索词（筛选会在页面间保留，这是设计如此）
  SD.app.state.filters.hazard.q = '';
  SD.app.refreshAll();
  const target = SD.app.state.summary.hazards.find(h => h.status === 'pending');
  win.location.hash = '#/hazard';
  await wait(400);
  // 操作列已收成下拉菜单：先点「操作」，再从菜单里选推进项
  const opsBtn = doc.querySelector('#view [data-act="ops"][data-id="' + (target && target.id) + '"]');
  ok('操作列是下拉菜单', !!opsBtn);
  let adv = null, to = null;
  if (opsBtn) {
    to = SD.metrics.nextOptions(target.status)[0];
    opsBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await wait(220);
    const menu = doc.querySelector('.dd-menu');
    ok('下拉菜单已弹出', !!menu);
    ok('菜单项挂在 body 上', !!menu && menu.parentNode === doc.body);
    adv = menu && Array.from(menu.querySelectorAll('.dd-item'))
      .find(el => new RegExp(to === 'fixing' ? '开始整改' : (to === 'verifying' ? '提交验收' : '验收闭环')).test(el.textContent));
    ok('菜单里有推进项', !!adv, adv && adv.textContent);
    adv.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await wait(200);
    ok('点完菜单已关闭', !doc.querySelector('.dd-menu'));
    const m2 = doc.querySelector('.mask');
    ok('流转弹窗打开', !!m2);
    if (m2) {
      m2.querySelector('.js-ok').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      await wait(1500);
      const after = SD.app.state.summary.hazards.find(h => h.id === (target && target.id));
      ok('状态已推进到 ' + to, !!after && after.status === to, after && after.status);
    }
  }

  console.log('== 7. 交互：待办一键完成 ==');
  win.location.hash = '#/todo';
  await wait(400);
  // 找一个巡检类待办（完成它一定会从待办里消失）
  const items = Array.from(doc.querySelectorAll('.todo-item'));
  const inspItem = items.find(el => /巡检/.test(el.textContent));
  const chk = inspItem ? inspItem.querySelector('.todo-check') : doc.querySelector('.todo-check');
  ok('待办有完成按钮', !!chk);
  if (chk) {
    const n0 = SD.app.state.summary.todos.length;
    chk.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await wait(1600);
    const n1 = SD.app.state.summary.todos.length;
    ok('待办数减少', n1 < n0, n0 + ' → ' + n1);
  }

  // 隐患类待办：一键推进后状态必须变化（未闭环的隐患不会从待办消失，这是对的）
  const hzItem = Array.from(doc.querySelectorAll('.todo-item'))
    .find(el => !/巡检/.test(el.textContent));
  if (hzItem) {
    const st0 = SD.app.state.summary.hazards.find(h => h.status !== 'closed');
    const before2 = st0 && st0.status;
    const c2 = hzItem.querySelector('.todo-check');
    if (c2) {
      c2.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      await wait(1600);
      const st1 = SD.app.state.summary.hazards.find(h => h.id === st0.id);
      ok('隐患待办一键推进生效', !!st1 && st1.status !== before2, before2 + ' → ' + (st1 && st1.status));
    }
  }

  console.log('== 8. 持久化 ==');
  const raw = win.localStorage.getItem('sd_safety_desk_v1');
  ok('已写入 localStorage', !!raw && raw.length > 100, (raw || '').length + ' 字节');

  console.log('== 9. JS 报错 ==');
  ok('无 JS 报错', errors.length === 0, errors.slice(0, 3).join(' | '));

  console.log('\n结果：通过 ' + pass + ' / 失败 ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('异常:', e && e.stack || e); process.exit(1); });
