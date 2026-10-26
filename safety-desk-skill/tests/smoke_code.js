/* 安全员工作台 · 单据编号 冒烟自检
   用法：node smoke_code.js [url]
   覆盖：规则表 → 编号默认顺延填入（可手动修改）→ 三类校验（空/格式/重复）
        → 编辑时不改号不被自己拦 → 各类型编号体系互不干扰 → 历史格式兼容（两代老号）
        → 数据层兜底（空号拒收/撞号拒收）→ 导入校验 → 配置可改（前缀/位数）
   ★ 2026-10-24 起七类各用各的编号：FZYH-0000001 / FZXJ-2026-001 / FZPX-2026-001 /
     FZTG-2026-001 / FZZY-0000001 / TZZY-001 / 证书 ZGZS-001（2026-10-25 定）
   ★ 2026-10-24 起编号「默认顺延填入下一个可用编号，仍可手动修改」：
     新增表单预填 SD.code.next(type)（最大序号 +1，撞号跳过，带年份的按年归 1），
     保存仍走「空 / 格式 / 同类型唯一」三道校验，数据层不自动补号。
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
  // 2026-10-25：工作台默认「受限用户」，测试先解锁为安全员（等同输入六位密码）
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
  const set = (m, id, v) => { const e = m.querySelector('#' + id); if (e) e.value = v; return !!e; };
  const submit = async (m, ms = 1700) => {
    m.querySelector('.js-ok').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await wait(ms);
  };
  const cancel = async m => {
    m.querySelector('.js-cancel').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await wait(250);
  };
  const errText = m => { const e = m && m.querySelector('.field-err'); return e && !e.hidden ? e.textContent : ''; };
  const pickOps = async (act, re, id) => {
    const sel = '#view [data-act="' + act + '"]' + (id ? '[data-id="' + id + '"]' : '');
    const btn = doc.querySelector(sel);
    if (!btn) return { ok: false, why: 'no-btn' };
    const rid = btn.dataset.id;
    btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await wait(220);
    const menu = doc.querySelector('.dd-menu');
    if (!menu) return { ok: false, id: rid, why: 'no-menu' };
    const item = Array.from(menu.querySelectorAll('.dd-item')).find(x => re.test(x.textContent || ''));
    if (!item) return { ok: false, id: rid, why: 'no-item' };
    item.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await wait(240);
    return { ok: true, id: rid };
  };

  const Y = String(new Date().getFullYear());

  /* ================= 1. 规则表与纯函数 ================= */
  console.log('== 1. 编号规则（config.codeRules 驱动） ==');
  ok('SD.code 已挂载', !!SD.code && typeof SD.code.check === 'function');
  const TYPES = ['hazard', 'inspection', 'training', 'certificate', 'notice', 'special', 'permit'];
  ok('七类单据规则齐全', TYPES.every(t => SD.CONFIG.codeRules[t] && SD.CONFIG.codeRules[t].prefix),
    TYPES.map(t => t + '=' + (SD.CONFIG.codeRules[t] || {}).prefix).join(' '));
  const EXPECT = {
    hazard:      { prefix: 'FZYH', withYear: false, seqLen: 7, sample: 'FZYH-0000001' },
    inspection:  { prefix: 'FZXJ', withYear: true,  seqLen: 3, sample: 'FZXJ-' + Y + '-001' },
    training:    { prefix: 'FZPX', withYear: true,  seqLen: 3, sample: 'FZPX-' + Y + '-001' },
    certificate: { prefix: 'ZGZS', withYear: false, seqLen: 3, sample: 'ZGZS-001' },
    notice:      { prefix: 'FZTG', withYear: true,  seqLen: 3, sample: 'FZTG-' + Y + '-001' },
    special:     { prefix: 'TZZY', withYear: false, seqLen: 3, sample: 'TZZY-001' },
    permit:      { prefix: 'FZZY', withYear: false, seqLen: 7, sample: 'FZZY-0000001' }
  };
  ok('八类前缀各按各的体系（FZYH/FZXJ/FZPX/ZGZS/FZTG/TZZY/FZZY/TZSB）',
    TYPES.every(t => SD.CONFIG.codeRules[t].prefix === EXPECT[t].prefix),
    TYPES.map(t => t + '=' + SD.CONFIG.codeRules[t].prefix).join(' '));
  ok('带年份的三类：巡检/培训/通知（前缀-年-序号）',
    ['inspection', 'training', 'notice'].every(t => SD.CONFIG.codeRules[t].withYear === true));
  ok('不带年份的四类：隐患/证书/人员/作业票（前缀-序号）',
    ['hazard', 'certificate', 'special', 'permit'].every(t => SD.CONFIG.codeRules[t].withYear === false));
  ok('序号位数：隐患/作业票 7 位，巡检/培训/通知 3 位，人员 3 位',
    SD.CONFIG.codeRules.hazard.seqLen === 7 && SD.CONFIG.codeRules.permit.seqLen === 7 &&
    SD.CONFIG.codeRules.inspection.seqLen === 3 && SD.CONFIG.codeRules.training.seqLen === 3 &&
    SD.CONFIG.codeRules.notice.seqLen === 3 && SD.CONFIG.codeRules.special.seqLen === 3);
  ok('示例编号各按各的格式（placeholder 同款）',
    TYPES.every(t => SD.code.sample(t) === EXPECT[t].sample),
    TYPES.map(t => t + '=' + SD.code.sample(t)).join(' '));
  ok('SD.code.next 存在（新增表单的默认值生成器）', typeof SD.code.next === 'function');
  ok('数据层没有自动补号入口（nextCode 未复活）', typeof SD.api.nextCode !== 'function');

  console.log('== 1.5 默认值生成：顺延 / 跳撞号 / 按年归 1 ==');
  // 示例数据：巡检 9 条（FZXJ-2026-001~009）→ 下一个应为 010
  ok('巡检 next 顺延到 FZXJ-' + Y + '-010（示例池 9 条）',
    SD.code.next('inspection') === 'FZXJ-' + Y + '-010', SD.code.next('inspection'));
  ok('隐患 next 顺延到 FZYH-0000013（示例池 12 条）',
    SD.code.next('hazard') === 'FZYH-0000013', SD.code.next('hazard'));
  ok('作业票 next 顺延到 FZZY-0000009（示例池 8 条）',
    SD.code.next('permit') === 'FZZY-0000009', SD.code.next('permit'));
  ok('人员 next 顺延到 TZZY-009（示例池 8 条）',
    SD.code.next('special') === 'TZZY-009', SD.code.next('special'));
  ok('培训 next 顺延到 FZPX-' + Y + '-005（示例池 4 条）',
    SD.code.next('training') === 'FZPX-' + Y + '-005', SD.code.next('training'));
  ok('通知 next 顺延到 FZTG-' + Y + '-005（示例池 4 条）',
    SD.code.next('notice') === 'FZTG-' + Y + '-005', SD.code.next('notice'));
  ok('证书 next 顺延到 ZGZS-008（示例池 7 条）',
    SD.code.next('certificate') === 'ZGZS-008', SD.code.next('certificate'));
  // 撞号跳过：往巡检池塞一条 010，next 应跳到 011
  {
    const pool = SD.app.state.data.inspections;
    const fake = Object.assign({}, pool[0], { id: 'INS-NEXT-DUP', code: 'FZXJ-' + Y + '-010' });
    pool.push(fake);
    ok('撞号自动跳过（池里已有 010 → 生成 011）',
      SD.code.next('inspection') === 'FZXJ-' + Y + '-011', SD.code.next('inspection'));
    pool.pop();
    ok('移除后恢复顺延 010', SD.code.next('inspection') === 'FZXJ-' + Y + '-010');
  }
  // 带年份的类型：明年的号不参与今年顺延
  {
    const pool = SD.app.state.data.inspections;
    const nextYear = String(Number(Y) + 1);
    const fake = Object.assign({}, pool[0], { id: 'INS-NEXT-Y2', code: 'FZXJ-' + nextYear + '-050' });
    pool.push(fake);
    ok('明年的号不参与今年顺延（仍为 010）',
      SD.code.next('inspection') === 'FZXJ-' + Y + '-010', SD.code.next('inspection'));
    pool.pop();
  }
  // 老编号不参与顺延（一代 HZ / 二代 FZ-7位）
  {
    const pool = SD.app.state.data.inspections;
    const fake = Object.assign({}, pool[0], { id: 'INS-NEXT-LEGACY', code: 'HZ-2026-099' });
    pool.push(fake);
    ok('一代老编号不参与顺延（仍为 010）',
      SD.code.next('inspection') === 'FZXJ-' + Y + '-010', SD.code.next('inspection'));
    pool.pop();
  }
  ok('next 生成的号本身能过校验', SD.code.check('inspection', SD.code.next('inspection')) === null,
    SD.code.next('inspection'));

  console.log('== 2. 校验：空 / 格式 / 重复 ==');
  ok('空 → 提示不能为空', /不能为空/.test(SD.code.check('hazard', '') || ''), SD.code.check('hazard', ''));
  ok('纯空格 → 提示不能为空', /不能为空/.test(SD.code.check('hazard', '   ') || ''));
  ok('格式不符 → 提示应形如示例',
    /格式应形如/.test(SD.code.check('hazard', 'ABC-1') || ''), SD.code.check('hazard', 'ABC-1'));
  ok('序号位数不足（FZYH-001）不放行', !!SD.code.check('hazard', 'FZYH-001'), SD.code.check('hazard', 'FZYH-001'));
  ok('隐患号不带年份（FZYH-2026-0000001）不放行',
    !!SD.code.check('hazard', 'FZYH-2026-0000001'), SD.code.check('hazard', 'FZYH-2026-0000001'));
  ok('串台：巡检号填进隐患（FZXJ-2026-001）不放行',
    !!SD.code.check('hazard', 'FZXJ-' + Y + '-001'), SD.code.check('hazard', 'FZXJ-' + Y + '-001'));
  ok('重复 → 提示已存在',
    /已存在/.test(SD.code.check('hazard', 'FZYH-0000001') || ''), SD.code.check('hazard', 'FZYH-0000001'));
  ok('大小写不同也判重复',
    !!SD.code.check('hazard', 'fzyh-0000001'), SD.code.check('hazard', 'fzyh-0000001'));
  ok('合法且不重复 → 通过', SD.code.check('hazard', 'FZYH-0000777') === null);
  const hz1 = SD.app.state.summary.hazards.find(x => x.code === 'FZYH-0000001');
  ok('编辑自身（传 id）不判重复',
    SD.code.check('hazard', 'FZYH-0000001', { id: hz1 && hz1.id }) === null, hz1 && hz1.id);

  console.log('== 3. 各类型编号体系互不干扰（池子各自独立） ==');
  ok('隐患号在隐患池里判重', SD.code.isDup('hazard', 'FZYH-0000001') === true);
  ok('作业票号在作业票池里判重', SD.code.isDup('permit', 'FZZY-0000001') === true);
  ok('巡检号在巡检池里判重', SD.code.isDup('inspection', 'FZXJ-' + Y + '-001') === true);
  ok('人员号在人员池里判重', SD.code.isDup('special', 'TZZY-001') === true);
  ok('第 9 号只在隐患池（作业票只有 8 条）→ 作业票池不判重',
    SD.code.isDup('hazard', 'FZYH-0000009') === true && SD.code.isDup('permit', 'FZZY-0000009') === false);
  ok('两类池子彼此独立（互不借号、互不撞号）',
    SD.code.isDup('permit', 'FZZY-0000012') === false && SD.code.isDup('hazard', 'FZYH-0000012') === true);

  console.log('== 4. 历史数据格式兼容（老编号仍可保存） ==');
  ok('一代老编号 HZ-2026-001 可过', SD.code.patternOf('hazard').test('HZ-2026-001'));
  ok('一代老编号 WP-2026-041 可过', SD.code.patternOf('permit').test('WP-2026-041'));
  ok('一代老编号 CT-001（无年份）可过', SD.code.patternOf('certificate').test('CT-001'));
  ok('一代老编号 TR-2026-09（两位序号）可过', SD.code.patternOf('training').test('TR-2026-09'));
  ok('二代老编号 FZ-0000001（10-22 统一期）可过', SD.code.patternOf('hazard').test('FZ-0000001'));
  ok('二代老号只放行 7 位：FZ-001 不放行', !SD.code.patternOf('hazard').test('FZ-001'));
  ok('二代老号只放行 7 位：FZ-2026-001 不放行', !SD.code.patternOf('hazard').test('FZ-2026-001'));
  const POOLS = ['hazards', 'inspections', 'trainings', 'certificates', 'notices', 'specialPersonnel', 'workPermits'];
  const RE = {
    hazards: /^FZYH-\d{7}$/, inspections: /^FZXJ-\d{4}-\d{3}$/, trainings: /^FZPX-\d{4}-\d{3}$/,
    certificates: /^ZGZS-\d{3}$/, notices: /^FZTG-\d{4}-\d{3}$/,
    specialPersonnel: /^TZZY-\d{3}$/, workPermits: /^FZZY-\d{7}$/
  };
  const allNew = POOLS.every(k => (SD.app.state.summary[k] || []).length > 0 &&
    (SD.app.state.summary[k] || []).every(x => RE[k].test(x.code || '')));
  ok('示例数据已全部换成各类型新格式', allNew,
    POOLS.map(k => k + '=' + (SD.app.state.summary[k] || [])[0].code).join(' '));

  /* ================= 5. 巡检表单：默认顺延填入 / 可手改 / 三类拦截 ================= */
  console.log('== 5. 巡检表单 ==');
  await go('inspection');
  const i0 = SD.app.state.summary.inspections.length;
  ok('找到「新增巡检」按钮', clickText('#view .btn', /新增巡检/));
  await wait(240);
  let m = modal();
  ok('弹窗打开', !!m);
  ok('有编号输入框', !!m.querySelector('#ff_code'));
  ok('没有「默认」按钮（默认值直接预填，不需要按钮）', !m.querySelector('.js-code-def'));
  const nextCode = SD.code.next('inspection');
  ok('编号默认顺延填入下一个可用编号（FZXJ-' + Y + '-010）',
    !!m && m.querySelector('#ff_code').value === nextCode,
    m && m.querySelector('#ff_code').value);
  ok('placeholder 给示例编号 FZXJ-' + Y + '-001',
    (m.querySelector('#ff_code').placeholder || '') === 'FZXJ-' + Y + '-001',
    m.querySelector('#ff_code').placeholder);
  ok('编号输入框可编辑（非 readonly）', !m.querySelector('#ff_code').readOnly);
  ok('表单里有「状态」下拉（2026-10-24 起状态改为编辑内可选项）',
    !!m.querySelector('#ff_status'), m && !!m.querySelector('#ff_status'));
  ok('状态默认「待执行」',
    !!m.querySelector('#ff_status') && m.querySelector('#ff_status').value === 'planned',
    m && m.querySelector('#ff_status') && m.querySelector('#ff_status').value);

  // 清空 → 拦截
  set(m, 'ff_planName', '编号冒烟-巡检'); set(m, 'ff_area', 'A 区'); set(m, 'ff_executor', '王安全');
  set(m, 'ff_code', '');
  await submit(m, 600);
  ok('清空编号 → 报错且不保存', /不能为空/.test(errText(modal())) && SD.app.state.summary.inspections.length === i0,
    errText(modal()));

  // 格式不符 → 拦截
  set(m, 'ff_code', 'ABC-1');
  await submit(m, 600);
  ok('格式不符 → 报错且不保存', /格式应形如/.test(errText(modal())) && SD.app.state.summary.inspections.length === i0,
    errText(modal()));

  // 格式不符（隐患号串台）→ 拦截
  set(m, 'ff_code', 'FZYH-0000001');
  await submit(m, 600);
  ok('隐患号填进巡检 → 报错且不保存', /格式应形如/.test(errText(modal())) && SD.app.state.summary.inspections.length === i0,
    errText(modal()));

  // 重复 → 拦截
  set(m, 'ff_code', 'FZXJ-' + Y + '-001');
  await submit(m, 600);
  ok('编号重复 → 报错且不保存', /已存在/.test(errText(modal())) && SD.app.state.summary.inspections.length === i0,
    errText(modal()));

  // 直接用预填的默认编号提交 → 保存成功（不手改也能用）
  set(m, 'ff_code', nextCode);
  await submit(m);
  const i1 = SD.app.state.summary.inspections.length;
  ok('预填编号可直接提交，记录 +1', i1 === i0 + 1, i0 + ' → ' + i1);
  const made = SD.app.state.summary.inspections.find(x => x.planName === '编号冒烟-巡检');
  ok('落库的正是预填编号', made && made.code === nextCode, made && made.code);

  // 再建一条：默认编号应顺延到 011（说明默认值跟着池子走）
  ok('再点「新增巡检」', clickText('#view .btn', /新增巡检/));
  await wait(240);
  m = modal();
  ok('第二条默认编号顺延为 FZXJ-' + Y + '-011',
    !!m && m.querySelector('#ff_code').value === 'FZXJ-' + Y + '-011',
    m && m.querySelector('#ff_code').value);
  // 手改成自定义号 → 保存成功并落库
  set(m, 'ff_planName', '编号冒烟-巡检2'); set(m, 'ff_area', 'B 区'); set(m, 'ff_executor', '王安全');
  set(m, 'ff_code', 'FZXJ-' + Y + '-900');
  await submit(m);
  const made2 = SD.app.state.summary.inspections.find(x => x.planName === '编号冒烟-巡检2');
  ok('手改自定义编号可保存，落库为手填值', !!made2 && made2.code === 'FZXJ-' + Y + '-900', made2 && made2.code);

  console.log('== 6. 巡检编辑：不改号不拦 / 改成别人的号要拦 ==');
  await go('inspection');
  const ops = await pickOps('iops', /编辑/, made && made.id);
  ok('能对刚建的记录点「编辑」', ops.ok, ops.why || '');
  m = modal();
  ok('编辑弹窗带出原编号（预填值原样回显）',
    !!m && m.querySelector('#ff_code').value === (made && made.code),
    m && m.querySelector('#ff_code').value);
  ok('编辑弹窗状态下拉带出当前状态',
    !!m && !!m.querySelector('#ff_status') && m.querySelector('#ff_status').value === (made && made.status),
    m && m.querySelector('#ff_status') && m.querySelector('#ff_status').value);
  set(m, 'ff_planName', '编号冒烟-巡检（已改名）');
  await submit(m);
  const after = SD.app.state.summary.inspections.find(x => x.id === (made && made.id));
  ok('不改编号能正常保存', after && after.planName === '编号冒烟-巡检（已改名）', after && after.planName);
  ok('编号保持不变', after && after.code === (made && made.code), after && after.code);

  await go('inspection');
  const ops2 = await pickOps('iops', /编辑/, made && made.id);
  m = modal();
  if (ops2.ok && m) {
    set(m, 'ff_code', 'FZXJ-' + Y + '-002');
    await submit(m, 600);
    ok('编辑改成他人编号 → 拦截', /已存在/.test(errText(modal())), errText(modal()));
    await cancel(modal());
  } else {
    ok('编辑改成他人编号 → 拦截', false, 'no-dialog');
  }

  /* ================= 7. 其它单据表单都有编号字段 ================= */
  console.log('== 7. 七类单据表单均带编号字段（默认顺延填入） ==');
  const CHECKS = [
    ['training', /新增培训/, '培训', 'training'],
    ['notice', /发布通知/, '通知', 'notice'],
    ['specPersonnel', /新增人员/, '特种人员', 'special'],
    ['specPermit', /新增作业票/, '作业票', 'permit']
  ];
  for (const [route, re, label, codeType] of CHECKS) {
    await go(route);
    const found = clickText('#view .btn', re);
    await wait(260);
    const d = modal();
    const has = !!d && !!d.querySelector('#ff_code');
    const val = has ? d.querySelector('#ff_code').value : '';
    const expect = SD.code.next(codeType);
    ok(label + '表单有编号输入框且默认顺延填入', found && has && val === expect,
      val + '（期望 ' + expect + '）' + (found ? '' : ' 无按钮'));
    ok(label + '编号输入框可编辑', has && !d.querySelector('#ff_code').readOnly);
    if (d) await cancel(d);
  }

  /* ================= 8. 隐患登记弹窗（手写表单） ================= */
  console.log('== 8. 隐患登记弹窗 ==');
  await go('hazard');
  ok('找到「登记隐患」按钮', clickText('#view .btn', /登记隐患/));
  await wait(260);
  m = modal();
  ok('弹窗打开', !!m);
  ok('有隐患编号输入框', !!m.querySelector('#f_code'));
  ok('编号默认顺延填入 FZYH-0000013（12 条之后）',
    m.querySelector('#f_code').value === 'FZYH-0000013',
    JSON.stringify(m.querySelector('#f_code').value));
  ok('没有「默认」按钮（默认值直接预填）', !m.querySelector('.js-code-def'));
  const h0 = SD.app.state.summary.hazards.length;

  set(m, 'f_code', '');
  await submit(m, 600);
  ok('清空编号 → 报错', /不能为空/.test(errText(modal())), errText(modal()));

  set(m, 'f_code', 'FZYH-ABC');
  await submit(m, 600);
  ok('格式不符 → 报错', /格式应形如/.test(errText(modal())), errText(modal()));

  set(m, 'f_code', 'FZYH-0000002');
  await submit(m, 600);
  ok('编号重复 → 报错', /已存在/.test(errText(modal())), errText(modal()));

  set(m, 'f_code', 'FZYH-0000888');
  set(m, 'f_title', '编号冒烟-隐患');
  await submit(m);
  const h1 = SD.app.state.summary.hazards.length;
  ok('自定义编号可保存，隐患 +1', h1 === h0 + 1, h0 + ' → ' + h1);
  const hzMade = SD.app.state.summary.hazards.find(x => x.title === '编号冒烟-隐患');
  ok('落库的是手填编号', hzMade && hzMade.code === 'FZYH-0000888', hzMade && hzMade.code);

  /* ================= 9. 数据层兜底 ================= */
  console.log('== 9. 数据层：直接调 API 空号/撞号都要拦 ==');
  let apiErr = '';
  await SD.api.createInspection({ code: 'FZXJ-' + Y + '-001', planName: '兜底测试', area: 'X', executor: 'Y', scheduledDate: SD.utils.today() })
    .catch(e => { apiErr = e && e.message || 'err'; });
  ok('createInspection 撞号被拒', /已存在/.test(apiErr), apiErr);
  let emptyErr = '';
  await SD.api.createInspection({ code: '', planName: '兜底测试-空号', area: 'X', executor: 'Y', scheduledDate: SD.utils.today() })
    .catch(e => { emptyErr = e && e.message || 'err'; });
  ok('createInspection 空号被拒', /不能为空/.test(emptyErr), emptyErr);
  let blankErr = '';
  await SD.api.createHazard({ code: '   ', title: '兜底测试-纯空格号', dueDate: SD.utils.today() })
    .catch(e => { blankErr = e && e.message || 'err'; });
  ok('createHazard 纯空格号被拒', /不能为空/.test(blankErr), blankErr);
  let updErr = '';
  await SD.api.updateInspection(made.id, { code: 'FZXJ-' + Y + '-003' }).catch(e => { updErr = e && e.message || 'err'; });
  ok('updateInspection 撞号被拒', /已存在/.test(updErr), updErr);
  let okUpd = null;
  await SD.api.updateInspection(made.id, { code: 'FZXJ-' + Y + '-901' }).then(r => { okUpd = r; }).catch(e => { updErr = e.message; });
  ok('改成未占用编号可保存', okUpd && okUpd.code === 'FZXJ-' + Y + '-901', okUpd && okUpd.code);

  /* ================= 9.5 导入校验 ================= */
  console.log('== 9.5 导入：空号/重号拒入，合法放行 ==');
  const cur = SD.store.exportJSON();
  const bak = JSON.parse(cur);
  // 构造「一条空号 + 一条重号」的问题备份
  const badBak = JSON.parse(cur);
  badBak.data = badBak.data || bak.data;
  const insArr = (badBak.data.inspections || []).slice();
  insArr[0] = Object.assign({}, insArr[0], { code: '' });
  insArr.push(Object.assign({}, insArr[1], { id: 'INS-BAD-DUP' }));
  badBak.data.inspections = insArr;
  const badRes = SD.store.importJSON(JSON.stringify(badBak));
  ok('含空号/重号的备份被拒', badRes.ok === false && /编号校验未通过/.test(badRes.msg), badRes.msg);
  ok('拒入后原数据未被动', SD.store.data().inspections.length === bak.data.inspections.length);
  const goodRes = SD.store.importJSON(cur);
  ok('原样导回成功', goodRes.ok === true, goodRes.msg);

  /* ================= 10. 配置可改（前缀 / 位数） ================= */
  console.log('== 10. 改配置即可换编号样式 ==');
  const oldRule = Object.assign({}, SD.CONFIG.codeRules.hazard);
  SD.CONFIG.codeRules.hazard = Object.assign({}, oldRule, { prefix: 'YH', seqLen: 4 });
  ok('换前缀后新格式放行', SD.code.check('hazard', 'YH-0001') === null, SD.code.check('hazard', 'YH-0001'));
  ok('换前缀后别类新号被拒（FZXJ-2026-001 不是隐患号）',
    !!SD.code.check('hazard', 'FZXJ-' + Y + '-001'));
  ok('序号位数跟着变（4 位不再放行 7 位）', !!SD.code.check('hazard', 'YH-0000001'));
  ok('换配置后默认值跟着规则变（next 生成 YH-0001）',
    SD.code.next('hazard') === 'YH-0001', SD.code.next('hazard'));
  SD.CONFIG.codeRules.hazard = oldRule;
  ok('配置改回后规则复原', SD.code.check('hazard', 'FZYH-0000777') === null);
  ok('改回后二代老号仍按兼容放行', SD.code.check('hazard', 'FZ-0000001', { id: 'no-such' }) === null,
    SD.code.check('hazard', 'FZ-0000001', { id: 'no-such' }));

  console.log('== 11. 无 JS 报错 ==');
  ok('运行期无 JS 错误', errors.length === 0, errors.join(' | '));

  console.log('\n结果：通过 ' + pass + ' / 失败 ' + fail);
  dom.window.close();
  process.exit(fail ? 1 : 0);
})();
