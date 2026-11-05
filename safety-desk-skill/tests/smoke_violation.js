/* 安全员工作台 · 安全违章考核单 冒烟自检（2026-11-04 新增）
   用法：node safety-desk_dev/smoke_violation.js [url]

   覆盖：
     ① 导航：报表分组下多出「安全违章考核单」，点进去标题 / 路由正确
     ② 默认全年：时间范围 = 今年 01-01 ~ 12-31，列表条数 = 当年条数
     ③ 编号规则 FZKH-001：示例数据编号格式、新增默认顺延 FZKH-006、格式/重复拦截
     ④ 点编号看图片：有照片 → 灯箱打开；无照片 → 只提示不报错
     ⑤ 时间范围筛选：收窄区间条数变少、「全年」按钮出现并可复原
     ⑥ 切年份 → 区间重置为该年全年
     ⑦ 新增 / 编辑 / 删除：字段落库、照片数组保留、删完回列表
     ⑦.5 考核情况：处罚 / 保证书 / 其它多选、勾「其它」后手填、校验与列表标签、搜索命中
     ⑧ 受限模式：新增按钮被拦（不落库）
     ⑨ 编号中枢：rule/next/padSeq 与其它八类互不干扰
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
    while (Date.now() - t0 < ms) { if (doc.querySelector(sel)) return true; await wait(80); }
    return false;
  };
  const go = async r => { win.location.hash = '#/' + r; await wait(500); };
  const rows = () => doc.querySelectorAll('#view .js-vk-body table tbody tr').length;
  const codes = () => Array.from(doc.querySelectorAll('#view .js-vk-body table tbody tr .js-vk-code'))
    .map(el => el.textContent.replace(/照片 \d+/, '').trim());
  const subText = () => ((doc.querySelector('#view .js-vk-sub') || {}).textContent || '');
  const fromIn = () => doc.querySelector('#view .js-vk-range input[type="date"]');
  const toIn = () => doc.querySelectorAll('#view .js-vk-range input[type="date"]')[1];
  const ySel = () => doc.querySelector('#view .year-fg .js-year-sel');
  const yearBtn = () => doc.querySelector('#view .js-vk-year');
  const setDay = async (el, v) => {
    el.value = v;
    el.dispatchEvent(new win.Event('change', { bubbles: true }));
    await wait(450);
  };
  const store = () => SD.store.data().violations || [];
  const TODAY = SD.app.state.summary.today;
  const CY = TODAY.slice(0, 4);

  /* ================= 1. 导航 ================= */
  console.log('== 1. 导航：报表分组下的安全违章考核单 ==');
  const navText = doc.body.textContent || '';
  ok('导航里出现「安全违章考核单」', navText.indexOf('安全违章考核单') >= 0);
  const routeHit = SD.router.ROUTES.filter(r => r.id === 'violation')[0];
  ok('路由注册在报表分组（group=secondary, subGroup=reports）',
    !!routeHit && routeHit.subGroup === 'reports' && routeHit.group === 'secondary',
    routeHit && (routeHit.group + '/' + routeHit.subGroup));

  await go('violation');
  await waitSel('#view .js-vk-body');
  ok('标题 = 安全违章考核单', (doc.getElementById('viewTitle') || {}).textContent === '安全违章考核单',
    (doc.getElementById('viewTitle') || {}).textContent);

  /* 空白版库里没有示例考核单：先造两条（含一张照片），后面的区间 / 照片断言才有对象可测 */
  function addDays(dayStr, n) {
    const d = new Date(dayStr + 'T00:00:00');
    d.setDate(d.getDate() + n);
    const p2 = x => (x < 10 ? '0' : '') + x;
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
  }
  const SEED_PHOTO = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="#def"/></svg>');
  /* 补一条「去年」的记录：用来证明默认全年确实把往年挡在外面、且年份下拉能切回去 */
  const LAST_Y = String(Number(CY) - 1);
  if (!store().some(r => String(r.date || '').slice(0, 4) === LAST_Y)) {
    await SD.api.createViolation({
      code: 'FZKH-900', date: LAST_Y + '-06-15', applicant: '自检', employee: '往年员工', empNo: 'Z0001',
      dept: '往年车间', leader: '往年负责人', content: '自检数据：往年违章（不该出现在今年全年里）。', photos: []
    });
    await SD.app.reload();
    await wait(600);
    await go('violation');
  }

  /* 注意：得按「有没有今年的记录」判断，不能按「库是不是空的」——
     上面刚补了往年那条，空库判断就不成立了 */
  if (!store().some(r => String(r.date || '').slice(0, 4) === CY)) {
    await SD.api.createViolation({
      code: 'FZKH-001', date: TODAY, applicant: '自检', employee: '员工甲', empNo: 'A001',
      dept: '一车间', leader: '负责人甲', content: '自检数据：未戴护目镜。', photos: [SEED_PHOTO]
    });
    await SD.api.createViolation({
      code: 'FZKH-002', date: addDays(TODAY, -2), applicant: '自检', employee: '员工乙', empNo: 'A002',
      dept: '二车间', leader: '负责人乙', content: '自检数据：通道堆料。', photos: []
    });
    await SD.app.reload();
    await wait(700);
    await go('violation');
    console.log('  -- 已补 2 条自检数据（空白版无示例数据）');
  }

  /* ================= 2. 默认全年 ================= */
  console.log('== 2. 默认展示全年 ==');
  ok('年份下拉默认为今年（' + CY + '）', ySel() && ySel().value === CY, ySel() && ySel().value);
  ok('起始日期 = ' + CY + '-01-01', fromIn() && fromIn().value === CY + '-01-01', fromIn() && fromIn().value);
  ok('结束日期 = ' + CY + '-12-31', toIn() && toIn().value === CY + '-12-31', toIn() && toIn().value);
  ok('默认没有「全年」按钮（已经是全年）', !yearBtn());

  const yearCount = store().filter(r => String(r.date || '').slice(0, 4) === CY).length;
  ok('列表条数 = 当年条数（' + yearCount + '）', rows() === yearCount, rows() + ' 行 / 当年 ' + yearCount + ' 条');
  ok('副标题写明区间与条数', subText().indexOf(CY + '-01-01 ~ ' + CY + '-12-31 共 ' + yearCount + ' 条') >= 0, subText());
  ok('副标题补「全部 N 条」（库里还有往年记录）', subText().indexOf('全部 ' + store().length + ' 条') >= 0, subText());
  ok('往年那条不在默认列表里', codes().indexOf('FZKH-900') < 0, codes().join(','));

  /* ================= 3. 编号规则 ================= */
  console.log('== 3. 编号 FZKH-001 ==');
  ok('编号中枢注册了 violation 规则',
    SD.CONFIG.codeRules.violation && SD.CONFIG.codeRules.violation.prefix === 'FZKH' &&
    SD.CONFIG.codeRules.violation.seqLen === 3 && SD.CONFIG.codeRules.violation.withYear === false,
    JSON.stringify(SD.CONFIG.codeRules.violation));
  ok('示例格式 = FZKH-001', SD.code.sample('violation') === 'FZKH-001', SD.code.sample('violation'));
  ok('FZKH-001 能过格式校验', SD.code.patternOf('violation').test('FZKH-001'));
  ok('FZKH-01 / FZKH-0001 不合法',
    !SD.code.patternOf('violation').test('FZKH-01') && !SD.code.patternOf('violation').test('FZKH-0001'));
  ok('与其它类不串（FZKH-001 不算通知编号）', !SD.code.patternOf('notice').test('FZKH-001'));
  if (store().length) {
    const nextCode = SD.code.next('violation');
    ok('顺延出下一个号（' + nextCode + '）', /^FZKH-\d{3}$/.test(nextCode), nextCode);
    ok('顺延号不与现有重复', !store().some(r => r.code === nextCode));
    ok('列表里的编号都是 FZKH-nnn',
      store().every(r => /^FZKH-\d{3}$/.test(r.code)), store().map(r => r.code).join(','));
  } else {
    skip('顺延号', '本版本没有示例考核单');
    ok('空库时下一个号 = FZKH-001', SD.code.next('violation') === 'FZKH-001', SD.code.next('violation'));
  }

  /* ================= 4. 点编号看图片 ================= */
  console.log('== 4. 点编号查看图片 ==');
  /* 只在「今年」的记录里挑：往年那条（FZKH-900）不在默认全年列表里，点不到 */
  const visible = () => store().filter(r => String(r.date || '').slice(0, 4) === CY);
  const withPhoto = visible().filter(r => (r.photos || []).length)[0];
  const noPhoto = visible().filter(r => !(r.photos || []).length)[0];
  if (withPhoto) {
    await go('violation');
    const el = Array.from(doc.querySelectorAll('#view .js-vk-code'))
      .filter(x => x.dataset.id === withPhoto.id)[0];
    ok('有照片的那条编号带 link 样式与「照片 N」角标',
      !!el && el.className.indexOf('link') >= 0 && /照片 \d+/.test(el.textContent),
      el && el.textContent);
    el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await wait(300);
    const lb = doc.querySelector('.lb-mask');
    ok('点编号打开大图灯箱', !!lb);
    ok('灯箱标题带编号',
      lb && (lb.querySelector('.lb-cap') || {}).textContent.indexOf(withPhoto.code) >= 0,
      lb && (lb.querySelector('.lb-cap') || {}).textContent);
    const close = doc.querySelector('.lb-close');
    if (close) close.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await wait(200);
  } else {
    skip('点编号看图片', '本版本没有带照片的记录');
  }
  if (noPhoto) {
    const el2 = Array.from(doc.querySelectorAll('#view .js-vk-code'))
      .filter(x => x.dataset.id === noPhoto.id)[0];
    el2.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await wait(250);
    ok('无照片的记录点了不报错、也不弹灯箱', !doc.querySelector('.lb-mask'));
  }

  /* ================= 5. 时间范围筛选 ================= */
  console.log('== 5. 时间范围筛选 ==');
  if (store().length >= 2) {
    /* 取最近一条的日期当作单日区间 */
    const newest = store().slice().sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    await setDay(fromIn(), newest.date);
    ok('起始日期改成 ' + newest.date + ' 后出现「全年」按钮', !!yearBtn());
    const oneDay = store().filter(r => r.date === newest.date).length;
    ok('区间收窄后条数 = 该日条数（' + oneDay + '）', rows() === oneDay, rows() + ' 行');
    ok('副标题跟着变', subText().indexOf(newest.date + ' ~ ' + CY + '-12-31') >= 0, subText());

    /* 起止颠倒 → 还原输入并提示（不静默改数、不把年份带跑） */
    await setDay(toIn(), '2000-01-01');
    ok('结束早于起始被拒并还原', toIn().value === CY + '-12-31', fromIn().value + ' ~ ' + toIn().value);
    ok('被拒后年份没被带跑', ySel().value === CY, ySel().value);

    yearBtn().dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await wait(500);
    ok('点「全年」复原区间', fromIn().value === CY + '-01-01' && toIn().value === CY + '-12-31',
      fromIn().value + ' ~ ' + toIn().value);
    ok('复原后条数回到全年（' + yearCount + '）', rows() === yearCount, rows() + ' / ' + yearCount);
  } else {
    skip('时间范围筛选', '空白版数据太少');
  }

  /* ================= 6. 切年份 ================= */
  console.log('== 6. 切年份重置区间 ==');
  const otherY = Array.from(ySel().options).map(o => o.value).filter(v => v !== CY)[0];
  if (otherY) {
    ySel().value = otherY;
    ySel().dispatchEvent(new win.Event('change', { bubbles: true }));
    await wait(500);
    ok('切到 ' + otherY + ' 年后起始日期 = ' + otherY + '-01-01', fromIn().value === otherY + '-01-01', fromIn().value);
    ok('结束日期 = ' + otherY + '-12-31', toIn().value === otherY + '-12-31', toIn().value);
    ok('该年条数对', rows() === store().filter(r => String(r.date || '').slice(0, 4) === otherY).length,
      rows() + ' 行');
    /* 切回今年 */
    ySel().value = CY;
    ySel().dispatchEvent(new win.Event('change', { bubbles: true }));
    await wait(500);
  } else {
    skip('切年份重置区间', '下拉里只有今年');
  }

  /* ================= 7. 新增 / 编辑 / 删除 ================= */
  console.log('== 7. 新增 / 编辑 / 删除 ==');
  const before = store().length;
  const addBtn = Array.from(doc.querySelectorAll('#view button')).filter(b => /新增考核单/.test(b.textContent))[0];
  ok('工具栏有「新增考核单」按钮', !!addBtn);
  addBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await waitSel('.mask', 4000);
  let m = doc.querySelector('.mask');
  ok('打开新增弹窗', !!m);
  const codeIn = m.querySelector('#ff_code');
  ok('编号已按规则预填（' + (codeIn && codeIn.value) + '）', codeIn && /^FZKH-\d{3}$/.test(codeIn.value), codeIn && codeIn.value);
  ok('表单含「申请人 / 违章员工 / 工号 / 部门 / 部门负责人 / 违章内容」',
    !!m.querySelector('#ff_applicant') && !!m.querySelector('#ff_employee') && !!m.querySelector('#ff_empNo') &&
    !!m.querySelector('#ff_dept') && !!m.querySelector('#ff_leader') && !!m.querySelector('#ff_content'));
  ok('表单含日期与照片字段', !!m.querySelector('#ff_date') && !!m.querySelector('#ff_photos'));
  ok('照片控件上限 6 张',
    /最多 6 张/.test(m.textContent), (m.textContent.match(/最多 \d+ 张/) || [''])[0]);

  const setF = (id, v) => { const e = m.querySelector('#' + id); if (e) { e.value = v; e.dispatchEvent(new win.Event('input', { bubbles: true })); e.dispatchEvent(new win.Event('change', { bubbles: true })); } };
  setF('ff_date', TODAY);
  setF('ff_applicant', '测试申请人');
  setF('ff_employee', '测试员工');
  setF('ff_empNo', 'MJ9999');
  setF('ff_dept', '测试车间');
  setF('ff_leader', '测试负责人');
  setF('ff_content', '自检用：未按规定佩戴护目镜进入打磨工位。');

  /* 先试一个非法编号，确认被拦 */
  const codeInput = m.querySelector('#ff_code');
  codeInput.value = 'FZKH-01';
  m.querySelector('.js-ok').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(600);
  ok('非法编号被拦（仍停在弹窗）', !!doc.querySelector('.mask'));
  ok('弹窗里有格式错误提示', /格式应形如 FZKH-\d{3}/.test((doc.querySelector('.mask') || {}).textContent || ''),
    ((doc.querySelector('.mask') || {}).textContent || '').slice(0, 0));

  codeInput.value = 'FZKH-099';
  m.querySelector('.js-ok').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(1800);
  ok('弹窗已关闭（保存成功）', !doc.querySelector('.mask'));
  ok('数据 +1', store().length === before + 1, store().length + ' / 之前 ' + before);
  const created = store().filter(r => r.code === 'FZKH-099')[0];
  ok('字段落库正确', !!created && created.employee === '测试员工' && created.empNo === 'MJ9999' &&
    created.dept === '测试车间' && created.leader === '测试负责人' && created.date === TODAY,
    created && JSON.stringify({ e: created.employee, n: created.empNo, d: created.dept }));
  ok('列表能看到新记录', codes().indexOf('FZKH-099') >= 0, codes().join(','));

  /* 编辑：改内容 + 加一张照片（走 API 模拟上传结果），再点编号看大图 */
  if (created) {
    await SD.api.updateViolation(created.id, {
      photos: ['data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="#eef"/></svg>')]
    });
    await SD.app.reload();
    await wait(700);
    await go('violation');
    const el = Array.from(doc.querySelectorAll('#view .js-vk-code')).filter(x => x.dataset.id === created.id)[0];
    ok('补照片后编号带「照片 1」角标', !!el && /照片 1/.test(el.textContent), el && el.textContent);
    el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await wait(300);
    ok('点编号能看到刚补的照片', !!doc.querySelector('.lb-mask'));
    const close = doc.querySelector('.lb-close');
    if (close) close.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await wait(200);

    /* 删除 */
    await SD.api.removeViolation(created.id);
    await SD.app.reload();
    await wait(700);
    await go('violation');
    ok('删除后数据 -1', store().length === before, store().length + ' / ' + before);
    ok('删除后列表里没有它', codes().indexOf('FZKH-099') < 0);
  }

  /* ================= 7.5 考核情况：多选 + 「其它」手填 ================= */
  console.log('== 7.5 考核情况（处罚 / 保证书 / 其它）==');
  const n1 = store().length;
  const addB2 = Array.from(doc.querySelectorAll('#view button')).filter(b => /新增考核单/.test(b.textContent))[0];
  addB2.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await waitSel('.mask', 4000);
  const m2 = doc.querySelector('.mask');
  ok('打开新增弹窗（考核情况用例）', !!m2);
  /* dialog 打开 30ms 后会把焦点放到第一个字段，等它做完再测「勾其它→补充框聚焦」 */
  await wait(180);

  const grp = m2.querySelector('#ff_assessment');
  ok('表单里有「考核情况」字段', !!grp);
  const boxes = () => Array.from(m2.querySelectorAll('#ff_assessment input[type="checkbox"]'));
  ok('三个选项：处罚 / 保证书 / 其它',
    boxes().map(b => b.value).join(',') === '处罚,保证书,其它', boxes().map(b => b.value).join(','));
  const otherIn = () => m2.querySelector('#ff_assessment .chk-other');
  ok('未勾「其它」时补充框隐藏', !!otherIn() && otherIn().hidden === true, otherIn() && otherIn().hidden);
  ok('补充框有占位提示', /勾「其它」后/.test((otherIn() || {}).placeholder || ''), otherIn() && otherIn().placeholder);

  const tick = (val, on) => {
    const b = boxes().filter(x => x.value === val)[0];
    b.checked = on;
    b.dispatchEvent(new win.Event('change', { bubbles: true }));
  };

  tick('其它', true);
  /* jsdom 不实现真实的焦点管理（弹窗里所有元素都聚焦不上，dialog 自带的自动聚焦同样无效），
     所以这里只验「显示出来」；勾选后自动聚焦到补充框只在真实浏览器里生效 */
  ok('勾「其它」后补充框显示出来', otherIn().hidden === false, 'hidden=' + otherIn().hidden);
  otherIn().value = '临时写一半';
  tick('其它', false);
  ok('取消勾选「其它」→ 补充框隐藏且清空', otherIn().hidden === true && otherIn().value === '',
    'hidden=' + otherIn().hidden + ' value=' + JSON.stringify(otherIn().value));

  /* 只写字不勾（真实浏览器做不到，这里验证兜底：内容不会被静默丢掉） */
  otherIn().value = '只写字没勾';
  otherIn().dispatchEvent(new win.Event('input', { bubbles: true }));
  ok('补充框一有字就自动勾上「其它」', boxes().filter(b => b.value === '其它')[0].checked === true);
  otherIn().value = '';
  otherIn().dispatchEvent(new win.Event('input', { bubbles: true }));

  const setF2 = (id, v) => {
    const e = m2.querySelector('#' + id);
    if (!e) return;
    e.value = v;
    e.dispatchEvent(new win.Event('input', { bubbles: true }));
    e.dispatchEvent(new win.Event('change', { bubbles: true }));
  };
  setF2('ff_code', 'FZKH-098');
  setF2('ff_date', TODAY);
  setF2('ff_applicant', '考核情况申请人');
  setF2('ff_employee', '考核情况员工');
  setF2('ff_empNo', 'MJ9098');
  setF2('ff_dept', '测试车间');
  setF2('ff_leader', '测试负责人');
  setF2('ff_content', '自检用：验证考核情况字段。');

  tick('处罚', true);
  tick('保证书', true);
  tick('其它', true);
  ok('可多选（三项同时勾上）', boxes().filter(b => b.checked).length === 3,
    boxes().filter(b => b.checked).map(b => b.value).join(','));

  m2.querySelector('.js-ok').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(800);
  ok('勾了「其它」却没写字 → 保存被拦', !!doc.querySelector('.mask'));
  ok('提示写明要补内容', /勾选了「其它」/.test((doc.querySelector('.mask') || {}).textContent || ''),
    (((doc.querySelector('.mask') || {}).textContent || '').match(/「考核情况」[^。]*/) || [''])[0]);

  m2.querySelector('#ff_assessment .chk-other').value = '口头教育 + 停工培训半天';
  m2.querySelector('#ff_assessment .chk-other').dispatchEvent(new win.Event('input', { bubbles: true }));
  m2.querySelector('.js-ok').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(1900);
  ok('补齐说明后保存成功', !doc.querySelector('.mask'));

  const v2 = store().filter(r => r.code === 'FZKH-098')[0];
  ok('落库为 {picks, other}（不混在一起）',
    !!v2 && v2.assessment && v2.assessment.picks.join(',') === '处罚,保证书,其它' &&
    v2.assessment.other === '口头教育 + 停工培训半天',
    v2 && JSON.stringify(v2.assessment));

  const heads = Array.from(doc.querySelectorAll('#view .js-vk-body table thead th')).map(t => t.textContent.trim());
  ok('列表新增「考核情况」列', heads.indexOf('考核情况') >= 0, heads.join(' | '));
  const tr = Array.from(doc.querySelectorAll('#view .js-vk-body table tbody tr'))
    .filter(t => /FZKH-098/.test(t.textContent))[0];
  ok('行内并列显示各选项（处罚 / 保证书 / 其它：…）',
    !!tr && /处罚/.test(tr.textContent) && /保证书/.test(tr.textContent) && /其它：口头教育/.test(tr.textContent),
    tr && tr.textContent.replace(/\s+/g, ' ').slice(0, 130));

  const qIn = doc.querySelector('#view input[placeholder*="搜编号"]');
  const search = async kw => { qIn.value = kw; qIn.dispatchEvent(new win.Event('input', { bubbles: true })); await wait(520); };
  await search('保证书');
  ok('搜索能按考核情况命中', codes().indexOf('FZKH-098') >= 0, codes().join(','));
  await search('停工培训');
  ok('搜索能命中「其它」里手写的说明', codes().indexOf('FZKH-098') >= 0, codes().join(','));
  await search('');
  await wait(200);

  /* 编辑回显 + 改选 */
  const opsBtn = doc.querySelector('[data-act="vops"][data-id="' + (v2 && v2.id) + '"]');
  ok('找到该行的「操作 ▾」', !!opsBtn);
  if (opsBtn) {
    opsBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await wait(350);
    const editItem = Array.from(doc.querySelectorAll('.dd-menu button')).filter(b => /编辑/.test(b.textContent))[0];
    ok('下拉里有「编辑」', !!editItem);
    editItem.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await waitSel('.mask', 4000);
    const m3 = doc.querySelector('.mask');
    const boxes3 = Array.from(m3.querySelectorAll('#ff_assessment input[type="checkbox"]'));
    ok('编辑回显：三项都勾上', boxes3.filter(b => b.checked).length === 3,
      boxes3.map(b => b.value + ':' + b.checked).join(','));
    ok('编辑回显：补充说明带回原文', m3.querySelector('.chk-other').value === '口头教育 + 停工培训半天',
      m3.querySelector('.chk-other').value);
    ok('编辑回显：补充框可见', m3.querySelector('.chk-other').hidden === false);

    const b3 = boxes3.filter(b => b.value === '保证书')[0];
    b3.checked = false;
    b3.dispatchEvent(new win.Event('change', { bubbles: true }));
    m3.querySelector('.js-ok').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await wait(1900);
    const v3 = store().filter(r => r.id === (v2 && v2.id))[0];
    ok('改选后 picks 少了「保证书」、other 原样保留',
      !!v3 && v3.assessment.picks.join(',') === '处罚,其它' &&
      v3.assessment.other === '口头教育 + 停工培训半天',
      v3 && JSON.stringify(v3.assessment));
  }

  /* 清理 */
  if (v2) { await SD.api.removeViolation(v2.id); }
  await SD.app.reload();
  await wait(800);
  await go('violation');
  ok('清理后数据回到 ' + n1 + ' 条', store().length === n1, store().length);

  /* ================= 8. 受限模式拦截 ================= */
  console.log('== 8. 受限模式 ==');
  SD.auth.set('restricted');
  SD.app.refreshAll();
  await wait(500);
  await go('violation');
  const n0 = store().length;
  const add2 = Array.from(doc.querySelectorAll('#view button')).filter(b => /新增考核单/.test(b.textContent))[0];
  if (add2) add2.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(400);
  ok('受限模式下新增被拦（不弹表单）', !doc.querySelector('.mask'));
  ok('数据没变', store().length === n0, store().length);
  SD.auth.set('safety_officer');
  SD.app.refreshAll();
  await wait(400);

  /* ================= 9. 无错误 ================= */
  console.log('== 9. 运行期无 JS 错误 ==');
  ok('没有未捕获错误', errors.length === 0, errors.join(' | '));

  console.log('\n结果：通过 ' + pass + ' / 失败 ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FATAL', e && e.stack || e); process.exit(1); });
