/* =========================================================
   code.js — 单据编号中枢（规则 / 校验）
   ────────────────────────────────────────────────────────
   为什么抽这个模块：
     隐患、巡检、培训、证书、公告、特种作业人员、危险作业票 七类单据
     都要「编号必填 + 保存时校验」，如果每处各写一遍，
     规则一改就要改七遍，还容易漏掉某一类。
     这里把编号的全部逻辑收敛成一张配置表 + 一组纯函数，
     各单据只在表单里声明自己是哪一类（codeType）即可。

   ★ 2026-10-21 起：编号**全部改为用户手动填写**
     · 表单上是带默认值的输入框：新增时按规则**顺延填入下一个可用编号**
       （2026-10-24 起恢复「默认填入」，取代此前的纯空值必填），
       用户可以直接改，也可以清空后手填其它符合规则的编号
     · 规则表同时用于「格式校验」与「默认值生成」
     · 原 nextCode() / next() 的自动落库逻辑没有回来：默认值只是表单初值，
       保存时仍走「空 / 格式 / 同类型唯一」三道校验，不自动补号

   规则表在 config.js 的 SD.CONFIG.codeRules：
     { prefix, label, withYear, seqLen, seqMin, seqMax, allowNoYear, allowLegacy, pattern }

   ★ 2026-10-24 起：七类单据按类型各用各的编号体系（规则表见 config.js）：
      隐患 FZYH-0000001（7 位）｜巡检 FZXJ-2026-001（带年份 3 位）｜
      培训 FZPX-2026-001（带年份 3 位）｜通知 FZTG-2026-001（带年份 3 位）｜
      作业票 FZZY-0000001（7 位）｜人员 TZZY-001（3 位）｜证书 ZGZS-001（2026-10-25 定）
     · 各类型序号池仍彼此独立（隐患 FZYH-0000001 与作业票 FZZY-0000001 可并存，
       唯一性只在同类型内比较），互不借号、互不撞号

   三条硬规则（check 的判定顺序）：
     1. 不能为空            → 「XX编号」不能为空
     2. 要符合本类格式      → 「隐患编号」格式应形如 FZYH-0000001（当前：xxx）
     3. 本类型内不得重复    → 「隐患编号」FZYH-0000001 已存在，请换一个
   唯一性只在「同一类型」内比较：隐患 FZYH-0000001 与巡检 FZXJ-2026-001 互不影响。

   历史数据怎么兼容：
     · 老编号默认放行（allowLegacy，可在规则里置 false 关掉），含两代：
       一代 HZ-2026-001 / CT-001 一类；二代 2026-10-22 统一期的 FZ-0000001（仅 7 位那一种）；
       2026-10-25 起证书改号 ZGZS-001，存量 FZ-0000001 证书号继续走这条兼容放行
     · 老编号位数短 / 无年份        → 靠规则的 seqMin/seqMax、allowNoYear 放宽
     · 老记录根本没有 code          → 列表显示「—」，编辑时补填即可（不再自动补号）
     · 编辑自身不改号时不做唯一性比对（传 id 排除自己），避免老重号记录改别的字段被拦

   改号对历史数据的影响（已同步写进 README / schema.md）：
     · 编号只是展示与检索用的业务字段，统计 / 流转留痕 / 关联都按 id 走，改号不影响
     · 但以「文本」形式引用旧编号的地方不会自动同步：
       巡检备注里写的「已登记 HZ-2026-001」、已下载的通知书文件与标题等，需人工核对
   ========================================================= */
window.SD = window.SD || {};

SD.code = (function () {
  var C = SD.CONFIG || {};

  /** 单据类型 → 数据集合名（决定唯一性在哪个池子里比） */
  var COLLECTIONS = {
    hazard: 'hazards',
    inspection: 'inspections',
    training: 'trainings',
    certificate: 'certificates',
    notice: 'notices',
    special: 'specialPersonnel',
    device: 'devicePersonnel',
    permit: 'workPermits'
  };

  var DEFAULT_RULE = { prefix: 'FZ', label: '编号', withYear: false, seqLen: 7 };

  /**
   * 历史编号写法（两代老号，打开编辑时不被格式校验拦住）：
   *   一代：2026-10-22 之前各类老前缀 HZ / INS / TR / CT / NT / SP / WP；
   *   二代：2026-10-22 统一期的 FZ-0000001（**仅放行 7 位序号那一种**，
   *         FZ-001、FZ-2026-001 这类残号仍拒；证书类 2026-10-25 起改号 ZGZS-001，
   *         存量 FZ-0000001 证书号走上面这条兼容，不是主规则）。
   */
  var LEGACY_PREFIXES = 'HZ|INS|TR|CT|NT|SP|WP';
  var LEGACY_SRC = '(?:' + LEGACY_PREFIXES + ')-\\d{4}-\\d{2,4}|(?:' + LEGACY_PREFIXES + ')-\\d{2,4}|FZ-\\d{7}';

  /** 取规则（合并默认值；未知类型回落到默认规则，不让页面崩） */
  function rule(type) {
    var r = (C.codeRules || {})[type];
    return Object.assign({}, DEFAULT_RULE, r || {});
  }

  function escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  /** 序号位数区间：没给 seqMin/seqMax 时直接用 seqLen（新体系下都是固定 7 位） */
  function seqRange(r) {
    var n = (r.seqLen != null ? r.seqLen : 3);
    var lo = (r.seqMin != null ? r.seqMin : n);
    var hi = (r.seqMax != null ? r.seqMax : n);
    if (hi < lo) hi = lo;
    return { lo: lo, hi: hi };
  }

  /** 按规则拼校验正则（显式 pattern 优先） */
  function patternOf(type) {
    var r = rule(type);
    if (r.pattern) return new RegExp(r.pattern);
    var p = escRe(r.prefix);
    var rg = seqRange(r);
    var seq = (rg.lo === rg.hi) ? String(rg.lo) : (rg.lo + ',' + rg.hi);
    var core = p + '-' + (r.withYear === false ? '' : '\\d{4}-') + '\\d{' + seq + '}';
    if (r.allowNoYear && r.withYear !== false) {
      core = '(?:' + core + '|' + p + '-\\d{' + seq + '})';
    }
    /* 存量老编号兼容：默认放行，规则里 allowLegacy:false 可关掉 */
    if (r.allowLegacy !== false) {
      core = '(?:' + core + '|' + LEGACY_SRC + ')';
    }
    return new RegExp('^' + core + '$');
  }

  /** 示例编号（隐患 FZYH-0000001 / 巡检 FZXJ-2026-001 …），只用于 placeholder 与错误提示 */
  function sample(type) {
    var r = rule(type);
    var len = seqRange(r).hi || 3;
    var n = '';
    for (var i = 0; i < len; i++) n += '0';
    n = n.slice(0, -1) + '1';
    var y = String(new Date().getFullYear());
    return r.withYear === false ? (r.prefix + '-' + n) : (r.prefix + '-' + y + '-' + n);
  }

  /** 把序号按位数补零（7 → 0000001；3 → 001） */
  function padSeq(type, n) {
    var r = rule(type);
    var len = seqRange(r).hi || 3;
    var s = String(n);
    while (s.length < len) s = '0' + s;
    var y = String(new Date().getFullYear());
    return r.withYear === false ? (r.prefix + '-' + s) : (r.prefix + '-' + y + '-' + s);
  }

  /** 从一个编号里解析序号（按本类规则；老编号 / 别类编号返回 null） */
  function seqOf(type, code) {
    var r = rule(type);
    var v = String(code == null ? '' : code).trim().toUpperCase();
    if (!v) return null;
    var p = escRe(r.prefix).toUpperCase();
    var m = v.match(new RegExp('^' + p + '-(\\d{4})-(\\d+)$'));
    if (m) return (r.withYear === false) ? null : { year: m[1], seq: parseInt(m[2], 10) };
    m = v.match(new RegExp('^' + p + '-(\\d+)$'));
    if (m) return (r.withYear === false) ? { year: null, seq: parseInt(m[1], 10) } : null;
    return null;
  }

  /**
   * 生成下一个可用编号（新增表单的默认值，用户可手动修改）
   *  · 顺延：取本类型当前最大序号 + 1（带年份的只顺延今年的，过年自动归 1）
   *  · 跳撞号：生成的号若已存在（如手工插过号），继续往后找到第一个空位
   *  · 老编号不参与顺延（HZ-2026-001、FZ-0000001 这类只做兼容放行）
   */
  function next(type) {
    var r = rule(type);
    var year = String(new Date().getFullYear());
    var maxSeq = 0;
    list(type).forEach(function (x) {
      var p = seqOf(type, x && x.code);
      if (!p) return;
      if (r.withYear !== false && p.year !== year) return;
      if (p.seq > maxSeq) maxSeq = p.seq;
    });
    var n = maxSeq + 1;
    var guard = 0;
    while (isDup(type, padSeq(type, n)) && guard++ < 10000) n++;
    return padSeq(type, n);
  }

  /** 该类型的记录池（优先用当前内存数据，真实接口模式下也能读到） */
  function list(type) {
    var coll = COLLECTIONS[type];
    if (!coll) return [];
    var a = null;
    if (SD.app && SD.app.state && SD.app.state.data) a = SD.app.state.data[coll];
    if (!Array.isArray(a)) {
      var d = (SD.store && SD.store.data) ? SD.store.data() : null;
      a = d ? d[coll] : null;
    }
    return Array.isArray(a) ? a : [];
  }

  /** 是否已存在同号（大小写不敏感；id 用于排除自己） */
  function isDup(type, code, selfId) {
    var v = String(code == null ? '' : code).trim().toUpperCase();
    if (!v) return false;
    return list(type).some(function (x) {
      if (selfId && x && x.id === selfId) return false;
      return String((x && x.code) || '').trim().toUpperCase() === v;
    });
  }

  /**
   * 校验一个编号：空 / 格式 / 重复，返回错误文案；通过返回 null
   * @param {string} type   单据类型（hazard / inspection / ...）
   * @param {string} value  待校验值
   * @param {object} opts   { id: 编辑中的记录 id（排除自身） }
   */
  function check(type, value, opts) {
    opts = opts || {};
    var r = rule(type);
    var v = String(value == null ? '' : value).trim();

    if (!v) return '「' + r.label + '」不能为空';
    if (v.length > 32) return '「' + r.label + '」不能超过 32 个字符（当前 ' + v.length + ' 个）';
    if (!patternOf(type).test(v)) {
      return '「' + r.label + '」格式应形如 ' + sample(type) + '，当前填写的是「' + v + '」';
    }
    if (isDup(type, v, opts.id)) {
      return '「' + r.label + '」' + v + ' 已存在，请换一个';
    }
    return null;
  }

  /** 生成 formDialog 的编号字段定义（各单据表单直接复用，保证行为一致） */
  function field(type, extra) {
    var r = rule(type);
    return Object.assign({
      name: 'code',
      label: r.label,
      type: 'code',
      codeType: type,
      required: true,
      placeholder: sample(type),
      def: function () { return next(type); },   // 新增时预填下一个可用编号，可改
      help: '默认顺延填入下一个可用编号，可手动修改；同一类型内不可重复，示例：' + sample(type)
    }, extra || {});
  }

  /** 数据层兜底：只在「真的撞号」时抛错，供 dataSource 的 create/update 调用 */
  function assertUnique(type, code, selfId) {
    if (!code) return;
    if (isDup(type, code, selfId)) {
      var r = rule(type);
      throw new Error(r.label + '「' + code + '」已存在，请换一个');
    }
  }

  return {
    COLLECTIONS: COLLECTIONS,
    rule: rule,
    patternOf: patternOf,
    sample: sample,
    padSeq: padSeq,
    seqOf: seqOf,
    next: next,
    list: list,
    isDup: isDup,
    check: check,
    field: field,
    label: function (type) { return rule(type).label; },
    assertUnique: assertUnique
  };
})();
