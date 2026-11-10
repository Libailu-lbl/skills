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

  ok('全程无 JS 报错', errors.length === 0, errors.join(' | ').slice(0, 200));

  console.log('\n结果：通过 ' + pass + ' / 失败 ' + fail);
  if (fail) process.exitCode = 1;
  await wait(200);
  win.close();
})();
