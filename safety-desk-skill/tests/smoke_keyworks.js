/* 安全员工作台 · 安全重要工作看板 冒烟自检（★ 2026-11-10 新增）
   用法：node safety-desk_dev/smoke_keyworks.js [url]

   覆盖：
     ① 概览页结构：原「今天要处理」已下线，换成「安全重要工作」四列看板
     ② 空态：四列都显示「暂无事项」，统计条全 0，起步提示可见
     ③ 新增：表单字段齐全 → 提交 → 落在「待开始」列，统计与计数同步
     ④ 逾期口径：截止日早于今天 → 红字「逾期 N 天」+ 统计「已逾期」
     ⑤ 推进：待开始 → 进行中 → 待验收 → 已完成，走完显示「已闭环」且无推进按钮
     ⑥ 编辑：点卡片打开弹窗（预填原值）→ 改名保存 → 卡片与落库都变
     ⑦ 删除：编辑弹窗左下角「删除」→ 二次确认 → 卡片消失、落库减一
     ⑧ 筛选：关键词 / 优先级 / 仅看逾期 / 重置
     ⑨ 持久化与备份：数据落在 keyWorks 集合，DATA_KEYS 收录，导出 JSON 带上
     ⑩ 受限模式：新增按钮被写操作守卫拦下，不落库
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
  await SD.app.reload();
  const doc = win.document;
  const click = el => el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  const go = async r => { win.location.hash = '#/' + r; await wait(600); };
  const store = () => SD.store.data().keyWorks || [];
  const sec = () => doc.querySelector('#view .kw-sec');
  const cols = () => Array.from(doc.querySelectorAll('#view .kw-col'));
  const colBy = st => doc.querySelector('#view .kw-col[data-st="' + st + '"]');
  const cards = st => Array.from(colBy(st).querySelectorAll('.kw-item'));
  const titles = st => cards(st).map(c => (c.querySelector('.kw-title') || {}).textContent || '');
  const allTitles = () => Array.from(doc.querySelectorAll('#view .kw-item .kw-title')).map(x => x.textContent);
  const statText = () => (doc.querySelector('#view .kw-sum') || {}).textContent || '';
  const hint = () => doc.querySelector('#view .kw-hint');
  const q = () => doc.querySelector('#view .kw-q');
  const selects = () => Array.from(doc.querySelectorAll('#view .kw-filters select'));
  const overChip = () => doc.querySelector('#view .kw-chk');
  const resetBtn = () => doc.querySelector('#view .kw-reset');
  const addBtn = () => doc.querySelector('#view .kw-sec .actions .btn');
  const topModal = () => {
    const arr = Array.from(doc.querySelectorAll('.mask .modal'));
    return arr.length ? arr[arr.length - 1] : null;
  };
  const TODAY = win.SD.app.state.summary.today;
  const YESTERDAY = SD.utils.shift(TODAY, -1);

  async function openOverview() { await go('overview'); }

  /* ================= 1. 概览页结构 ================= */
  console.log('== 1. 概览页：看板替换「今天要处理」 ==');
  await openOverview();
  ok('概览页出现「安全重要工作」区块', !!sec() && /安全重要工作/.test(sec().textContent));
  ok('原「今天要处理」已下线', (doc.querySelector('#view') || {}).textContent.indexOf('今天要处理') < 0);
  ok('四列看板结构存在且顺序正确',
    cols().map(c => c.dataset.st).join(',') === 'todo,doing,review,done',
    cols().map(c => c.dataset.st).join(','));
  ok('列标题为 待开始 / 进行中 / 待验收 / 已完成',
    cols().map(c => c.querySelector('.kw-col-hd span').textContent).join(',') === '待开始,进行中,待验收,已完成',
    cols().map(c => c.querySelector('.kw-col-hd span').textContent).join(','));
  ok('看板挂在概览页第二个区块（指标卡之后）',
    doc.querySelector('#view').children[0].classList.contains('grid') &&
    doc.querySelector('#view').children[1].classList.contains('kw-sec'));
  ok('原「查看全部 N 项」入口已移除（列表本身交给待办任务页）',
    !/查看全部 \d+ 项/.test(sec().textContent));

  /* ================= 2. 空态 ================= */
  console.log('== 2. 空态 ==');
  const clean = () => {
    SD.store.data().keyWorks = [];
    SD.store.setData(SD.store.data());
  };
  clean();
  await SD.app.reload(); await wait(300);
  ok('空库时四列都显示「暂无事项」',
    cols().every(c => /暂无事项/.test(c.textContent)), cols().map(c => c.textContent.trim().slice(-4)).join('/'));
  ok('空库时统计条全 0', /重点事项 0 项/.test(statText()) && /完成率 0%/.test(statText()), statText().replace(/\s+/g, ' ').trim());
  ok('空库时给出起步提示', hint() && !hint().hidden && /新增事项/.test(hint().textContent),
    hint() ? hint().textContent.slice(0, 30) : '无');
  ok('空库时列头计数为 0', cols().every(c => c.querySelector('.kw-col-hd b').textContent === '0'));

  /* ================= 3. 新增（走界面表单） ================= */
  console.log('== 3. 新增事项 ==');
  click(addBtn());
  await wait(320);
  let m = topModal();
  ok('点「新增事项」弹出表单', !!m);
  ok('表单字段齐全（名称/负责人/类别/优先级/状态/截止/备注）',
    ['title', 'owner', 'cat', 'pri', 'status', 'due', 'note'].every(n => !!m.querySelector('#ff_' + n)));
  ok('新增默认状态 = 待开始、优先级 = 中',
    m.querySelector('#ff_status').value === 'todo' && m.querySelector('#ff_pri').value === 'mid',
    m.querySelector('#ff_status').value + '/' + m.querySelector('#ff_pri').value);

  m.querySelector('#ff_title').value = '三号仓库消防通道被托盘占用，需清空并划设禁放区';
  m.querySelector('#ff_owner').value = '测试员';
  m.querySelector('#ff_cat').value = '隐患整改';
  m.querySelector('#ff_pri').value = 'high';
  m.querySelector('#ff_due').value = SD.utils.shift(TODAY, 5);
  m.querySelector('#ff_note').value = '疏散通道宽度不小于 1.1m。';
  click(m.querySelector('.js-ok'));
  await wait(700);
  ok('新增后台账 +1', store().length === 1, store().length);
  ok('新增的卡片落在「待开始」列', titles('todo').indexOf('三号仓库消防通道被托盘占用，需清空并划设禁放区') >= 0, titles('todo').join(' | '));
  ok('卡片显示类别 / 优先级 / 负责人 / 截止时间',
    /隐患整改/.test(colBy('todo').textContent) && /测试员/.test(colBy('todo').textContent) &&
    new RegExp(SD.utils.shift(TODAY, 5).slice(5).replace('-', '/')).test(colBy('todo').textContent));
  ok('统计条同步：重点 1 项、进行中 0、完成率 0%',
    /重点事项 1 项/.test(statText()) && /完成率 0%/.test(statText()), statText().replace(/\s+/g, ' ').trim());
  ok('有数据后起步提示隐藏', hint().hidden === true);

  /* ================= 4. 逾期口径 ================= */
  console.log('== 4. 逾期样式与统计 ==');
  await SD.api.createKeyWork({
    title: '二号车间东侧配电箱未上锁、箱内积尘', owner: '陈涛', cat: '设备设施',
    pri: 'high', status: 'doing', due: YESTERDAY, note: '', createdAt: new Date().toISOString()
  });
  await SD.app.reload(); await wait(300);
  const overdueCard = colBy('doing').querySelector('.kw-item');
  ok('截止日早于今天 → 卡片显示红字「逾期 1 天」',
    !!overdueCard.querySelector('.kw-due.over') && /逾期1天/.test(overdueCard.textContent),
    overdueCard.querySelector('.kw-due').textContent.trim());
  ok('统计条「已逾期 1」并标红', /已逾期 1/.test(statText()) &&
    !!doc.querySelector('#view .kw-k.is-danger'), statText().replace(/\s+/g, ' ').trim());

  /* ================= 5. 推进状态机 ================= */
  console.log('== 5. 推进：待开始 → 进行中 → 待验收 → 已完成 ==');
  const t1 = store().filter(t => /三号仓库/.test(t.title))[0];
  const advOf = id => doc.querySelector('#view .kw-adv[data-id="' + id + '"]');
  ok('待开始卡片有「推进到「进行中」」', !!advOf(t1.id) && /进行中/.test(advOf(t1.id).textContent),
    advOf(t1.id) && advOf(t1.id).textContent);

  click(advOf(t1.id)); await wait(700);
  ok('推进一次 → 进行中', (store().filter(t => t.id === t1.id)[0] || {}).status === 'doing',
    (store().filter(t => t.id === t1.id)[0] || {}).status);
  ok('卡片移到「进行中」列', titles('doing').some(x => /三号仓库/.test(x)), titles('doing').join(' | '));

  click(doc.querySelector('#view .kw-adv[data-id="' + t1.id + '"]')); await wait(700);
  ok('推进两次 → 待验收', (store().filter(t => t.id === t1.id)[0] || {}).status === 'review',
    (store().filter(t => t.id === t1.id)[0] || {}).status);

  click(doc.querySelector('#view .kw-adv[data-id="' + t1.id + '"]')); await wait(700);
  ok('推进三次 → 已完成', (store().filter(t => t.id === t1.id)[0] || {}).status === 'done',
    (store().filter(t => t.id === t1.id)[0] || {}).status);
  const doneCard = cards('done').filter(c => c.dataset.id === t1.id)[0];
  ok('已完成卡片显示「已闭环」且不再有推进按钮',
    !!doneCard && /已闭环/.test(doneCard.textContent) && !doneCard.querySelector('.kw-adv'));
  ok('完成率随之上调（1/2 = 50%）', /完成率 50%/.test(statText()), statText().replace(/\s+/g, ' ').trim());
  ok('已完成卡片加 .done（视觉弱化）', doneCard.classList.contains('done'));

  /* ================= 6. 编辑 ================= */
  console.log('== 6. 编辑 ==');
  click(doneCard); await wait(320);
  m = topModal();
  ok('点卡片打开编辑弹窗，标题写「编辑安全重要工作」', !!m && /编辑安全重要工作/.test(m.textContent));
  ok('弹窗预填原值（标题 / 负责人 / 状态）',
    m.querySelector('#ff_title').value === t1.title &&
    m.querySelector('#ff_owner').value === '测试员' &&
    m.querySelector('#ff_status').value === 'done',
    m.querySelector('#ff_title').value.slice(0, 12) + ' / ' + m.querySelector('#ff_status').value);
  m.querySelector('#ff_title').value = '三号仓库消防通道清理（已复查合格）';
  click(m.querySelector('.js-ok')); await wait(700);
  ok('改名落库', (store().filter(t => t.id === t1.id)[0] || {}).title === '三号仓库消防通道清理（已复查合格）',
    (store().filter(t => t.id === t1.id)[0] || {}).title);
  ok('看板卡片标题同步更新', allTitles().some(x => /已复查合格/.test(x)), allTitles().join(' | '));

  /* ================= 7. 删除 ================= */
  console.log('== 7. 删除 ==');
  const before = store().length;
  const t2 = store().filter(t => /配电箱/.test(t.title))[0];
  click(cards('doing')[0]); await wait(320);
  m = topModal();
  const delBtn = m.querySelector('.js-kw-del');
  ok('编辑弹窗左下角有「删除」按钮', !!delBtn && delBtn.textContent.trim() === '删除', delBtn && delBtn.className);
  click(delBtn); await wait(320);
  let cm = topModal();
  ok('点删除弹二次确认，写明不可恢复', !!cm && /删除后不可恢复/.test(cm.textContent), cm ? cm.textContent.slice(0, 40) : '无');
  click(cm.querySelector('.js-ok')); await wait(800);
  ok('确认后台账减一', store().length === before - 1, before + ' → ' + store().length);
  ok('被删卡片从看板消失', !allTitles().some(x => /配电箱/.test(x)), allTitles().join(' | '));
  ok('删除后台账里确实没有这条', !store().some(t => t.id === t2.id));

  /* ================= 8. 筛选 ================= */
  console.log('== 8. 筛选 ==');
  await SD.api.createKeyWork({ title: '有限空间作业人员复训', owner: '张敏', cat: '教育培训', pri: 'mid', status: 'todo', due: SD.utils.shift(TODAY, 9), note: '', createdAt: new Date().toISOString() });
  await SD.api.createKeyWork({ title: '空压机储气罐安全阀到期校验', owner: '陈涛', cat: '设备设施', pri: 'high', status: 'todo', due: SD.utils.shift(TODAY, 2), note: '', createdAt: new Date().toISOString() });
  await SD.api.createKeyWork({ title: '年度消防设施检测单位确定', owner: '王建国', cat: '消防管理', pri: 'low', status: 'review', due: YESTERDAY, note: '', createdAt: new Date().toISOString() });
  await SD.app.reload(); await wait(300);
  const totalNow = store().length;
  ok('准备数据：' + totalNow + ' 条', totalNow === 4, totalNow);

  const setQ = async v => { const el = q(); el.value = v; el.dispatchEvent(new win.Event('input', { bubbles: true })); await wait(150); };
  await setQ('配电');
  ok('关键词搜索：搜已被删的「配电」→ 0 条', doc.querySelectorAll('#view .kw-item').length === 0,
    doc.querySelectorAll('#view .kw-item').length);
  ok('筛出空时给出「重置」提示', hint() && !hint().hidden && /重置/.test(hint().textContent),
    hint() && hint().textContent.slice(0, 24));
  await setQ('空压机');
  ok('关键词命中的只剩 1 条', doc.querySelectorAll('#view .kw-item').length === 1,
    allTitles().join(' | '));

  click(resetBtn()); await wait(200);
  ok('点「重置」清空关键词，恢复全部', doc.querySelectorAll('#view .kw-item').length === totalNow,
    doc.querySelectorAll('#view .kw-item').length);
  ok('重置后输入框也被清空', q().value === '', q().value);

  const priSel = selects()[2];
  priSel.value = '低';
  priSel.dispatchEvent(new win.Event('change', { bubbles: true })); await wait(200);
  ok('按优先级「低」筛选 → 只剩低优先级卡片',
    doc.querySelectorAll('#view .kw-item').length === 1 &&
    /消防设施检测/.test(doc.querySelector('#view .kw-item').textContent),
    allTitles().join(' | '));
  click(resetBtn()); await wait(200);

  click(overChip()); await wait(200);
  ok('「仅看逾期」→ 只剩逾期项（1 条）',
    doc.querySelectorAll('#view .kw-item').length === 1 &&
    !!doc.querySelector('#view .kw-item .kw-due.over'),
    allTitles().join(' | '));
  ok('仅看逾期时按钮处于选中态', overChip().classList.contains('on'));
  click(overChip()); await wait(200);
  ok('再点一次取消「仅看逾期」', doc.querySelectorAll('#view .kw-item').length === totalNow,
    doc.querySelectorAll('#view .kw-item').length);

  /* 筛选状态跨重绘保留（切页回来仍在） */
  await setQ('空压机');
  await go('todo'); await openOverview();
  ok('筛选条件存在 state.filters，重绘后仍保留',
    q() && q().value === '空压机', q() && q().value);
  click(resetBtn()); await wait(200);

  /* ================= 9. 持久化与备份 ================= */
  console.log('== 9. 持久化与备份 ==');
  ok('数据落在 store 的 keyWorks 集合', Array.isArray(SD.store.data().keyWorks) && store().length === totalNow);
  ok('DATA_KEYS 收录 keyWorks（备份 / 导入不会丢）', SD.store.DATA_KEYS.indexOf('keyWorks') >= 0,
    SD.store.DATA_KEYS.join(','));
  const dump = JSON.parse(SD.store.exportJSON());
  ok('导出备份包含 keyWorks 且条数一致', Array.isArray(dump.data.keyWorks) && dump.data.keyWorks.length === totalNow,
    dump.data.keyWorks && dump.data.keyWorks.length);
  const raw = win.localStorage.getItem(SD.CONFIG.storageKey) || '';
  ok('已写进本机 localStorage', raw.indexOf('keyWorks') >= 0);
  ok('看板数据不进待办口径（两套互不干扰）',
    SD.app.state.summary.todos.every(t => t.kind !== 'keyWork'));

  /* ================= 10. 受限模式 ================= */
  console.log('== 10. 受限模式 ==');
  SD.auth.set('restricted');
  await SD.app.reload(); await wait(400);
  const n0 = store().length;
  click(addBtn()); await wait(400);
  ok('受限模式下点「新增事项」不弹表单', !topModal());
  ok('受限模式下不产生新记录', store().length === n0, n0 + ' → ' + store().length);
  SD.auth.set('safety_officer');
  await SD.app.reload(); await wait(400);

  /* ================= 收尾 ================= */
  ok('全程无 JS 报错', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log('\n结果：通过 ' + pass + ' / 失败 ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FATAL: ' + (e && e.stack || e)); process.exit(1); });
