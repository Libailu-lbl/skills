/* =========================================================
   usage.js — 功能使用频率（★ 2026-11-05，2026-11-05 晚改「全菜单统一排名」）
   ────────────────────────────────────────────────────────
   干什么：
     侧栏「常用功能」要按**实际使用频率**排序，而不是写死一个顺序。
     这个模块负责记「某个功能被用了多少次」，并给出**全部菜单**的排名与前 N 名。

   ★ 统计口径（四条，改口径必须同时改这里和 README）：
     ① 统计范围：SD.router.ROUTES 里的全部**页面级功能**（含特种作业下 3 个子页，共 15 项）。
        报表 / 更多 这类只做折叠、没有独立页面的父项不计；导出 / 打印等按钮动作也不计。
     ② 排序：次数 ↓ → 最近使用 ↓ → 菜单内置顺序 ↑（末键保证结果稳定，不会来回跳动）
     ③ 并列：次数相同看最近使用；最近使用也相同（含「都没用过」的 0 次组）按菜单顺序。
        前 6 名只取 6 个，靠上述规则得出唯一结果；与第 6 名同次但落选的会单独计数，
        界面注明「另有 N 项同为 X 次」，不把信息吞掉。
     ④ 空数据：全部为 0 次时按菜单顺序展示前 6 项，并标注「暂无使用记录」（不显示空白区）。

   记什么（每个 key 两项）：
     counts[key]  次数，进入一次 +1
     last[key]    最近一次使用的时间戳（同一次数时用它排先后）

   key 怎么定：
     · 页面类直接用路由 id（hazard / inspection / todo / training / dashboard …）
       导航、侧栏快捷入口、页面内跳转都归到同一个 key，统计的是**功能**的热度，
       不是某个按钮的点击量。
     · 非页面的动作（如今后要统计「导出」「打印」）可加 act: 前缀单独记。

   存在哪：
     本机 localStorage 的 sd_usage_v1。**只存这台设备、不上传、不跨设备同步**。
     隐私模式 / 配额满导致写不进去时，自动退化成「本次会话内存计数」，功能不报错。
     清空浏览器站点数据即重置；也可以在控制台调 SD.usage.reset()。

   什么时候更新：
     ① 计数：用户**主动切到**某页时 +1。首屏自动落到默认页不计（那不是用户的选择），
        同一页反复刷新 / 重绘也不重复计（避免刷一次涨一次）
     ② 落盘：每次 +1 立即写 localStorage
     ③ 排序：侧栏每次重绘（切页 / 刷新 / 改设置）时按最新次数重排，所以顺序是「用着用着就变」
   ========================================================= */
window.SD = window.SD || {};

SD.usage = (function () {
  var KEY = 'sd_usage_v1';
  var mem = null;          // 内存副本：localStorage 不可用时的兜底，也避免频繁 JSON.parse

  function blank() { return { v: 1, counts: {}, last: {} }; }

  function read() {
    if (mem) return mem;
    var d = blank();
    try {
      var raw = window.localStorage.getItem(KEY);
      if (raw) {
        var o = JSON.parse(raw);
        if (o && typeof o === 'object') {
          if (o.counts && typeof o.counts === 'object') d.counts = o.counts;
          if (o.last && typeof o.last === 'object') d.last = o.last;
        }
      }
    } catch (e) {
      /* 隐私模式 / 数据损坏：直接用空表，不让统计影响主流程 */
    }
    mem = d;
    return mem;
  }

  function save() {
    try { window.localStorage.setItem(KEY, JSON.stringify(read())); } catch (e) { /* 配额满就只留内存 */ }
  }

  /** 计数 +n（默认 1） */
  function bump(key, n) {
    if (!key) return;
    var d = read();
    var add = (n == null) ? 1 : Number(n);
    if (!isFinite(add) || add <= 0) return;
    d.counts[key] = (Number(d.counts[key]) || 0) + add;
    d.last[key] = Date.now();
    save();
  }

  function count(key) { return Number(read().counts[key]) || 0; }
  function last(key) { return Number(read().last[key]) || 0; }

  /**
   * 按使用频率排序
   *   次数降序 → 最近使用降序 → 原顺序（没记录过的保持原样，不打乱首屏）
   * @param {Array} list   待排序数组
   * @param {Function} [keyOf] 取 key 的函数；不传则读 item.key（或 item 本身是字符串）
   */
  function rank(list, keyOf) {
    var arr = (list || []).slice();
    var pos = {};
    arr.forEach(function (x, i) {
      var k = keyOf ? keyOf(x) : (typeof x === 'string' ? x : x.key);
      pos[k] = i;
    });
    return arr.sort(function (a, b) {
      var ka = keyOf ? keyOf(a) : (typeof a === 'string' ? a : a.key);
      var kb = keyOf ? keyOf(b) : (typeof b === 'string' ? b : b.key);
      var ca = count(ka), cb = count(kb);
      if (ca !== cb) return cb - ca;
      var la = last(ka), lb = last(kb);
      if (la !== lb) return lb - la;
      return (pos[ka] == null ? 0 : pos[ka]) - (pos[kb] == null ? 0 : pos[kb]);
    });
  }

  /** 清空统计（设置里做「恢复默认顺序」时用） */
  function reset() {
    mem = blank();
    save();
  }

  /* 口径说明：界面 tooltip 与「功能使用统计」弹窗共用同一份文案，避免两处写得不一样 */
  var RULES = {
    scope: '左侧导航里的全部页面功能，共 15 项（含「特种作业」下的特种作业人员 / 特种设备人员 / 危险作业票）。「报表」「更多」这类只做折叠、没有独立页面的父项不计；导出 / 打印等按钮动作也不计。',
    order: '① 使用次数从多到少；② 次数相同，最近用过的排前面；③ 再相同，按菜单内置顺序。',
    tie: '逐级比较到最后一定落在菜单顺序上，所以名次不会飘；第 6 名只有一席，与它同次数但没排进来的，下方会注明「另有 N 项同为 X 次」，不隐藏信息。',
    empty: '一条记录都没有时，按菜单内置顺序展示前 6 项，并标注「暂无使用记录」，不留空白区。',
    count: '进入一次记一次；首屏自动打开的那一页不计，同一页反复刷新 / 重绘也不重复计。记录只存这台设备的浏览器，不上传、不跨设备。'
  };

  /**
   * 排名看板：把「全部菜单」排好序，给出前 limit 名与并列 / 空数据信息
   * @param {Array} list  [{key, locked}]；locked=true 表示当前角色打不开，不参与排名、不占名额
   * @param {number} [limit=6]
   * @returns {{
   *   limit:number, rows:Array, rest:Array, ranked:Array, locked:Array,
   *   total:number, used:number, sum:number, noData:boolean, cutN:number, cutTies:number
   * }}
   *   rows   前 limit 名（空数据时即菜单顺序前 limit 项）
   *   rest   有排名但没进前 limit 的
   *   ranked 参与排名的全部行（含 n / last / share / rank）
   *   locked 当前角色打不开的行（只统计、不排名）
   */
  function board(list, limit) {
    limit = limit == null ? 6 : Math.max(0, Number(limit) || 0);
    var sorted = rank(list || []);
    var ranked = [], locked = [];

    sorted.forEach(function (x) {
      var k = (typeof x === 'string') ? x : x.key;
      var row = {
        key: k,
        n: count(k),
        last: last(k),
        locked: !!(x && typeof x === 'object' && x.locked),
        rank: 0,
        share: 0
      };
      if (row.locked) locked.push(row); else ranked.push(row);
    });

    /* 名次：**只给用过的项排名**（次数 > 0）。
       次数与最近使用都一致的算并列（1、1、3 跳号）；0 次的没排过名，名次留 0，
       界面显示「—」——它们只是按菜单顺序补位，硬编号会出现一排「第 6 名」。 */
    var prev = null, prevRank = 0;
    ranked.forEach(function (r, i) {
      if (!r.n) { r.rank = 0; prev = null; prevRank = 0; return; }
      var same = !!prev && prev.n === r.n && prev.last === r.last;
      r.rank = same ? prevRank : i + 1;
      prev = r; prevRank = r.rank;
    });

    var sum = 0;
    ranked.forEach(function (r) { sum += r.n; });
    ranked.forEach(function (r) { r.share = sum ? r.n / sum : 0; });

    var rows = ranked.slice(0, limit);
    var rest = ranked.slice(limit);
    var cut = rest.length ? rest[0] : null;
    var cutTies = 0;
    if (cut && cut.n > 0) {
      rest.forEach(function (r) { if (r.n === cut.n) cutTies++; });
    }
    var used = 0;
    ranked.forEach(function (r) { if (r.n > 0) used++; });

    return {
      limit: limit, rows: rows, rest: rest, ranked: ranked, locked: locked,
      total: ranked.length, used: used, sum: sum,
      noData: used === 0,
      cutN: cut ? cut.n : 0, cutTies: cutTies
    };
  }

  /** 只读快照，便于自检与排查 */
  function stats() {
    var d = read();
    var c = {}, l = {};
    Object.keys(d.counts).forEach(function (k) { c[k] = Number(d.counts[k]) || 0; });
    Object.keys(d.last).forEach(function (k) { l[k] = Number(d.last[k]) || 0; });
    return { key: KEY, counts: c, last: l };
  }

  return {
    KEY: KEY, RULES: RULES, bump: bump, count: count, last: last,
    rank: rank, board: board, reset: reset, stats: stats
  };
})();
