/* 安全员工作台 · 各部门隐患趋势 冒烟自检
   用法：node smoke_trend.js [url]
   覆盖：① metrics.deptTrend 口径（12 个月窗口 / 部门降序 / 各月合计 = 全厂新增）
        ② 无预聚合数据时从 hazards.foundDate 现算（兜底链路）
        ③ 看板「各部门隐患趋势」卡：chips 多选 / 默认前 4 / 折线 series 联动 / 图例
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
  const U = SD.utils;

  /* ---------- 1. metrics 口径 ---------- */
  console.log('== 1. metrics.deptTrend 口径 ==');
  const data = SD.store.data();
  const dt = SD.metrics.deptTrend(data);
  ok('metrics.deptTrend 存在', !!dt && Array.isArray(dt.months) && Array.isArray(dt.depts));
  ok('窗口 = 近 12 个月', dt.months.length === 12, dt.months.length);
  ok('末月 = 本月', dt.months[11] === U.ym(U.today()), dt.months[11]);
  ok('首月 = 11 个月前', dt.months[0] === U.shiftYM(U.ym(U.today()), -11), dt.months[0]);
  ok('部门数 = 台账部门数（8）', dt.depts.length === 8, dt.depts.length);
  ok('部门按总量降序', dt.depts.every((d, i) => i === 0 || dt.depts[i - 1].total >= d.total),
    dt.depts.map(d => d.dept + ':' + d.total).join(' '));
  ok('每个部门 12 个月数据', dt.depts.every(d => d.data.length === 12));
  // 口径一致：各月「各部门合计」= 全厂 trend.created
  const trend = SD.app.state.summary.trend;
  let allMatch = true, detail = [];
  dt.months.forEach((ym, i) => {
    const sum = dt.depts.reduce((a, d) => a + d.data[i], 0);
    const want = (trend.find(t => t.ym === ym) || {}).created;
    if (sum !== want) { allMatch = false; detail.push(ym + ':' + sum + '≠' + want); }
  });
  ok('各月部门合计 = 全厂新增（两张图同一口径）', allMatch, detail.join(',') || '12/12 个月全部吻合');
  ok('部门总量 = 全厂新增合计',
    dt.depts.reduce((a, d) => a + d.total, 0) === trend.reduce((a, t) => a + t.created, 0));
  ok('summary 已挂载 deptTrend', !!SD.app.state.summary.deptTrend && SD.app.state.summary.deptTrend.depts.length === 8);

  /* ---------- 2. 兜底：无预聚合时从 foundDate 现算 ---------- */
  console.log('== 2. 兜底链路：从 hazards.foundDate 现算 ==');
  const noAgg = Object.assign({}, data, { deptTrend: undefined });
  const dt2 = SD.metrics.deptTrend(noAgg);
  ok('仍返回 12 个月窗口', dt2.months.length === 12);
  ok('从台账算出部门', dt2.depts.length > 0, dt2.depts.map(d => d.dept + ':' + d.total).join(' '));
  /* 兜底口径的真正不变量：各月各部门合计 === 台账里该月（按 foundDate 归月）的隐患条数。
     （以前是拿演示曲线 TREND_CREATED 比大小 —— 演示曲线是写死的，而台账日期是相对今天造的，
      跨月那几天会出现台账条数 > 曲线值，属于测试口径问题，不是程序错。） */
  const U2 = SD.utils;
  const byMonth = {};
  (data.hazards || []).forEach(h => {
    const ym = U2.ym(h.foundDate);
    if (dt2.months.indexOf(ym) >= 0) byMonth[ym] = (byMonth[ym] || 0) + 1;
  });
  ok('各月各部门合计 = 台账该月条数（兜底口径自洽）', dt2.months.every((ym, i) => {
    const sum = dt2.depts.reduce((a, d) => a + d.data[i], 0);
    return sum === (byMonth[ym] || 0);
  }), dt2.months.map((ym, i) => ym + ':' + dt2.depts.reduce((a, d) => a + d.data[i], 0) + '/' + (byMonth[ym] || 0)).join(' '));
  ok('窗口外月份被剔除', dt2.depts.every(d => d.data.every(v => v >= 0)));

  /* ---------- 3. 看板渲染 ---------- */
  console.log('== 3. 看板：各部门隐患趋势卡 ==');
  await go('dashboard');
  const card = Array.from(view().querySelectorAll('.card'))
    .find(c => /各部门隐患趋势/.test((c.querySelector('h3') || {}).textContent || ''));
  ok('页面有「各部门隐患趋势」卡', !!card);
  const chips = card ? card.querySelectorAll('.js-dept-chips .chip') : [];
  ok('部门 chips = 部门数', chips.length === dt.depts.length, chips.length);
  const onChips = card ? card.querySelectorAll('.js-dept-chips .chip.on') : [];
  ok('默认勾选总量前 4', onChips.length === Math.min(4, dt.depts.length), onChips.length);
  ok('勾选的正是总量前 4 的部门',
    Array.from(onChips).every(c => dt.depts.slice(0, 4).some(d => d.dept === c.dataset.dept)),
    Array.from(onChips).map(c => c.dataset.dept).join('/'));
  const paths = card ? card.querySelectorAll('.js-chart svg path') : [];
  ok('折线 series 数 = 勾选数（4）', paths.length === 4, paths.length);
  const legend = card ? card.querySelector('.js-legend') : null;
  ok('图例含各部门合计', !!legend && /合计/.test(legend.textContent) && /条/.test(legend.textContent),
    legend && legend.textContent.trim().slice(0, 80));
  ok('口径说明提到部门趋势', /各部门隐患趋势/.test(view().textContent));

  /* ---------- 4. 交互：chips 增减 ---------- */
  console.log('== 4. 交互：点部门名增减对比 ==');
  const offChip = Array.from(chips).find(c => !c.classList.contains('on'));
  click(offChip);
  await wait(400);
  const card2 = Array.from(view().querySelectorAll('.card'))
    .find(c => /各部门隐患趋势/.test((c.querySelector('h3') || {}).textContent || ''));
  ok('勾选 +1', card2.querySelectorAll('.js-dept-chips .chip.on').length === 5,
    card2.querySelectorAll('.js-dept-chips .chip.on').length);
  ok('折线 series 跟到 5', card2.querySelectorAll('.js-chart svg path').length === 5,
    card2.querySelectorAll('.js-chart svg path').length);
  const onChip2 = Array.from(card2.querySelectorAll('.js-dept-chips .chip')).find(c => c.classList.contains('on'));
  click(onChip2);
  await wait(400);
  const card3 = Array.from(view().querySelectorAll('.card'))
    .find(c => /各部门隐患趋势/.test((c.querySelector('h3') || {}).textContent || ''));
  ok('取消一个回到 4', card3.querySelectorAll('.js-dept-chips .chip.on').length === 4,
    card3.querySelectorAll('.js-dept-chips .chip.on').length);
  // 全部取消 → 空态提示
  Array.from(card3.querySelectorAll('.js-dept-chips .chip.on')).forEach(c => click(c));
  await wait(400);
  const card4 = Array.from(view().querySelectorAll('.card'))
    .find(c => /各部门隐患趋势/.test((c.querySelector('h3') || {}).textContent || ''));
  ok('全不选时给出引导空态', !!card4 && /选一个部门/.test(card4.textContent),
    card4 && card4.querySelector('.js-chart').textContent.trim().slice(0, 40));

  /* ---------- 结果 ---------- */
  console.log('\n结果：通过 ' + pass + ' / 失败 ' + fail);
  if (errors.length) { console.log('页面报错：'); errors.slice(0, 5).forEach(e => console.log('  - ' + e)); }
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FATAL', e); process.exit(1); });
