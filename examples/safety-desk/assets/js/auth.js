/* =========================================================
   auth.js — 角色 / 权限 / 六位安全员密码
   ────────────────────────────────────────────────────────
   2026-10-25 改版（按用户要求）：
     · **进入工作台默认就是「受限用户」**——只能看、能打印、能导出 Excel，
       但不能新增 / 修改 / 删除，也进不了特种作业、改不了密码与数据
     · 要变成「安全员（全权）」，必须在页面里输入 **六位安全员密码**
     · 解锁只对**本次打开有效**（sessionStorage）：关掉再进又回到受限，
       避免「解一次就永久敞开」
     · 密码默认 123456，可在「设置 → 密码设置」里改；本机只存加盐摘要，
       不存明文
     · 另有**清空数据专用密码**（与登录密码相互独立，默认 888888）：
       「清空数据」这类不可撤销的操作，除了要安全员权限，还必须再输入这个专用密码
     · **连续 30 分钟无操作自动退回受限**（见 app.js 的 idle 看门狗，
       阈值在 config.js → security.idleLockMin）

   能力点（perm）：
     data.read      浏览（受限用户也有）
     data.write     新增 / 修改 / 删除（安全员）
     special.view   特种作业模块（安全员）
     settings.write 导入 / 清空数据 / 改密码（安全员）

   ⚠️ 这是**本机前端**的门禁，用来防误操作、防顺手改数，不是网络安全。
      真系统里应把权限判定放到后端，can() 的调用点可以不改。
   ========================================================= */
window.SD = window.SD || {};

SD.auth = (function () {
  var UNLOCK_KEY = 'sd_auth_unlocked';   // sessionStorage：本次打开是否已输入过密码
  var PIN_KEY = 'sd_auth_pin';           // localStorage：{ v, salt, hash } —— 登录/解锁密码
  var PURGE_KEY = 'sd_auth_purge';       // localStorage：{ v, salt, hash } —— 清空数据专用密码
  var DEFAULT_PIN = '123456';
  var DEFAULT_PURGE_PIN = '888888';      // 清空数据专用密码（与登录密码分开，可单独改）

  /* 角色定义 */
  var ROLES = {
    safety_officer: {
      name: '安全员（全权）',
      desc: '可管理隐患、巡检、培训、证书、通知、特种作业与全部设置',
      full: true,
      perms: ['data.read', 'data.write', 'special.view', 'settings.write']
    },
    restricted: {
      name: '受限用户',
      desc: '只能查看、打印与导出；新增 / 修改 / 删除、特种作业、导入与清空需要安全员密码',
      full: false,
      perms: ['data.read']
    }
  };

  function ss() { try { return window.sessionStorage; } catch (e) { return null; } }
  function ls() { try { return window.localStorage; } catch (e) { return null; } }

  /** 当前角色：没在本次会话里解锁过 → 受限 */
  function current() {
    var s = ss();
    var unlocked = false;
    try { unlocked = !!s && s.getItem(UNLOCK_KEY) === '1'; } catch (e) {}
    return unlocked ? 'safety_officer' : 'restricted';
  }

  /**
   * 直接设置本次会话的角色（不做密码校验——这是程序内 API，
   * 界面上的解锁入口一律先走 unlock(pin)）。
   */
  function set(role) {
    if (!ROLES[role]) return false;
    var s = ss();
    try { if (s) s.setItem(UNLOCK_KEY, role === 'safety_officer' ? '1' : '0'); } catch (e) {}
    return true;
  }

  function roleInfo(role) { return ROLES[role || current()] || ROLES.restricted; }

  /** 权限判定：full 角色直接放行；否则查 perms */
  function can(perm) {
    var r = roleInfo();
    if (r.full) return true;
    return (r.perms || []).indexOf(perm) >= 0;
  }

  /* ---------------- 六位密码 ---------------- */

  /** 加盐摘要（多轮 FNV-1a，纯前端防明文，不是密码学强度） */
  function digest(pin, salt) {
    var s = String(salt) + '|' + String(pin) + '|sd';
    var h = 0x811c9dc5;
    for (var round = 0; round < 2000; round++) {
      for (var i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
      }
      s = String(h);
    }
    return ('00000000' + h.toString(16)).slice(-8);
  }

  function readPinRec() {
    var s = ls();
    if (!s) return null;
    try {
      var raw = s.getItem(PIN_KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      return (o && o.salt && o.hash) ? o : null;
    } catch (e) { return null; }
  }

  /** 是否已自定义过密码（false = 还在用默认 123456） */
  function hasPin() { return !!readPinRec(); }

  /* ---------- 清空数据专用密码（独立存储、独立默认值） ---------- */
  function readPurgeRec() {
    var s = ls();
    if (!s) return null;
    try {
      var raw = s.getItem(PURGE_KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      return (o && o.salt && o.hash) ? o : null;
    } catch (e) { return null; }
  }
  function hasPurgePin() { return !!readPurgeRec(); }

  /** 校验清空专用密码；没改过时接受默认 888888 */
  function verifyPurge(pin) {
    var v = String(pin == null ? '' : pin).trim();
    if (!/^\d{6}$/.test(v)) return false;
    var rec = readPurgeRec();
    if (!rec) return v === DEFAULT_PURGE_PIN;
    return digest(v, rec.salt) === rec.hash;
  }

  /** 设置清空专用密码（旧密码校验由界面负责） */
  function setPurgePin(pin) {
    var v = String(pin == null ? '' : pin).trim();
    if (!/^\d{6}$/.test(v)) return { ok: false, msg: '专用密码必须是 6 位数字' };
    if (verifyPin(v)) return { ok: false, msg: '专用密码不能与登录密码相同' };
    var salt = '';
    var chars = 'abcdef0123456789';
    for (var i = 0; i < 12; i++) salt += chars.charAt(Math.floor(Math.random() * chars.length));
    var s = ls();
    try { if (s) s.setItem(PURGE_KEY, JSON.stringify({ v: 1, salt: salt, hash: digest(v, salt) })); }
    catch (e) { return { ok: false, msg: '本机无法保存密码' }; }
    return { ok: true };
  }

  /** 校验密码；未设置过时接受默认密码 */
  function verifyPin(pin) {
    var v = String(pin == null ? '' : pin).trim();
    if (!/^\d{6}$/.test(v)) return false;
    var rec = readPinRec();
    if (!rec) return v === DEFAULT_PIN;
    return digest(v, rec.salt) === rec.hash;
  }

  /** 设置 / 修改密码（校验旧密码由界面负责，这里只落库） */
  function setPin(pin) {
    var v = String(pin == null ? '' : pin).trim();
    if (!/^\d{6}$/.test(v)) return { ok: false, msg: '密码必须是 6 位数字' };
    var salt = '';
    var chars = 'abcdef0123456789';
    for (var i = 0; i < 12; i++) salt += chars.charAt(Math.floor(Math.random() * chars.length));
    var rec = { v: 1, salt: salt, hash: digest(v, salt) };
    var s = ls();
    try { if (s) s.setItem(PIN_KEY, JSON.stringify(rec)); } catch (e) { return { ok: false, msg: '本机无法保存密码' }; }
    return { ok: true };
  }

  /** 用密码解锁 → 本次会话变成安全员 */
  function unlock(pin) {
    if (!verifyPin(pin)) return { ok: false, msg: '密码不正确（6 位数字）' };
    set('safety_officer');
    return { ok: true };
  }

  /** 退回受限（复核完点一下就走） */
  function lock() { set('restricted'); return true; }

  /** 当前是否还在用默认密码 */
  function usingDefaultPin() { return !hasPin(); }

  return {
    ROLES: ROLES,
    DEFAULT_PIN: DEFAULT_PIN,
    current: current,
    set: set,
    roleInfo: roleInfo,
    can: can,
    hasPin: hasPin,
    verifyPin: verifyPin,
    DEFAULT_PURGE_PIN: DEFAULT_PURGE_PIN,
    hasPurgePin: hasPurgePin,
    verifyPurge: verifyPurge,
    setPurgePin: setPurgePin,
    setPin: setPin,
    unlock: unlock,
    lock: lock,
    usingDefaultPin: usingDefaultPin
  };
})();
