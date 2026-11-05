/* 安全员工作台 · 导航下拉 + 常用功能按频率排序 冒烟自检（2026-11-05 新增）
   用法：node safety-desk_dev/smoke_nav.js [url]

   覆盖：
     ① 结构：特种作业 / 报表 / 更多三处都是下拉，都带箭头与 aria-expanded；
        「报表」与「更多」并列同级、排在「更多」之前（2026-11-05 从「更多」里提出）
     ② 初始状态：只有「报表」默认展开（其它两个按当前页决定）
     ③ 点击展开 / 收起，父项自己有页面时顺带进入
     ④ 互斥：同一时间只有一个并列下拉展开；父子层级可同时展开
     ⑤ 悬停不触发任何开合（2026-11-05 取消悬停展开），只有点击才展开/收起
     ⑥ 换页自动展开所属分支，父项高亮 in-tree、子项 active
     ⑦ 同页重绘保留手动开合；换页回到默认
     ⑧ Esc 收起全部
     ⑨ 常用功能：默认顺序 → 按使用次数重排 → 次数写进本机 → 同页刷新不重复计 → reset 复原
*/
const { JSDOM } = require('jsdom');
const URL_ = process.argv[2] || 'http://127.0.0.1:8127/index.html';
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

  /* 每次运行从干净的使用记录开始，避免上次跑剩的次数影响排序断言 */
  try { win.localStorage.removeItem('sd_usage_v1'); } catch (e) {}
  SD.usage.reset();

  SD.auth.set('safety_officer');
  if (win.location.hash !== '#/overview') win.location.hash = '#/overview';
  SD.app.refreshAll();
  await wait(600);

  const doc = win.document;
  const wrapOf = k => doc.querySelector('.nav-drop[data-drop="' + k + '"]');
  const headOf = k => { const w = wrapOf(k); return w ? w.firstElementChild : null; };
  const isOpen = k => !!wrapOf(k) && wrapOf(k).dataset.open === '1';
  const chevOpen = k => { const h = headOf(k); const c = h && h.querySelector('.chev'); return !!(c && c.classList.contains('open')); };
  const aria = k => headOf(k) && headOf(k).getAttribute('aria-expanded');
  const inTree = k => { const h = headOf(k); return !!(h && h.classList.contains('in-tree')); };
  const activeSub = () => {
    const el = doc.querySelector('.nav-drop .nav-item.active');
    return el ? el.dataset.route : '';
  };
  const quicks = () => Array.from(doc.querySelectorAll('.js-sidebar-quick .quick')).map(b => b.textContent.trim());
  const click = async el => { el.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); await wait(650); };
  const hover = async (k, type) => {
    wrapOf(k).dispatchEvent(new win.MouseEvent(type, { bubbles: false }));
    await wait(type === 'mouseleave' ? 420 : 200);
  };
  const goHash = async h => { win.location.hash = h; await wait(700); };

  /* ================= 1. 结构 ================= */
  console.log('== 1. 三处都是下拉 ==');
  ok('导航里有三个下拉：special / more / reports',
    !!wrapOf('special') && !!wrapOf('more') && !!wrapOf('reports'),
    Array.from(doc.querySelectorAll('.nav-drop')).map(d => d.dataset.drop).join(','));
  ['special', 'more', 'reports'].forEach(function (k) {
    const h = headOf(k);
    ok('「' + k + '」是下拉头（has-children + 箭头）',
      !!h && h.classList.contains('has-children') && !!h.querySelector('.chev'));
    ok('「' + k + '」带 aria-expanded 与 aria-controls',
      !!aria(k) && !!h.getAttribute('aria-controls') && !!doc.getElementById(h.getAttribute('aria-controls')));
  });
  const tops = Array.from(doc.querySelectorAll('#navSecondary > .nav-drop')).map(d => d.dataset.drop);
  ok('二级区是两个并列下拉：报表在前、更多在后',
    tops.join(',') === 'reports,more', tops.join(','));
  ok('两者层级一致（同一容器、同一套 class）',
    Array.from(doc.querySelectorAll('#navSecondary > .nav-drop > .nav-item'))
      .every(h => h.classList.contains('nav-item') && h.classList.contains('has-children')),
    Array.from(doc.querySelectorAll('#navSecondary > .nav-drop > .nav-item')).map(h => h.className).join(' || '));
  ok('「报表」已不再嵌在「更多」内部',
    !doc.querySelector('#navSecondary .nav-drop[data-drop="more"] .nav-drop[data-drop="reports"]'));
  ok('旧的小标题结构已下线', !doc.querySelector('#navSecondary .nav-sub-title'));
  ok('「更多」里只剩数据看板 / 通知公告',
    Array.from(doc.querySelectorAll('#navSecondary .nav-drop[data-drop="more"] > .nav-drop-body > .nav-item'))
      .map(x => x.textContent.trim()).join(',') === '数据看板,通知公告',
    Array.from(doc.querySelectorAll('#navSecondary .nav-drop[data-drop="more"] > .nav-drop-body > .nav-item'))
      .map(x => x.textContent.trim()).join(','));
  ok('「报表」下拉里是四个入口',
    wrapOf('reports').querySelectorAll('.nav-drop-body > .nav-item').length === 4,
    Array.from(wrapOf('reports').querySelectorAll('.nav-drop-body > .nav-item')).map(x => x.textContent.trim()).join(','));
  ok('「特种作业」下拉里是三个入口',
    wrapOf('special').querySelectorAll('.nav-drop-body > .nav-item').length === 3,
    Array.from(wrapOf('special').querySelectorAll('.nav-drop-body > .nav-item')).map(x => x.textContent.trim()).join(','));

  /* ================= 2. 初始状态 ================= */
  console.log('== 2. 初始展开状态 ==');
  ok('概览页：「特种作业」收起', !isOpen('special'), aria('special'));
  ok('概览页：「更多」收起', !isOpen('more'), aria('more'));
  ok('「报表」默认展开（四个报表入口直接可见）', isOpen('reports'), aria('reports'));
  ok('箭头随状态：展开的报表箭头是旋转态', chevOpen('reports') === true);
  ok('箭头随状态：收起的特种作业箭头是原始态', chevOpen('special') === false);

  /* ================= 3. 点击展开 / 收起 ================= */
  console.log('== 3. 点击展开 / 收起 ==');
  await click(headOf('special'));
  ok('点「特种作业」展开', isOpen('special'), aria('special'));
  ok('点「特种作业」顺带进入落地页', win.location.hash === '#/special', win.location.hash);
  ok('展开后箭头旋转', chevOpen('special') === true);
  ok('在特种作业页：父项高亮 in-tree', inTree('special'));
  await click(headOf('special'));
  ok('再点一次收起', !isOpen('special'), aria('special'));

  /* ================= 4. 互斥 ================= */
  console.log('== 4. 同一时间只有一个并列下拉展开 ==');
  await click(headOf('special'));
  ok('先展开「特种作业」', isOpen('special'));
  await click(headOf('more'));
  ok('再展开「更多」时，「特种作业」自动收起', !isOpen('special') && isOpen('more'),
    'special=' + isOpen('special') + ' more=' + isOpen('more'));
  ok('展开「更多」会收起「报表」（两者并列互斥）', !isOpen('reports') && isOpen('more'),
    'reports=' + isOpen('reports') + ' more=' + isOpen('more'));

  /* ================= 5. 悬停不触发开合（★ 2026-11-05 取消悬停展开） ================= */
  console.log('== 5. 悬停不触发开合 ==');
  await click(headOf('more'));                 // 先点一下收起
  ok('「更多」已收起（悬停测试准备）', !isOpen('more'));
  await hover('more', 'mouseenter');
  ok('收起状态：鼠标移入不展开', !isOpen('more'));
  await wait(400);                              // 超过原来 260ms 的延时，确认不是「延迟展开」
  ok('移入后再等一会儿仍不展开', !isOpen('more'));
  await hover('more', 'mouseleave');
  ok('收起状态：鼠标移出也不改变', !isOpen('more'));

  await click(headOf('more'));
  ok('点击才是展开入口', isOpen('more'));
  await hover('more', 'mouseleave');
  ok('展开后鼠标移出 → 不会自动收起', isOpen('more'));
  await hover('more', 'mouseenter');
  ok('展开后鼠标移入 → 保持展开', isOpen('more'));
  await click(headOf('more'));
  ok('再点一次才收起', !isOpen('more'));
  ok('DOM 上不再有 pin / hover 这类悬停痕迹',
    !/data-(pin|hover)/.test(wrapOf('more').outerHTML), wrapOf('more').outerHTML.slice(0, 80));

  /* ================= 6. 换页自动展开所属分支 ================= */
  console.log('== 6. 换页自动展开所属分支 ==');
  await goHash('#/violation');
  ok('进违章考核单：「报表」展开', isOpen('reports'));
  ok('进违章考核单：「更多」保持收起（不在它的地盘）', !isOpen('more'), aria('more'));
  ok('只有「报表」父项高亮 in-tree', inTree('reports') && !inTree('more'),
    'reports=' + inTree('reports') + ' more=' + inTree('more'));
  ok('当前子项高亮 active', activeSub() === 'violation', activeSub());

  await goHash('#/specPermit');
  ok('进危险作业票：「特种作业」展开', isOpen('special'));
  /* 报表是「默认展开」的（四个报表入口直接可见），所以切到别的页它仍开着，这里不要求它收起 */
  ok('「特种作业」父项高亮 in-tree', inTree('special'));
  ok('危险作业票子项高亮', activeSub() === 'specPermit', activeSub());
  ok('此时「更多」已收起（离开该分支）', !isOpen('more'), aria('more'));

  /* ================= 7. 同页保留 / 换页复原 ================= */
  console.log('== 7. 同页重绘保留手动开合 ==');
  await goHash('#/hazard');
  ok('进隐患页：两个下拉都收起', !isOpen('special') && !isOpen('more'));
  await click(headOf('more'));
  ok('手动展开「更多」', isOpen('more'));
  SD.app.refreshAll();                          // 模拟「点筛选 / 改数据」触发的重绘
  await wait(400);
  ok('同页重绘后仍是展开的（不会点一下就收回）', isOpen('more'));

  await goHash('#/overview');
  ok('换页后回到默认： 「更多」收起', !isOpen('more'), aria('more'));

  /* ================= 8. Esc ================= */
  console.log('== 8. Esc 收起 ==');
  await click(headOf('more'));
  ok('先展开「更多」', isOpen('more'));
  doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await wait(200);
  ok('按 Esc 收起全部下拉', !isOpen('more') && !isOpen('reports'),
    'more=' + isOpen('more') + ' reports=' + isOpen('reports'));

  /* ================= 9. 常用功能按频率排序 ================= */
  console.log('== 9. 常用功能：按使用频率排序 ==');
  ok('默认按内置顺序展示 6 个入口',
    quicks().join(',') === '登记隐患,待办任务,巡检打卡,安全培训,数据看板,导出台账',
    quicks().join(','));
  ok('每个入口的 title 写明本机用过几次',
    /本机用过 \d+ 次/.test(doc.querySelector('.js-sidebar-quick .quick').getAttribute('title')),
    doc.querySelector('.js-sidebar-quick .quick').getAttribute('title'));

  SD.usage.bump('dashboard', 3);
  SD.app.refreshAll();
  await wait(400);
  ok('用 3 次「数据看板」后排到第一位', quicks()[0] === '数据看板', quicks().join(','));
  ok('title 里的次数同步更新',
    /本机用过 3 次/.test(Array.from(doc.querySelectorAll('.js-sidebar-quick .quick'))
      .filter(b => b.textContent.trim() === '数据看板')[0].getAttribute('title')));

  SD.usage.bump('training', 5);
  SD.app.refreshAll();
  await wait(400);
  ok('「安全培训」5 次后超过「数据看板」，排第一', quicks()[0] === '安全培训', quicks().join(','));
  ok('次数少的排在后面（导出台账 0 次垫底）', quicks().slice(-1)[0] === '导出台账', quicks().join(','));

  const raw = win.localStorage.getItem('sd_usage_v1');
  ok('计数写进本机 localStorage（sd_usage_v1）', !!raw && /"training"\s*:\s*5/.test(raw),
    (raw || '').slice(0, 120));
  ok('统计接口能读到同一份数据', SD.usage.count('training') === 5, SD.usage.count('training'));

  /* 切页计数：进入新页 +1；同页刷新不重复计 */
  const c0 = SD.usage.count('todo');
  await goHash('#/todo');
  ok('切到待办页 → 计数 +1', SD.usage.count('todo') === c0 + 1, c0 + ' → ' + SD.usage.count('todo'));
  SD.app.refreshAll();
  await wait(300);
  ok('同一页再刷新不重复计数', SD.usage.count('todo') === c0 + 1, SD.usage.count('todo'));

  SD.usage.reset();
  SD.app.refreshAll();
  await wait(400);
  ok('reset 后恢复默认顺序',
    quicks().join(',') === '登记隐患,待办任务,巡检打卡,安全培训,数据看板,导出台账',
    quicks().join(','));
  ok('reset 后计数清零', SD.usage.count('training') === 0, SD.usage.count('training'));

  /* ================= 10. 无错误 ================= */
  console.log('== 10. 运行期无 JS 错误 ==');
  ok('没有未捕获错误', errors.length === 0, errors.join(' | '));

  console.log('\n结果：通过 ' + pass + ' / 失败 ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FATAL', e); process.exit(1); });
