/* 安全员工作台 · 「所有板块操作项统一为下拉」冒烟自检
   用法：node smoke_ops.js [url]
   覆盖：隐患 / 巡检 / 培训 / 通知 / 特种作业人员 / 危险作业票 六个板块
        · 操作列只剩一个「操作 ▾」触发按钮（不再是并排按钮组）
        · 点开下拉后菜单项齐全（推进、通知书、编辑、作废、删除…）
        · 统一性：全部带 js-ops 类 + data-act + data-id，文字统一为「操作」
        · 交互：同时只允许一个菜单；选完即关
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

  const go = async r => { win.location.hash = '#/' + r; await wait(320); };
  const view = () => doc.getElementById('view');
  const click = el => el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  const menu = () => doc.querySelector('.dd-menu');
  const menuTexts = () => Array.from((menu() || { querySelectorAll: () => [] }).querySelectorAll('.dd-item'))
    .map(x => (x.textContent || '').trim());
  const has = re => menuTexts().some(t => re.test(t));

  /* 打开某模块第一行的操作下拉，返回触发按钮 */
  async function openFirstOps(act) {
    const btn = view().querySelector('[data-act="' + act + '"]');
    if (!btn) return null;
    click(btn);
    await wait(240);
    return btn;
  }
  /* 表格实际渲染行数（各页有筛选/排序，不能用 summary 总数当基准） */
  const rowCount = () => view().querySelectorAll('tbody tr').length;
  const everyRowHasOneOps = act =>
    Array.from(view().querySelectorAll('tbody tr'))
      .every(tr => tr.querySelectorAll('[data-act="' + act + '"]').length === 1);

  /* ---------- 1. 隐患 ---------- */
  console.log('== 1. 隐患：操作列收成下拉 ==');
  await go('hazard');
  SD.app.state.filters.hazard.q = '';
  SD.app.state.filters.hazard.status = 'all';
  SD.app.refreshAll();
  await wait(320);
  let hzBtns = Array.from(view().querySelectorAll('[data-act="ops"]'));
  ok('每行只有一个操作按钮', hzBtns.length === rowCount() && rowCount() > 0 && everyRowHasOneOps('ops'),
    hzBtns.length + ' 行/' + rowCount());
  ok('按钮是统一「操作 ▾」', hzBtns.every(b => /操作/.test(b.textContent) && b.classList.contains('js-ops')));
  ok('按钮带 data-id', hzBtns.every(b => !!b.dataset.id));
  ok('已无裸露的编辑/删除按钮', !view().querySelector('[data-act="edit"],[data-act="del"]'));
  await openFirstOps('ops');
  ok('下拉菜单已弹出', !!menu());
  ok('菜单含「编辑」', has(/编辑/), menuTexts().join(' | '));
  ok('菜单含「查看详情」', has(/查看详情/));
  ok('菜单含「整改通知书」', has(/整改通知书/));
  ok('菜单含推进动作（主操作高亮）',
    !!menu() && !!menu().querySelector('.dd-item.primary'), menuTexts().join(' | '));

  /* ---------- 2. 巡检 ---------- */
  console.log('== 2. 巡检：操作列收成下拉 ==');
  await go('inspection');
  let insBtns = Array.from(view().querySelectorAll('[data-act="iops"]'));
  ok('每行只有一个操作按钮', insBtns.length === rowCount() && rowCount() > 0 && everyRowHasOneOps('iops'),
    insBtns.length + ' 行/' + rowCount());
  ok('按钮是统一「操作 ▾」', insBtns.every(b => /操作/.test(b.textContent) && b.classList.contains('js-ops')));
  ok('已无并排按钮组', !view().querySelector('[data-act="done"],[data-act="resch"],[data-act="rec"]'));
  const firstIns = SD.app.state.summary.inspections.find(x => x.id === insBtns[0].dataset.id);
  await openFirstOps('iops');
  ok('菜单含「编辑」', has(/编辑/), menuTexts().join(' | '));
  ok('菜单含「删除」', has(/删除/));
  if (firstIns && (firstIns.status === 'planned' || firstIns.status === 'rescheduled')) {
    ok('待执行行菜单含「标记完成」（主操作）', has(/标记完成/) && !!menu().querySelector('.dd-item.primary'));
    ok('待执行行菜单含「改期」', has(/改期/));
  } else {
    ok('已完成行菜单含「执行记录」', has(/执行记录/), firstIns && firstIns.status);
  }

  /* ---------- 3. 培训 ---------- */
  console.log('== 3. 培训：操作列收成下拉 ==');
  await go('training');
  let trBtns = Array.from(view().querySelectorAll('[data-act="tops"]'));
  ok('每行只有一个操作按钮', trBtns.length === rowCount() && rowCount() > 0 && everyRowHasOneOps('tops'),
    trBtns.length + ' 行/' + rowCount());
  ok('已无裸露的编辑/删除按钮', !view().querySelector('[data-act="tedit"],[data-act="tdel"]'));
  await openFirstOps('tops');
  ok('菜单含「编辑」', has(/编辑/), menuTexts().join(' | '));
  ok('菜单含「删除」（危险项）', has(/删除/) && !!menu().querySelector('.dd-item.danger'));

  /* ---------- 4. 通知公告 ---------- */
  console.log('== 4. 通知公告：条目操作收成下拉 ==');
  await go('notice');
  let ntBtns = Array.from(view().querySelectorAll('[data-act="nops"]'));
  ok('每条只有一个操作按钮', ntBtns.length === SD.app.state.summary.notices.length, ntBtns.length);
  ok('按钮是统一「操作 ▾」', ntBtns.every(b => /操作/.test(b.textContent) && b.classList.contains('js-ops')));
  ok('已无并排的编辑/删除按钮',
    Array.from(view().querySelectorAll('.nops')).every(x => x.querySelectorAll('.btn').length === 1));
  await openFirstOps('nops');
  ok('菜单含「编辑」', has(/编辑/), menuTexts().join(' | '));
  ok('菜单含「删除」', has(/删除/));

  /* ---------- 5. 特种作业人员 ---------- */
  console.log('== 5. 特种作业人员：操作列收成下拉 ==');
  await go('specPersonnel');
  let spBtns = Array.from(view().querySelectorAll('[data-act="sops"]'));
  ok('每行只有一个操作按钮', spBtns.length === rowCount() && rowCount() > 0 && everyRowHasOneOps('sops'),
    spBtns.length + ' 行/' + rowCount());
  ok('已无裸露的编辑/删除按钮', !view().querySelector('[data-act="pedit"],[data-act="pdel"]'));
  await openFirstOps('sops');
  ok('菜单含「编辑」', has(/编辑/), menuTexts().join(' | '));
  ok('菜单含「删除」', has(/删除/));

  /* ---------- 6. 危险作业票 ---------- */
  console.log('== 6. 危险作业票：操作列收成下拉 ==');
  await go('specPermit');
  let wpBtns = Array.from(view().querySelectorAll('[data-act="pops"]'));
  ok('每行只有一个操作按钮', wpBtns.length === rowCount() && rowCount() > 0 && everyRowHasOneOps('pops'),
    wpBtns.length + ' 行/' + rowCount());
  await openFirstOps('pops');
  ok('菜单含「照片（打印 / Word）」', has(/照片/), menuTexts().join(' | '));
  ok('菜单含「编辑」', has(/编辑/));
  ok('菜单含「删除」', has(/删除/));

  /* ---------- 7. 交互一致性 ---------- */
  console.log('== 7. 下拉交互一致性 ==');
  await go('inspection');
  const all = Array.from(view().querySelectorAll('[data-act="iops"]'));
  click(all[0]);
  await wait(220);
  ok('第一个菜单已开', !!menu());
  if (all[1]) {
    click(all[1]);
    await wait(220);
    ok('再点另一行：同时只有一个菜单', doc.querySelectorAll('.dd-menu').length === 1, doc.querySelectorAll('.dd-menu').length);
  }
  const item = menu() && Array.from(menu().querySelectorAll('.dd-item')).find(x => /编辑/.test(x.textContent));
  if (item) {
    click(item);
    await wait(260);
    ok('选中后菜单关闭', !menu());
    const mask = doc.querySelector('.mask');
    ok('选中「编辑」打开编辑弹窗', !!mask && /编辑巡检/.test(mask.textContent || ''), mask ? '' : '无弹窗');
    if (mask && mask.querySelector('.js-cancel')) { click(mask.querySelector('.js-cancel')); await wait(160); }
  }
  ok('无 JS 报错', errors.length === 0, errors.slice(0, 3).join(' | '));

  console.log('\n结果：通过 ' + pass + ' / 失败 ' + fail);
  process.exit(fail ? 1 : 0);
})();
