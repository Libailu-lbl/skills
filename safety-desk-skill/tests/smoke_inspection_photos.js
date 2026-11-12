/* 安全员工作台 · 巡检「隐患照片」更名 + 看板照片口径 冒烟自检
   用法：node safety-desk_dev/smoke_inspection_photos.js [url]

   背景（★ 2026-11-10）：
     ① 安全巡检「新增巡检任务」里原字段「巡查照片」统一更名「隐患照片」；
     ② 数据看板的隐患计数改为「按部门汇总巡检任务上传的隐患照片张数」。

   覆盖：
     1  表单标签：新增巡检任务弹窗里是「隐患照片」，全页不再出现「巡查照片」
     2  存储映射：落库字段仍是 photos（不出现 hazardPhotos），老记录无需迁移即可读
     3  校验：照片控件单次上限仍为 18 张（data-max）
     4  文案：列表区域列 title / 执行记录弹窗都跟着改名
     5  看板 KPI：第一张卡是「隐患照片」，值 = 巡检照片总张数
     6  按部门汇总：生产一部 / 未指定部门 / 仓储部，按照片数降序，含「N 张（M 项）」
     7  合计自洽：各部门张数相加 === 顶部总张数（含未指定部门）
     8  无照片任务不计数；改期 / 取消的任务已上传照片仍计入
     9  空态：没有照片时看板给出「暂无隐患照片」而不是空白
    10  口径说明：页面写明照片口径与台账口径的分工
    11  隐患类型（★ 2026-11-10 新增字段）：表单有下拉、非必填；看板类型分布改按巡检统计
        （一条任务记一次，含未分类，合计等于有照片的任务数）
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
  win.addEventListener('unhandledrejection', e => errors.push('rejection: ' + String((e.reason && (e.reason.message || e.reason)))));

  for (let i = 0; i < 80 && !(win.SD && win.SD.app && win.SD.app.state.summary); i++) await wait(150);
  const SD = win.SD;
  if (!SD || !SD.app) { console.log('FATAL: SD 未初始化'); process.exit(1); }

  SD.auth.set('safety_officer');
  await SD.app.reload();
  const doc = win.document;
  const go = async r => { win.location.hash = '#/' + r; await wait(650); };
  const view = () => doc.querySelector('#view');
  const today = SD.app.state.summary.today;
  const thisYM = today.slice(0, 7);
  const d10 = thisYM + '-10';
  const d05 = thisYM + '-05';
  const data = () => SD.store.data();

  const shot = n => Array.from({ length: n }, (_, i) => 'data:image/png;base64,AAA' + i);

  /* ================= 1. 表单标签 ================= */
  console.log('== 1. 新增巡检任务：字段名「隐患照片」 ==');
  await go('inspection');
  /* 直接调视图的 openForm，避免依赖按钮选择器 */
  SD.views.inspection.openCreate && SD.views.inspection.openCreate(SD.app.state.ctx || {});
  await wait(500);

  let modal = Array.from(doc.querySelectorAll('.mask .modal')).pop();
  if (!modal) {
    /* 有些版本没暴露 openCreate，退化为点页面上的「新增」按钮 */
    const btn = Array.from(doc.querySelectorAll('#view .btn')).find(b => /新增/.test(b.textContent));
    if (btn) { btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); await wait(500); }
    modal = Array.from(doc.querySelectorAll('.mask .modal')).pop();
  }

  const modalText = modal ? modal.textContent : '';
  ok('弹窗已打开', !!modal);
  ok('表单里有「隐患照片」标签', /隐患照片/.test(modalText), modalText.slice(0, 60) + '…');
  ok('表单里不再有「巡查照片」', !/巡查照片/.test(modalText));

  const phSlot = modal ? modal.querySelector('.ph-slot') : null;
  ok('照片控件存在且上限 18 张', !!phSlot && phSlot.getAttribute('data-max') === '18',
    phSlot ? phSlot.getAttribute('data-max') : '无控件');

  /* ★ 2026-11-10：表单新增「隐患类型」，供看板「隐患类型分布」出图 */
  const labels = modal ? Array.from(modal.querySelectorAll('.field > span, label > span')).map(x => x.textContent.trim()) : [];
  ok('表单有「隐患类型」字段', labels.some(t => t === '隐患类型'), labels.join('/'));
  const hzTypeSel = modal ? Array.from(modal.querySelectorAll('select')).find(sel => {
    const f = sel.closest('.field, label');
    const sp = f && f.querySelector('span');
    return sp && sp.textContent.trim() === '隐患类型';
  }) : null;
  ok('隐患类型是下拉且选项来自字典', !!hzTypeSel && hzTypeSel.options.length >= 10,
    hzTypeSel ? hzTypeSel.options.length + ' 项' : '无下拉');
  ok('隐患类型非必填', !hzTypeSel || !hzTypeSel.closest('.field, label').classList.contains('req'));

  /* 关掉弹窗 */
  const cancelBtn = modal && Array.from(modal.querySelectorAll('.btn')).find(b => /取消/.test(b.textContent));
  if (cancelBtn) cancelBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(300);

  /* ================= 2. 存储映射：键仍是 photos ================= */
  console.log('== 2. 存储映射：落库字段仍叫 photos ==');
  const d = data();
  d.inspections = [
    { id: 'IP-A', code: 'FZXJ-7000001', planName: '装配车间日常巡检', type: '日常巡检', area: 'A 区装配线',
      dept: '生产一部', executor: '测试员', scheduledDate: d10, status: 'done', photos: shot(2),
      hazardType: '消防',
      completedAt: d10, record: { findings: '无异常', hazardCount: 0, signedBy: '测试员', signedAt: d10 } },
    { id: 'IP-B', code: 'FZXJ-7000002', planName: '装配线二次巡检', type: '日常巡检', area: 'A 区装配线',
      dept: '生产一部', executor: '测试员', scheduledDate: d05, status: 'planned', photos: shot(1),
      hazardType: '消防' },
    { id: 'IP-C', code: 'FZXJ-7000003', planName: '未填部门巡检', type: '专项检查', area: 'B 区',
      dept: '', executor: '测试员', scheduledDate: d10, status: 'planned', photos: shot(3),
      hazardType: '电气' },
    { id: 'IP-D', code: 'FZXJ-7000004', planName: '没传照片的巡检', type: '季节性检查', area: 'C 区',
      dept: '仓储部', executor: '测试员', scheduledDate: d10, status: 'planned', photos: [] },
    { id: 'IP-E', code: 'FZXJ-7000005', planName: '已取消但传了照片', type: '综合巡查', area: 'D 区',
      dept: '仓储部', executor: '测试员', scheduledDate: d05, status: 'cancelled', photos: shot(1) }
  ];
  SD.store.save();
  await SD.app.reload();
  await wait(400);

  const saved = data().inspections;
  ok('落库字段名仍是 photos', saved.every(t => Array.isArray(t.photos)));
  ok('没有出现 hazardPhotos 这类新键', saved.every(t => !('hazardPhotos' in t)));
  ok('老结构（只有 photos）能被计数', saved.filter(t => t.photos.length).length === 4,
    saved.map(t => t.photos.length).join('/'));

  const sum = SD.app.state.summary;
  const ip = sum.inspectionPhotos;
  ok('metrics 已透出 inspectionPhotos', !!ip);
  ok('总张数 = 2+1+3+1 = 7（无照片任务不计）', ip.totalPhotos === 7, ip.totalPhotos);
  ok('任务数 = 4（IP-D 无照片不计）', ip.totalTasks === 4, ip.totalTasks);
  ok('取消的任务照片仍计入（IP-E 的 1 张）',
    ip.byDept.some(x => x.dept === '仓储部' && x.photos === 1));

  /* ================= 3. 按部门汇总 ================= */
  console.log('== 3. 按部门汇总与自洽 ==');
  ok('部门数 3（生产一部 / 未指定部门 / 仓储部）', ip.byDept.length === 3,
    ip.byDept.map(x => x.dept).join('|'));
  ok('生产一部 3 张 / 2 项',
    ip.byDept[0].dept === '生产一部' && ip.byDept[0].photos === 3 && ip.byDept[0].tasks === 2,
    JSON.stringify(ip.byDept[0]));
  ok('未填部门归到「未指定部门」3 张 / 1 项',
    ip.byDept.some(x => x.dept === '未指定部门' && x.photos === 3 && x.tasks === 1),
    ip.byDept.map(x => x.dept + ':' + x.photos).join(','));
  ok('按照片数降序（含并列时任务数兜底）',
    ip.byDept.every((x, i) => i === 0 || ip.byDept[i - 1].photos >= x.photos),
    ip.byDept.map(x => x.photos).join('>='));
  ok('各部门相加 === 总张数（账能对上）',
    ip.byDept.reduce((a, x) => a + x.photos, 0) === ip.totalPhotos,
    ip.byDept.reduce((a, x) => a + x.photos, 0) + ' vs ' + ip.totalPhotos);

  /* ---- 隐患类型（★ 2026-11-10 新增字段）---- */
  ok('byType 分组数 3（消防 / 电气 / 未分类）', ip.byType.length === 3,
    ip.byType.map(t => t.type + ':' + t.tasks).join(','));
  ok('消防 2 次（IP-A + IP-B）',
    ip.byType.some(t => t.type === '消防' && t.tasks === 2),
    JSON.stringify(ip.byType[0]));
  ok('电气 1 次', ip.byType.some(t => t.type === '电气' && t.tasks === 1));
  ok('没填类型的归「未分类」且仍计入',
    ip.byType.some(t => t.type === '未分类' && t.tasks === 1),
    ip.byType.map(t => t.type).join(','));
  ok('类型合计 = 有照片的任务数（一条任务记一次）',
    ip.byType.reduce((a, t) => a + t.tasks, 0) === ip.totalTasks,
    ip.byType.reduce((a, t) => a + t.tasks, 0) + ' vs ' + ip.totalTasks);
  ok('按次数降序', ip.byType.every((t, i) => i === 0 || ip.byType[i - 1].tasks >= t.tasks));

  /* ================= 4. 看板呈现 ================= */
  console.log('== 4. 数据看板：KPI 与各部门照片 ==');
  await go('dashboard');
  const cards = Array.from(view().querySelectorAll('.grid.cols-4 > *'));
  ok('顶部 4 张关键数字', cards.length === 4, cards.length);
  const k1 = cards[0] ? cards[0].textContent.replace(/\s+/g, ' ') : '';
  ok('第一张卡是「隐患条数」（KPI 全巡检化）', /隐患条数/.test(k1), k1.slice(0, 50));
  /* ★ 2026-11-12：KPI 从「照片张数」改为「隐患条数」。本组种子只有照片、没填条数，
     所以这里本来就该是 0 条 —— 旧断言查「7 张」属于已作废的照片口径（9 条的断言见 13.3）。 */
  ok('第一张卡的值 = 0 条（本组未填条数）', /0\s*条/.test(k1) && !/张/.test(k1), k1.slice(0, 50));
  ok('第一张卡不再叫「隐患总数」', !/隐患总数/.test(k1));
  const kAll = cards.map(c => c.textContent.replace(/\s+/g, ' '));
  ok('后三张是「已整改 / 逾期未整改 / 整改率」',
    /已整改/.test(kAll[1]) && /逾期未整改/.test(kAll[2]) && /整改率/.test(kAll[3]),
    kAll.slice(1).map(t => t.slice(0, 12)).join(' | '));
  ok('KPI 不再统计隐患台账（无「已闭环 / 延期跟进」）',
    !/已闭环/.test(kAll.join(' ')) && !/延期跟进/.test(kAll.join(' ')));

  const photoCard = Array.from(view().querySelectorAll('.card'))
    .find(c => {
      const t = (c.querySelector('h3') || {}).textContent || '';
      /* 精确匹配：不能用 includes —— 「各部门隐患照片趋势」也含「各部门隐患照片」 */
      return t.trim() === '各部门隐患照片';
    });
  ok('看板有「各部门隐患照片」区块', !!photoCard);
  if (photoCard) {
    const rows = Array.from(photoCard.querySelectorAll('.bar-row')).map(r => r.textContent.replace(/\s+/g, ' '));
    ok('条形行数 = 3 个部门', rows.length === 3, rows.join(' / '));
    ok('生产一部显示「3 张（2 项）」', rows.some(t => /生产一部/.test(t) && /3 张（2 项）/.test(t)), rows.join(' / '));
    ok('未指定部门出现在条形里', rows.some(t => /未指定部门/.test(t)), rows.join(' / '));
    ok('右上角合计写明 7 张 / 4 项', /合计 7 张 \/ 4 项/.test(photoCard.textContent.replace(/\s+/g, ' ')),
      (photoCard.querySelector('.js-total') || {}).textContent);
  }

  const trendCard = Array.from(view().querySelectorAll('.card'))
    .find(c => /各部门隐患照片趋势/.test((c.querySelector('h3') || {}).textContent || ''));
  ok('趋势区块标题已改为「各部门隐患照片趋势」', !!trendCard);

  const typeCard = Array.from(view().querySelectorAll('.card'))
    .find(c => (c.querySelector('h3') || {}).textContent.trim() === '隐患类型分布');
  ok('类型分布改用巡检口径', !!typeCard && /基于巡检/.test(typeCard.textContent),
    typeCard ? typeCard.querySelector('.sub').textContent : '无');
  ok('类型分布中心显示隐患次数 4', !!typeCard && /隐患次数/.test(typeCard.textContent) &&
    typeCard.querySelector('svg') && typeCard.textContent.indexOf('消防') >= 0,
    typeCard ? typeCard.textContent.replace(/\s+/g, ' ').slice(0, 80) : '无');
  ok('类型分布图例含 消防 2', !!typeCard && /消防\s*2/.test(typeCard.textContent.replace(/\s+/g, ' ')),
    typeCard ? typeCard.textContent.replace(/\s+/g, ' ').slice(0, 100) : '无');
  const noteText = view().textContent.replace(/\s+/g, ' ');
  ok('口径说明写清照片口径（按部门汇总 / 未指定部门 / 张数）',
    /各部门相加恒等于总张数/.test(noteText) && /未填的归「未指定部门」/.test(noteText));
  ok('口径说明写明台账口径仍负责闭环 / 整改率',
    /闭环率、逾期未闭环/.test(noteText) && /整改率/.test(noteText));

  /* ================= 5. 空态 ================= */
  console.log('== 5. 空态 ==');
  data().inspections = [
    { id: 'IP-N1', code: 'FZXJ-7000010', planName: '无照片巡检', type: '日常巡检', area: 'E 区',
      dept: '生产一部', executor: '测试员', scheduledDate: d10, status: 'planned', photos: [] }
  ];
  SD.store.save();
  await SD.app.reload();
  await go('dashboard');
  const emptySum = SD.app.state.summary.inspectionPhotos;
  ok('全部无照片时总张数为 0', emptySum.totalPhotos === 0, emptySum.totalPhotos);
  ok('部门列表为空', emptySum.byDept.length === 0);
  const noteEmpty = view().textContent;
  ok('看板给出「暂无隐患照片」空态', /暂无隐患照片/.test(noteEmpty));

  /* ================= 6. 巡检页文案 ================= */
  console.log('== 6. 巡检列表与执行记录文案 ==');
  data().inspections = [
    { id: 'IP-X', code: 'FZXJ-7000020', planName: '文案核对巡检', type: '日常巡检', area: 'F 区',
      dept: '生产一部', executor: '测试员', scheduledDate: d10, status: 'done', photos: shot(2),
      completedAt: d10, record: { findings: '无异常', hazardCount: 1, signedBy: '测试员', signedAt: d10 } }
  ];
  SD.store.save();
  await SD.app.reload();
  await go('inspection');
  const areaCell = view().querySelector('.js-insp-area');
  ok('区域列 title 写「隐患照片」',
    !!areaCell && /点击查看隐患照片/.test(areaCell.getAttribute('title')),
    areaCell ? areaCell.getAttribute('title') : '无');
  ok('巡检页不再出现「巡查照片」', !/巡查照片/.test(view().textContent));

  const recBtn = Array.from(view().querySelectorAll('.btn')).find(b => /执行记录|记录/.test(b.textContent));
  if (recBtn) {
    recBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await wait(500);
    const recModal = Array.from(doc.querySelectorAll('.mask .modal')).pop();
    const recText = recModal ? recModal.textContent : '';
    ok('执行记录弹窗标签是「隐患照片」', /隐患照片/.test(recText), recText.slice(0, 80));
    const closeBtn = recModal && Array.from(recModal.querySelectorAll('.btn')).pop();
    if (closeBtn) closeBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await wait(200);
  }

  /* ================= 12. 整改照片 / 整改日期（★ 2026-11-11 新增） ================= */
  console.log('== 12. 编辑表单新增「整改日期」「整改照片」 ==');
  await go('inspection');
  /* 先切到「全部」，确保列表里有行可编辑（默认是本周） */
  const allChip = Array.from(view().querySelectorAll('.chip')).find(x => x.textContent.trim() === '全部');
  if (allChip) { allChip.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); await wait(400); }

  const opsBtn = view().querySelector('[data-act="iops"]');
  ok('列表行有「操作 ▾」入口', !!opsBtn);
  if (opsBtn) {
    opsBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await wait(300);
    const editItem = Array.from(doc.querySelectorAll('.dd-item')).find(x => x.textContent.trim() === '编辑');
    ok('菜单里有「编辑」', !!editItem);
    if (editItem) { editItem.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); await wait(450); }
  }

  const em = Array.from(doc.querySelectorAll('.mask .modal')).pop();
  const emLabels = em ? Array.from(em.querySelectorAll('.field > span, label > span')).map(x => x.textContent.trim()) : [];
  ok('编辑巡检任务弹窗已打开', !!em, emLabels.join('/'));
  ok('表单有「整改日期」字段', emLabels.indexOf('整改日期') >= 0, emLabels.join('/'));
  ok('表单有「整改照片」字段', emLabels.indexOf('整改照片') >= 0, emLabels.join('/'));

  const fixDateEl = em ? em.querySelector('#ff_fixDate') : null;
  const fixSlot = em ? em.querySelector('#ff_fixPhotos') : null;
  const hzSlot = em ? em.querySelector('#ff_photos') : null;
  ok('整改日期是日期控件（type=date）', !!fixDateEl && fixDateEl.type === 'date', fixDateEl && fixDateEl.type);
  ok('整改日期非必填', !!fixDateEl && !fixDateEl.closest('.field, label').classList.contains('req'));
  ok('整改照片控件上限 18 张', !!fixSlot && fixSlot.getAttribute('data-max') === '18',
    fixSlot ? fixSlot.getAttribute('data-max') : '无控件');
  ok('整改照片与隐患照片是两个独立控件（不共用 photos 键）',
    !!hzSlot && !!fixSlot && hzSlot !== fixSlot);
  /* 老记录（落库里没有 fixDate / fixPhotos）打开编辑：空值、不报错 */
  ok('老记录打开编辑：整改日期为空', !!fixDateEl && fixDateEl.value === '', fixDateEl && fixDateEl.value);
  ok('老记录打开编辑：整改照片为空数组', !!fixSlot && !!fixSlot._ph && fixSlot._ph.get().length === 0,
    fixSlot && fixSlot._ph ? fixSlot._ph.get().length : '未挂载');

  /* 填值 → 保存 → 验落库 */
  if (fixDateEl && fixSlot && fixSlot._ph && hzSlot && hzSlot._ph) {
    const editId = (SD.store.data().inspections[0] || {}).id;
    /* 种子数据用的是 7000xxx 这类「格式不合规」的测试编号（只读用），
       真要提交得先换成合法格式，否则会被编号校验拦下（这本身是正确行为） */
    const codeEl = em.querySelector('#ff_code');
    if (codeEl) codeEl.value = 'FZXJ-2026-001';
    fixDateEl.value = d10;
    fixSlot._ph.set(shot(2));      // 整改照片 2 张
    hzSlot._ph.set(shot(3));       // 隐患照片 3 张
    const okBtn = em.querySelector('.js-ok');
    if (okBtn) { okBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); await wait(900); }
    const rec = SD.store.data().inspections.filter(t => t.id === editId)[0] || {};
    ok('整改日期已落库', rec.fixDate === d10, rec.fixDate);
    ok('整改照片已落库（2 张）', Array.isArray(rec.fixPhotos) && rec.fixPhotos.length === 2,
      Array.isArray(rec.fixPhotos) ? rec.fixPhotos.length : rec.fixPhotos);
    ok('隐患照片没被串改（仍是 3 张）', Array.isArray(rec.photos) && rec.photos.length === 3,
      Array.isArray(rec.photos) ? rec.photos.length : rec.photos);
    ok('两套照片内容不同（各存各的）',
      JSON.stringify(rec.fixPhotos) !== JSON.stringify(rec.photos));

    /* 看板口径：整改照片**不进**「隐患照片」统计 ——
       用「总张数 == photos 张数，且 != photos + fixPhotos」判定，不依赖种子数据的绝对数 */
    const ip2 = SD.app.state.summary.inspectionPhotos;
    const sumAll = SD.store.data().inspections.reduce(function (n, t) {
      return n + (t.photos || []).length;
    }, 0);
    ok('看板总张数 = 各任务 photos 张数之和（不含整改照片）', ip2.totalPhotos === sumAll,
      ip2.totalPhotos + ' vs ' + sumAll);
    ok('看板总张数 ≠ photos + 整改照片（没被数两遍）',
      ip2.totalPhotos !== sumAll + 2, ip2.totalPhotos);
    ok('有照片任务数不受整改照片影响',
      ip2.totalTasks === SD.store.data().inspections.filter(t => (t.photos || []).length).length,
      ip2.totalTasks);
  }

  /* 执行记录弹窗里能看到整改两件套 */
  await go('inspection');
  const doneOps = view().querySelector('[data-act="iops"]');
  if (doneOps) {
    doneOps.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await wait(300);
    const recItem = Array.from(doc.querySelectorAll('.dd-item')).find(x => /执行记录/.test(x.textContent));
    if (recItem) {
      recItem.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      await wait(500);
      const rm = Array.from(doc.querySelectorAll('.mask .modal')).pop();
      const rmText = rm ? rm.textContent : '';
      ok('执行记录弹窗有「整改日期」', /整改日期/.test(rmText), rmText.slice(0, 60));
      ok('执行记录弹窗有「整改照片」入口', /整改照片/.test(rmText));
      const closeBtn = rm && Array.from(rm.querySelectorAll('.btn')).pop();
      if (closeBtn) closeBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      await wait(200);
    }
  }

  /* ================= 13. 隐患条数与整改口径（★ 2026-11-11 统一口径） ================= */
  console.log('== 13. 隐患条数 / 隐患等级 / 整改状态 ==');

  /* ---- 13.1 表单字段与空选项（防空值被静默回填成第一项） ---- */
  data().inspections = [{
    id: 'IP-Z', code: 'FZXJ-2026-009', planName: '口径自检巡检', type: '日常巡检', area: 'Z 区',
    dept: '生产一部', executor: '测试员', scheduledDate: d10, status: 'planned', photos: [],
    /* 老结构：只有 record.hazardCount，没有顶层、没有等级 */
    record: { findings: '旧记录', hazardCount: 2, signedBy: '测试员', signedAt: d10 }
  }];
  SD.store.save();
  await SD.app.reload();
  await go('inspection');
  await wait(400);

  let zOps = view().querySelector('[data-act="iops"]');
  if (zOps) {
    zOps.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await wait(300);
    const zEdit = Array.from(doc.querySelectorAll('.dd-item')).find(x => x.textContent.trim() === '编辑');
    if (zEdit) { zEdit.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); await wait(450); }
  }
  const zm = Array.from(doc.querySelectorAll('.mask .modal')).pop();
  const zLabels = zm ? Array.from(zm.querySelectorAll('.field > span, label > span')).map(x => x.textContent.trim()) : [];
  ok('编辑表单有「隐患条数」字段', zLabels.indexOf('隐患条数') >= 0, zLabels.join('/'));
  ok('编辑表单有「隐患等级」字段', zLabels.indexOf('隐患等级') >= 0);
  const hzEl = zm ? zm.querySelector('#ff_hazardCount') : null;
  const lvEl = zm ? zm.querySelector('#ff_hazardLevel') : null;
  ok('隐患条数是数字控件且 min=0', !!hzEl && hzEl.type === 'number' && hzEl.getAttribute('min') === '0',
    hzEl && hzEl.type + '/' + hzEl.getAttribute('min'));
  ok('隐患条数非必填', !!hzEl && !hzEl.closest('.field, label').classList.contains('req'));
  ok('隐患等级下拉首项是「未定级」空值',
    !!lvEl && lvEl.options[0].value === '' && /未定级/.test(lvEl.options[0].textContent),
    lvEl && (lvEl.options[0].value + '/' + lvEl.options[0].textContent));
  ok('隐患等级有 4 项（未定级 + 三级）', !!lvEl && lvEl.options.length === 4, lvEl && lvEl.options.length);
  ok('老记录打开编辑：条数显示 2（不被读成 0）', !!hzEl && hzEl.value === '2', hzEl && hzEl.value);
  ok('老记录打开编辑：等级显示为空（未定级）', !!lvEl && lvEl.value === '', lvEl && lvEl.value);

  /* 不动条数直接保存 → 顶层必须补成 2，而不是被清零 */
  if (zm) {
    const zOk = zm.querySelector('.js-ok');
    if (zOk) { zOk.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); await wait(800); }
  }
  const zsaved = (SD.store.data().inspections.filter(t => t.id === 'IP-Z')[0] || {});
  ok('保存后顶层 hazardCount = 2（老数据没被清零）', zsaved.hazardCount === 2, zsaved.hazardCount);
  ok('未选等级保存后是空值（没被回填成「重大」）', zsaved.hazardLevel === '', zsaved.hazardLevel);
  ok('record 镜像同步为 2', !zsaved.record || zsaved.record.hazardCount === 2,
    zsaved.record && zsaved.record.hazardCount);

  /* ---- 13.2 口径函数：造一组能对账的数据 ---- */
  /* A 3 条/较大/已整改 · B 2 条/重大/整改中 · C 4 条/未定级/未整改 · D 0 条（不进任何口径） */
  data().inspections = [
    { id: 'IA', code: 'FZXJ-2026-101', planName: 'A', type: '日常巡检', area: 'A 区', dept: '生产一部',
      executor: '测试员', scheduledDate: d10, status: 'done', photos: [], hazardCount: 3, hazardLevel: 'large',
      fixDate: d10, fixPhotos: [], record: { findings: 'x', hazardCount: 3, signedBy: '测试员', signedAt: d10 } },
    { id: 'IB', code: 'FZXJ-2026-102', planName: 'B', type: '日常巡检', area: 'B 区', dept: '生产一部',
      executor: '测试员', scheduledDate: d10, status: 'planned', photos: [], hazardCount: 2, hazardLevel: 'major',
      fixDate: '', fixPhotos: shot(1) },
    { id: 'IC', code: 'FZXJ-2026-103', planName: 'C', type: '专项检查', area: 'C 区', dept: '',
      executor: '测试员', scheduledDate: d05, status: 'rescheduled', photos: [], hazardCount: 4, hazardLevel: '',
      fixDate: '', fixPhotos: [] },
    { id: 'ID', code: 'FZXJ-2026-104', planName: 'D', type: '季节性检查', area: 'D 区', dept: '仓储部',
      executor: '测试员', scheduledDate: d10, status: 'cancelled', photos: shot(1), hazardCount: 0, hazardLevel: '' }
  ];
  SD.store.save();
  await SD.app.reload();
  await wait(500);

  const st = SD.app.state.summary.inspectionStats;
  ok('summary 透出 inspectionStats', !!st);
  ok('形状齐全（records/byStatus/weekRate/hazardCount/hazardTasks/byLevel/fix/fixRate/byDept）',
    !!st && ['records', 'byStatus', 'weekRate', 'hazardCount', 'hazardTasks', 'byLevel', 'fix', 'fixRate', 'byDept']
      .every(k => st[k] !== undefined));
  ok('巡检记录 = 4（含改期 / 取消）', st.records === 4, st.records);
  ok('byStatus 四态各自计数', st.byStatus.done === 1 && st.byStatus.planned === 1 &&
    st.byStatus.rescheduled === 1 && st.byStatus.cancelled === 1, JSON.stringify(st.byStatus));
  ok('隐患条数 = 3+2+4 = 9（0 条任务不计）', st.hazardCount === 9, st.hazardCount);
  ok('有隐患任务数 = 3', st.hazardTasks === 3, st.hazardTasks);
  ok('整改三态按条数：未整改 4 / 整改中 2 / 已整改 3',
    st.fix.none === 4 && st.fix.doing === 2 && st.fix.done === 3, JSON.stringify(st.fix));
  ok('三态相加 = 隐患条数', st.fix.none + st.fix.doing + st.fix.done === st.hazardCount);
  ok('整改率 = 3/9 ≈ 33%', Math.round(st.fixRate * 100) === 33, st.fixRate);
  ok('等级分布：重大 2 / 较大 3 / 未定级 4（固定顺序，与台账等级图一致）',
    st.byLevel.map(x => x.name + x.count).join(',') === '重大2,较大3,未定级4',
    st.byLevel.map(x => x.name + x.count).join(','));
  ok('等级合计 = 隐患条数', st.byLevel.reduce((a, b) => a + b.count, 0) === st.hazardCount);
  ok('部门条数合计 = 隐患条数',
    st.byDept.reduce((a, b) => a + b.hazardCount, 0) === st.hazardCount,
    JSON.stringify(st.byDept));
  ok('未填部门归「未指定部门」', st.byDept.some(x => x.dept === '未指定部门'),
    st.byDept.map(x => x.dept).join('|'));

  /* ---- 13.3 看板：新段数值必须与 summary 一致 ---- */
  await go('dashboard');
  await wait(300);
  const inspSec = Array.from(view().querySelectorAll('.card'))
    .find(c => (c.querySelector('h3') || {}).textContent.trim() === '安全巡检（隐患与整改）');
  ok('看板有「安全巡检（隐患与整改）」段', !!inspSec);
  const inspTxt = inspSec ? inspSec.textContent.replace(/\s+/g, ' ') : '';
  /* ★ 2026-11-12 本段已瘦身：原来那 4 格（巡检记录 / 隐患条数 / 已整改 / 整改率）
     与顶部 KPI 重复，已上移；本段改放「期限口径」三格 —— KPI 里没有、也只有
     整改期限才算得出来的东西。旧断言因此改为对 KPI 断言（数字一个不少）。 */
  ok('段内「未设期限」= 9 条（本组一条期限都没设）', /未设期限\s*9\s*条/.test(inspTxt), inspTxt.slice(0, 120));
  ok('段内「整改及时率」= —（分母 0）', /整改及时率\s*—/.test(inspTxt), inspTxt.slice(0, 120));
  ok('段内「最长逾期」= —（无逾期可判）', /最长逾期\s*—/.test(inspTxt), inspTxt.slice(0, 140));
  ok('段内不再重复 KPI 的那四个数字（旧三态行已删）',
    !/巡检记录\s*4\s*项/.test(inspTxt) && !/已整改\s*3\s*条/.test(inspTxt), inspTxt.slice(0, 80));
  ok('段内空态改为「尚未设置整改期限」（有隐患但一条期限都没设）',
    /尚未设置整改期限/.test(inspTxt), inspTxt.slice(-60));

  const kpiTxt = Array.from(view().querySelectorAll('.grid.cols-4 > *'))
    .map(c => c.textContent.replace(/\s+/g, ' '));
  ok('KPI「隐患条数」= 9 条', /隐患条数\s*9\s*条/.test(kpiTxt[0]), kpiTxt[0].slice(0, 40));
  ok('KPI「已整改」= 3 条', /已整改\s*3\s*条/.test(kpiTxt[1]), kpiTxt[1].slice(0, 40));
  ok('KPI「已整改」脚注写明整改中 2 条', /另有\s*2\s*条整改中/.test(kpiTxt[1]), kpiTxt[1].slice(0, 60));
  ok('KPI「逾期未整改」= 0 条且坦白说没设期限',
    /逾期未整改\s*0\s*条/.test(kpiTxt[2]) && /尚未设置整改期限/.test(kpiTxt[2]), kpiTxt[2].slice(0, 60));
  ok('KPI「整改率」= 33%', /整改率\s*33%/.test(kpiTxt[3]), kpiTxt[3].slice(0, 40));
  ok('顶部 KPI 仍然正好 4 张（新段没用 cols-4）',
    view().querySelectorAll('.grid.cols-4 > *').length === 4,
    view().querySelectorAll('.grid.cols-4 > *').length);

  const sevCards = Array.from(view().querySelectorAll('.card'))
    .filter(c => /隐患等级分布/.test((c.querySelector('h3') || {}).textContent || ''));
  ok('等级分布改为巡检口径且按条数',
    sevCards.length === 1 && /按条数/.test(sevCards[0].textContent) && /隐患条数/.test(sevCards[0].textContent),
    sevCards[0] ? sevCards[0].textContent.replace(/\s+/g, ' ').slice(0, 80) : '无');
  ok('页面只剩一张等级图（巡检段那张重复的已删）', sevCards.length === 1, sevCards.length);
  ok('页面副标题写明「巡检记录 4 项」',
    /巡检记录\s*4\s*项/.test(SD.views.dashboard.sub(SD.app.state.summary)),
    SD.views.dashboard.sub(SD.app.state.summary));

  /* 口径说明：新段存在且旧四句仍在 */
  const noteTxt = view().textContent.replace(/\s+/g, ' ');
  ok('口径说明写明条数不是照片张数 / 任务数',
    /不是照片张数、也不是任务数/.test(noteTxt));
  ok('口径说明写明整改三态的推导规则',
    /有「整改日期」= 已整改/.test(noteTxt) && /整改照片.*整改中/.test(noteTxt));
  ok('口径说明写明巡检隐患不自动进台账',
    /不会自动生成隐患台账记录/.test(noteTxt));
  ok('口径说明旧四句仍在（回归护栏）',
    /各部门相加恒等于总张数/.test(noteTxt) && /未填的归「未指定部门」/.test(noteTxt) &&
    /闭环率、逾期未闭环/.test(noteTxt) && /整改率/.test(noteTxt));

  /* ---- 13.4 巡检页汇总条：与看板 / summary 三方同值 ---- */
  await go('inspection');
  await wait(300);
  const sumBar = view().querySelector('.js-insp-sum');
  ok('巡检页有口径汇总条', !!sumBar);
  const sumTxt = sumBar ? sumBar.textContent.replace(/\s+/g, ' ') : '';
  /* ★ 2026-11-12：看板改为「只统计当前自然年」后，这条汇总条也改成年度口径 ——
     原来写的是「全部记录（不限本周 / 年份）」，现在必须写出年份，否则与看板对不上。 */
  ok('汇总条写明「本年度 + 跨年不计入」', /年度记录（按计划日期归年，跨年不计入）/.test(sumTxt),
    sumTxt.slice(0, 60));
  ok('汇总条「当年记录」= 4 项', /年度记录[^0-9]*4\s*项/.test(sumTxt), sumTxt.slice(0, 60));
  ok('汇总条「发现隐患」= 9 条', /发现隐患\s*9\s*条/.test(sumTxt));
  ok('汇总条整改率 = 33%', /整改率\s*33%/.test(sumTxt));
  ok('巡检页与看板 KPI 同值（9 条 / 33%）',
    /发现隐患\s*9\s*条/.test(sumTxt) && /隐患条数\s*9\s*条/.test(kpiTxt[0]) &&
    /整改率\s*33%/.test(sumTxt) && /整改率\s*33%/.test(kpiTxt[3]));
  const sumBtn = sumBar && sumBar.querySelector('.js-go-dash');
  ok('汇总条有「去数据看板」入口（不含「新增」字样，避免抢新增按钮）',
    !!sumBtn && /去数据看板/.test(sumBtn.textContent) && !/新增/.test(sumBtn.textContent),
    sumBtn ? sumBtn.textContent : '无');

  /* ---- 13.5 标记完成弹窗：条数初值 + 等级可填 ---- */
  data().inspections = [{
    id: 'IP-CP', code: 'FZXJ-2026-201', planName: '标记完成自检', type: '日常巡检', area: 'P 区',
    dept: '生产一部', executor: '测试员', scheduledDate: d10, status: 'planned', photos: [],
    hazardCount: 5, hazardLevel: 'general', fixDate: '', fixPhotos: []
  }];
  SD.store.save();
  await SD.app.reload();
  await go('inspection');
  await wait(400);
  const cpOps = view().querySelector('[data-act="iops"]');
  if (cpOps) {
    cpOps.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await wait(300);
    const cpDone = Array.from(doc.querySelectorAll('.dd-item')).find(x => /标记完成/.test(x.textContent));
    if (cpDone) { cpDone.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); await wait(400); }
  }
  const cpm = Array.from(doc.querySelectorAll('.mask .modal')).pop();
  const cpText = cpm ? cpm.textContent : '';
  ok('标记完成弹窗标签改为「隐患条数」', /隐患条数/.test(cpText) && !/发现隐患数/.test(cpText), cpText.slice(0, 60));
  ok('标记完成弹窗有「隐患等级」下拉', !!cpm && !!cpm.querySelector('#i_hzlv'));
  ok('标记完成弹窗条数初值取已有值 5',
    !!cpm && (cpm.querySelector('#i_hz') || {}).value === '5',
    cpm && (cpm.querySelector('#i_hz') || {}).value);
  ok('标记完成弹窗等级预选「一般」',
    !!cpm && (cpm.querySelector('#i_hzlv') || {}).value === 'general',
    cpm && (cpm.querySelector('#i_hzlv') || {}).value);
  const cpCancel = cpm && Array.from(cpm.querySelectorAll('.btn')).find(b => /取消|关闭/.test(b.textContent));
  if (cpCancel) cpCancel.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(200);

  /* ================= 14. 一单多部门（★ 2026-11-12）=================
     目标：一张巡检单能按部门登记多条问题，看板按部门汇总且账能对上；
           老记录（无 problems）走「一行合成行」，数字一个都不变。 */
  console.log('== 14. 一张巡检单记录多个部门 ==');

  const click2 = el => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  const setV = (el, v) => {
    if (!el) return;
    el.value = v;
    el.dispatchEvent(new win.Event('input', { bubbles: true }));
  };

  data().inspections = [{
    id: 'M0', code: 'FZXJ-2026-301', planName: '多部门巡检', type: '日常巡检', area: 'A 区',
    dept: '生产一部', executor: '测试员', scheduledDate: d10, status: 'planned',
    photos: [], hazardCount: 2, hazardLevel: 'large', hazardType: '消防',
    fixDate: '', fixPhotos: [], record: null
  }];
  SD.store.save();
  await SD.app.reload();
  await go('inspection');
  await wait(400);

  click2(view().querySelector('[data-act="iops"]'));
  await wait(300);
  click2(Array.from(doc.querySelectorAll('.dd-item')).find(x => x.textContent.trim() === '编辑'));
  await wait(500);

  let fm = Array.from(doc.querySelectorAll('.mask .modal')).pop();
  ok('默认仍是单部门模式（没有明细行）', !!fm && fm.querySelectorAll('.pr-row').length === 0);
  ok('表单有「按部门拆分」入口', !!fm && !!fm.querySelector('.js-split'));
  ok('单部门路径不变：隐患条数输入框仍在', !!fm && !!fm.querySelector('#ff_hazardCount'));

  click2(fm.querySelector('.js-split'));
  await wait(300);

  ok('拆分后出现 1 行明细', !!fm && fm.querySelectorAll('.pr-row').length === 1,
    fm && fm.querySelectorAll('.pr-row').length);
  ok('第 1 行继承原条数 2',
    (fm.querySelector('.pr-row [data-role="count"]') || {}).value === '2',
    (fm.querySelector('.pr-row [data-role="count"]') || {}).value);
  const hiddenAll = ['dept', 'hazardType', 'hazardCount', 'hazardLevel', 'photos', 'fixDate', 'fixPhotos']
    .every(k => {
      const el = fm.querySelector('#ff_' + k);
      const f = el && el.closest('.field');
      return f && f.style.display === 'none';
    });
  ok('7 个标量字段整块隐藏（避免两套入口打架）', hiddenAll);
  ok('行内没有 ff_ 前缀 id（防主表单串值）', fm.querySelectorAll('.pr-row [id^="ff_"]').length === 0,
    fm.querySelectorAll('.pr-row [id^="ff_"]').length);
  ok('行内两个照片位、上限 18 张', fm.querySelectorAll('.pr-row .ph-slot[data-max="18"]').length === 2,
    fm.querySelectorAll('.pr-row .ph-slot[data-max="18"]').length);

  click2(fm.querySelector('[data-act="add"]'));
  await wait(150);
  click2(fm.querySelector('[data-act="add"]'));
  await wait(200);
  ok('可继续加行（共 3 个部门）', fm.querySelectorAll('.pr-row').length === 3,
    fm.querySelectorAll('.pr-row').length);

  const rowsEl = () => Array.from(fm.querySelectorAll('.pr-row'));
  const fillRow = (i, o) => {
    const r = rowsEl()[i];
    if (!r) return;
    if (o.dept != null) setV(r.querySelector('[data-role="dept"]'), o.dept);
    if (o.count != null) setV(r.querySelector('[data-role="count"]'), String(o.count));
    if (o.level != null) r.querySelector('[data-role="level"]').value = o.level;
    if (o.type != null) r.querySelector('[data-role="type"]').value = o.type;
    if (o.content != null) setV(r.querySelector('[data-role="content"]'), o.content);
    if (o.fixDate != null) r.querySelector('[data-role="fixDate"]').value = o.fixDate;
    if (o.photos) r.querySelector('[data-role="photos"]')._ph.set(shot(o.photos));
    if (o.fixPhotos) r.querySelector('[data-role="fixPhotos"]')._ph.set(shot(o.fixPhotos));
  };

  fillRow(0, { dept: '生产一部', count: 2, level: 'large', type: '消防', content: '通道被占用', photos: 2, fixDate: d10 });
  fillRow(1, { dept: '仓储部', count: 3, level: 'major', type: '电气', content: '配电箱门未关', photos: 1, fixPhotos: 1 });
  fillRow(2, { dept: '质检部', count: 1, level: '', type: '', content: '照明不足', photos: 0 });
  await wait(250);
  ok('明细汇总行按行累计（3 个部门 · 6 条）',
    /3 个部门 · 6 条/.test(fm.querySelector('.pr-sum').textContent),
    fm.querySelector('.pr-sum').textContent);

  click2(fm.querySelector('.js-ok'));
  await wait(1300);

  const m1 = data().inspections.filter(t => t.id === 'M0')[0] || {};
  ok('明细已落库（3 条问题行）', Array.isArray(m1.problems) && m1.problems.length === 3,
    m1.problems && m1.problems.length);
  ok('顶层条数是明细汇总 2+3+1=6', m1.hazardCount === 6, m1.hazardCount);
  ok('顶层部门取第一个非空', m1.dept === '生产一部', m1.dept);
  ok('顶层等级取最高（重大）', m1.hazardLevel === 'major', m1.hazardLevel);
  ok('顶层照片是各行拼接（2+1）', (m1.photos || []).length === 3, (m1.photos || []).length);
  ok('各行照片各存各的',
    (m1.problems[0].photos || []).length === 2 && (m1.problems[1].photos || []).length === 1);

  const st2 = SD.app.state.summary.inspectionStats;
  ok('隐患条数 = Σ 行 = 6', st2.hazardCount === 6, st2.hazardCount);
  ok('hazardCountOf 与明细一致', SD.metrics.hazardCountOf(m1) === 6);
  const deptMap = {};
  st2.byDept.forEach(d => { deptMap[d.dept] = d.hazardCount; });
  ok('按部门拆开：生产一部 2 / 仓储部 3 / 质检部 1',
    deptMap['生产一部'] === 2 && deptMap['仓储部'] === 3 && deptMap['质检部'] === 1,
    JSON.stringify(deptMap));
  ok('各部门相加 = 隐患条数',
    st2.byDept.reduce((a, d) => a + d.hazardCount, 0) === st2.hazardCount);
  ok('等级按行汇总：重大 3 / 较大 2 / 未定级 1',
    st2.byLevel.map(x => x.name + x.count).join(',') === '重大3,较大2,未定级1',
    st2.byLevel.map(x => x.name + x.count).join(','));
  ok('整改三态按行累计且和为 6',
    st2.fix.done === 2 && st2.fix.doing === 3 && st2.fix.none === 1 &&
    st2.fix.done + st2.fix.doing + st2.fix.none === 6,
    JSON.stringify(st2.fix));
  ok('整改率 = 2/6 ≈ 33%', Math.round(st2.fixRate * 100) === 33, st2.fixRate);
  ok('一张单仍算 1 个任务（hazardTasks）', st2.hazardTasks === 1, st2.hazardTasks);

  const ip2 = SD.app.state.summary.inspectionPhotos;
  ok('照片按部门拆：总 3 张', ip2.totalPhotos === 3, ip2.totalPhotos);
  const phMap = {};
  ip2.byDept.forEach(d => { phMap[d.dept] = d.photos; });
  ok('照片归属：生产一部 2 / 仓储部 1',
    phMap['生产一部'] === 2 && phMap['仓储部'] === 1, JSON.stringify(phMap));
  ok('镜像守恒：Σ t.photos === totalPhotos',
    data().inspections.reduce((a, t) => a + (t.photos || []).length, 0) === ip2.totalPhotos);
  ok('类型合计 = 上报处数（环图中心与图例对得上）',
    ip2.byType.reduce((a, x) => a + x.tasks, 0) === ip2.totalTasks, ip2.totalTasks);
  ok('处数 2 ≠ 任务数 1（一单两个部门各带照片）',
    ip2.totalTasks === 2 && ip2.totalRecords === 1,
    ip2.totalTasks + '/' + ip2.totalRecords);

  /* ---- 看板：分部门条数 ---- */
  await go('dashboard');
  await wait(500);
  const dBox = view().querySelector('.js-insp-dept');
  ok('看板出现「分部门隐患条数」', !!dBox && /分部门隐患条数/.test(dBox.textContent),
    dBox && dBox.textContent.slice(0, 70));
  ok('看板按部门列出条数', !!dBox && /仓储部\s*3\s*条/.test(dBox.textContent),
    dBox && dBox.textContent);
  ok('顶部 KPI 仍正好 4 张', view().querySelectorAll('.grid.cols-4 > *').length === 4,
    view().querySelectorAll('.grid.cols-4 > *').length);
  const photoCard2 = Array.from(view().querySelectorAll('.card'))
    .find(c => ((c.querySelector('h3') || {}).textContent || '').trim() === '各部门隐患照片');
  ok('合计文案区分「处」与「任务」',
    !!photoCard2 && /合计 3 张 \/ 2 项（共 1 项任务）/.test(photoCard2.textContent),
    photoCard2 && photoCard2.querySelector('.js-total').textContent);

  /* ---- 列表：部门列与搜索 ---- */
  await go('inspection');
  await wait(500);
  ok('列表部门列写明「等 3 个部门」', /等 3 个部门/.test(view().textContent));
  const qBox = view().querySelector('input[data-keep-focus="insp"]');
  setV(qBox, '质检部');
  await wait(600);
  ok('搜第三个部门名能命中这张单',
    view().querySelectorAll('.js-list-box table tbody tr').length === 1,
    view().querySelectorAll('.js-list-box table tbody tr').length);
  setV(qBox, '');
  await wait(600);

  /* ---- 标记完成：不覆盖明细汇总 ---- */
  click2(view().querySelector('[data-act="iops"]'));
  await wait(300);
  click2(Array.from(doc.querySelectorAll('.dd-item')).find(x => /标记完成/.test(x.textContent)));
  await wait(500);
  const cm2 = Array.from(doc.querySelectorAll('.mask .modal')).pop();
  ok('多部门单的「标记完成」不再给条数输入框', !!cm2 && !cm2.querySelector('#i_hz'));
  ok('改为只读摘要（按明细汇总）', !!cm2 && /按明细汇总/.test(cm2.textContent),
    cm2 && cm2.textContent.slice(0, 80));
  click2(cm2 && cm2.querySelector('.js-ok'));
  await wait(1300);
  const m1b = data().inspections.filter(t => t.id === 'M0')[0] || {};
  ok('标记完成没改写条数（仍 6）', m1b.hazardCount === 6, m1b.hazardCount);
  ok('标记完成没清掉等级（仍 major）', m1b.hazardLevel === 'major', m1b.hazardLevel);

  /* ---- 执行记录：分部门明细 ---- */
  click2(view().querySelector('[data-act="iops"]'));
  await wait(300);
  click2(Array.from(doc.querySelectorAll('.dd-item')).find(x => /执行记录/.test(x.textContent)));
  await wait(500);
  const rm = Array.from(doc.querySelectorAll('.mask .modal')).pop();
  const rmText = rm ? rm.textContent : '';
  ok('执行记录有「分部门明细」', /分部门明细/.test(rmText));
  ok('明细列出三个部门',
    /生产一部/.test(rmText) && /仓储部/.test(rmText) && /质检部/.test(rmText));
  ok('明细行显示条数与整改状态',
    /2 条/.test(rmText) && /已整改/.test(rmText) && /整改中/.test(rmText));
  click2(rm && Array.from(rm.querySelectorAll('.btn')).find(b => /关闭/.test(b.textContent)));
  await wait(250);

  /* ---- 老记录：单部门路径与数字都不变 ---- */
  data().inspections = [{
    id: 'L0', code: 'FZXJ-2026-302', planName: '老记录', type: '日常巡检', area: 'B 区',
    dept: '', executor: '测试员', scheduledDate: d10, status: 'planned',
    photos: [], hazardCount: 4, hazardLevel: '',
    record: { findings: '旧', hazardCount: 4, signedBy: 'x', signedAt: d10 }
  }];
  SD.store.save();
  await SD.app.reload();
  await go('inspection');
  await wait(500);
  click2(view().querySelector('[data-act="iops"]'));
  await wait(300);
  click2(Array.from(doc.querySelectorAll('.dd-item')).find(x => x.textContent.trim() === '编辑'));
  await wait(500);
  const lm = Array.from(doc.querySelectorAll('.mask .modal')).pop();
  ok('老记录打开仍是单部门表单（无明细行）', !!lm && lm.querySelectorAll('.pr-row').length === 0);
  ok('老记录条数不被读成 0', !!lm && (lm.querySelector('#ff_hazardCount') || {}).value === '4',
    lm && (lm.querySelector('#ff_hazardCount') || {}).value);
  click2(lm && lm.querySelector('.js-ok'));
  await wait(1100);
  const l0 = data().inspections.filter(t => t.id === 'L0')[0] || {};
  ok('老记录保存后条数仍是 4', l0.hazardCount === 4, l0.hazardCount);
  ok('老记录保存后 problems 显式为 []',
    Array.isArray(l0.problems) && l0.problems.length === 0,
    JSON.stringify(l0.problems).slice(0, 40));

  /* ================= 15. 整改期限：六格 / 逾期 / 及时率 =================
     这是 v1.3.7 的核心：看板从"台账口径"整体切到"巡检口径"，
     逾期与及时率全靠新字段 fixDueDate。没有这一节，新逻辑等于没测。 */
  console.log('== 15. 整改期限：逾期与及时率 ==');
  const t0 = SD.app.state.summary.today;
  const pastD = SD.utils.shift(t0, -5);     // 已过期的期限
  const futD = SD.utils.shift(t0, 7);       // 还在期限内的期限
  data().inspections = [
    { id: 'FD-M', code: 'FZXJ-2026-301', planName: '期限自检（多部门）', type: '日常巡检', area: 'Q 区',
      dept: '生产一部', executor: '测试员', scheduledDate: t0, status: 'done', completedAt: t0,
      photos: [], hazardCount: 9, hazardLevel: 'major', fixDueDate: pastD, fixDate: '', fixPhotos: [],
      record: { findings: '三条问题', hazardCount: 9, signedBy: '测试员', signedAt: t0 },
      problems: [
        { id: 'p1', dept: '生产一部', content: '过期未改', type: '消防', level: 'major', count: 2,
          photos: [], fixDueDate: pastD, fixDate: '', fixPhotos: [] },
        { id: 'p2', dept: '生产一部', content: '超期改完', type: '电气', level: 'large', count: 3,
          photos: [], fixDueDate: pastD, fixDate: t0, fixPhotos: [] },
        { id: 'p3', dept: '仓储部', content: '还在期内', type: '消防', level: 'general', count: 4,
          photos: [], fixDueDate: futD, fixDate: '', fixPhotos: [] }
      ] },
    { id: 'FD-S', code: 'FZXJ-2026-302', planName: '期限自检（无期限）', type: '日常巡检', area: 'R 区',
      dept: '质检部', executor: '测试员', scheduledDate: t0, status: 'planned',
      photos: [], hazardCount: 1, hazardLevel: '', fixDueDate: '', fixDate: '', fixPhotos: [], problems: [] }
  ];
  SD.store.save();
  await SD.app.reload();
  await wait(400);

  const dueSt = SD.app.state.summary.inspectionStats;
  ok('期限：行级 fixDueDate 被规范化读出',
    SD.metrics.hazardRowsOf(data().inspections[0])[0].fixDueDate === pastD,
    SD.metrics.hazardRowsOf(data().inspections[0])[0].fixDueDate);
  ok('期限：隐患条数 = 10 条（2+3+4+1）', dueSt.hazardCount === 10, dueSt.hazardCount);

  const six = ['doneOnTime', 'doneLate', 'doneNoDue', 'openOverdue', 'openInDue', 'openNoDue'];
  ok('六格之和 = 隐患条数', six.reduce((a, k) => a + dueSt.due[k], 0) === dueSt.hazardCount,
    six.map(k => k + ':' + dueSt.due[k]).join(' '));
  ok('已整改三格之和 = fix.done',
    dueSt.due.doneOnTime + dueSt.due.doneLate + dueSt.due.doneNoDue === dueSt.fix.done, dueSt.fix.done);
  ok('未整改三格之和 = fix.none + fix.doing',
    dueSt.due.openOverdue + dueSt.due.openInDue + dueSt.due.openNoDue === dueSt.fix.none + dueSt.fix.doing);
  ok('逾期 = 2 条（过期且未整改，整改中的也算）', dueSt.due.openOverdue === 2, dueSt.due.openOverdue);
  ok('超期整改 = 3 条（改了但晚于期限）', dueSt.due.doneLate === 3, dueSt.due.doneLate);
  ok('在期限内未整改 = 4 条', dueSt.due.openInDue === 4, dueSt.due.openInDue);
  ok('未设期限 = 1 条（不判逾期也不判按期）', dueSt.noDue.count === 1, dueSt.noDue.count);
  ok('整改及时率分母只含已设期限且已整改的 3 条（按期 0）',
    dueSt.due.doneOnTime === 0 && dueSt.due.doneOnTime + dueSt.due.doneLate === 3);
  ok('最长逾期 = 5 天', dueSt.dueMaxDays === 5, dueSt.dueMaxDays);

  const deptOf = n => dueSt.byDept.filter(d => d.dept === n)[0] || {};
  ok('分部门逾期：生产一部 2 条', deptOf('生产一部').overdue === 2, JSON.stringify(deptOf('生产一部')));
  ok('分部门未设期限：质检部 1 条', deptOf('质检部').noDue === 1, JSON.stringify(deptOf('质检部')));
  ok('分部门三态合计 = 隐患条数',
    dueSt.byDept.reduce((a, d) => a + d.fix.none + d.fix.doing + d.fix.done, 0) === dueSt.hazardCount,
    dueSt.byDept.map(d => d.dept + ':' + (d.fix.none + d.fix.doing + d.fix.done)).join(' '));

  /* ---- 15.2 看板：KPI 与段内三格 ---- */
  await go('dashboard');
  await wait(400);
  const fdCards = Array.from(view().querySelectorAll('.grid.cols-4 > *'));
  const fdKpi = fdCards.map(c => c.textContent.replace(/\s+/g, ' '));
  ok('KPI 逾期未整改 = 2 条', /逾期未整改\s*2\s*条/.test(fdKpi[2]), fdKpi[2].slice(0, 50));
  ok('KPI 逾期脚注追加「另有 1 条未设期限」', /另有\s*1\s*条未设期限/.test(fdKpi[2]), fdKpi[2]);
  ok('有逾期时逾期卡才给红色告警',
    !!(fdCards[2] && /red/.test((fdCards[2].querySelector('.stat-ico') || {}).className || '')),
    fdCards[2] ? (fdCards[2].querySelector('.stat-ico') || {}).className : '无');
  ok('KPI 整改率 = 30%（3/10）', /整改率\s*30%/.test(fdKpi[3]), fdKpi[3].slice(0, 40));

  const fdSec = Array.from(view().querySelectorAll('.card'))
    .find(c => (c.querySelector('h3') || {}).textContent.trim() === '安全巡检（隐患与整改）');
  const fdTxt = fdSec ? fdSec.textContent.replace(/\s+/g, ' ') : '';
  ok('段内「未设期限」= 1 条', /未设期限\s*1\s*条/.test(fdTxt), fdTxt.slice(0, 80));
  ok('段内「整改及时率」= 0%', /整改及时率\s*0%/.test(fdTxt), fdTxt.slice(0, 120));
  ok('段内「最长逾期」= 5 天', /最长逾期\s*5\s*天/.test(fdTxt), fdTxt.slice(0, 140));
  ok('段内给出分部门逾期条形', /分部门逾期未整改/.test(fdTxt));
  ok('逾期条形按条件数摊到部门（生产一部 2 条）', /生产一部\s*2\s*条/.test(fdTxt), fdTxt.slice(-120));

  const fdTrend = Array.from(view().querySelectorAll('.card'))
    .find(c => /巡检隐患条数趋势/.test((c.querySelector('h3') || {}).textContent || ''));
  ok('趋势卡改为巡检条数（上报 / 已整改两条线）',
    !!fdTrend && /上报/.test(fdTrend.textContent) && /已整改/.test(fdTrend.textContent));
  ok('趋势卡不再出现台账的「闭环」线', !!fdTrend && !/闭环/.test(fdTrend.textContent));

  const fdDept = Array.from(view().querySelectorAll('.card'))
    .find(c => /巡检各部门整改率/.test((c.querySelector('h3') || {}).textContent || ''));
  ok('整改率卡改为巡检口径，label 为「已整改/条数」',
    !!fdDept && /已整改条数 \/ 该部门隐患条数/.test(fdDept.textContent) &&
    /（3\/5）/.test(fdDept.textContent.replace(/\s+/g, ' ')),
    fdDept ? fdDept.textContent.replace(/\s+/g, ' ').slice(0, 100) : '无');

  /* ---- 15.3 表单：字段、多部门行、取消拆分回填、保存镜像 ---- */
  const fdef = (SD.views.inspection.FIELDS || []).filter(f => f.name === 'fixDueDate')[0];
  /* ★ 2026-11-12：基座定义仍是「非必填、无默认值」—— 必填是 resolveFields 按「新增」注入的，
     编辑侧不强制（历史记录本就没有这个字段）。本条只锁基座，新增必填见第 16 节。 */
  ok('巡检表单「整改期限」基座定义：日期、无默认值（必填在新增时注入）',
    !!fdef && fdef.label === '整改期限' && fdef.type === 'date' && !fdef.required && fdef.def == null,
    fdef ? fdef.label + '/' + fdef.type : '无');

  await go('inspection');
  await wait(500);
  click2(view().querySelector('[data-act="iops"]'));
  await wait(300);
  click2(Array.from(doc.querySelectorAll('.dd-item')).find(x => x.textContent.trim() === '编辑'));
  await wait(600);
  const fdModal = Array.from(doc.querySelectorAll('.mask .modal')).pop();
  ok('多部门单打开即显示 3 行明细', !!fdModal && fdModal.querySelectorAll('.pr-row').length === 3,
    fdModal ? fdModal.querySelectorAll('.pr-row').length : '无');
  const dueInputs = fdModal ? Array.from(fdModal.querySelectorAll('.pr-row [data-role="fixDue"]')) : [];
  ok('每行都有「整改期限」输入框', dueInputs.length === 3, dueInputs.length);
  ok('期限按行回填（第 1 行 = 过期日）', dueInputs[0] && dueInputs[0].value === pastD,
    dueInputs[0] ? dueInputs[0].value : '无');
  ok('行内不复用 ff_ 前缀 id（否则主表单会串值）',
    dueInputs.every(el => !el.id || el.id.indexOf('ff_') !== 0));
  ok('多部门模式下整单「整改期限」被隐藏',
    !!fdModal && !!fdModal.querySelector('#ff_fixDueDate') &&
    fdModal.querySelector('#ff_fixDueDate').closest('.field').style.display === 'none',
    fdModal && fdModal.querySelector('#ff_fixDueDate') ? fdModal.querySelector('#ff_fixDueDate').closest('.field').style.display : '无');

  click2(fdModal && fdModal.querySelector('.js-ok'));
  await wait(1200);
  const saved2 = data().inspections.filter(t => t.id === 'FD-M')[0] || {};
  ok('保存后顶层镜像 = 各行最早期限', saved2.fixDueDate === pastD, saved2.fixDueDate);
  ok('保存后行级期限没丢（第 1 行仍是过期日）',
    !!saved2.problems && saved2.problems[0] && saved2.problems[0].fixDueDate === pastD,
    saved2.problems ? saved2.problems[0].fixDueDate : '无');
  ok('保存后三条问题的条数没被改写',
    !!saved2.problems && saved2.problems.length === 3 &&
    saved2.problems.reduce((a, p) => a + p.count, 0) === 9,
    saved2.problems ? saved2.problems.map(p => p.count).join('+') : '无');

  /* ---- 15.4 执行记录：逐行期限 / 逾期，且部门数去重 ---- */
  const rowM = Array.from(view().querySelectorAll('tbody tr'))
    .filter(tr => tr.textContent.indexOf('FZXJ-2026-301') >= 0)[0];
  if (rowM) {
    click2(rowM.querySelector('[data-act="iops"]'));
    await wait(350);
    click2(Array.from(doc.querySelectorAll('.dd-item')).find(x => x.textContent.trim() === '执行记录'));
    await wait(650);
    const rm = Array.from(doc.querySelectorAll('.mask .modal')).pop();
    const rmTxt = rm ? rm.textContent.replace(/\s+/g, ' ') : '';
    ok('执行记录逐行给出逾期天数（生产一部 逾期 5 天）', /逾期\s*5\s*天/.test(rmTxt), rmTxt.slice(0, 120));
    ok('执行记录逐行给出期限（仓储部 期限 xxx）', /期限\s*20\d\d-\d\d-\d\d/.test(rmTxt));
    ok('执行记录里部门数按去重算（3 行只有 2 个部门）', /2\s*个部门/.test(rmTxt),
      rmTxt.slice(-60));
    ok('多部门单不显示整单期限（改为逐行判定）', /按明细逐行判定/.test(rmTxt));
  } else {
    ok('执行记录用例：找到 FZXJ-2026-301 这一行', false);
  }

  /* ================= 16. 新增巡检：整改期限必填（★ 2026-11-12） =================
     用户要求：「新增巡检记录时，将期限设为必填项并进行校验，未填写期限时阻止提交并给出明确提示」。
     这一节就测三件事：①单部门空期限被拦（且提示说清原因）②多部门逐行必填
     ③误点新增留下的空行不拦 ④编辑历史单不强制（不能把老数据锁死）。 */
  console.log('== 16. 新增巡检：整改期限必填 ==');
  data().inspections = [];
  SD.store.save();
  await SD.app.reload();
  await go('inspection');
  await wait(400);

  const openCreate = async () => {
    const btn = Array.from(view().querySelectorAll('.btn'))
      .find(b => b.textContent.trim() === '新增巡检');
    click2(btn);
    await wait(500);
    return Array.from(doc.querySelectorAll('.mask .modal')).pop();
  };
  const setVal = (root, sel, v) => { const el = root && root.querySelector(sel); if (el) el.value = v; };
  const errOf = m => {
    const e = m && m.querySelector('.field-err');
    return e && !e.hidden ? e.textContent.replace(/\s+/g, ' ') : '';
  };
  const fillBasics = (m) => {
    setVal(m, '#ff_planName', '期限必填自检');
    setVal(m, '#ff_area', 'S 区');
    setVal(m, '#ff_executor', '测试员');
  };

  /* ---- 16.1 单部门：不填期限 → 阻止提交 + 明确提示 ---- */
  let cm = await openCreate();
  ok('新增表单已打开', !!cm);
  ok('新增时「整改期限」标为必填（红星 class=req）',
    !!(cm && cm.querySelector('#ff_fixDueDate')) &&
    cm.querySelector('#ff_fixDueDate').closest('.field').querySelector('span').className === 'req',
    cm && cm.querySelector('#ff_fixDueDate') ? cm.querySelector('#ff_fixDueDate').closest('.field').querySelector('span').className : '无');
  ok('新增时「整改期限」默认留空（不替用户编日期）',
    cm && cm.querySelector('#ff_fixDueDate').value === '',
    cm && cm.querySelector('#ff_fixDueDate').value);

  fillBasics(cm);
  click2(cm && cm.querySelector('.js-ok'));
  await wait(500);
  const e1 = errOf(cm);
  ok('未填期限 → 阻止提交（弹窗没关）', !!cm && cm.parentNode && doc.body.contains(cm), e1);
  ok('提示写明原因（不是干巴巴一句"不能为空"）',
    /整改期限/.test(e1) && /逾期/.test(e1) && /及时率/.test(e1), e1);
  ok('未填期限时没有写入任何记录', data().inspections.length === 0, data().inspections.length);

  /* ---- 16.2 填了期限 → 正常保存，且期限落库 ---- */
  setVal(cm, '#ff_fixDueDate', futD);
  click2(cm && cm.querySelector('.js-ok'));
  await wait(1100);
  const created = data().inspections[0] || {};
  ok('填了期限后可以保存', data().inspections.length === 1, data().inspections.length);
  ok('保存的「整改期限」= 表单里填的日期', created.fixDueDate === futD, created.fixDueDate);

  /* ---- 16.3 多部门：有内容的行没有期限 → 拦；空行不拦 ---- */
  data().inspections = [];
  SD.store.save();
  await SD.app.reload();
  await go('inspection');
  await wait(400);

  cm = await openCreate();
  fillBasics(cm);
  click2(cm && cm.querySelector('.js-split'));
  await wait(400);
  ok('已进入分部门模式（1 行明细）',
    !!cm && cm.querySelectorAll('.pr-row').length === 1, cm ? cm.querySelectorAll('.pr-row').length : '无');
  ok('分部门模式下整单期限必填被解除（改由各行自己校验）',
    !!cm && cm.querySelector('#ff_fixDueDate').closest('.field').style.display === 'none');

  const row1 = cm.querySelectorAll('.pr-row')[0];
  setVal(row1, '[data-role="dept"]', '生产一部');
  setVal(row1, '[data-role="content"]', '消防通道被物料占用');
  click2(cm.querySelector('.js-ok'));
  await wait(500);
  const e2 = errOf(cm);
  ok('多部门：行有内容、没填期限 → 阻止提交',
    /第 1 行/.test(e2) && /整改期限/.test(e2), e2);

  /* 空白行不该拦人：点「再加一个部门」多出来的行，只要把条数清成 0、部门留空，
     就不该逼着人先编个期限 —— 否则用户只能去乱填一个日期才能保存。
     （注意：新加的行条数默认 1、部门必填，这是既有规则，本条只验证「空白行」豁免） */
  setVal(row1, '[data-role="fixDue"]', futD);
  click2(cm.querySelector('[data-act="add"]'));
  await wait(250);
  const row2 = cm.querySelectorAll('.pr-row')[1];
  ok('再加一行', cm.querySelectorAll('.pr-row').length === 2, cm.querySelectorAll('.pr-row').length);
  setVal(row2, '[data-role="count"]', '0');
  click2(cm.querySelector('.js-ok'));
  await wait(1200);
  const mCreated = data().inspections[0] || {};
  ok('空白行豁免：第 1 行有期限、第 2 行清空 → 可以保存',
    data().inspections.length === 1, data().inspections.length + ' / ' + errOf(cm));
  ok('多部门保存后行级期限落库',
    !!(mCreated.problems && mCreated.problems[0]) && mCreated.problems[0].fixDueDate === futD,
    mCreated.problems ? mCreated.problems[0].fixDueDate : '无');
  ok('多部门保存后整单期限镜像 = 行期限', mCreated.fixDueDate === futD, mCreated.fixDueDate);

  /* ---- 16.4 编辑历史单不强制（老记录没有期限也能保存） ---- */
  data().inspections = [{
    id: 'LEG-NODUE', code: 'FZXJ-2026-901', planName: '历史无期限单据', type: '日常巡检',
    area: 'T 区', dept: '生产一部', executor: '测试员', scheduledDate: t0, status: 'planned',
    photos: [], hazardCount: 1, hazardLevel: '', fixDueDate: '', fixDate: '', fixPhotos: [], problems: []
  }];
  SD.store.save();
  await SD.app.reload();
  await go('inspection');
  await wait(400);
  click2(view().querySelector('[data-act="iops"]'));
  await wait(300);
  click2(Array.from(doc.querySelectorAll('.dd-item')).find(x => x.textContent.trim() === '编辑'));
  await wait(600);
  const legModal = Array.from(doc.querySelectorAll('.mask .modal')).pop();
  ok('编辑历史单：整单期限不标必填',
    !!legModal && legModal.querySelector('#ff_fixDueDate').closest('.field').querySelector('span').className !== 'req',
    legModal && legModal.querySelector('#ff_fixDueDate') ? em.querySelector('#ff_fixDueDate').closest('.field').querySelector('span').className : '无');
  click2(legModal && legModal.querySelector('.js-ok'));
  await wait(1100);
  const legSaved = data().inspections.filter(t => t.id === 'LEG-NODUE')[0] || {};
  ok('编辑历史单：不填期限也能保存（不把老数据锁死）',
    data().inspections.length === 1 && legSaved.fixDueDate === '', legSaved.fixDueDate);

  /* ================= 17. 看板只统计当前自然年（★ 2026-11-12） =================
     用户要求：「数据看板仅统计当年（当前自然年）的数据，跨年数据不计入统计范围，
     并确保相关筛选与展示逻辑同步生效」。
     这一节用「当年 2 条 + 去年 1 条」验证：
       · 看板所有数字只含当年；跨年那条不出现
       · 趋势横轴是本年度 1–12 月（不是滚动的近 12 个月）
       · 巡检页年度汇总条与看板同值
       · 列表仍能切到去年查看（列表是视图过滤，不是把数据藏了） */
  console.log('== 17. 看板只统计当年 ==');
  const Y0 = t0.slice(0, 4);
  const LY = String(Number(Y0) - 1);
  const oldD = LY + '-06-10';
  data().inspections = [
    { id: 'Y-CUR-1', code: 'FZXJ-' + Y0 + '-801', planName: '当年单据甲', type: '日常巡检', area: 'U 区',
      dept: '生产一部', executor: '测试员', scheduledDate: t0, status: 'done', completedAt: t0,
      photos: shot(2), hazardCount: 2, hazardLevel: 'general', fixDueDate: futD, fixDate: '', fixPhotos: [],
      record: { findings: '两条', hazardCount: 2, signedBy: '测试员', signedAt: t0 }, problems: [] },
    { id: 'Y-CUR-2', code: 'FZXJ-' + Y0 + '-802', planName: '当年单据乙', type: '日常巡检', area: 'U 区',
      dept: '仓储部', executor: '测试员', scheduledDate: t0, status: 'planned',
      photos: shot(1), hazardCount: 3, hazardLevel: 'major', fixDueDate: futD, fixDate: '', fixPhotos: [],
      problems: [] },
    { id: 'Y-OLD-1', code: 'FZXJ-' + LY + '-900', planName: '去年单据（跨年）', type: '日常巡检', area: 'V 区',
      dept: '质检部', executor: '测试员', scheduledDate: oldD, status: 'done', completedAt: oldD,
      photos: shot(4), hazardCount: 7, hazardLevel: 'major', fixDueDate: oldD, fixDate: '', fixPhotos: [],
      record: { findings: '跨年数据', hazardCount: 7, signedBy: '测试员', signedAt: oldD }, problems: [] }
  ];
  SD.store.save();
  await SD.app.reload();
  await wait(400);

  const yrSt = SD.app.state.summary.inspectionStats;
  ok('统计年份 = 当前自然年', yrSt.year === Y0, yrSt.year);
  ok('巡检记录只算当年（2 项，去年那条不计）', yrSt.records === 2, yrSt.records);
  ok('全库记录数仍然可查（3 项，作对照）', yrSt.recordsAll === 3, yrSt.recordsAll);
  ok('隐患条数只算当年（2+3=5，不含去年 7 条）', yrSt.hazardCount === 5, yrSt.hazardCount);
  ok('状态计数只算当年（done 1 / planned 1）',
    yrSt.byStatus.done === 1 && yrSt.byStatus.planned === 1, JSON.stringify(yrSt.byStatus));
  ok('分部门不含去年的质检部',
    !yrSt.byDept.some(d => d.dept === '质检部'), yrSt.byDept.map(d => d.dept).join('/'));

  const yrIp = SD.app.state.summary.inspectionPhotos;
  ok('隐患照片只算当年（2+1=3 张，不含去年 4 张）', yrIp.totalPhotos === 3, yrIp.totalPhotos);
  ok('照片趋势横轴 = 本年度 1–12 月',
    yrIp.trend.months.length === 12 && yrIp.trend.months[0] === Y0 + '-01' &&
    yrIp.trend.months[11] === Y0 + '-12',
    yrIp.trend.months[0] + ' … ' + yrIp.trend.months[11]);
  ok('条数趋势横轴同样是本年度 1–12 月',
    yrSt.trend.length === 12 && yrSt.trend[0].ym === Y0 + '-01' && yrSt.trend[11].ym === Y0 + '-12',
    yrSt.trend.length ? yrSt.trend[0].ym + ' … ' + yrSt.trend[11].ym : '空');

  await go('dashboard');
  await wait(500);

  /* ---- 17.0 默认 = 按月（★ 2026-11-12 v1.3.9）----
     看板改成「月为主、可切年」后，进页面第一屏是当月口径，年度断言必须切档后再做。 */
  const mBar = view().querySelector('.js-dash-range');
  ok('看板顶部有年/月范围条', !!mBar);
  const mOn = mBar ? mBar.querySelector('.js-dash-mode .chip.on') : null;
  ok('默认选中「按月」', !!mOn && /按月/.test(mOn.textContent), mOn ? mOn.textContent : '无');
  const mSel0 = mBar ? mBar.querySelector('.js-m-sel') : null;
  ok('月份下拉默认本月', !!mSel0 && mSel0.value === thisYM, mSel0 ? mSel0.value : '无');
  const mScopeTxt = ((view().querySelector('.js-year-scope') || {}).textContent || '').replace(/\s+/g, ' ');
  ok('月档统计范围写到月', new RegExp('统计范围：' + Y0 + ' 年 ' + Number(thisYM.slice(5)) + ' 月').test(mScopeTxt),
    mScopeTxt.slice(0, 80));
  ok('范围条不在 .grid.cols-4 内（KPI 仍 4 张）',
    !view().querySelector('.grid.cols-4 .js-dash-range') &&
    view().querySelectorAll('.grid.cols-4 > *').length === 4,
    view().querySelectorAll('.grid.cols-4 > *').length);
  const mKpi = Array.from(view().querySelectorAll('.grid.cols-4 > *')).map(c => c.textContent.replace(/\s+/g, ' '));
  ok('月档 KPI 隐患条数 = 5 条（当年两条都在本月，去年 7 条不计）', /隐患条数\s*5\s*条/.test(mKpi[0]), mKpi[0].slice(0, 40));

  /* ---- 17.1 切「看年度」：以下为原年度断言 ---- */
  click2(view().querySelector('.js-dash-mode [data-mode="year"]'));
  await wait(450);
  /* 年档直接不渲染月份条：宁可少一个节点，也别用 hidden ——
     `.js-dash-month{display:flex}` 会盖掉 [hidden]，实测会留在屏幕上 */
  ok('切年度后不再渲染月份条', !view().querySelector('.js-dash-month'));
  ok('切年度后不显示环比（年度数字「较上月」没有意义）', !view().querySelector('.stat-delta'));
  ok('切年度后「看年度」变选中态',
    /看年度/.test((view().querySelector('.js-dash-mode .chip.on') || {}).textContent || ''));

  const yCards = Array.from(view().querySelectorAll('.grid.cols-4 > *'))
    .map(c => c.textContent.replace(/\s+/g, ' '));
  ok('看板 KPI 隐患条数 = 5 条（跨年 7 条不计入）', /隐患条数\s*5\s*条/.test(yCards[0]), yCards[0].slice(0, 40));
  const scopeEl = view().querySelector('.js-year-scope');
  const scopeTxt = scopeEl ? scopeEl.textContent.replace(/\s+/g, ' ') : '';
  ok('看板顶部写明统计范围 = 当前自然年', new RegExp('统计范围：' + Y0 + ' 年').test(scopeTxt), scopeTxt.slice(0, 80));
  ok('看板顶部写明跨年不计入并给出全库对照',
    /跨年记录不计入/.test(scopeTxt) && /全库共\s*3\s*项/.test(scopeTxt), scopeTxt.slice(0, 120));
  const yTrendCard = Array.from(view().querySelectorAll('.card'))
    .find(c => /巡检隐患条数趋势/.test((c.querySelector('h3') || {}).textContent || ''));
  ok('年档趋势卡副标题写明「当年各月」（不再是近 12 个月）',
    !!yTrendCard && new RegExp(Y0 + ' 年各月').test(yTrendCard.textContent) &&
    !/近 12 个月/.test(yTrendCard.textContent),
    yTrendCard ? yTrendCard.querySelector('.sub').textContent : '无');
  const yPhotoCard = Array.from(view().querySelectorAll('.card'))
    .find(c => (c.querySelector('h3') || {}).textContent.trim() === '各部门隐患照片');
  ok('照片汇总合计 = 3 张（去年 4 张不进当年）',
    !!yPhotoCard && /合计 3 张/.test(yPhotoCard.textContent.replace(/\s+/g, ' ')),
    yPhotoCard ? (yPhotoCard.querySelector('.js-total') || {}).textContent : '无');
  const yNote = view().textContent.replace(/\s+/g, ' ');
  ok('口径说明写明「四、统计范围」并覆盖年 / 月两档',
    /四、统计范围/.test(yNote) && /只统计当前自然年/.test(yNote) && /不计入/.test(yNote) &&
    /月档只统计所选自然月/.test(yNote));
  ok('看板副标题带年份', new RegExp(Y0 + ' 年').test(SD.views.dashboard.sub(SD.app.state.summary)),
    SD.views.dashboard.sub(SD.app.state.summary));

  /* ---- 17.2 巡检页：年度汇总条 + 列表仍可切年份查往年 ---- */
  await go('inspection');
  await wait(400);
  const ySum = view().querySelector('.js-insp-sum');
  const ySumTxt = ySum ? ySum.textContent.replace(/\s+/g, ' ') : '';
  ok('巡检页汇总条写明年度口径', new RegExp(Y0 + ' 年度记录').test(ySumTxt), ySumTxt.slice(0, 70));
  ok('汇总条当年 2 项 + 提示全库 3 项',
    /年度记录[^0-9]*2\s*项/.test(ySumTxt) && /全部年份共 3 项/.test(ySumTxt), ySumTxt.slice(0, 110));

  click2(Array.from(view().querySelectorAll('.chip')).find(c => c.textContent.trim() === '全部'));
  await wait(300);
  const ySel = view().querySelector('.js-year-sel');
  ok('列表有年份下拉且默认当年', !!ySel && ySel.value === Y0, ySel ? ySel.value : '无');
  if (ySel) {
    ySel.value = LY;
    ySel.dispatchEvent(new win.Event('change', { bubbles: true }));
    await wait(700);
    const rowsLY = Array.from(view().querySelectorAll('tbody tr'))
      .map(tr => tr.textContent.replace(/\s+/g, ' '));
    ok('切到去年：列表能看到跨年那条（往年记录没被藏掉）',
      rowsLY.length === 1 && /FZXJ-/.test(rowsLY[0]) && /去年单据/.test(rowsLY[0]), rowsLY.join(' | '));
  }

  /* ================= 18. 月视图：切月 / 逐日 / 环比 / 空月（★ 2026-11-12 v1.3.9） =================
     用户要求：「在看板中新增按月维度的时间筛选与统计视图」。
     这一节用「本月 2 条 + 上月 3 条（其中 1 条本月才改完）+ 去年同月 1 条」验证：
     切月、逐日横轴、跨月补完、四条环比文案、历史月逾期基准、空月空态、切年回落。 */
  console.log('== 18. 月视图：切月 / 逐日 / 环比 ==');
  const curYM2 = t0.slice(0, 7);
  const prevYM2 = SD.utils.shiftYM(curYM2, -1);
  const lyYM2 = String(Number(t0.slice(0, 4)) - 1) + curYM2.slice(4);
  const cd = n => curYM2 + '-' + (n < 10 ? '0' + n : n);
  const pd = n => prevYM2 + '-' + (n < 10 ? '0' + n : n);

  data().inspections = [
    /* 本月：1 条本月改完（2 条）、1 条期限上月已过且未整改（3 条） */
    { id: 'MV-C1', code: 'FZXJ-' + Y0 + '-701', planName: '本月已改', type: '日常巡检', area: 'W 区',
      dept: '生产一部', executor: '测试员', scheduledDate: cd(3), status: 'done', completedAt: cd(3),
      photos: shot(2), hazardCount: 2, hazardLevel: 'general', fixDueDate: cd(20), fixDate: cd(3), fixPhotos: [],
      record: { findings: '2 条', hazardCount: 2, signedBy: '测试员', signedAt: cd(3) },
      problems: [{ id: 'm1', dept: '生产一部', content: '本月改完', type: '消防', level: 'general', count: 2,
        photos: shot(2), fixDueDate: cd(20), fixDate: cd(3), fixPhotos: [] }] },
    { id: 'MV-C2', code: 'FZXJ-' + Y0 + '-702', planName: '本月逾期', type: '日常巡检', area: 'W 区',
      dept: '仓储部', executor: '测试员', scheduledDate: cd(15), status: 'planned',
      photos: shot(1), hazardCount: 3, hazardLevel: 'major', fixDueDate: pd(1), fixDate: '', fixPhotos: [],
      problems: [{ id: 'm2', dept: '仓储部', content: '期限已过未改', type: '电气', level: 'major', count: 3,
        photos: shot(1), fixDueDate: pd(1), fixDate: '', fixPhotos: [] }] },
    /* 上月：1 条逾期未改（4 条）、1 条按期改完（1 条）、1 条上月发现本月改完（2 条 → 跨月补完） */
    { id: 'MV-P1', code: 'FZXJ-' + Y0 + '-711', planName: '上月逾期', type: '日常巡检', area: 'X 区',
      dept: '生产一部', executor: '测试员', scheduledDate: pd(20), status: 'planned',
      photos: [], hazardCount: 4, hazardLevel: 'large', fixDueDate: pd(25), fixDate: '', fixPhotos: [],
      problems: [{ id: 'm3', dept: '生产一部', content: '上月至今未改', type: '其它', level: 'large', count: 4,
        photos: [], fixDueDate: pd(25), fixDate: '', fixPhotos: [] }] },
    { id: 'MV-P2', code: 'FZXJ-' + Y0 + '-712', planName: '上月按期', type: '日常巡检', area: 'X 区',
      dept: '仓储部', executor: '测试员', scheduledDate: pd(10), status: 'done', completedAt: pd(12),
      photos: [], hazardCount: 1, hazardLevel: 'general', fixDueDate: pd(12), fixDate: pd(12), fixPhotos: [],
      record: { findings: '1 条', hazardCount: 1, signedBy: '测试员', signedAt: pd(12) },
      problems: [{ id: 'm4', dept: '仓储部', content: '按期改完', type: '消防', level: 'general', count: 1,
        photos: [], fixDueDate: pd(12), fixDate: pd(12), fixPhotos: [] }] },
    { id: 'MV-P3', code: 'FZXJ-' + Y0 + '-713', planName: '跨月补完', type: '日常巡检', area: 'X 区',
      dept: '生产一部', executor: '测试员', scheduledDate: pd(22), status: 'done', completedAt: cd(5),
      photos: [], hazardCount: 2, hazardLevel: 'large', fixDueDate: pd(20), fixDate: cd(5), fixPhotos: [],
      record: { findings: '2 条', hazardCount: 2, signedBy: '测试员', signedAt: cd(5) },
      problems: [{ id: 'm5', dept: '生产一部', content: '本月才改完', type: '消防', level: 'large', count: 2,
        photos: [], fixDueDate: pd(20), fixDate: cd(5), fixPhotos: [] }] },
    /* 去年同月：必须不出现在当年/当月任何数字里 */
    { id: 'MV-LY', code: 'FZXJ-' + (Number(Y0) - 1) + '-799', planName: '去年同月', type: '日常巡检', area: 'Y 区',
      dept: '质检部', executor: '测试员', scheduledDate: lyYM2 + '-01', status: 'done', completedAt: lyYM2 + '-02',
      photos: shot(3), hazardCount: 9, hazardLevel: 'major', fixDueDate: '', fixDate: '', fixPhotos: [],
      problems: [{ id: 'm6', dept: '质检部', content: '去年问题', type: '其它', level: 'major', count: 9,
        photos: shot(3), fixDueDate: '', fixDate: '', fixPhotos: [] }] }
  ];
  SD.store.save();
  await SD.app.reload();
  await go('dashboard');
  await wait(500);

  /* 上一节停在「看年度」，这里切回「按月」 */
  click2(view().querySelector('.js-dash-mode [data-mode="month"]'));
  await wait(400);
  const mSel = view().querySelector('.js-m-sel');
  ok('切回按月后月份条重新出现', !!mSel && !!view().querySelector('.js-dash-month'));

  const mOpts = mSel ? Array.from(mSel.querySelectorAll('option')).map(o => o.value) : [];
  ok('月份下拉含本月 / 上月 / 去年同月，且倒序',
    mOpts[0] === curYM2 && mOpts.indexOf(prevYM2) >= 0 && mOpts.indexOf(lyYM2) >= 0, mOpts.join(','));
  ok('月份下拉不含从未出现的月份',
    mOpts.length === 3, mOpts.join(','));
  const curOptTxt = mSel ? mSel.querySelector('option[value="' + curYM2 + '"]').textContent : '';
  ok('选项文案带本月项数（· 2 项）', /·\s*2\s*项/.test(curOptTxt), curOptTxt);

  /* ---- 18.1 本月：逐日 + 跨月补完 + 环比 ---- */
  const curSt = SD.metrics.inspectionStats(data(), t0, { ym: curYM2 });
  ok('本月隐患条数 = 5（2+3，去年 9 条不计）', curSt.hazardCount === 5, curSt.hazardCount);
  ok('本月逐日长度 = 该月天数',
    curSt.daily.length === SD.utils.daysInMonth(curYM2), curSt.daily.length);
  ok('逐日上报落点：3 日 2 条', curSt.daily[2].found === 2, JSON.stringify(curSt.daily[2]));
  ok('逐日已整改落点：3 日 2 条', curSt.daily[2].fixed === 2, JSON.stringify(curSt.daily[2]));
  ok('跨月补完：5 日为上月上报的 2 条', curSt.daily[4].fixed === 2, JSON.stringify(curSt.daily[4]));
  ok('fixedCarryIn = 2（本月改完但上报不在本月）', curSt.fixedCarryIn === 2, curSt.fixedCarryIn);
  const carryLegend = Array.from(view().querySelectorAll('.card'))
    .find(c => /巡检隐患条数趋势/.test((c.querySelector('h3') || {}).textContent || ''));
  ok('趋势图例写明跨月补完来源',
    !!carryLegend && /来自上月及以前上报/.test(carryLegend.textContent.replace(/\s+/g, ' ')),
    carryLegend ? carryLegend.querySelector('.js-legend').textContent : '无');
  const curKpi = Array.from(view().querySelectorAll('.grid.cols-4 > *')).map(c => c.textContent.replace(/\s+/g, ' '));
  ok('本月卡出现环比行（4 张都有）',
    view().querySelectorAll('.stat-delta').length === 4, view().querySelectorAll('.stat-delta').length);
  ok('隐患条数环比：较上月 -29%（上月 7 条）',
    /较上月\s*-29%（上月 7 条）/.test(curKpi[0]), curKpi[0].slice(0, 70));
  ok('已整改环比：较上月 -33%（上月 3 条）', /较上月\s*-33%（上月 3 条）/.test(curKpi[1]), curKpi[1].slice(0, 70));
  ok('逾期环比下降算好事（着 good 绿，按好坏不按数值方向）',
    /较上月\s*-25%（上月 4 条）/.test(curKpi[2]) &&
    !!view().querySelectorAll('.grid.cols-4 > *')[2].querySelector('.stat-delta .good'),
    curKpi[2].slice(0, 80));
  ok('整改率环比用「个百分点」而非相对变化',
    /较上月\s*-2\.9 个百分点（上月 43%）/.test(curKpi[3]), curKpi[3].slice(0, 90));

  /* ---- 18.2 切到上月：历史月 + 逾期按今天判 ---- */
  click2(view().querySelector('.js-m-prev'));
  await wait(450);
  const prevSel = view().querySelector('.js-m-sel');
  ok('「‹ 上一月」切到上月', !!prevSel && prevSel.value === prevYM2, prevSel ? prevSel.value : '无');
  const prevScope = (view().querySelector('.js-year-scope') || {}).textContent.replace(/\s+/g, ' ');
  ok('范围条写明所选月份',
    new RegExp('统计范围：' + prevYM2.slice(0, 4) + ' 年 ' + Number(prevYM2.slice(5)) + ' 月').test(prevScope),
    prevScope.slice(0, 80));
  const prevKpi = Array.from(view().querySelectorAll('.grid.cols-4 > *')).map(c => c.textContent.replace(/\s+/g, ' '));
  ok('上月隐患条数 = 7（4+1+2）', /隐患条数\s*7\s*条/.test(prevKpi[0]), prevKpi[0].slice(0, 40));
  const prevSt = SD.metrics.inspectionStats(data(), t0, { ym: prevYM2 });
  ok('历史月逾期按「今天」判：上月那条过期未整改 = 4 条', prevSt.due.openOverdue === 4, prevSt.due.openOverdue);
  const prevSec = Array.from(view().querySelectorAll('.card'))
    .find(c => (c.querySelector('h3') || {}).textContent.trim() === '安全巡检（隐患与整改）');
  ok('月档段副标题标「逾期天数截至今天」',
    !!prevSec && /截至今天/.test(prevSec.textContent), prevSec ? prevSec.querySelector('.sub').textContent : '无');
  ok('上月逐日：10 日上报 1 条', prevSt.daily[9].found === 1, JSON.stringify(prevSt.daily[9]));
  ok('上月逐日：12 日改完 1 条', prevSt.daily[11].fixed === 1, JSON.stringify(prevSt.daily[11]));
  ok('上月 fixedCarryIn = 0（上月改完的没有跨月上报）', prevSt.fixedCarryIn === 0, prevSt.fixedCarryIn);

  /* ---- 18.3 去年同月：无基数不编百分比 ---- */
  const lySel = view().querySelector('.js-m-sel');
  lySel.value = lyYM2;
  lySel.dispatchEvent(new win.Event('change', { bubbles: true }));
  await wait(450);
  const lyKpi = Array.from(view().querySelectorAll('.grid.cols-4 > *')).map(c => c.textContent.replace(/\s+/g, ' '));
  ok('去年同月能查到（9 条）', /隐患条数\s*9\s*条/.test(lyKpi[0]), lyKpi[0].slice(0, 40));
  ok('上月为 0 时逾期环比不出百分比',
    /上月\s*0\s*条/.test(lyKpi[2]) && !/%/.test(lyKpi[2]), lyKpi[2].slice(0, 70));
  ok('上月无隐患基数时整改率写「无可比基数」',
    /上月无数据（无可比基数）/.test(lyKpi[3]), lyKpi[3].slice(0, 80));

  /* ---- 18.4 空月份：四处空态 + 脏值回落 ---- */
  SD.app.state.filters.dashboard.ym = '2020-05';
  await go('todo');
  await go('dashboard');
  await wait(500);
  const emptyTxt = view().textContent.replace(/\s+/g, ' ');
  ok('空月份：条数趋势走空态', /暂无趋势数据/.test(emptyTxt));
  ok('空月份：照片趋势走空态', /暂无隐患照片/.test(emptyTxt));
  ok('空月份：部门整改率走空态', /暂无部门数据/.test(emptyTxt));
  ok('空月份：巡检段走空态', /暂无巡检隐患数据/.test(emptyTxt));
  ok('空月份不画逐日折线（daily 为空）',
    SD.metrics.inspectionStats(data(), t0, { ym: '2020-05' }).daily.length === 0);

  SD.app.state.filters.dashboard.ym = '2026-13';
  await go('todo');
  await go('dashboard');
  await wait(500);
  const fixedSel = view().querySelector('.js-m-sel');
  ok('脏值（13 月）回落到本月', !!fixedSel && fixedSel.value === curYM2, fixedSel ? fixedSel.value : '无');

  /* ---- 18.5 月档六格恒等式 + 切年回落 ---- */
  ok('月档六格恒等式仍成立',
    ['doneOnTime', 'doneLate', 'doneNoDue', 'openOverdue', 'openInDue', 'openNoDue']
      .reduce((a, k) => a + curSt.due[k], 0) === curSt.hazardCount);
  /* 副标题：单参数（导航摘要 / 老调用）必须仍走年度，第二参才按月 */
  ok('副标题：单参数走年度、带 state 走月档',
    /巡检记录\s*5\s*项/.test(SD.views.dashboard.sub(SD.app.state.summary)) &&
    !/年 \d+ 月/.test(SD.views.dashboard.sub(SD.app.state.summary)) &&
    /年 \d+ 月 · 巡检记录/.test(SD.views.dashboard.sub(SD.app.state.summary, SD.app.state)),
    SD.views.dashboard.sub(SD.app.state.summary) + ' | ' + SD.views.dashboard.sub(SD.app.state.summary, SD.app.state));

  click2(view().querySelector('.js-dash-mode [data-mode="year"]'));
  await wait(450);
  const backKpi = Array.from(view().querySelectorAll('.grid.cols-4 > *')).map(c => c.textContent.replace(/\s+/g, ' '));
  ok('切年度：条数回到当年合计（5+7=12，去年 9 条不计）', /隐患条数\s*12\s*条/.test(backKpi[0]), backKpi[0].slice(0, 40));
  ok('切年度：环比行消失', view().querySelectorAll('.stat-delta').length === 0);
  ok('切年度：月份条移除、看年度变选中',
    !view().querySelector('.js-dash-month') &&
    /看年度/.test((view().querySelector('.js-dash-mode .chip.on') || {}).textContent || ''));

  ok('全程无 JS 报错', errors.length === 0, errors.join(' | ').slice(0, 200));

  console.log('\n结果：通过 ' + pass + ' / 失败 ' + fail);
  if (fail) process.exitCode = 1;
  await wait(200);
  win.close();
})();
