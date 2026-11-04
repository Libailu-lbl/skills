/* 安全员工作台 · 隐患 / 巡检 / 培训 / 通知「默认当年」冒烟自检（2026-11-04 新增）
   用法：node safety-desk_dev/smoke_yearview.js [url]

   覆盖（四页同一套口径，逐页跑）：
     ① 年份下拉存在、默认 = 当年；默认只列当年的记录
     ② 年份脏值 / 刷新后都回当年（不落本地存储）
     ③ 造一条「上一年」记录 → 当年条数 -1、下拉多出那一年、切过去能看到它
     ④ 切到没有数据的年份 → 专属空态 + 「回到今年」出口，点回今年复原
     ⑤ 巡检特有：在「本周」下改年份自动切到「全部」
     ⑥ 培训特有：四张指标卡的「培训计划」跟所选年份走
     ⑦ 通知特有：副标题显示「YYYY 年 共 N 条 · 全部 M 条」
     ⑧ yearBar 纯函数（yearOf / yearOfRecord / yearsOf）

   ★ 空白版（库里一条数据都没有）会自动跳过与数据相关的 ③④ 段。
*/
const { JSDOM } = require('jsdom');
const URL_ = process.argv[2] || 'http://127.0.0.1:8124/index.html';
const wait = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  OK  ' + name + (extra != null ? ' => ' + extra : '')); }
  else { fail++; console.log('  FAIL ' + name + (extra != null ? ' => ' + extra : '')); }
}
function skip(name, why) { console.log('  -- 跳过 ' + name + '（' + why + '）'); }

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
  const waitSel = async (sel, ms = 5000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (doc.querySelector(sel)) return true;
      await wait(80);
    }
    return false;
  };
  const go = async r => {
    win.location.hash = '#/' + r;
    await wait(500);
    await waitSel('#view .year-fg .js-year-sel');
  };
  const ySel = () => doc.querySelector('#view .year-fg .js-year-sel');
  const yNow = () => doc.querySelector('#view .js-year-now');
  const setYear = async v => {
    const el = ySel();
    if (!el) return false;
    el.value = v;
    el.dispatchEvent(new win.Event('change', { bubbles: true }));
    await wait(500);
    return true;
  };
  const clickChip = async text => {
    const c = Array.from(doc.querySelectorAll('#view .chip')).find(x => x.textContent.trim().indexOf(text) === 0);
    if (c) c.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await wait(400);
    return !!c;
  };
  const store = () => SD.store.data();
  const TODAY_Y = SD.app.state.summary.today.slice(0, 4);

  const yOf = v => { const m = /^(\d{4})/.exec(String(v == null ? '' : v)); return m ? m[1] : ''; };
  const yearOfRec = (r, fields) => {
    for (const k of fields) { const y = yOf(r[k]); if (y) return y; }
    return TODAY_Y;
  };
  const countIn = (coll, fields, y) =>
    (store()[coll] || []).filter(r => yearOfRec(r, fields) === y).length;

  const PAGES = [
    {
      id: 'hazard', fkey: 'hazard', label: '隐患管理', route: 'hazard', coll: 'hazards',
      fields: ['foundDate', 'dueDate'],
      rows: () => doc.querySelectorAll('#view .js-list-box table tbody tr').length,
      emptyTitle: () => ((doc.querySelector('#view .js-list-box .state h4') || {}).textContent || ''),
      emptyAction: () => ((doc.querySelector('#view .js-list-box .state-actions') || {}).textContent || ''),
      inBar: '#view .filters .year-fg',
    },
    {
      id: 'inspection', fkey: 'insp', label: '安全巡检', route: 'inspection', coll: 'inspections',
      fields: ['scheduledDate'],
      before: async () => { await clickChip('全部'); },
      rows: () => doc.querySelectorAll('#view .js-list-box table tbody tr').length,
      emptyTitle: () => ((doc.querySelector('#view .js-list-box .state h4') || {}).textContent || ''),
      emptyAction: () => ((doc.querySelector('#view .js-list-box .state-actions') || {}).textContent || ''),
      inBar: '#view .filters .year-fg',
    },
    {
      id: 'training', fkey: 'training', label: '安全培训', route: 'training', coll: 'trainings',
      fields: ['startDate', 'endDate'],
      rows: () => doc.querySelectorAll('#view .js-tr-body table tbody tr').length,
      emptyTitle: () => ((doc.querySelector('#view .js-tr-body .state h4') || {}).textContent || ''),
      emptyAction: () => ((doc.querySelector('#view .js-tr-body .state-actions') || {}).textContent || ''),
      inBar: '#view .filters .year-fg',
    },
    {
      id: 'notice', fkey: 'notice', label: '通知公告', route: 'notice', coll: 'notices',
      fields: ['publishAt'],
      rows: () => doc.querySelectorAll('#view .notice-list .notice-item').length,
      emptyTitle: () => ((doc.querySelector('#view .js-list .state h4') || {}).textContent || ''),
      emptyAction: () => ((doc.querySelector('#view .js-list .state-actions') || {}).textContent || ''),
      inBar: '#view .card-head .year-fg',
    }
  ];

  const OLD_Y = '2025';
  const EMPTY_Y = '2020';
  const HAS_DATA = (store().hazards || []).length > 0;

  /* ================= ① 默认当年 ================= */
  for (const P of PAGES) {
    console.log('== ' + P.label + '：默认当年 ==');
    await go(P.route);
    if (P.before) await P.before();
    await wait(250);

    ok('年份控件挂在筛选条里（' + P.inBar + '）', !!doc.querySelector(P.inBar));
    ok('年份下拉默认 = 当年（' + TODAY_Y + '）', ySel() && ySel().value === TODAY_Y, ySel() && ySel().value);

    const yCount = countIn(P.coll, P.fields, TODAY_Y);
    ok('默认只列当年记录（' + yCount + ' 条）', P.rows() === yCount, P.rows() + ' 行 / 当年 ' + yCount + ' 条');
    ok('当年时没有「回到今年」按钮', !yNow());
    ok('下拉里至少含当年', Array.from(ySel().options).some(o => o.value === TODAY_Y),
      Array.from(ySel().options).map(o => o.value).join(','));

    const total0 = (store()[P.coll] || []).length;
    ok('初始筛选不改数据（' + total0 + ' 条）', (store()[P.coll] || []).length === total0);

    /* 脏值 → 回当年 */
    SD.app.state.filters[P.fkey].year = 'abcd';
    SD.app.refreshAll();
    await wait(600);
    ok('年份脏值（abcd）回当年', ySel() && ySel().value === TODAY_Y, ySel() && ySel().value);

    /* 模拟刷新（清掉 filters）→ 回当年 */
    await setYear(OLD_Y);            // 若没有该年选项，value 会变成 ''，下一句再兜底
    delete SD.app.state.filters[P.fkey];
    SD.app.refreshAll();
    await wait(600);
    ok('清掉 filters（等价刷新）后回当年', ySel() && ySel().value === TODAY_Y, ySel() && ySel().value);
    /* 刷新后巡检的 range 也回默认「本周」，要再切「全部」才能按年比对 */
    if (P.before) await P.before();
    ok('刷新后行数仍 = 当年条数', P.rows() === yCount, P.rows() + ' / ' + yCount);
  }

  /* ================= ② 造一条上一年记录 ================= */
  console.log('== 造跨年数据 ==');
  if (!HAS_DATA) {
    skip('跨年数据与空年份空态', '本版本库里没有示例数据（空白版）');
  } else {
    const moved = [];
    (function seedOldYear() {
      const d = store();
      [
        { coll: 'hazards', field: 'foundDate' },
        { coll: 'inspections', field: 'scheduledDate' },
        { coll: 'trainings', field: 'startDate' },
        { coll: 'notices', field: 'publishAt' }
      ].forEach(function (it) {
        const list = d[it.coll] || [];
        const victim = list.filter(r => yearOfRec(r, [it.field]) === TODAY_Y)[0];
        if (!victim) return;
        victim[it.field] = OLD_Y + '-06-15';
        moved.push(it.coll);
      });
      SD.store.setData(d);
    })();
    ok('四类数据各挪了一条到 ' + OLD_Y, moved.length === 4, moved.join('|'));

    await SD.app.reload();
    await wait(800);

    for (const P of PAGES) {
      console.log('-- ' + P.label + '：切到 ' + OLD_Y + ' --');
      delete SD.app.state.filters[P.fkey];
      await go(P.route);
      if (P.before) await P.before();
      await wait(250);

      const yCount = countIn(P.coll, P.fields, TODAY_Y);
      ok('默认仍是当年，条数减 1（' + yCount + '）', ySel().value === TODAY_Y && P.rows() === yCount,
        ySel().value + ' / ' + P.rows() + ' 行 / 当年 ' + yCount);
      ok('下拉里出现了 ' + OLD_Y + ' 年', Array.from(ySel().options).some(o => o.value === OLD_Y),
        Array.from(ySel().options).map(o => o.value).join(','));

      await setYear(OLD_Y);
      const oldCount = countIn(P.coll, P.fields, OLD_Y);
      ok('切到 ' + OLD_Y + ' 年能看到那条（' + oldCount + ' 条）', oldCount >= 1 && P.rows() === oldCount,
        P.rows() + ' 行 / ' + oldCount + ' 条');
      ok('非当年时「回到今年」按钮出现', !!yNow());

      const b = yNow();
      if (b) b.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      await wait(500);
      ok('点「回到今年」回当年', ySel().value === TODAY_Y, ySel().value);
    }

    /* ================= ③ 空年份空态（直接置成没数据的年份，等价于那年的记录被删光） ================= */
    for (const P of PAGES) {
      console.log('-- ' + P.label + '：' + EMPTY_Y + ' 年空态 --');
      const f = SD.app.state.filters[P.fkey];
      f.year = EMPTY_Y;
      if (P.id === 'inspection') f.range = 'all';   // 「本周」不套年份，先切全部
      await go(P.route);
      await wait(400);

      ok('下拉显示 ' + EMPTY_Y + ' 年', ySel() && ySel().value === EMPTY_Y, ySel() && ySel().value);
      ok(EMPTY_Y + ' 年列表为空', P.rows() === 0, P.rows());
      ok('空态文案点名年份', P.emptyTitle().indexOf(EMPTY_Y + ' 年还没有') === 0, P.emptyTitle());
      ok('空态给「回到今年」出口', /回到今年/.test(P.emptyAction()), P.emptyAction());
      ok('「回到今年」按钮出现在年份控件里', !!yNow());

      const b = yNow();
      if (b) b.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      await wait(600);
      ok('空态点回今年 → 年份复原', ySel().value === TODAY_Y, ySel().value);
      ok('复原后行数对', P.rows() === countIn(P.coll, P.fields, TODAY_Y), P.rows() + ' / ' + countIn(P.coll, P.fields, TODAY_Y));
    }
  }

  /* ================= ④ 巡检：本周下改年份自动切「全部」 ================= */
  console.log('== 巡检：本周 → 改年份自动切全部 ==');
  delete SD.app.state.filters.insp;
  await go('inspection');
  await clickChip('本周');
  await wait(300);
  const onBefore = Array.from(doc.querySelectorAll('#view .chip'))
    .filter(c => c.className.indexOf('on') >= 0).map(c => c.textContent.trim());
  ok('先停在「本周」', onBefore.length === 1 && onBefore[0] === '本周', onBefore.join(','));
  /* 选一个下拉里真实存在的非当年（有数据时才有；空白版跳过） */
  const otherY = Array.from(ySel().options).map(o => o.value).filter(v => v !== TODAY_Y)[0];
  if (otherY) {
    await setYear(otherY);
    const onAfter = Array.from(doc.querySelectorAll('#view .chip'))
      .filter(c => c.className.indexOf('on') >= 0).map(c => c.textContent.trim());
    ok('改年份后 chip 自动切到「全部」', onAfter.indexOf('全部') >= 0, onAfter.join(','));
    ok('切完年份 = ' + otherY, ySel().value === otherY, ySel().value);
    await setYear(TODAY_Y);
  } else {
    skip('改年份自动切「全部」', '下拉里没有其它年份（库里只有当年）');
  }

  /* ================= ⑤ 培训：指标卡跟年份走 ================= */
  console.log('== 培训：指标卡随年份 ==');
  delete SD.app.state.filters.training;
  await go('training');
  const planCard = () => {
    const el = Array.from(doc.querySelectorAll('#view .stat')).filter(x =>
      ((x.querySelector('.stat-label') || {}).textContent || '') === '培训计划')[0];
    return el ? parseInt(((el.querySelector('.stat-value') || {}).textContent || '0').replace(/[^\d]/g, ''), 10) || 0 : -1;
  };
  const ty = countIn('trainings', PAGES[2].fields, TODAY_Y);
  ok('当年「培训计划」卡 = 当年条数（' + ty + '）', planCard() === ty, planCard() + ' / ' + ty);
  const tyOther = Array.from(ySel().options).map(o => o.value).filter(v => v !== TODAY_Y)[0];
  if (tyOther) {
    await setYear(tyOther);
    const want = countIn('trainings', PAGES[2].fields, tyOther);
    ok('切到 ' + tyOther + ' 年后卡片同步（' + want + '）', planCard() === want, planCard() + ' / ' + want);
    await setYear(TODAY_Y);
  } else {
    skip('卡片随年份变', '下拉里没有其它年份');
  }

  /* ================= ⑥ 通知：副标题计数 ================= */
  console.log('== 通知：副标题计数 ==');
  delete SD.app.state.filters.notice;
  await go('notice');
  const nSub = () => ((doc.querySelector('#view .js-nt-sub') || {}).textContent || '');
  const ny = countIn('notices', ['publishAt'], TODAY_Y);
  ok('副标题写明年份与条数（' + ny + '）', nSub().indexOf(TODAY_Y + ' 年 共 ' + ny + ' 条') >= 0, nSub());

  /* ================= ⑦ 组件纯函数 ================= */
  console.log('== yearBar 纯函数 ==');
  const YB = SD.comp.yearBar;
  ok("yearOf('2026-11-04') = 2026", YB.yearOf('2026-11-04') === '2026', YB.yearOf('2026-11-04'));
  ok("yearOf('2025') = 2025", YB.yearOf('2025') === '2025');
  ok('yearOf 空值 = 空串', YB.yearOf('') === '' && YB.yearOf(null) === '');
  ok('yearOf 非法年 = 空串', YB.yearOf('1066-01-01') === '' && YB.yearOf('abcd') === '');
  ok('yearOfRecord 按字段顺序回退',
    YB.yearOfRecord({ foundDate: '', dueDate: '2024-03-01' }, ['foundDate', 'dueDate'], '2026') === '2024');
  ok('yearOfRecord 全空回落 fallback', YB.yearOfRecord({}, ['foundDate'], '2026') === '2026');
  ok('yearsOf 倒序且含当年',
    JSON.stringify(YB.yearsOf([{ d: '2024-01-01' }, { d: '2025-02-02' }], ['d'], '2026')) === '["2026","2025","2024"]',
    JSON.stringify(YB.yearsOf([{ d: '2024-01-01' }, { d: '2025-02-02' }], ['d'], '2026')));

  console.log('== 运行期无 JS 错误 ==');
  ok('没有未捕获错误', errors.length === 0, errors.join(' | '));

  console.log('\n结果：通过 ' + pass + ' / 失败 ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FATAL', e && e.stack || e); process.exit(1); });
