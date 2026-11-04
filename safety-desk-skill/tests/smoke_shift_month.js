/* 安全员工作台 · 交接班记录「按月查看」冒烟自检（2026-11-04 新增）
   用法：node safety-desk_dev/smoke_shift_month.js [url]

   覆盖：
     ① 默认当月：初次进入 / 刷新后都只列当月，月份选择器值 = 当月
     ② 切换：‹ 上一月 / › 下一月 / 直接选月 / 回到本月
     ③ 按所选月份筛选（行数 = 该月条数，副标题计数跟着走）
     ④ 有记录但该月为空 → 专属空态 + 「回到本月」出口
     ⑤ 切月只是视图过滤：不改数据、不动顶部日期 / 班次编辑区
     ⑥ 从其它月份「打开」记录：表单日期跟着走、月份不变
     ⑦ 打印 / 导出仍按当前编辑的那一天，不受浏览月份影响
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
  if (!SD || !SD.app) { console.log('FATAL: SD 未初始化'); process.exit(1); }
  SD.auth.set('safety_officer');
  if (SD.app.refreshAll) SD.app.refreshAll();
  await wait(300);

  const doc = win.document;
  const go = async r => { win.location.hash = '#/' + r; await wait(400); };
  /** 等视图重绘出月份控件（reload 是异步取数，固定 wait 不稳定） */
  const waitView = async (ms = 4000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (doc.querySelector('#view .sl-monthbar .js-m-input')) return true;
      await wait(80);
    }
    return false;
  };

  const monthEl = () => doc.querySelector('#view .sl-monthbar .js-m-input');
  const dateEl = () => doc.querySelector('#view input[type="date"]');
  const shiftEl = () => doc.querySelector('#view select');
  const rows = () => doc.querySelectorAll('#view .sl-history table tbody tr').length;
  const subText = () => ((doc.querySelector('#view .sl-history .card-head .sub') || {}).textContent || '');
  const emptyTitle = () => ((doc.querySelector('#view .sl-history .state h4') || {}).textContent || '');
  const emptyDesc = () => ((doc.querySelector('#view .sl-history .state p') || {}).textContent || '');
  const emptyAction = () => ((doc.querySelector('#view .sl-history .state-actions') || {}).textContent || '');
  const hasNow = () => !!doc.querySelector('#view .sl-monthbar .js-m-now');

  const monthOf = s => { const m = String(s == null ? '' : s).slice(0, 7); return /^\d{4}-\d{2}$/.test(m) ? m : ''; };
  const fmt = m => m.slice(0, 4) + '年' + Number(m.slice(5, 7)) + '月';
  const shiftM = (m, d) => {
    let y = Number(m.slice(0, 4)), mo = Number(m.slice(5, 7)) + d;
    y += Math.floor((mo - 1) / 12);
    mo = ((mo - 1) % 12 + 12) % 12 + 1;
    return y + '-' + (mo < 10 ? '0' : '') + mo;
  };
  const click = el => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  const setMonth = async v => {
    const el = monthEl();
    el.value = v;
    el.dispatchEvent(new win.Event('change', { bubbles: true }));
    await wait(400);
  };
  const storeLogs = () => SD.store.data().shiftLogs || [];
  const countIn = m => storeLogs().filter(r => (monthOf(r.date) || '') === m).length;

  const TODAY = SD.app.state.summary.today;
  const CUR = monthOf(TODAY);
  const PREV = shiftM(CUR, -1);
  const OLD = '2020-01';

  /* ================= 1. 默认当月 ================= */
  console.log('== 1. 初次进入：默认当月 ==');
  await go('shiftLog');
  ok('进入后画出了月份控件', !!monthEl());
  ok('月份选择器默认 = 当月（' + CUR + '）', monthEl() && monthEl().value === CUR, monthEl() && monthEl().value);
  ok('默认只列当月记录（' + countIn(CUR) + ' 条）', rows() === countIn(CUR), rows() + ' 行');
  ok('副标题写明月份与条数', subText().indexOf(fmt(CUR) + ' 共 ' + countIn(CUR) + ' 条') >= 0, subText());
  ok('当月时不显示「回到本月」', !hasNow());

  /* ================= 2. 造跨月数据后仍默认当月 ================= */
  console.log('== 2. 造跨月记录 ==');
  const mk = (date, shift, ev) => SD.api.createShiftLog({
    date, shift, inspector: '测试员',
    checks: (() => { const c = new Array(19).fill(''); c[0] = 'ok'; return c; })(),
    events: [ev], updatedAt: date + ' 09:00'
  });
  await mk(PREV + '-15', 'day', '上月记录（自检）');
  await mk(OLD + '-15', 'night', '2020 年记录（自检）');
  await SD.app.reload();
  await waitView();
  ok('新增后仍停在当月', monthEl() && monthEl().value === CUR, monthEl() && monthEl().value);
  ok('当月行数 = 当月条数', rows() === countIn(CUR), rows() + ' / ' + countIn(CUR));
  ok('副标题带「全部 N 条」（因为跨月有记录）',
    subText().indexOf('全部 ' + storeLogs().length + ' 条') >= 0, subText());

  /* ================= 3. 上一月 / 下一月 ================= */
  console.log('== 3. ‹ › 切换 ==');
  await click(doc.querySelector('#view .sl-m-prev') || doc.querySelector('#view .js-m-prev'));
  await wait(400);
  ok('‹ 上一月 → ' + PREV, monthEl().value === PREV, monthEl().value);
  ok('上一月只列该月记录（' + countIn(PREV) + ' 条）', rows() === countIn(PREV), rows() + ' 行');
  ok('非当月时出现「回到本月」', hasNow());
  ok('上一月能看到刚造的那条', Array.from(doc.querySelectorAll('#view .sl-history table tbody tr'))
    .some(tr => tr.textContent.indexOf(PREV + '-15') >= 0));

  await click(doc.querySelector('#view .js-m-next'));
  await wait(400);
  ok('› 下一月 → 回到当月', monthEl().value === CUR, monthEl().value);
  ok('当月行数仍对', rows() === countIn(CUR), rows() + ' / ' + countIn(CUR));

  /* ================= 4. 直接选月 + 空月空态 ================= */
  console.log('== 4. 直接选月 / 空月 ==');
  await setMonth(OLD);
  ok('直接选月 → ' + OLD, monthEl().value === OLD, monthEl().value);
  ok('2020-01 只列该月记录（' + countIn(OLD) + ' 条）', rows() === countIn(OLD), rows() + ' 行');

  await setMonth('2019-03');
  ok('无记录月份：行数为 0', rows() === 0, rows());
  ok('空月给专属空态「2019年3月还没有交接班记录」',
    emptyTitle() === '2019年3月还没有交接班记录', emptyTitle());
  ok('空态文案提示可用月份选择器', /月份选择器/.test(emptyDesc()), emptyDesc());
  ok('空态给「回到本月」出口', /回到本月/.test(emptyAction()), emptyAction());

  const act = doc.querySelector('#view .sl-history .state-actions .btn');
  await click(act);
  await wait(400);
  ok('点空态「回到本月」→ 回当月', monthEl().value === CUR, monthEl().value);
  ok('回到当月的行数对', rows() === countIn(CUR), rows() + ' / ' + countIn(CUR));

  /* ================= 5. 切月不改数据 / 不动表单 ================= */
  console.log('== 5. 切月只是视图过滤 ==');
  const total0 = storeLogs().length;
  const d0 = dateEl().value, s0 = shiftEl().value;
  await setMonth(PREV);
  await setMonth(OLD);
  await setMonth(CUR);
  ok('来回切月不改数据条数（' + total0 + '）', storeLogs().length === total0, storeLogs().length);
  ok('来回切月不动顶部日期', dateEl().value === d0, dateEl().value);
  ok('来回切月不动班次', shiftEl().value === s0, shiftEl().value);

  /* ================= 6. 从其它月份「打开」 ================= */
  console.log('== 6. 打开其它月份的记录 ==');
  await setMonth(PREV);
  const openBtn = Array.from(doc.querySelectorAll('#view .sl-history table tbody tr'))
    .filter(tr => tr.textContent.indexOf(PREV + '-15') >= 0)
    .map(tr => tr.querySelector('[data-act="slopen"]'))[0];
  ok('上一月列表里有「打开」按钮', !!openBtn);
  await click(openBtn);
  await wait(500);
  ok('打开后表单日期 = 该记录日期', dateEl().value === PREV + '-15', dateEl().value);
  ok('打开后月份仍是 ' + PREV + '（不跳走）', monthEl().value === PREV, monthEl().value);
  ok('打开后状态行显示该日已有记录',
    /已有记录/.test(((doc.querySelector('#view .sl-statusline') || {}).textContent || '')),
    ((doc.querySelector('#view .sl-statusline') || {}).textContent || ''));

  /* ================= 7. 打印 / 导出不受浏览月份影响 ================= */
  console.log('== 7. 导出仍按当前编辑日期 ==');
  let dlName = '', cap = null;
  SD.comp.xlsxWriter.download = (blob, name) => { dlName = name; cap = blob; };
  const xlsBtn = Array.from(doc.querySelectorAll('#view button')).filter(b => /导出 Excel/.test(b.textContent))[0];
  ok('导出按钮在', !!xlsBtn);
  await click(xlsBtn);
  await wait(400);
  ok('导出文件名用表单日期（' + PREV + '-15）而不是当月',
    dlName.indexOf(PREV + '-15') >= 0 && /白夜班\.xlsx$/.test(dlName), dlName);
  ok('导出件是双 sheet 工作簿（白班 + 夜班）', !!cap && cap.size > 2000, cap && cap.size);

  /* ================= 8. 模拟刷新：回到当月 ================= */
  console.log('== 8. 刷新后默认当月 ==');
  await setMonth(OLD);
  ok('刷新前停在 ' + OLD, monthEl().value === OLD, monthEl().value);
  /* 页面刷新会丢掉内存里的 filters → 这里手动清掉，等价于重新加载 */
  delete SD.app.state.filters.shift;
  SD.app.refreshAll();
  await wait(500);
  ok('刷新后月份回到当月（' + CUR + '）', monthEl() && monthEl().value === CUR, monthEl() && monthEl().value);
  ok('刷新后行数 = 当月条数', rows() === countIn(CUR), rows() + ' / ' + countIn(CUR));

  /* 脏值也要回当月 */
  SD.app.state.filters.shift.month = '2019-13';
  SD.app.refreshAll();
  await wait(500);
  ok('月份脏值（2019-13）也回当月', monthEl().value === CUR, monthEl().value);

  /* ================= 9. 保存跨月记录：列表自动切到该月 ================= */
  console.log('== 9. 保存跨月记录 ==');
  await setMonth(CUR);
  const dEl = dateEl();
  dEl.value = '2019-03-08';
  dEl.dispatchEvent(new win.Event('change', { bubbles: true }));
  await wait(450);
  ok('改日期不动月份（月份只筛列表）', monthEl().value === CUR, monthEl().value);

  const saveBtn = Array.from(doc.querySelectorAll('#view button'))
    .filter(b => /保存记录|保存修改/.test(b.textContent))[0];
  ok('保存按钮在', !!saveBtn);
  await click(saveBtn);
  /* reload 是异步取数：轮询等「月份切到 2019-03 且列表出现这一条」 */
  const t0 = Date.now();
  while (Date.now() - t0 < 8000) {
    if (monthEl() && monthEl().value === '2019-03' && rows() === 1) break;
    await wait(120);
  }
  ok('保存跨月记录后，列表自动切到该记录所在月', monthEl() && monthEl().value === '2019-03',
    monthEl() && monthEl().value);
  ok('切过去就能看到刚保存的那一条', rows() === 1, rows() + ' 行');
  ok('该条日期落在 2019-03', Array.from(doc.querySelectorAll('#view .sl-history table tbody tr'))
    .every(tr => tr.textContent.indexOf('2019-03-08') >= 0));

  /* ================= 10. 无错误 ================= */
  console.log('== 10. 运行期无 JS 错误 ==');
  ok('没有未捕获错误', errors.length === 0, errors.join(' | '));

  console.log('\n结果：通过 ' + pass + ' / 失败 ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FATAL', e && e.stack || e); process.exit(1); });
