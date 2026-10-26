/* =========================================================
   components/photoVault.js — 大图外置仓库（IndexedDB）
   ────────────────────────────────────────────────────────
   为什么需要它：
     2026-10-24 起照片**不再压缩**（按用户要求保留手机原图）。但 localStorage
     每个源只有约 5MB，一张手机照（3~6MB）就能撑爆，直接存会「保存失败」。

   做法（对业务代码零侵入）：
     · 落盘时：把业务数据里所有 `data:image/...` 且长度超过 LIMIT 的字符串，
       写进 IndexedDB，JSON 里只留引用 `vault:<key>` → localStorage 里体积很小
     · 启动时：把 `vault:<key>` 全部换回真实 dataURL → 内存里仍是完整图片
     · 因此所有视图 / 打印 / 水印 / 导出照旧拿 dataURL，一行都不用改

   兼容与降级：
     · 浏览器不支持 IndexedDB（或隐私模式打不开）→ enabled() = false，
       行为退回「全部存 localStorage」（jsdom 测试就是这条路径）
     · 引用丢了（IDB 被清、换浏览器）→ 水合时给占位图并保留引用，不会破图崩页

   用法：
     SD.photoVault.ready()                    // 启动时等它就绪（返回 Promise<boolean>）
     SD.photoVault.externalize(data)          // Promise<替换成 vault:key 的副本>
     SD.photoVault.hydrate(data)              // Promise<换回 dataURL 的副本>
     SD.photoVault.clear()                    // 清空仓库（清空数据 / 重置时调）
   ========================================================= */
window.SD = window.SD || {};
SD.comp = SD.comp || {};

SD.photoVault = (function () {
  var DB_NAME = 'sd_photo_vault';
  var STORE = 'photos';
  var DB_VER = 1;
  var LIMIT = 30000;                 // 超过约 22KB 的图片才外置（示例 SVG 小图不受影响）
  var PREFIX = 'vault:';

  var MISSING = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="90">' +
      '<rect width="120" height="90" fill="#eef2f3"/>' +
      '<text x="60" y="52" font-size="11" fill="#8b9ba0" text-anchor="middle">照片丢失</text>' +
    '</svg>');

  var usable = (typeof indexedDB !== 'undefined' && !!indexedDB);
  var booted = null;                 // Promise<IDBDatabase>
  var cache = {};                    // key -> dataURL（内存缓存，避免重复读盘）

  /* ---------------- IndexedDB 基础 ---------------- */
  function openDB() {
    if (!usable) return Promise.reject(new Error('当前环境不支持 IndexedDB'));
    if (booted) return booted;
    booted = new Promise(function (resolve, reject) {
      var req;
      try { req = indexedDB.open(DB_NAME, DB_VER); }
      catch (e) { return reject(e); }
      req.onupgradeneeded = function () {
        var d = req.result;
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('IndexedDB 打开失败')); };
      req.onblocked = function () { reject(new Error('IndexedDB 被其他标签页占用')); };
    });
    return booted;
  }

  function putMany(pairs) {
    if (!pairs.length) return Promise.resolve();
    return openDB().then(function (d) {
      return new Promise(function (resolve, reject) {
        var t = d.transaction(STORE, 'readwrite');
        var st = t.objectStore(STORE);
        pairs.forEach(function (p) { st.put(p[1], p[0]); });
        t.oncomplete = function () { pairs.forEach(function (p) { cache[p[0]] = p[1]; }); resolve(); };
        t.onerror = function () { reject(t.error || new Error('写入失败')); };
        t.onabort = function () { reject(t.error || new Error('写入中止')); };
      });
    });
  }

  function getMany(keys) {
    var out = {}, todo = [];
    keys.forEach(function (k) {
      if (cache[k] !== undefined) out[k] = cache[k]; else todo.push(k);
    });
    if (!todo.length) return Promise.resolve(out);
    return openDB().then(function (d) {
      return new Promise(function (resolve, reject) {
        var t = d.transaction(STORE, 'readonly');
        var st = t.objectStore(STORE);
        todo.forEach(function (k) {
          var r = st.get(k);
          r.onsuccess = function () {
            if (r.result != null) { out[k] = r.result; cache[k] = r.result; }
          };
        });
        t.oncomplete = function () { resolve(out); };
        t.onerror = function () { reject(t.error || new Error('读取失败')); };
      });
    });
  }

  function clear() {
    cache = {};
    if (!usable) return Promise.resolve();
    return openDB().then(function (d) {
      return new Promise(function (resolve, reject) {
        var t = d.transaction(STORE, 'readwrite');
        t.objectStore(STORE).clear();
        t.oncomplete = resolve;
        t.onerror = function () { reject(t.error); };
      });
    }).catch(function () { /* 清不掉不影响主流程 */ });
  }

  /* ---------------- 数据遍历（字符串 → 处理函数） ---------------- */
  function walk(node, fn) {
    if (typeof node === 'string') return fn(node);
    if (Array.isArray(node)) {
      var arr = new Array(node.length);
      for (var i = 0; i < node.length; i++) arr[i] = walk(node[i], fn);
      return arr;
    }
    if (node && typeof node === 'object') {
      var o = {};
      for (var k in node) {
        if (Object.prototype.hasOwnProperty.call(node, k)) o[k] = walk(node[k], fn);
      }
      return o;
    }
    return node;
  }

  /** 内容指纹：采样 + 长度，同一张图永远同一个 key（重复保存不会堆积） */
  function keyOf(s) {
    var h = 5381, n = s.length, i;
    for (i = 0; i < n; i += 61) h = ((((h << 5) + h) ^ s.charCodeAt(i)) >>> 0);
    h = ((((h << 5) + h) ^ n) >>> 0);
    return 'p' + h.toString(36) + '-' + n.toString(36);
  }

  /** 需要外置的字符串？（dataURL 图片且够大） */
  function isBigImage(s) {
    return s.length > LIMIT && s.indexOf('data:image/') === 0;
  }

  /* ---------------- 对外：外置 / 水合 ---------------- */
  /**
   * 落盘前调用：把大图搬到 IndexedDB，返回只含引用的深拷贝
   * 失败时原样返回（交给 localStorage，由 store 报配额错误）
   */
  function externalize(data) {
    if (!usable || !data) return Promise.resolve(data);
    var pairs = [], seen = {};
    var slim = walk(data, function (s) {
      if (!isBigImage(s)) return s;
      var k = keyOf(s);
      if (!seen[k]) { seen[k] = 1; pairs.push([k, s]); }
      return PREFIX + k;
    });
    if (!pairs.length) return Promise.resolve(slim);
    return putMany(pairs).then(function () { return slim; }, function () { return data; });
  }

  /** 启动时调用：把 vault:key 全部换回 dataURL，返回完整深拷贝 */
  function hydrate(data) {
    if (!usable || !data) return Promise.resolve(data);
    var need = {}, list = [];
    walk(data, function (s) {
      if (s.indexOf(PREFIX) !== 0) return s;
      var k = s.slice(PREFIX.length);
      if (!need[k]) { need[k] = 1; list.push(k); }
      return s;
    });
    if (!list.length) return Promise.resolve(data);
    return getMany(list).then(function (map) {
      return walk(data, function (s) {
        if (s.indexOf(PREFIX) !== 0) return s;
        return map[s.slice(PREFIX.length)] || MISSING;
      });
    }, function () { return data; });
  }

  /** 启动时等仓库就绪；不支持则返回 false 并永久降级 */
  function ready() {
    if (!usable) return Promise.resolve(false);
    return openDB().then(function () { return true; }, function () {
      usable = false;
      console.warn('[photoVault] IndexedDB 不可用，照片退回 localStorage（大图可能超限）');
      return false;
    });
  }

  return {
    ready: ready,
    enabled: function () { return usable; },
    externalize: externalize,
    hydrate: hydrate,
    clear: clear,
    keyOf: keyOf,
    LIMIT: LIMIT,
    PREFIX: PREFIX
  };
})();
