/* =========================================================
   dataSource.js — 数据适配层（DataSource）
   ────────────────────────────────────────────────────────
   界面只认「语义函数」，例如 api.advanceHazard(id, 'closed')。
   内部有两套实现：
     · local 实现：读写 store（localStorage），同步返回、零延迟，
       全程不发起任何网络请求 —— 单机离线版的默认且唯一通路
     · real 实现：走 fetch 到 CONFIG.baseURL，接真实后端用；
       单机版不启用（CONFIG.source 固定 'local'，界面无切换入口）
   本层的意义：将来要接后端时，只需把 CONFIG.source 切成 'real'
   并配好 baseURL / getToken，界面一行都不用动。
   ========================================================= */
window.SD = window.SD || {};

SD.api = (function () {
  var U = SD.utils;
  var C = SD.CONFIG;

  /* ---------------- local 实现统一外壳 ----------------
     本机操作立即完成（Promise 只是保持与 real 实现同为异步签名，
     界面代码在两种数据源下完全一致）。 */
  function local(fn) {
    try { return Promise.resolve(fn()); }
    catch (e) { return Promise.reject(e); }
  }

  /* ---------------- real 实现：统一请求（接后端时才走） ---------------- */
  function request(path, opts) {
    opts = opts || {};
    var url = C.baseURL.replace(/\/$/, '') + path;
    var headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    var token = (typeof C.getToken === 'function') ? C.getToken() : '';
    if (token) headers['Authorization'] = 'Bearer ' + token;

    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = null;
    if (ctrl) timer = setTimeout(function () { ctrl.abort(); }, C.timeout);

    return fetch(url, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) {
      if (!r.ok) throw new Error('接口返回 ' + r.status);
      return r.json();
    }).then(function (json) {
      // 约定后端统一包 {code, data, message}；裸数组/对象也兼容
      if (json && json.code != null && json.code !== 0 && json.code !== 200) {
        throw new Error(json.message || ('接口错误 ' + json.code));
      }
      return (json && json.data !== undefined) ? json.data : json;
    }).then(function (d) { if (timer) clearTimeout(timer); return d; },
            function (e) { if (timer) clearTimeout(timer); throw e; });
  }

  var isReal = function () { return String(C.source) === 'real'; };

  /* ---------------- 取数：整份快照 ---------------- */
  function fetchAll() {
    if (isReal()) return request('/workbench/overview');
    return local(function () { return U.clone(SD.store.data()); });
  }

  /* ---------------- 通用 CRUD 工厂 ----------------
     巡检 / 培训 / 证书 / 通知 的读写形状完全一致，
     这里用一份工厂生成各自的语义函数，避免四段几乎一样的代码。
     local 实现落到 store（localStorage），real 实现落到 REST 约定路径。      */

  /**
   * @param {string} collName 数据集合名（inspections / trainings / certificates / notices）
   * @param {string} path     真实接口路径
   * @param {object} opts     { idPrefix, codeType, onCreate, onUpdate }
   *
   * 编号（2026-10-21 起改为用户手动必填，不再自动生成）：
   *   · 没给 code        → create 直接拒绝（表单上已是必填输入框，这里做数据层兜底）
   *   · 给了 code        → 新增时校验同类唯一；编辑时只在「确实改了号」才校验，
   *                        这样历史重号记录改其它字段不会被拦住
   */
  function crud(collName, path, opts) {
    opts = opts || {};

    function coll() {
      var d = SD.store.data();
      if (!Array.isArray(d[collName])) d[collName] = [];
      return d[collName];
    }
    function find(arr, id) {
      for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i];
      return null;
    }

    return {
      list: function () {
        if (isReal()) return request(path);
        return local(function () { return U.clone(coll()); });
      },

      create: function (payload) {
        if (isReal()) return request(path, { method: 'POST', body: payload });
        return local(function () {
          var arr = coll();
          var p = Object.assign({}, payload);
          if (!p.id) p.id = U.uid(opts.idPrefix || 'X');
          // 编号手动必填：数据层兜底拒绝空号（错误文案与表单一致）
          if (opts.codeType && SD.code && !String(p.code == null ? '' : p.code).trim()) {
            throw new Error('「' + SD.code.label(opts.codeType) + '」不能为空');
          }
          if (opts.codeType && SD.code) SD.code.assertUnique(opts.codeType, p.code, p.id);
          if (typeof opts.onCreate === 'function') opts.onCreate(p);
          arr.unshift(p);                 // 新增的排最前，符合「刚录的马上能看见」
          SD.store.setData(SD.store.data());
          return U.clone(p);
        });
      },

      update: function (id, patch) {
        if (isReal()) return request(path + '/' + encodeURIComponent(id), { method: 'PATCH', body: patch });
        return local(function () {
          var arr = coll();
          var hit = find(arr, id);
          if (!hit) throw new Error('记录不存在：' + id);
          // 只在「确实改了编号」时校验唯一性：历史重号记录改其它字段不受影响
          if (opts.codeType && SD.code && patch && patch.code != null &&
              String(patch.code).trim() !== String(hit.code || '').trim()) {
            SD.code.assertUnique(opts.codeType, patch.code, id);
          }
          Object.keys(patch || {}).forEach(function (k) { hit[k] = patch[k]; });
          if (typeof opts.onUpdate === 'function') opts.onUpdate(hit, patch);
          SD.store.setData(SD.store.data());
          return U.clone(hit);
        });
      },

      remove: function (id) {
        if (isReal()) return request(path + '/' + encodeURIComponent(id), { method: 'DELETE' });
        return local(function () {
          var arr = coll();
          var idx = -1;
          for (var k = 0; k < arr.length; k++) if (arr[k].id === id) { idx = k; break; }
          if (idx < 0) throw new Error('记录不存在：' + id);
          arr.splice(idx, 1);
          SD.store.setData(SD.store.data());
          return { id: id, removed: true };
        });
      }
    };
  }

  /* ---------------- 隐患 ---------------- */
  function listHazards() {
    if (isReal()) return request('/hazards');
    return local(function () { return U.clone(SD.store.data().hazards || []); });
  }

  /** 新增隐患：真实接口返回带 id 的完整对象；local 里本地补 id 与初始流转记录 */
  function createHazard(payload) {
    if (isReal()) return request('/hazards', { method: 'POST', body: payload });

    return local(function () {
      var d = SD.store.data();
      var id = U.uid('H');
      var hz = Object.assign({}, payload, {
        id: id,
        status: 'pending',
        delayCount: 0,
        closedAt: null,
        flow: [{
          at: U.today() + ' ' + new Date().toTimeString().slice(0, 5),
          by: '王安全', from: '—', to: '待整改',
          note: payload.note || '新建登记'
        }]
      });
      // 编号手动必填：调用方没给 code 一律拒绝，不再自动补号
      if (!String(hz.code == null ? '' : hz.code).trim()) {
        throw new Error('「隐患编号」不能为空');
      }
      if (SD.code) SD.code.assertUnique('hazard', hz.code, id);
      d.hazards = d.hazards || [];
      d.hazards.unshift(hz);
      SD.store.setData(d);
      return U.clone(hz);
    });
  }

  /** 通用字段更新（改期限、改责任人等） */
  function updateHazard(id, patch) {
    if (isReal()) return request('/hazards/' + encodeURIComponent(id), { method: 'PATCH', body: patch });

    return local(function () {
      var d = SD.store.data();
      var hit = (d.hazards || []).filter(function (h) { return h.id === id; })[0];
      if (!hit) throw new Error('隐患不存在：' + id);
      // 只在「确实改了编号」时校验唯一性（历史重号记录改其它字段不受影响）
      if (SD.code && patch && patch.code != null &&
          String(patch.code).trim() !== String(hit.code || '').trim()) {
        SD.code.assertUnique('hazard', patch.code, id);
      }
      Object.keys(patch || {}).forEach(function (k) { hit[k] = patch[k]; });
      SD.store.setData(d);
      return U.clone(hit);
    });
  }

  /**
   * 状态流转：pending → fixing → verifying → closed，旁挂 delayed
   * 每次流转强制写一条 flow 记录（谁、何时、从什么到什么、备注）——台账法定要求
   * @param {string} id      隐患 id
   * @param {string} to      目标状态
   * @param {object} extra   { note, by, delayReason, delayApprovedBy, dueDate }
   */
  function advanceHazard(id, to, extra) {
    extra = extra || {};
    if (isReal()) {
      return request('/hazards/' + encodeURIComponent(id) + '/status', {
        method: 'POST', body: {
          to: to, note: extra.note || '',
          delayReason: extra.delayReason, delayApprovedBy: extra.delayApprovedBy, dueDate: extra.dueDate
        }
      });
    }

    return local(function () {
      var d = SD.store.data();
      var hit = (d.hazards || []).filter(function (h) { return h.id === id; })[0];
      if (!hit) throw new Error('隐患不存在：' + id);

      var NAME = { pending: '待整改', fixing: '整改中', verifying: '待验收', closed: '已闭环', delayed: '已延期' };
      var from = NAME[hit.status] || hit.status;

      // 延期：原始期限 originalDueDate 永不改写，只推当前期限 dueDate，并累计延期次数
      if (to === 'delayed') {
        hit.delayCount = (hit.delayCount || 0) + 1;
        hit.delayReason = extra.delayReason || '';
        hit.delayApprovedBy = extra.delayApprovedBy || '';
        if (extra.dueDate) hit.dueDate = extra.dueDate;
      }
      if (to === 'closed') hit.closedAt = U.today();

      hit.status = to;
      hit.flow = hit.flow || [];
      hit.flow.push({
        at: U.today() + ' ' + new Date().toTimeString().slice(0, 5),
        by: extra.by || '王安全',
        from: from, to: NAME[to] || to,
        note: extra.note || ''
      });

      SD.store.setData(d);
      return U.clone(hit);
    });
  }

  /* ---------------- 巡检 ---------------- */
  function listInspections() {
    if (isReal()) return request('/inspections');
    return local(function () { return U.clone(SD.store.data().inspections || []); });
  }

  /** 标记巡检完成，并写入执行记录 */
  function completeInspection(id, payload) {
    payload = payload || {};
    if (isReal()) return request('/inspections/' + encodeURIComponent(id) + '/complete', { method: 'POST', body: payload });

    return local(function () {
      var d = SD.store.data();
      var hit = (d.inspections || []).filter(function (x) { return x.id === id; })[0];
      if (!hit) throw new Error('巡检任务不存在：' + id);
      hit.status = 'done';
      hit.completedAt = U.today();
      hit.hazardCount = payload.hazardCount || 0;
      hit.record = {
        findings: payload.findings || '现场正常，无异常项',
        signedBy: payload.signedBy || hit.executor,
        signedAt: U.today() + ' ' + new Date().toTimeString().slice(0, 5)
      };
      SD.store.setData(d);
      return U.clone(hit);
    });
  }

  /** 改期：改期不减免，仍留在原周期分母内（口径见 metrics.weekInspectionRate） */
  function rescheduleInspection(id, to, reason) {
    if (isReal()) return request('/inspections/' + encodeURIComponent(id) + '/reschedule', { method: 'POST', body: { to: to, reason: reason } });

    return local(function () {
      var d = SD.store.data();
      var hit = (d.inspections || []).filter(function (x) { return x.id === id; })[0];
      if (!hit) throw new Error('巡检任务不存在：' + id);
      hit.status = 'rescheduled';
      hit.rescheduleTo = to;
      hit.reason = reason || '';
      SD.store.setData(d);
      return U.clone(hit);
    });
  }

  /* ---------------- 巡检 / 培训 / 证书 / 通知 的增删改查 ----------------
     四者形状一致，统一由 crud 工厂生成（见上方 crud 定义）。
     巡检另有「标记完成」「改期」两个带业务规则的写操作，单独保留。      */
  var inspCRUD   = crud('inspections',   '/inspections',   { idPrefix: 'INS', codeType: 'inspection' });
  var trainCRUD  = crud('trainings',     '/trainings',     { idPrefix: 'TR',  codeType: 'training' });
  var certCRUD   = crud('certificates',  '/certificates',  { idPrefix: 'CT',  codeType: 'certificate' });
  var noticeCRUD = crud('notices',       '/notices',       { idPrefix: 'NT',  codeType: 'notice' });

  /* 特种作业：人员台账 + 危险作业票（两张集合形状一致，复用 crud 工厂） */
  var specPersonnelCRUD = crud('specialPersonnel', '/special-personnel', { idPrefix: 'SP', codeType: 'special' });

  /* 交接班记录：没有单据编号（原表不带号），一天一班次一份 */
  var shiftLogCRUD = crud('shiftLogs', '/shift-logs', { idPrefix: 'SL' });
  var workPermitCRUD    = crud('workPermits',      '/work-permits',     { idPrefix: 'WP', codeType: 'permit' });
  var devicePersonCRUD  = crud('devicePersonnel',  '/device-personnel', { idPrefix: 'DP', codeType: 'device' });

  /**
   * 隐患作废（不是物理删除）
   * 隐患台账属法定留痕材料，登记表不允许抹掉 —— 这里只把它置为「已作废」，
   * 记录作废人与原因，界面上不再计入未整改 / 逾期 / 待办，但台账里仍可查。
   */
  function voidHazard(id, reason, by) {
    if (isReal()) {
      return request('/hazards/' + encodeURIComponent(id) + '/void', {
        method: 'POST', body: { reason: reason || '' }
      });
    }
    return local(function () {
      var d = SD.store.data();
      var hit = (d.hazards || []).filter(function (h) { return h.id === id; })[0];
      if (!hit) throw new Error('隐患不存在：' + id);
      var NAME = { pending: '待整改', fixing: '整改中', verifying: '待验收', closed: '已闭环', delayed: '已延期', void: '已作废' };
      var from = NAME[hit.status] || hit.status;
      hit.status = 'void';
      hit.voidReason = reason || '';
      hit.flow = hit.flow || [];
      hit.flow.push({
        at: U.today() + ' ' + new Date().toTimeString().slice(0, 5),
        by: by || '王安全', from: from, to: '已作废', note: reason || ''
      });
      SD.store.setData(d);
      return U.clone(hit);
    });
  }

  return {
    source: function () { return C.source; },
    isReal: isReal,
    fetchAll: fetchAll,

    // 隐患
    listHazards: listHazards,
    createHazard: createHazard,
    updateHazard: updateHazard,
    advanceHazard: advanceHazard,
    voidHazard: voidHazard,

    // 巡检（另有 complete / reschedule 两个业务写操作）
    listInspections: listInspections,
    createInspection: inspCRUD.create,
    updateInspection: inspCRUD.update,
    removeInspection: inspCRUD.remove,
    completeInspection: completeInspection,
    rescheduleInspection: rescheduleInspection,

    // 培训 / 证书 / 通知
    listTrainings: trainCRUD.list,
    createTraining: trainCRUD.create,
    updateTraining: trainCRUD.update,
    removeTraining: trainCRUD.remove,

    listCertificates: certCRUD.list,
    createCertificate: certCRUD.create,
    updateCertificate: certCRUD.update,
    removeCertificate: certCRUD.remove,

    listNotices: noticeCRUD.list,
    createNotice: noticeCRUD.create,
    updateNotice: noticeCRUD.update,
    removeNotice: noticeCRUD.remove,

    // 特种作业：特种作业人员台账
    listSpecialPersonnel: specPersonnelCRUD.list,
    createSpecialPersonnel: specPersonnelCRUD.create,
    updateSpecialPersonnel: specPersonnelCRUD.update,
    removeSpecialPersonnel: specPersonnelCRUD.remove,

    listDevicePersonnel: devicePersonCRUD.list,
    createDevicePersonnel: devicePersonCRUD.create,
    updateDevicePersonnel: devicePersonCRUD.update,
    removeDevicePersonnel: devicePersonCRUD.remove,

    // 特种作业：危险作业票（八大危险作业）
    listWorkPermits: workPermitCRUD.list,
    createWorkPermit: workPermitCRUD.create,
    updateWorkPermit: workPermitCRUD.update,
    removeWorkPermit: workPermitCRUD.remove,

    // 安全巡检交接班记录（2026-10-25）
    listShiftLogs: shiftLogCRUD.list,
    createShiftLog: shiftLogCRUD.create,
    updateShiftLog: shiftLogCRUD.update,
    removeShiftLog: shiftLogCRUD.remove
  };
})();
