/* 安全员工作台 · 危险作业票「按作业类型动态编号」冒烟自检
   用法：node smoke_permitcode.js [url]
   覆盖：
     1. 拼音首字母表（pinyin.js）可用、覆盖率与取字结果
     2. 前缀分配：FZ + 类型名前两字首字母（吊装作业 → FZDZ）
     3. 序号：各前缀各自顺延、7 位补零、跳撞号
     4. 特殊类型：单字（焊 → H）、无汉字（LOTO → LT）、全符号（QT）、
        首字母撞车（受限空间/射线探伤/水下 都是 SX → SX / SXT / SXZ）
     5. 校验：格式、旧号放行、跨类型前缀给软提示、大小写归一
     6. 表单联动：新增默认填当前类型号、切类型自动换前缀、手改后不覆盖、
        编辑老记录不擅自改号
     7. 落库后序号池独立，互不借号
   ★ 2026-10-28 起生效
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
  SD.auth.set('safety_officer');
  if (SD.app.refreshAll) SD.app.refreshAll();
  await wait(300);

  if (!SD || !SD.app) { console.log('FATAL: SD 未初始化'); process.exit(1); }
  const doc = win.document;
  /* 字典可能在 SD.mock（演示版）或 SD.dict（空白版）里，两种都吃 */
  const DICT = (SD.mock && SD.mock.DICT ? SD.mock.DICT : SD.dict.DICT).permitType;
  /* 空白版没有预置作业票：先按新规则铺 8 张（每类 0000001），后面的
     「各前缀独立顺延 / 编辑老记录」才有对象可测 */
  if ((SD.app.state.summary.workPermits || []).length === 0) {
    const T = SD.utils.today();
    for (const t of DICT) {
      await SD.api.createWorkPermit({
        code: SD.code.prefixOf('permit', t) + '-0000001', type: t, location: '引导-' + t,
        dept: '安环部', applicant: '测试员', leader: '测试员', guardian: '孙浩',
        workers: [], risk: '', measures: '', planStart: T, planEnd: T, status: 'draft'
      });
    }
    await SD.app.reload();
    await wait(300);
  }
  const go = async r => { win.location.hash = '#/' + r; await wait(320); };
  const clickText = (sel, re) => {
    const b = Array.from(doc.querySelectorAll(sel)).find(x => re.test(x.textContent || ''));
    if (b) b.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    return !!b;
  };
  const modal = () => doc.querySelector('.mask');
  const set = (m, id, v) => { const e = m.querySelector('#' + id); if (e) e.value = v; return !!e; };
  const changeSel = (m, id, v) => {
    const e = m.querySelector('#' + id);
    if (!e) return false;
    e.value = v;
    e.dispatchEvent(new win.Event('change', { bubbles: true }));
    return true;
  };
  const submit = async (m, ms = 1500) => {
    m.querySelector('.js-ok').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await wait(ms);
  };
  const cancel = async m => {
    m.querySelector('.js-cancel').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await wait(250);
  };
  const errText = m => { const e = m && m.querySelector('.field-err'); return e && !e.hidden ? e.textContent : ''; };
  const pickOps = async (act, re, id) => {
    const btn = doc.querySelector('#view [data-act="' + act + '"][data-id="' + id + '"]');
    if (!btn) return { ok: false, why: 'no-btn' };
    btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await wait(220);
    const menu = doc.querySelector('.dd-menu');
    if (!menu) return { ok: false, why: 'no-menu' };
    const item = Array.from(menu.querySelectorAll('.dd-item')).find(x => re.test(x.textContent || ''));
    if (!item) return { ok: false, why: 'no-item' };
    item.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await wait(240);
    return { ok: true, id };
  };

  /* ================= 1. 拼音首字母表 ================= */
  console.log('== 1. 拼音首字母表（pinyin.js） ==');
  ok('SD.pinyin 已挂载', !!(SD.pinyin && typeof SD.pinyin.initials === 'function'));
  ok('字表覆盖 GB2312 一二级（6763 字）', SD.pinyin.size() === 6763, SD.pinyin.size());
  ok('钓装/吊装首字母正确（吊 → D，装 → Z）',
    SD.pinyin.initials('吊装', 2) === 'DZ', SD.pinyin.initials('吊装', 2));
  ok('多字取前两位', SD.pinyin.initials('受限空间', 2) === 'SX', SD.pinyin.initials('受限空间', 2));
  ok('标点/空格不占位', SD.pinyin.initials('吊 装（作业）', 2) === 'DZ', SD.pinyin.initials('吊 装（作业）', 2));
  ok('拉丁字母原样转大写', SD.pinyin.initials('loto', 2) === 'LO', SD.pinyin.initials('loto', 2));
  ok('生僻字取不到 → 空串', SD.pinyin.initial('𠀀') === '', JSON.stringify(SD.pinyin.initial('𠀀')));

  /* ================= 2. 八类前缀 ================= */
  console.log('== 2. 前缀分配（FZ + 类型名前两字首字母） ==');
  ok('规则表：permit 前缀 = FZ + 动态（prefixFrom=type）',
    SD.code.rule('permit').prefix === 'FZ' && SD.code.rule('permit').prefixFrom === 'type',
    JSON.stringify(SD.code.rule('permit')));
  const MAP = {
    '动火作业': 'FZDH', '受限空间作业': 'FZSX', '盲板抽堵作业': 'FZMB', '高处作业': 'FZGC',
    '吊装作业': 'FZDZ', '临时用电作业': 'FZLS', '动土作业': 'FZDT', '断路作业': 'FZDL'
  };
  const mapOk = Object.keys(MAP).every(t => SD.code.prefixOf('permit', t) === MAP[t]);
  ok('八种内置类型前缀全部正确', mapOk,
    Object.keys(MAP).map(t => t + '=' + SD.code.prefixOf('permit', t)).join(' '));
  ok('示例编号：吊装作业 → FZDZ-0000001',
    SD.code.sample('permit', '吊装作业') === 'FZDZ-0000001', SD.code.sample('permit', '吊装作业'));
  ok('不指定类型时用字典第一个（动火）→ FZDH-0000001',
    SD.code.sample('permit') === 'FZDH-0000001', SD.code.sample('permit'));
  ok('前缀归属可反查（FZGC 属高处作业）',
    SD.code.prefixOwner('permit', 'FZGC') === '高处作业', SD.code.prefixOwner('permit', 'FZGC'));
  ok('不认识的旧前缀反查为空（FZZY）',
    SD.code.prefixOwner('permit', 'FZZY') === null, SD.code.prefixOwner('permit', 'FZZY'));

  /* ================= 3. 序号：各前缀独立顺延 ================= */
  console.log('== 3. 序号顺延（每个前缀各自 7 位） ==');
  const wpList = SD.app.state.summary.workPermits;
  ok('示例池 8 张，前缀各不相同',
    new Set(wpList.map(p => String(p.code).split('-')[0])).size === 8,
    wpList.map(p => p.code).join(','));
  ok('吊装作业 next → FZDZ-0000002（该前缀已有 1 条）',
    SD.code.next('permit', '吊装作业') === 'FZDZ-0000002', SD.code.next('permit', '吊装作业'));
  ok('盲板抽堵 next → FZMB-0000002',
    SD.code.next('permit', '盲板抽堵作业') === 'FZMB-0000002', SD.code.next('permit', '盲板抽堵作业'));
  ok('高位序号继续补零到 7 位（padSeq 123 → 0000123）',
    SD.code.padSeq('permit', 123, '吊装作业') === 'FZDZ-0000123', SD.code.padSeq('permit', 123, '吊装作业'));
  ok('解析序号只认本前缀（FZGC 的号在吊装下解析为 null）',
    SD.code.seqOf('permit', 'FZGC-0000001', '吊装作业') === null &&
    SD.code.seqOf('permit', 'FZDZ-0000012', '吊装作业').seq === 12,
    JSON.stringify(SD.code.seqOf('permit', 'FZDZ-0000012', '吊装作业')));

  /* ================= 4. 特殊类型 ================= */
  console.log('== 4. 特殊类型：单字 / 无汉字 / 全符号 / 首字母撞车 ==');
  /* 单字类型：临时加进字典，验证「同首字母的两个单字怎么分」 */
  DICT.push('焊', '弧');
  ok('单字类型「焊」→ 只取 1 位（FZH）',
    SD.code.prefixOf('permit', '焊') === 'FZH', SD.code.prefixOf('permit', '焊'));
  ok('同为 H 的第二个单字「弧」→ 加序号（FZH2）',
    SD.code.prefixOf('permit', '弧') === 'FZH2', SD.code.prefixOf('permit', '弧'));
  DICT.splice(DICT.length - 2, 2);
  ok('字典移除后不影响其它类型（动火仍 FZDH）',
    SD.code.prefixOf('permit', '动火作业') === 'FZDH', SD.code.prefixOf('permit', '动火作业'));
  ok('无汉字类型 LOTO作业 → 取前两个字母（FZLO）',
    SD.code.prefixOf('permit', 'LOTO作业') === 'FZLO', SD.code.prefixOf('permit', 'LOTO作业'));
  ok('一个字母都取不到（（））→ 兜底 QT',
    SD.code.prefixOf('permit', '（）') === 'FZQT', SD.code.prefixOf('permit', '（）'));
  ok('撞车：受限空间作业已占 SX，射线探伤作业延长到 SXT',
    SD.code.prefixOf('permit', '射线探伤作业') === 'FZSXT', SD.code.prefixOf('permit', '射线探伤作业'));
  ok('撞车：水下作业延长到 SXZ',
    SD.code.prefixOf('permit', '水下作业') === 'FZSXZ', SD.code.prefixOf('permit', '水下作业'));
  ok('后来者不抢已有前缀（受限空间仍是 FZSX）',
    SD.code.prefixOf('permit', '受限空间作业') === 'FZSX', SD.code.prefixOf('permit', '受限空间作业'));
  ok('新增冲突类型不影响原有类型（动火仍 FZDH、高处仍 FZGC）',
    SD.code.prefixOf('permit', '动火作业') === 'FZDH' && SD.code.prefixOf('permit', '高处作业') === 'FZGC');

  /* ================= 5. 校验 ================= */
  console.log('== 5. 校验：格式 / 旧号 / 跨类型前缀 ==');
  ok('本类型号通过（FZDZ-0000009 + 吊装）',
    SD.code.check('permit', 'FZDZ-0000009', { typeVal: '吊装作业' }) === null,
    SD.code.check('permit', 'FZDZ-0000009', { typeVal: '吊装作业' }));
  const mis = SD.code.check('permit', 'FZGC-0000009', { typeVal: '吊装作业' });
  ok('拿别的类型的号 → 明确提示归属与应填前缀',
    !!mis && /高处作业/.test(mis) && /FZDZ/.test(mis), mis);
  ok('旧通用号 FZZY-0000009 不被拦（历史兼容）',
    SD.code.check('permit', 'FZZY-0000009', { typeVal: '吊装作业' }) === null,
    SD.code.check('permit', 'FZZY-0000009', { typeVal: '吊装作业' }));
  ok('一代老号 WP-2026-041 仍可过',
    SD.code.check('permit', 'WP-2026-041', { typeVal: '吊装作业' }) === null);
  ok('类型改名后的旧前缀不被拦（FZQZ 未登记）',
    SD.code.check('permit', 'FZQZ-0000001', { typeVal: '吊装作业' }) === null);
  ok('序号位数不足 → 格式错误',
    /格式应形如/.test(SD.code.check('permit', 'FZDZ-123', { typeVal: '吊装作业' }) || ''),
    SD.code.check('permit', 'FZDZ-123', { typeVal: '吊装作业' }));
  ok('前缀太长（7 位字母）→ 格式错误',
    /格式应形如/.test(SD.code.check('permit', 'FZABCDEFG-0000001', { typeVal: '吊装作业' }) || ''));
  ok('带年份的旧写法 FZDZ-2026-0000001 → 不入（作业票无年份）',
    /格式应形如/.test(SD.code.check('permit', 'FZDZ-2026-0000001', { typeVal: '吊装作业' }) || ''));

  /* ================= 6. 表单联动 ================= */
  console.log('== 6. 表单联动：默认值 / 切类型 / 手改保护 ==');
  await go('specPermit');
  ok('找到「新增作业票」按钮', clickText('#view .btn', /新增作业票/));
  await wait(280);
  let m = modal();
  ok('弹窗打开', !!m);
  ok('默认类型为动火作业时编号预填 FZDH-0000002',
    m && m.querySelector('#ff_code').value === 'FZDH-0000002',
    m && m.querySelector('#ff_code').value);
  ok('切到吊装作业 → 编号自动换成 FZDZ-0000002',
    changeSel(m, 'ff_type', '吊装作业') && m.querySelector('#ff_code').value === 'FZDZ-0000002',
    m && m.querySelector('#ff_code').value);
  ok('切回动火作业 → 又换回 FZDH-0000002',
    changeSel(m, 'ff_type', '动火作业') && m.querySelector('#ff_code').value === 'FZDH-0000002',
    m && m.querySelector('#ff_code').value);
  set(m, 'ff_code', 'FZDZ-0000999');      // 用户手改
  changeSel(m, 'ff_type', '吊装作业');
  ok('手改过的编号不被类型切换覆盖',
    m.querySelector('#ff_code').value === 'FZDZ-0000999', m.querySelector('#ff_code').value);
  ok('小写输入失焦后归一为大写',
    (function () {
      const el = m.querySelector('#ff_code');
      el.value = 'fzdz-0000999';
      el.dispatchEvent(new win.Event('blur', { bubbles: false }));
      return el.value === 'FZDZ-0000999';
    })(), m.querySelector('#ff_code').value);
  await cancel(m);

  /* 编辑老记录：不动号 */
  const dz = SD.app.state.summary.workPermits.find(p => p.type === '吊装作业');
  ok('取到吊装作业示例票', !!dz, dz && dz.code);
  if (dz) {
    const op = await pickOps('pops', /编辑/, dz.id);
    await wait(200);
    m = modal();
    ok('打开编辑弹窗', op.ok && !!m, op.why);
    if (m) {
      ok('编辑时编号保持原号（FZDZ-0000001）',
        m.querySelector('#ff_code').value === 'FZDZ-0000001', m.querySelector('#ff_code').value);
      changeSel(m, 'ff_type', '动火作业');
      ok('编辑时改类型也不擅自改号（避免历史票被换号）',
        m.querySelector('#ff_code').value === 'FZDZ-0000001', m.querySelector('#ff_code').value);
      await cancel(m);
    }
  }

  /* 提交：跨类型前缀应被拦 */
  console.log('== 6.5 提交校验 ==');
  await go('specPermit');
  clickText('#view .btn', /新增作业票/);
  await wait(280);
  m = modal();
  if (m) {
    changeSel(m, 'ff_type', '吊装作业');
    set(m, 'ff_code', 'FZGC-0000999');   // 高处作业的号
    set(m, 'ff_location', '冒烟-FZ 前缀校验');
    set(m, 'ff_dept', '安环部');
    set(m, 'ff_applicant', '王安全');
    set(m, 'ff_leader', '王安全');
    set(m, 'ff_guardian', '孙浩');
    set(m, 'ff_planStart', SD.utils.today());
    set(m, 'ff_planEnd', SD.utils.today());
    await submit(m, 700);
    ok('跨类型前缀提交被拦', /高处作业/.test(errText(modal() || m)), errText(modal() || m));
    const mm = modal() || m;
    if (mm) {
      set(mm, 'ff_code', 'FZDZ-0000002');
      await submit(mm, 1600);
    }
    const created = SD.app.state.summary.workPermits.find(p => p.location === '冒烟-FZ 前缀校验');
    ok('改成本类型号后保存成功', !!created, created && created.code);
    ok('落库号即 FZDZ-0000002', !!created && created.code === 'FZDZ-0000002', created && created.code);
    ok('落库后吊装 next 顺延到 FZDZ-0000003',
      SD.code.next('permit', '吊装作业') === 'FZDZ-0000003', SD.code.next('permit', '吊装作业'));
    ok('其它类型不受影响（高处仍从 0000002 起）',
      SD.code.next('permit', '高处作业') === 'FZGC-0000002', SD.code.next('permit', '高处作业'));
  } else {
    ok('跨类型前缀提交被拦', false, 'no-dialog');
  }

  /* ================= 7. 无 JS 报错 ================= */
  console.log('== 7. 无 JS 报错 ==');
  ok('运行期无 JS 错误', errors.length === 0, errors.slice(0, 3).join(' | '));

  console.log('\n结果：通过 ' + pass + ' / 失败 ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FATAL', e); process.exit(1); });
