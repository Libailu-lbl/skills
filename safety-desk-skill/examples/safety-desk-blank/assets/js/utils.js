/* =========================================================
   utils.js — 纯工具层（日期 / 文本 / DOM / 提示）
   铁律：本层只被上层调用，绝不反向依赖 store / metrics / views。
   所有日期一律使用本地时区构造，避免 toISOString 的 UTC 偏移把
   「今天」算成昨天（跨月/跨年尤其明显）。
   ========================================================= */
window.SD = window.SD || {};

SD.utils = (function () {
  var U = {};

  /* ---------------- 日期 ---------------- */
  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  /** Date / 'YYYY-MM-DD' → 'YYYY-MM-DD'（本地时区） */
  U.iso = function (d) {
    if (!d) d = new Date();
    if (typeof d === 'string') return d.slice(0, 10);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  };

  U.today = function () { return U.iso(new Date()); };

  /** 'YYYY-MM-DD' → Date（本地 00:00）；非法返回 null */
  U.parse = function (s) {
    if (!s) return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3]);
  };

  /** 在 base 上偏移 days 天，返回 'YYYY-MM-DD'。可正可负，自动跨月跨年 */
  U.shift = function (base, days) {
    var d = U.parse(base) || new Date();
    d.setDate(d.getDate() + days);
    return U.iso(d);
  };

  /** a - b，单位「自然日」；任一方非法返回 null */
  U.diffDays = function (a, b) {
    var da = U.parse(a), db = U.parse(b);
    if (!da || !db) return null;
    return Math.round((da - db) / 86400000);
  };

  /** 一周起点（默认周一）。weekStart: 1=周一, 0=周日 */
  U.startOfWeek = function (base, weekStart) {
    var ws = (weekStart == null ? (SD.CONFIG ? SD.CONFIG.weekStart : 1) : weekStart);
    var d = U.parse(base) || new Date();
    var delta = (d.getDay() - ws + 7) % 7;
    d.setDate(d.getDate() - delta);
    return U.iso(d);
  };
  U.endOfWeek = function (base, weekStart) {
    return U.shift(U.startOfWeek(base, weekStart), 6);
  };

  /** 'YYYY-MM-DD' → 'YYYY-MM' */
  U.ym = function (s) { return String(s || '').slice(0, 7); };

  /** 月份偏移 n 个月，返回 'YYYY-MM'（自动跨年） */
  U.shiftYM = function (ym, n) {
    var m = /^(\d{4})-(\d{2})/.exec(String(ym || U.ym(U.today())));
    var d = new Date(+m[1], +m[2] - 1 + n, 1);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1);
  };

  /** 展示用：'10月15日' */
  U.fmtCN = function (s) {
    var d = U.parse(s); if (!d) return '—';
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  };
  /** 展示用：'周三' */
  U.weekdayCN = function (s) {
    var d = U.parse(s); if (!d) return '';
    return '周' + '日一二三四五六'.charAt(d.getDay());
  };
  /** 时间戳 → 'YYYY-MM-DD HH:mm' */
  U.fmtTime = function (ts) {
    if (!ts) return '—';
    var d = new Date(ts);
    return U.iso(d) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  };

  /* ---------------- 文本 ---------------- */
  U.esc = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };
  /** 百分比：0.667 → '66.7%'；分母为 0 返回 '—' */
  U.pct = function (a, b, digits) {
    if (!b) return '—';
    var v = (a / b) * 100;
    return v.toFixed(digits == null ? 1 : digits) + '%';
  };
  // 不依赖 crypto.randomUUID：它在 file:// 与部分旧浏览器里不可用
  U.uid = function (prefix) {
    return (prefix || 'ID') + '-' + Date.now().toString(36).toUpperCase() +
      '-' + Math.random().toString(36).slice(2, 8).toUpperCase();
  };

  /* ---------------- DOM ---------------- */
  /** 字符串 → 首个元素（找不到返回 null） */
  U.h = function (html) {
    var t = document.createElement('template');
    t.innerHTML = String(html).trim();
    return t.content.firstElementChild;
  };
  U.qs = function (sel, root) { return (root || document).querySelector(sel); };
  U.qsa = function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };
  /** 事件委托：在 root 上监听，命中 selector 才回调 */
  U.on = function (root, evt, selector, handler) {
    if (!root) return;
    root.addEventListener(evt, function (e) {
      var t = e.target && e.target.closest ? e.target.closest(selector) : null;
      if (t) handler.call(t, e, t);
    });
  };
  /** 清空子节点 */
  U.clear = function (el) { if (el) while (el.firstChild) el.removeChild(el.firstChild); };

  /* ---------------- 提示 ---------------- */
  var toastTimer = null;
  U.toast = function (msg, type) {
    var root = document.getElementById('toastRoot');
    if (!root) return;
    var el = document.createElement('div');
    el.className = 'toast' + (type ? ' ' + type : '');
    el.textContent = msg;
    root.appendChild(el);
    // 同一时刻最多保留 3 条
    while (root.children.length > 3) root.removeChild(root.firstChild);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 2600);
  };

  /* ---------------- 其它 ---------------- */
  U.debounce = function (fn, wait) {
    var t = null;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, wait || 200);
    };
  };
  U.clone = function (o) { return JSON.parse(JSON.stringify(o)); };
  /** 数组按 key 分组 → {key: [..]} */
  U.groupBy = function (arr, keyFn) {
    var out = {};
    (arr || []).forEach(function (it) {
      var k = keyFn(it);
      (out[k] = out[k] || []).push(it);
    });
    return out;
  };
  /** 稳定排序：返回新数组，不改原数组 */
  U.sortBy = function (arr, cmpFn) {
    return (arr || []).map(function (it, i) { return { it: it, i: i }; })
      .sort(function (a, b) { return cmpFn(a.it, b.it) || (a.i - b.i); })
      .map(function (x) { return x.it; });
  };

  /* ---------------- 出件文件名（2026-10-22 用户要求） ----------------
     · 通知书：事故隐患整改通知书（2026.10.22）.docx
     · 作业票照片页：20261022吊装.docx（日期 + 作业类型）
     ★ 2026-10-22 晚：用户要求**后缀全部取消**——同名再出件就叫同一个名字
       （不再加 -1/-2/-3），所以这里只做「清洗非法字符 + 补扩展名」，
       不再记 localStorage 计数（旧版本留下的 sd_doc_seq_v1 键不再读写）。 */
  U.docName = function (base, ext) {
    base = String(base || '出件').replace(/[\\/:*?"<>|]/g, '');   // 去掉文件名非法字符
    return base + (ext || '.docx');
  };

  /** 2026-10-22 → '2026.10.22'（通知书文件名用，月日不补零，照用户给的样式） */
  U.dotDate = function (s) {
    var d = U.parse(s || U.today()) || new Date();
    return d.getFullYear() + '.' + (d.getMonth() + 1) + '.' + d.getDate();
  };
  /** 2026-10-22 → '20261022'（作业票照片页文件名用） */
  U.compactDate = function (s) {
    return String(U.iso(s || U.today())).replace(/-/g, '');
  };

  return U;
})();
