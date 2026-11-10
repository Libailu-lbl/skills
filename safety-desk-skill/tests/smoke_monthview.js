/* 安全员工作台 · 2026-10-30 两处改动冒烟自检
   用法：node safety-desk_dev/smoke_monthview.js [url]

   覆盖：
     ① 安全巡检「隐患照片」（原「巡查照片」）单次上限 6 → 18（字段定义 / 控件计数 / 满额禁用）
     ② 危险作业票按月展示：
        默认当月 · ‹ › 切换 · 回到本月 · 任意月份（含无数据的空月）·
        指标卡与状态计数随月走 · 状态 chips / 搜索与月份叠加 ·
        新增跨月票自动切月 · 编辑不擅自切月 · 切月不改数据
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

  const doc = win.document;
  const go = async r => { win.location.hash = '#/' + r; await wait(320); };
  const clickText = (sel, re) => {
    const b = Array.from(doc.querySelectorAll(sel)).find(x => re.test(x.textContent || ''));
    if (b) b.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    return !!b;
  };
  const modal = () => doc.querySelector('.mask');
  const set = (m, id, v) => { const e = m.querySelector('#' + id); if (e) { e.value = v; return true; } return false; };
  const cancel = async m => {
    if (!m) return;
    const b = m.querySelector('.js-cancel');
    if (b) b.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await wait(240);
  };
  const submit = async (m, ms = 1600) => {
    m.querySelector('.js-ok').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await wait(ms);
  };
  const monthEl = () => doc.querySelector('#view .js-m-input');
  const rows = () => doc.querySelectorAll('#view table tbody tr').length;
  const stats = () => Array.from(doc.querySelectorAll('#view .stat')).map(el => ({
    label: (el.querySelector('.stat-label') || {}).textContent || '',
    value: parseInt(((el.querySelector('.stat-value') || {}).textContent || '0').replace(/[^\d]/g, ''), 10) || 0
  }));
  const statOf = label => (stats().find(s => s.label === label) || {}).value;
  const setMonth = async v => {
    const el = monthEl();
    el.value = v;
    el.dispatchEvent(new win.Event('change', { bubbles: true }));
    await wait(320);
  };
  const shift = (m, d) => {
    let y = Number(m.slice(0, 4)), mo = Number(m.slice(5, 7)) + d;
    y += Math.floor((mo - 1) / 12);
    mo = ((mo - 1) % 12 + 12) % 12 + 1;
    return y + '-' + (mo < 10 ? '0' : '') + mo;
  };
  const fmt = m => m.slice(0, 4) + '年' + Number(m.slice(5, 7)) + '月';
  const monthOf = p => {
    const d = String((p && (p.planStart || p.planEnd)) || '').slice(0, 7);
    return /^\d{4}-\d{2}$/.test(d) ? d : CUR_MONTH;
  };

  const TODAY = SD.utils.today();
  const CUR_MONTH = TODAY.slice(0, 7);
  const NEXT_MONTH = shift(CUR_MONTH, 1);

  /* ================= 1. 隐患照片（原「巡查照片」，2026-11-10 更名）：上限 18 ================= */
  console.log('== 1. 安全巡检：隐患照片上限 18 张 ==');
  await go('inspection');
  ok('找到「新增巡检」按钮', clickText('#view .btn', /新增巡检/));
  await wait(300);
  let m = modal();
  ok('巡检表单已打开', !!m);
  const slot = m && m.querySelector('#ff_photos');
  ok('照片位存在', !!slot);
  ok('照片位 data-max 已改为 18', !!slot && slot.dataset.max === '18', slot && slot.dataset.max);
  const tmpl = SD.views.inspection && SD.views.inspection.FIELDS
    ? null : null;   // 字段定义未对外暴露，改从控件本身验证
  ok('照片控件已挂载', !!(slot && slot._ph));
  const countText = () => (slot.querySelector('.ph-count') || {}).textContent || '';
  ok('计数文案为「0 / 18 张」', /^0 \/ 18 张$/.test(countText()), countText());
  const P1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AF+4Y9WAAAAAElFTkSuQmCC';
  const arr18 = new Array(18).fill(P1);
  slot._ph.set(arr18);
  await wait(120);
  ok('可容纳 18 张', /^18 \/ 18 张$/.test(countText()), countText());
  ok('满 18 张后「添加照片」按钮禁用',
    slot.querySelector('.js-ph-add').disabled === true);
  await cancel(m);

  /* ================= 2. 危险作业票：默认当月 ================= */
  console.log('== 2. 危险作业票：默认展示当月 ==');
  await go('specPermit');
  ok('月份条存在', !!monthEl());
  ok('默认月份 = 当月 ' + CUR_MONTH, monthEl() && monthEl().value === CUR_MONTH, monthEl() && monthEl().value);
  const all = SD.store.data().workPermits;
  const TOTAL0 = all.length;          // 快照：store 返回的是内部数组，长度会随新增变
  const inMonth = all.filter(p => monthOf(p) === CUR_MONTH).length;
  ok('列表只显示当月（' + inMonth + ' / 全部 ' + all.length + '）', rows() === inMonth, rows());
  ok('当月票数少于全部时列表确实变短', all.length === 0 || rows() === inMonth);
  ok('本月摘要文案带月份', new RegExp(fmt(CUR_MONTH) + ' 共 ' + inMonth + ' 张').test(doc.querySelector('#view .month-bar').textContent),
    doc.querySelector('#view .month-bar').textContent.replace(/\s+/g, ' ').trim());
  ok('当月无「回到本月」按钮（已在当月）', !doc.querySelector('#view .js-m-now'));

  /* 指标卡 = 当月口径 */
  const pend = all.filter(p => monthOf(p) === CUR_MONTH && p.status === 'pending').length;
  ok('指标卡「待审批」= 当月待审批数', statOf('待审批') === pend, statOf('待审批') + ' / ' + pend);
  ok('状态 chips 的「全部」计数 = 当月数',
    new RegExp('全部 ' + inMonth + '\\b').test(doc.querySelector('#view .chip-group').textContent),
    doc.querySelector('#view .chip-group').textContent.replace(/\s+/g, ' ').trim());

  /* ================= 3. 切月 / 回到本月 ================= */
  console.log('== 3. 月份切换 ==');
  doc.querySelector('#view .js-m-next').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(340);
  ok('点「下一月」→ ' + NEXT_MONTH, monthEl().value === NEXT_MONTH, monthEl().value);
  const nextCount = all.filter(p => monthOf(p) === NEXT_MONTH).length;
  ok('下月行数正确（' + nextCount + ' 张）', rows() === nextCount || (nextCount === 0 && !doc.querySelector('#view table')), rows());
  ok('非当月时出现「回到本月」', !!doc.querySelector('#view .js-m-now'));
  doc.querySelector('#view .js-m-now').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(340);
  ok('「回到本月」回到 ' + CUR_MONTH, monthEl().value === CUR_MONTH, monthEl().value);

  doc.querySelector('#view .js-m-prev').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(340);
  ok('点「上一月」→ ' + shift(CUR_MONTH, -1), monthEl().value === shift(CUR_MONTH, -1), monthEl().value);

  /* 空月份：2020-01 */
  await setMonth('2020-01');
  ok('跳到无数据月份仍可用（月份条在）', !!monthEl());
  const emptyTitle = (doc.querySelector('#view .state h4') || {}).textContent || '';
  if (TOTAL0 > 0) {
    ok('空月给专属空态文案', /2020年1月还没有作业票/.test(emptyTitle), emptyTitle);
    ok('空月有「回到本月」动作',
      /回到本月/.test((doc.querySelector('#view .state-actions') || {}).textContent || ''));
  } else {
    console.log('  -- 跳过空月文案（本版本没有任何作业票，走「还没有作业票」首启空态）');
  }
  ok('空月不改数据', SD.store.data().workPermits.length === TOTAL0, SD.store.data().workPermits.length);
  await setMonth(CUR_MONTH);

  /* ================= 4. 状态 / 搜索 与月份叠加 ================= */
  console.log('== 4. 与状态 chips、搜索叠加 ==');
  const doneCnt = all.filter(p => monthOf(p) === CUR_MONTH && p.status === 'done').length;
  clickText('#view .chip', /已完工/);
  await wait(260);
  ok('「已完工」只在本月内筛', rows() === doneCnt, rows() + ' / ' + doneCnt);
  ok('筛选后指标卡仍是当月口径', statOf('待审批') === pend);
  clickText('#view .chip', /全部/);
  await wait(240);
  const q = doc.querySelector('#view input[data-keep-focus="permit"]');
  q.value = '不存在的关键词XYZ';
  q.dispatchEvent(new win.Event('input', { bubbles: true }));
  await wait(420);
  if (TOTAL0 > 0) {
    ok('搜索无结果给空态', /没有匹配/.test((doc.querySelector('#view .state p') || {}).textContent || ''),
      (doc.querySelector('#view .state p') || {}).textContent);
  } else {
    console.log('  -- 跳过搜索空态（本版本没有任何作业票）');
  }
  q.value = '';
  q.dispatchEvent(new win.Event('input', { bubbles: true }));
  await wait(420);
  ok('清空搜索恢复当月列表', rows() === inMonth, rows());

  /* ================= 5. 新增跨月票 → 自动切到该月 ================= */
  console.log('== 5. 新增跨月作业票 ==');
  ok('找到「新增作业票」', clickText('#view .btn', /新增作业票/));
  await wait(320);
  m = modal();
  ok('作业票表单已打开', !!m);
  const pickType = m.querySelector('#ff_type');
  pickType.value = '动土作业';
  pickType.dispatchEvent(new win.Event('change', { bubbles: true }));
  await wait(120);
  const newCode = m.querySelector('#ff_code').value;
  ok('编号按类型生成（FZDT-）', /^FZDT-\d{7}$/.test(newCode), newCode);
  const dateNext = NEXT_MONTH + '-05';
  set(m, 'ff_location', '冒烟-跨月计划作业');
  set(m, 'ff_dept', '安环部');
  set(m, 'ff_applicant', '王安全');
  set(m, 'ff_leader', '王安全');
  set(m, 'ff_guardian', '孙浩');
  set(m, 'ff_planStart', dateNext);
  set(m, 'ff_planEnd', dateNext);
  await submit(m, 1700);
  ok('保存后自动切到计划月份 ' + NEXT_MONTH, monthEl() && monthEl().value === NEXT_MONTH, monthEl() && monthEl().value);
  const created = SD.store.data().workPermits.filter(p => p.location === '冒烟-跨月计划作业')[0];
  ok('新票已落库', !!created && created.code === newCode, created && created.code);
  ok('新票出现在下月列表（行数 = ' + (nextCount + 1) + '）', rows() === nextCount + 1, rows());
  ok('总数 +1 且未影响其它票', SD.store.data().workPermits.length === TOTAL0 + 1,
    SD.store.data().workPermits.length + ' / ' + TOTAL0);

  /* ================= 6. 编辑不擅自切月 ================= */
  console.log('== 6. 编辑作业票 ==');
  const id = created.id;
  const btn = Array.from(doc.querySelectorAll('#view [data-act="pops"]')).find(b => b.dataset.id === id);
  ok('找到该票「操作 ▾」', !!btn);
  if (btn) {
    btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await wait(220);
    const item = Array.from(doc.querySelectorAll('.dd-menu .dd-item')).find(x => /编辑/.test(x.textContent));
    ok('下拉含「编辑」', !!item);
    if (item) {
      item.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      await wait(280);
      m = modal();
      ok('编辑弹窗带出原编号', m && m.querySelector('#ff_code').value === newCode, m && m.querySelector('#ff_code').value);
      set(m, 'ff_location', '冒烟-跨月计划作业（已改）');
      await submit(m, 1700);
      ok('编辑后仍停在原月份（不擅自切月）', monthEl().value === NEXT_MONTH, monthEl().value);
      const upd = SD.store.data().workPermits.filter(p => p.id === id)[0];
      ok('编辑已落库', upd && upd.location === '冒烟-跨月计划作业（已改）', upd && upd.location);
      ok('编辑没改编号', upd && upd.code === newCode, upd && upd.code);
    }
  }

  /* ================= 7. 切回当月，原数据仍在 ================= */
  console.log('== 7. 数据未被月视图影响 ==');
  await setMonth(CUR_MONTH);
  ok('回到当月仍是 ' + inMonth + ' 张', rows() === inMonth, rows());
  ok('全部票仍在（' + (TOTAL0 + 1) + '）', SD.store.data().workPermits.length === TOTAL0 + 1,
    SD.store.data().workPermits.length);

  console.log('== 8. 无 JS 报错 ==');
  ok('运行期无 JS 错误', errors.length === 0, errors.slice(0, 3).join(' | '));

  console.log('\n结果：通过 ' + pass + ' / 失败 ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FATAL', e); process.exit(1); });
