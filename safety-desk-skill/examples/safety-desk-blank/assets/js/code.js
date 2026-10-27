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
      作业票 FZ+类型首字母-0000001（7 位）｜人员 TZZY-001（3 位）｜证书 ZGZS-001
     · 各类型序号池仍彼此独立（隐患 FZYH-0000001 与作业票 FZDZ-0000001 可并存，
       唯一性只在同类型内比较），互不借号、互不撞号

   ★ 2026-10-28 起：危险作业票前缀改为**按作业类型动态生成**：
      前缀 = 固定前缀 FZ + 作业类型名称前两个汉字的拼音首字母（大写）
      例：吊装作业 → DZ → FZDZ-0000001；动火作业 → DH → FZDH-0000001
     · 序号仍为 7 位，各前缀各自顺延（FZDZ-0000001 与 FZDH-0000001 可并存）
     · 单字名称 → 只取 1 位首字母（FZH-0000001）；无汉字（如 LOTO）→ 取字母
     · 两个类型首字母相同（受限空间/射线探伤/水下 都是 SX）→ 按字典顺序
       先登记者保留 2 位前缀，后来者自动延长取第 3、第 4 位首字母
       （FZSX / FZSXT / FZSXZ），仍相同则加序号（FZSX2）
     · 首字母表在 pinyin.js（GB2312 全字库，离线），本文件只做分配与拼接
     · 校验放宽为「FZ + 1~6 位大写字母 + - + 7 位数字」，另加一条**软校验**：
       若前缀属于「另一个现存类型」，则明确提示应换成当前类型的编号；
       不属于任何现存类型的前缀（旧号 FZZY、类型改名后的旧前缀）照常放行

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

  /** 按规则拼校验正则（显式 pattern 优先；typeVal 见下方「动态前缀」） */
  function patternOf(type, typeVal) {
    var r = rule(type);
    if (r.pattern) return new RegExp(r.pattern);
    var rg = seqRange(r);
    var seq = (rg.lo === rg.hi) ? String(rg.lo) : (rg.lo + ',' + rg.hi);
    var core;
    if (r.prefixFrom) {
      /* 动态前缀（作业票）：形状固定为「FZ + 1~6 位大写字母 + 序号」，
         不写死成当前作业类型的那一个 —— 类型改名、历史数据、跨类型补录
         都要能存得进；类型与前缀对不对得上由 check() 单独给软提示 */
      core = escRe(r.prefix) + '[A-Z]{1,6}-' +
        (r.withYear === false ? '' : '\\d{4}-') + '\\d{' + seq + '}';
    } else {
      var p = escRe(r.prefix);
      core = p + '-' + (r.withYear === false ? '' : '\\d{4}-') + '\\d{' + seq + '}';
      if (r.allowNoYear && r.withYear !== false) {
        core = '(?:' + core + '|' + p + '-\\d{' + seq + '})';
      }
    }
    /* 存量老编号兼容：默认放行，规则里 allowLegacy:false 可关掉 */
    if (r.allowLegacy !== false) {
      core = '(?:' + core + '|' + LEGACY_SRC + ')';
    }
    return new RegExp('^' + core + '$');
  }

  /* ---------- 动态前缀：危险作业票 = FZ + 作业类型首字母 ----------
     规则表里给 permit 配 prefixFrom（见 config.js），本段负责三件事：
       ① 类型名 → 首字母（查 pinyin.js，离线字表）
       ② 首字母撞车时怎么分（先登记者占 2 位，后来者延长取字，再撞加序号）
       ③ 前缀与作业类型是否对得上（check 的软提示，不拦历史数据）

     为什么「先到先得」而不是「大家一起重新算」：
       如果按「全局重新分配」来，某天新增一个同首字母的类型，
       已有类型的编号前缀会被迫改变，历史台账的号就全对不上了。
       所以按字典顺序占位，新增类型只影响它自己。 */

  /** 字典里的作业类型名（['动火作业', ...] 或 [{v,n}] 两种写法都吃） */
  function permitNames() {
    var d = null;
    if (SD.mock && SD.mock.DICT) d = SD.mock.DICT;
    else if (SD.dict && SD.dict.DICT) d = SD.dict.DICT;
    var arr = (d && d.permitType) || [];
    return arr.map(function (o) {
      return (o && typeof o === 'object') ? String(o.v == null ? '' : o.v) : String(o);
    }).filter(function (s) { return s; });
  }

  /** 类型名能派生出几个首字母（跳过数字、标点、空格） */
  function letterCount(name) {
    if (!SD.pinyin) return 0;
    return SD.pinyin.initials(name, 999).length;
  }

  /**
   * 给一个类型名分配前缀尾串（不含固定的 FZ）
   * @param {string} name  作业类型名
   * @param {object} used  已被占用的尾串集合（会被就地写入）
   */
  function allocTail(name, used) {
    var total = letterCount(name);
    if (!total) return 'QT';                      // 一个字母都取不到 → 归「其他」
    var start = total < 2 ? 1 : 2;                // 单字名称只能取 1 位
    for (var len = start; len <= total; len++) {
      var p = SD.pinyin.initials(name, len);
      if (p && !used[p]) return p;
    }
    /* 整个名称首字母都一样（同名/同字母串）→ 加序号 2、3… */
    var base = SD.pinyin.initials(name, start) || 'QT';
    for (var k = 2; k < 100; k++) {
      if (!used[base + k]) return base + k;
    }
    return base;
  }

  /** 当前字典的前缀分配表（name → 尾串）；extra 为不在字典里的临时类型 */
  function tailMap(extra) {
    var names = permitNames();
    var e = String(extra == null ? '' : extra).trim();
    if (e && names.indexOf(e) < 0) names = names.concat([e]);
    var used = {}, map = {};
    names.forEach(function (n) {
      if (map[n] != null) return;
      var t = allocTail(n, used);
      used[t] = true;
      map[n] = t;
    });
    return map;
  }

  /** 某个作业类型应得的前缀（含固定前缀 FZ） */
  function prefixOf(type, typeVal) {
    var r = rule(type);
    if (!r.prefixFrom) return r.prefix;
    var name = String(typeVal == null ? '' : typeVal).trim();
    if (!name) name = permitNames()[0] || '';
    if (!name) return r.prefix;
    var map = tailMap(name);
    return r.prefix + (map[name] || 'QT');
  }

  /** 前缀归属：这个前缀是哪个现存作业类型的（不认识的返回 null） */
  function prefixOwner(type, prefix) {
    var r = rule(type);
    var map = tailMap(null);
    var owner = null;
    Object.keys(map).forEach(function (n) {
      if (r.prefix + map[n] === prefix) owner = n;
    });
    return owner;
  }

  /** 示例编号（隐患 FZYH-0000001 / 作业票 FZDZ-0000001 …），只用于 placeholder 与错误提示 */
  function sample(type, typeVal) {
    var r = rule(type);
    var len = seqRange(r).hi || 3;
    var n = '';
    for (var i = 0; i < len; i++) n += '0';
    n = n.slice(0, -1) + '1';
    var y = String(new Date().getFullYear());
    var p = prefixOf(type, typeVal);
    return r.withYear === false ? (p + '-' + n) : (p + '-' + y + '-' + n);
  }

  /** 把序号按位数补零（7 → 0000001；3 → 001） */
  function padSeq(type, n, typeVal) {
    var r = rule(type);
    var len = seqRange(r).hi || 3;
    var s = String(n);
    while (s.length < len) s = '0' + s;
    var y = String(new Date().getFullYear());
    var p = prefixOf(type, typeVal);
    return r.withYear === false ? (p + '-' + s) : (p + '-' + y + '-' + s);
  }

  /** 从一个编号里解析序号（按本类当前前缀；别的类型 / 老编号返回 null） */
  function seqOf(type, code, typeVal) {
    var r = rule(type);
    var v = String(code == null ? '' : code).trim().toUpperCase();
    if (!v) return null;
    var p = escRe(prefixOf(type, typeVal)).toUpperCase();
    var m = v.match(new RegExp('^' + p + '-(\\d{4})-(\\d+)$'));
    if (m) return (r.withYear === false) ? null : { year: m[1], seq: parseInt(m[2], 10) };
    m = v.match(new RegExp('^' + p + '-(\\d+)$'));
    if (m) return (r.withYear === false) ? { year: null, seq: parseInt(m[1], 10) } : null;
    return null;
  }

  /**
   * 生成下一个可用编号（新增表单的默认值，用户可手动修改）
   *  · 顺延：取本类型当前最大序号 + 1（带年份的只顺延今年的，过年自动归 1）
   *    作业票按**当前作业类型的前缀**顺延，各前缀各自从 0000001 起
   *  · 跳撞号：生成的号若已存在（如手工插过号），继续往后找到第一个空位
   *  · 老编号不参与顺延（HZ-2026-001、FZZY-0000001 这类只做兼容放行）
   */
  function next(type, typeVal) {
    var r = rule(type);
    var year = String(new Date().getFullYear());
    var maxSeq = 0;
    list(type).forEach(function (x) {
      var p = seqOf(type, x && x.code, typeVal);
      if (!p) return;
      if (r.withYear !== false && p.year !== year) return;
      if (p.seq > maxSeq) maxSeq = p.seq;
    });
    var n = maxSeq + 1;
    var guard = 0;
    while (isDup(type, padSeq(type, n, typeVal)) && guard++ < 10000) n++;
    return padSeq(type, n, typeVal);
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
   * 校验一个编号：空 / 格式 / 类型与前缀是否对得上 / 重复，返回错误文案；通过返回 null
   * @param {string} type    单据类型（hazard / inspection / ... / permit）
   * @param {string} value   待校验值
   * @param {object} opts    { id: 编辑中的记录 id（排除自身）, typeVal: 所属作业类型 }
   */
  function check(type, value, opts) {
    opts = opts || {};
    var r = rule(type);
    var v = String(value == null ? '' : value).trim();

    if (!v) return '「' + r.label + '」不能为空';
    if (v.length > 32) return '「' + r.label + '」不能超过 32 个字符（当前 ' + v.length + ' 个）';
    if (!patternOf(type, opts.typeVal).test(v)) {
      var tip = r.prefixFrom
        ? (r.prefix + ' + 作业类型首字母 + 7 位序号，如 ' + sample(type, opts.typeVal))
        : sample(type);
      return '「' + r.label + '」格式应形如 ' + tip + '，当前填写的是「' + v + '」';
    }
    /* 动态前缀的软校验：前缀若是「另一个现存作业类型」的号，直接指出该用哪个；
       不属于任何现存类型（旧号 FZZY、类型改名后的旧前缀）照常放行 */
    if (r.prefixFrom) {
      var mm = typeMismatch(type, v, opts.typeVal);
      if (mm) return mm;
    }
    if (isDup(type, v, opts.id)) {
      return '「' + r.label + '」' + v + ' 已存在，请换一个';
    }
    return null;
  }

  /** 编号前缀与作业类型是否对得上（对不上返回提示文案，对得上返回 null） */
  function typeMismatch(type, code, typeVal) {
    var r = rule(type);
    var m = /^([A-Z]+)-/.exec(String(code == null ? '' : code).trim().toUpperCase());
    if (!m) return null;                                  // 一代老号（HZ-2026-001 等）不判
    var p = m[1];
    if (p === prefixOf(type, typeVal)) return null;
    var owner = prefixOwner(type, p);
    if (!owner) return null;                              // 非现存类型的前缀 → 放行
    return '「' + r.label + '」' + code + ' 是「' + owner + '」的编号，当前作业类型是「' +
      (typeVal || '—') + '」，应为 ' + prefixOf(type, typeVal) + '-…（如 ' +
      sample(type, typeVal) + '）';
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
      def: function (vals) { return next(type, r.prefixFrom ? vals && vals[r.prefixFrom] : null); },
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
    assertUnique: assertUnique,
    /* 动态前缀（作业票）对外接口，供表单提示与测试使用 */
    prefixOf: prefixOf,
    prefixOwner: prefixOwner,
    permitNames: permitNames
  };
})();
