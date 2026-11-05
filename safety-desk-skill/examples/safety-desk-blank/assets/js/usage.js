/* =========================================================
   usage.js — 功能使用频率（★ 2026-11-05）
   ────────────────────────────────────────────────────────
   干什么：
     侧栏「常用功能」要按**实际使用频率**排序，而不是写死一个顺序。
     这个模块就负责记「某个功能被用了多少次」并给出排序结果。

   记什么（每个 key 两项）：
     counts[key]  次数，进入一次 +1
     last[key]    最近一次使用的时间戳（同一次数时用它排先后）

   key 怎么定：
     · 页面类直接用路由 id（hazard / inspection / todo / training / dashboard …）
     · 不是页面的动作加前缀，如导出台账 = 'act:export'
     这样「从导航进隐患管理」和「从常用功能点登记隐患」都会记到同一个 hazard 上，
     统计的是**功能**的使用频率，不是某个按钮的点击量。

   存在哪：
     本机 localStorage 的 sd_usage_v1。**只存这台设备、不上传、不跨设备同步**。
     隐私模式 / 配额满导致写不进去时，自动退化成「本次会话内存计数」，功能不报错。
     清空浏览器站点数据即重置；也可以在控制台调 SD.usage.reset()。

   什么时候更新：
     ① 计数：app 每次真正切到某页时 +1（同一页反复刷新不重复计，避免刷一次涨一次）
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

  /** 只读快照，便于自检与排查 */
  function stats() {
    var d = read();
    var c = {}, l = {};
    Object.keys(d.counts).forEach(function (k) { c[k] = Number(d.counts[k]) || 0; });
    Object.keys(d.last).forEach(function (k) { l[k] = Number(d.last[k]) || 0; });
    return { key: KEY, counts: c, last: l };
  }

  return { KEY: KEY, bump: bump, count: count, last: last, rank: rank, reset: reset, stats: stats };
})();
