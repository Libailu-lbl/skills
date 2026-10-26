/* =========================================================
   auth.js — 角色 / 六位登录密码 / 清空专用密码
   ────────────────────────────────────────────────────────
   · 打开页面默认「受限」：能看、能导出，不能改数据
   · 输对六位密码 → 安全员；只对本次打开有效（sessionStorage）
   · 清空数据另需「专用密码」（默认 888888），与登录密码分开存
   ⚠️ 这是**本机前端门禁**，用来防误操作、防顺手改数，不是网络安全。
      真系统请把权限判定放到后端，can() 的调用点一处不用改。
   ========================================================= */
window.SD = window.SD || {};

SD.auth = (function () {
  var U = SD.utils;
  var UNLOCK_KEY = 'sd_auth_unlocked';    // sessionStorage：本次打开是否已解锁
  var PIN_KEY = 'sd_auth_pin';            // localStorage：{salt, hash} 登录密码
  var PURGE_KEY = 'sd_auth_purge';        // localStorage：{salt, hash} 清空专用密码
  var DEFAULT_PIN = '123456';

  /* 加盐摘要（多轮 FNV-1a）。纯前端只求不存明文，强度不等于密码学哈希。 */
  function digest(pin, salt) {
    var s = String(salt) + '|' + String(pin) + '|sd';
    var h = 0x811c9dc5;
    for (var r = 0; r < 2000; r++) {
      for (var i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
      }
      s = String(h);
    }
    return ('00000000' + h.toString(16)).slice(-8);
  }
  function readRec(key) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return null;
      var o = JSON.parse(raw);
      return (o && o.salt && o.hash) ? o : null;
    } catch (e) { return null; }
  }
  function writeRec(key, pin) {
    var salt = '';
    var chars = 'abcdef0123456789';
    for (var i = 0; i < 12; i++) salt += chars.charAt(Math.floor(Math.random() * chars.length));
    try { localStorage.setItem(key, JSON.stringify({ v: 1, salt: salt, hash: digest(pin, salt) })); return true; }
    catch (e) { return false; }
  }

  /* ---------- 角色 ---------- */
  function current() {
    try { return sessionStorage.getItem(UNLOCK_KEY) === '1' ? 'safety_officer' : 'restricted'; }
    catch (e) { return 'restricted'; }
  }
  function set(role) {
    try { sessionStorage.setItem(UNLOCK_KEY, role === 'safety_officer' ? '1' : '0'); } catch (e) {}
  }
  function lock() { set('restricted'); }
  /** 权限点：数据读 / 数据写 */
  function can(perm) {
    if (perm === 'data.read') return true;
    return current() === 'safety_officer';
  }

  /* ---------- 登录密码 ---------- */
  function hasPin() { return !!readRec(PIN_KEY); }
  function verifyPin(pin) {
    var v = String(pin == null ? '' : pin).trim();
    if (!/^\d{6}$/.test(v)) return false;
    var rec = readRec(PIN_KEY);
    return rec ? digest(v, rec.salt) === rec.hash : v === DEFAULT_PIN;
  }
  function setPin(pin) {
    var v = String(pin == null ? '' : pin).trim();
    if (!/^\d{6}$/.test(v)) return { ok: false, msg: '密码必须是 6 位数字' };
    if (v === DEFAULT_PIN) return { ok: false, msg: '别再用初始密码 123456，换一个' };
    if (!writeRec(PIN_KEY, v)) return { ok: false, msg: '本机无法保存密码' };
    return { ok: true };
  }
  function unlock(pin) {
    if (!verifyPin(pin)) return { ok: false, msg: '密码不正确（6 位数字）' };
    set('safety_officer');
    return { ok: true };
  }

  /* ---------- 清空专用密码 ---------- */
  function hasPurgePin() { return !!readRec(PURGE_KEY); }
  function verifyPurge(pin) {
    var v = String(pin == null ? '' : pin).trim();
    if (!/^\d{6}$/.test(v)) return false;
    var rec = readRec(PURGE_KEY);
    return rec ? digest(v, rec.salt) === rec.hash : v === SD.CONFIG.security.defaultPurgePin;
  }
  function setPurgePin(pin) {
    var v = String(pin == null ? '' : pin).trim();
    if (!/^\d{6}$/.test(v)) return { ok: false, msg: '专用密码必须是 6 位数字' };
    if (verifyPin(v)) return { ok: false, msg: '专用密码不能与登录密码相同' };
    if (!writeRec(PURGE_KEY, v)) return { ok: false, msg: '本机无法保存密码' };
    return { ok: true };
  }

  return {
    DEFAULT_PIN: DEFAULT_PIN,
    current: current, set: set, lock: lock, can: can,
    hasPin: hasPin, verifyPin: verifyPin, setPin: setPin, unlock: unlock,
    hasPurgePin: hasPurgePin, verifyPurge: verifyPurge, setPurgePin: setPurgePin
  };
})();
