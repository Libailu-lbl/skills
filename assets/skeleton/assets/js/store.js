/* =========================================================
   store.js — 本地持久化（localStorage）+ 示例数据 + 导出/导入/清空
   ────────────────────────────────────────────────────────
   数据形状：{ items:[{id,title,due,status,createdAt,note}], meta:{} }
   铁律：本项目**只在这里读写存储**，其它模块一律通过 store.data() 拿内存对象。
   ========================================================= */
window.SD = window.SD || {};

SD.store = (function () {
  var U = SD.utils;
  var KEY = SD.CONFIG.storageKey;
  var mem = null;

  /* ---------- 示例数据：4 条，其中 1 条逾期（铁律：首次打开不能空白） ---------- */
  function defaults() {
    if (!SD.CONFIG.sample) return { items: [] };
    return {
      items: [
        { id: 's1', title: '把本周要交的三份材料列出来', due: U.addDays(-1), status: 'todo', createdAt: U.addDays(-3), note: '逾期示例：一键完成即可' },
        { id: 's2', title: '整理上周的检查记录', due: U.today(), status: 'todo', createdAt: U.addDays(-2), note: '' },
        { id: 's3', title: '确认下月排班表', due: U.addDays(2), status: 'todo', createdAt: U.addDays(-1), note: '' },
        { id: 's4', title: '已经做完的一条（看完成态）', due: U.addDays(-1), status: 'done', createdAt: U.addDays(-5), note: '' }
      ]
    };
  }

  function read() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      return (o && typeof o === 'object') ? o : null;
    } catch (e) { return null; }
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch (e) {
      U.toast('本机存储写满或不可用，请先导出备份', 'err');
    }
  }

  /** 首次打开：没有快照就写入示例数据 */
  function load() {
    var o = read();
    if (!o || !Array.isArray(o.items)) {
      mem = defaults();
      save();
    } else {
      mem = o;
      if (!Array.isArray(mem.items)) mem.items = [];
    }
    return mem;
  }

  function get() { if (!mem) load(); return mem; }
  function data() { return get(); }
  function items() { return get().items; }

  /* ---------- 增删改：只改内存 + 落盘，不碰 DOM ---------- */
  function add(item) {
    var it = {
      id: U.uid('it'),
      title: String(item.title || '').trim(),
      due: item.due || U.today(),
      status: 'todo',
      createdAt: U.today(),
      note: String(item.note || '')
    };
    get().items.unshift(it);
    save();
    return it;
  }
  function update(id, patch) {
    var t = get().items.filter(function (x) { return x.id === id; })[0];
    if (!t) return null;
    Object.keys(patch || {}).forEach(function (k) { t[k] = patch[k]; });
    save();
    return t;
  }
  function remove(id) {
    var arr = get().items;
    for (var i = 0; i < arr.length; i++) if (arr[i].id === id) { arr.splice(i, 1); save(); return true; }
    return false;
  }
  function toggle(id) {
    var t = get().items.filter(function (x) { return x.id === id; })[0];
    if (!t) return null;
    t.status = (t.status === 'done' ? 'todo' : 'done');
    save();
    return t;
  }

  /* ---------- 备份 / 恢复 / 清空 ---------- */
  function exportJSON() {
    return JSON.stringify({ app: SD.CONFIG.appName, version: 1, exportedAt: new Date().toISOString(), data: get() }, null, 2);
  }
  function importJSON(text) {
    var o;
    try { o = JSON.parse(String(text)); } catch (e) { return { ok: false, msg: '不是合法的 JSON 文件' }; }
    var d = o && o.data;
    if (!d || !Array.isArray(d.items)) return { ok: false, msg: '文件里没有 items 数据，可能不是本工作台的备份' };
    mem = { items: d.items, meta: d.meta || {} };
    save();
    return { ok: true, msg: '已导入 ' + d.items.length + ' 条数据' };
  }
  /** 清空 = 回到初始态（示例版回示例，空白版回空白）。调用前必须已通过专用密码校验。 */
  function reset() {
    mem = defaults();
    save();
    return mem;
  }

  return {
    load: load, data: data, items: items, save: save,
    add: add, update: update, remove: remove, toggle: toggle,
    exportJSON: exportJSON, importJSON: importJSON, reset: reset
  };
})();
