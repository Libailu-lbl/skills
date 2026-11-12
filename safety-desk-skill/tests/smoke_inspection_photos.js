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
  ok('第一张卡是「隐患照片」', /隐患照片/.test(k1), k1.slice(0, 50));
  ok('第一张卡的值是 7 张', /\b7\b/.test(k1) && /张/.test(k1), k1.slice(0, 50));
  ok('第一张卡不再叫「隐患总数」', !/隐患总数/.test(k1));

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
  ok('段内「巡检记录」= 4 项', /巡检记录\s*4\s*项/.test(inspTxt), inspTxt.slice(0, 80));
  ok('段内「隐患条数」= 9 条', /隐患条数\s*9\s*条/.test(inspTxt));
  ok('段内「已整改」= 3 条', /已整改\s*3\s*条/.test(inspTxt));
  ok('段内「整改率」= 33%', /整改率\s*33%/.test(inspTxt), inspTxt.slice(0, 120));
  ok('段内写明三态明细（未整改 4 / 整改中 2 / 已整改 3）',
    /未整改\s*4\s*条/.test(inspTxt) && /整改中\s*2\s*条/.test(inspTxt));
  ok('等级环图中心显示隐患条数 9', /隐患条数/.test(inspTxt) && /\b9\b/.test(inspTxt));
  ok('顶部 KPI 仍然正好 4 张（新段没用 cols-4）',
    view().querySelectorAll('.grid.cols-4 > *').length === 4,
    view().querySelectorAll('.grid.cols-4 > *').length);
  ok('新段等级图标注「按条数」，与台账等级图区分',
    /按条数/.test(inspTxt) && /隐患等级分布/.test(view().textContent));

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
  ok('汇总条写明「不限本周 / 年份」', /不限本周/.test(sumTxt), sumTxt.slice(0, 60));
  ok('汇总条「全部记录」= 4 项', /4\s*项/.test(sumTxt));
  ok('汇总条「发现隐患」= 9 条', /发现隐患\s*9\s*条/.test(sumTxt));
  ok('汇总条整改率 = 33%', /整改率\s*33%/.test(sumTxt));
  ok('巡检页与看板数字一致（9 条 / 33%）',
    /发现隐患\s*9\s*条/.test(sumTxt) && /隐患条数\s*9\s*条/.test(inspTxt) &&
    /整改率\s*33%/.test(sumTxt) && /整改率\s*33%/.test(inspTxt));
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

  ok('全程无 JS 报错', errors.length === 0, errors.join(' | ').slice(0, 200));

  console.log('\n结果：通过 ' + pass + ' / 失败 ' + fail);
  if (fail) process.exitCode = 1;
  await wait(200);
  win.close();
})();
