/* =========================================================
   store.js — 本地持久化层（localStorage）
   职责单一：读写本机快照，不做任何业务计算，不碰 DOM。
   本版本不带示例数据：首次打开即为空白状态，之后所有写操作
  （登记隐患、推进状态、标记完成…）都落到这里，刷新页面不丢。
   「清空数据」= 丢弃本机改动，恢复到这个空白初始状态。
   ========================================================= */
window.SD = window.SD || {};

SD.store = (function () {
  var KEY = SD.CONFIG.storageKey;
  var U = SD.utils;

  /* 内存态：{ data, thresholds, source, dirty } */
  var mem = null;

  /** 默认内存态（首次打开 / 清空时使用空白数据） */
  function defaults() {
    return {
      version: 1,
      source: 'local',
      thresholds: {
        soonDays: SD.CONFIG.thresholds.soonDays,
        certWarnDays: SD.CONFIG.thresholds.certWarnDays,
        certNoticeDays: SD.CONFIG.thresholds.certNoticeDays
      },
      data: SD.initial.build(),
      dirty: false,          // 是否已有本地改动（用于「清空数据」提示）
      savedAt: null,
      settings: {
        appName: '安全员工作台',     // 左上角工作台名称（可自定义）
        appSub: 'EHS 日常办公台',    // 左上角副标题（可自定义）
        appIcon: 'shield'            // 左上角图标（内置图标名，或 dataURL 自定义图片）
      }
    };
  }

  /** 读取工作台外观设置（缺字段时回退默认，保证向后兼容） */
  function getSettings() {
    var d = defaults().settings;
    var cur = get().settings || {};
    return {
      appName: (typeof cur.appName === 'string' && cur.appName.trim()) ? cur.appName : d.appName,
      appSub: (typeof cur.appSub === 'string') ? cur.appSub : d.appSub,
      appIcon: (typeof cur.appIcon === 'string' && cur.appIcon) ? cur.appIcon : d.appIcon
    };
  }

  /** 写入工作台外观设置并落盘 */
  function setSettings(s) {
    var cur = getSettings();
    get().settings = {
      appName: (s && typeof s.appName === 'string' && s.appName.trim()) ? s.appName.trim() : cur.appName,
      appSub: (s && typeof s.appSub === 'string') ? s.appSub : cur.appSub,
      appIcon: (s && typeof s.appIcon === 'string' && s.appIcon) ? s.appIcon : cur.appIcon
    };
    save();
    return get().settings;
  }

  function readRaw() {
    try {
      var s = localStorage.getItem(KEY);
      return s ? JSON.parse(s) : null;
    } catch (e) {
      console.warn('[store] 读取本地数据失败，将使用空白初始状态', e);
      return null;
    }
  }

  /** 初始化：优先读本机快照，读不到就用空白初始状态 */
  function load() {
    var raw = readRaw();
    if (raw && raw.data && Array.isArray(raw.data.hazards)) {
      mem = raw;
      // 补齐可能缺失的字段，保证向后兼容（旧备份缺字段时补空，不补假数据）
      mem.thresholds = Object.assign({}, defaults().thresholds, mem.thresholds || {});
      if (!Array.isArray(mem.data.trend)) mem.data.trend = [];
      if (!Array.isArray(mem.data.deptTrend)) mem.data.deptTrend = [];
      if (!Array.isArray(mem.data.inspections)) mem.data.inspections = [];
      if (!Array.isArray(mem.data.trainings)) mem.data.trainings = [];
      if (!Array.isArray(mem.data.devicePersonnel)) mem.data.devicePersonnel = [];
      // 交接班记录（2026-10-25 新增）：老快照没有这个集合时补空数组
      if (!Array.isArray(mem.data.shiftLogs)) mem.data.shiftLogs = [];
      if (!Array.isArray(mem.data.specialPersonnel)) mem.data.specialPersonnel = [];
      if (!Array.isArray(mem.data.certificates)) mem.data.certificates = [];
      if (!Array.isArray(mem.data.notices)) mem.data.notices = [];
      if (!Array.isArray(mem.data.specialPersonnel)) mem.data.specialPersonnel = [];
      if (!Array.isArray(mem.data.workPermits)) mem.data.workPermits = [];
      // 老快照里的培训可能没有 photos 字段，补齐成空数组
      (mem.data.trainings || []).forEach(function (t) { if (!Array.isArray(t.photos)) t.photos = []; });
      mem.settings = Object.assign({}, defaults().settings, mem.settings || {});
    } else {
      mem = defaults();
    }
    return mem;
  }

  function get() { return mem || load(); }

  /** 同步配置阈值到 CONFIG（计算层统一从 CONFIG 读） */
  function syncConfig() {
    var t = get().thresholds || {};
    SD.CONFIG.thresholds.soonDays = t.soonDays != null ? t.soonDays : 3;
    SD.CONFIG.thresholds.certWarnDays = t.certWarnDays != null ? t.certWarnDays : 30;
    SD.CONFIG.thresholds.certNoticeDays = t.certNoticeDays != null ? t.certNoticeDays : 90;
    SD.CONFIG.source = get().source || 'local';
  }

  /** 落盘（写入失败不影响界面，只提示一次） */
  var saveQueue = Promise.resolve();   // 串行写，避免连续保存时旧快照覆盖新快照
  var quotaWarned = false;

  /** 真正落到 localStorage（失败提示一次，不刷屏） */
  function writeLocal(snap) {
    try {
      localStorage.setItem(KEY, JSON.stringify(snap));
      return true;
    } catch (e) {
      console.warn('[store] 本地存储写入失败', e);
      if (!quotaWarned) {
        quotaWarned = true;
        if (U && U.toast) {
          U.toast('本地存储已满：照片太大存不下。可减少照片张数，或把 config.js 的 photo.compress 设为 true 改用压缩', 'err');
        }
      }
      return false;
    }
  }

  /**
   * 落盘
   * 照片不再压缩（2026-10-24 起保留原图），大图由 photoVault 外置到 IndexedDB，
   * JSON 里只留 `vault:<key>` 引用 —— localStorage 不会再被几张原图撑爆。
   * 不支持 IndexedDB 时退回整包写 localStorage（数据量小时与以前一致）。
   */
  function save() {
    try { get().savedAt = new Date().toISOString(); } catch (e) {}

    if (!(SD.photoVault && SD.photoVault.enabled())) return writeLocal(mem);

    var snap = Object.assign({}, mem);
    saveQueue = saveQueue.then(function () {
      return SD.photoVault.externalize(snap.data).then(function (slim) {
        writeLocal(Object.assign({}, snap, { data: slim }));
      }, function () {
        writeLocal(snap);
      });
    });
    return true;
  }

  /**
   * 启动初始化（异步）：读本地快照 + 把 IndexedDB 里的大图水合回内存。
   * 之后 get / data 拿到的仍是完整 dataURL，视图代码无需改。
   */
  function init() {
    load();
    if (!(SD.photoVault && SD.photoVault.enabled())) return Promise.resolve(mem);
    return SD.photoVault.hydrate(mem.data).then(function (full) {
      mem.data = full;
      return mem;
    }, function () { return mem; });
  }

  /** 取整份业务数据（可变副本由调用方自行 clone） */
  function data() { return get().data; }

  /** 写整份业务数据，并标记本地已改动 */
  function setData(d) {
    get().data = d;
    get().dirty = true;
    save();
  }

  /** 清空数据：丢弃本机全部改动，恢复空白初始状态（保留阈值与外观设置） */
  function reset() {
    var th = get().thresholds, st = get().settings;
    mem = defaults();
    mem.thresholds = th;
    mem.settings = st;
    save();
    // 清仓库要排在保存之后：保存是异步外置，先清会被随后的写入又填回来
    if (SD.photoVault && SD.photoVault.clear) {
      saveQueue = saveQueue.then(function () { return SD.photoVault.clear(); });
    }
    return mem;
  }

  function setSource(v) { get().source = v; save(); }
  function getThresholds() { return get().thresholds; }
  function setThresholds(t) {
    get().thresholds = Object.assign({}, get().thresholds, t || {});
    syncConfig(); save();
  }

  /* ---------------- 导出 / 导入 ---------------- */
  function exportJSON() {
    var snap = get();
    return JSON.stringify({
      app: (snap.settings && snap.settings.appName) || '安全员工作台',
      version: snap.version || 1,
      exportedAt: new Date().toISOString(),
      thresholds: snap.thresholds,
      settings: snap.settings,
      data: snap.data
    }, null, 2);
  }

  /**
   * 导入恢复
   * 编号（2026-10-21 起手动必填）在导入时同样校验：
   *   · 七类单据逐条查「编号为空 / 同类型重复」，不静默补号
   *   · 有问题的记录在错误信息里点名（最多列 5 条），用户改备份文件后再导
   * @returns {{ok:boolean, msg:string}}
   */
  function importJSON(text) {
    var obj;
    try { obj = JSON.parse(text); }
    catch (e) { return { ok: false, msg: '不是合法的 JSON 文件' }; }

    var d = obj && obj.data ? obj.data : obj;
    if (!d || !Array.isArray(d.hazards)) {
      return { ok: false, msg: '文件里没有找到隐患数据，请确认是本工作台导出的备份' };
    }

    // 编号校验：空号 / 同类型重号一律拒入（数据层与表单层同一套口径）
    if (SD.code && SD.code.COLLECTIONS) {
      var bad = [];
      Object.keys(SD.code.COLLECTIONS).forEach(function (type) {
        var coll = SD.code.COLLECTIONS[type];
        var arr = Array.isArray(d[coll]) ? d[coll] : [];
        var seen = {};
        arr.forEach(function (x, i) {
          var c = String((x && x.code) == null ? '' : x.code).trim();
          var label = SD.code.label(type);
          if (!c) { bad.push('第 ' + (i + 1) + ' 条' + label + '为空'); return; }
          var key = c.toUpperCase();
          if (seen[key]) { bad.push(label + '「' + c + '」重复'); return; }
          seen[key] = true;
        });
      });
      if (bad.length) {
        return { ok: false, msg: '编号校验未通过（编号已改为手动填写，不可为空、不可重复）：' +
          bad.slice(0, 5).join('；') + (bad.length > 5 ? ' 等 ' + bad.length + ' 处' : '') };
      }
    }

    get().data = {
      updatedAt: d.updatedAt || new Date().toISOString(),
      hazards: Array.isArray(d.hazards) ? d.hazards : [],
      inspections: Array.isArray(d.inspections) ? d.inspections : [],
      trainings: Array.isArray(d.trainings) ? d.trainings : [],
      certificates: Array.isArray(d.certificates) ? d.certificates : [],
      notices: Array.isArray(d.notices) ? d.notices : [],
      trend: Array.isArray(d.trend) ? d.trend : [],
      deptTrend: Array.isArray(d.deptTrend) ? d.deptTrend : [],
      specialPersonnel: Array.isArray(d.specialPersonnel) ? d.specialPersonnel : [],
      workPermits: Array.isArray(d.workPermits) ? d.workPermits : []
    };
    if (obj.thresholds) get().thresholds = Object.assign({}, get().thresholds, obj.thresholds);
    if (obj.settings) get().settings = Object.assign({}, defaults().settings, obj.settings);
    get().dirty = true;
    syncConfig();
    save();
    return { ok: true, msg: '导入成功' };
  }

  return {
    init: init,
    load: load, get: get, save: save,
    data: data, setData: setData, reset: reset,
    setSource: setSource,
    getThresholds: getThresholds, setThresholds: setThresholds,
    getSettings: getSettings, setSettings: setSettings,
    syncConfig: syncConfig,
    exportJSON: exportJSON, importJSON: importJSON
  };
})();
