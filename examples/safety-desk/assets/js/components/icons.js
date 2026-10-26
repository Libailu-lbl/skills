/* =========================================================
   icons.js — 内联 SVG 图标集（零外链，不使用 emoji）
   用法：SD.icons.get('hazard', 18)  → 返回 svg 字符串
   所有图标统一 24×24 viewBox，stroke 用 currentColor 继承文字色。
   ========================================================= */
window.SD = window.SD || {};

SD.icons = (function () {
  // 每个图标只写主体路径，统一套一层 <svg>
  var P = {
    /* 导航 */
    overview:   '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
    todo:       '<path d="M9 11l2 2 4-4"/><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M8 2v4M16 2v4"/>',
    hazard:     '<path d="M10.3 3.9L1.9 18a2 2 0 001.7 3h16.8a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    inspection: '<path d="M9 3h6a2 2 0 012 2v1H7V5a2 2 0 012-2z"/><rect x="5" y="6" width="14" height="16" rx="2"/><path d="M9 12l2 2 4-4"/>',
    training:   '<path d="M22 9L12 4 2 9l10 5 10-5z"/><path d="M6 11.5V17c0 1.5 2.7 3 6 3s6-1.5 6-3v-5.5"/>',
    dashboard:  '<path d="M3 3v18h18"/><rect x="7" y="12" width="3" height="6"/><rect x="12.5" y="8" width="3" height="10"/><rect x="18" y="5" width="3" height="13"/>',
    notice:     '<path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 01-3.4 0"/>',
    daily:      '<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4M16 3v4M8 12h8M8 16h5"/>',
    weekly:     '<path d="M5 3h9l5 5v13a1 1 0 01-1 1H5a1 1 0 01-1-1V4a1 1 0 011-1z"/><path d="M14 3v5h5M8 13h7M8 17h5"/>',

    /* 操作 */
    plus:       '<path d="M12 5v14M5 12h14"/>',
    check:      '<path d="M20 6L9 17l-5-5"/>',
    x:          '<path d="M18 6L6 18M6 6l12 12"/>',
    edit:       '<path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.1 2.1 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>',
    trash:      '<path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>',
    download:   '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M7 10l5 5 5-5M12 15V3"/>',
    upload:     '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M17 8l-5-5-5 5M12 3v12"/>',
    refresh:    '<path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.5 9a9 9 0 0114.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0020.5 15"/>',
    search:     '<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.3-4.3"/>',
    filter:     '<path d="M22 3H2l8 9.5V19l4 2v-8.5L22 3z"/>',
    clock:      '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    chevronR:   '<path d="M9 18l6-6-6-6"/>',
    chevronD:   '<path d="M6 9l6 6 6-6"/>',
    external:   '<path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><path d="M15 3h6v6M10 14L21 3"/>',
    user:       '<path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    building:   '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 8h2M13 8h2M9 12h2M13 12h2M9 16h6"/>',
    calendar:   '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    award:      '<circle cx="12" cy="8" r="6"/><path d="M15.5 13.5L17 22l-5-3-5 3 1.5-8.5"/>',
    file:       '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/>',
    flame:      '<path d="M12 2s5 5 5 9a5 5 0 01-10 0c0-2 1-3.5 2-4.5C9 8 8 9 8 11a4 4 0 008 0c0-4-4-9-4-9z"/>',
    zap:        '<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>',
    helmet:     '<path d="M3 18h18v-2a9 9 0 00-18 0v2z"/><path d="M12 7V3M8 7V4M16 7V4"/>',
    flask:      '<path d="M9 2v6L3.5 18a2 2 0 001.7 3h13.6a2 2 0 001.7-3L15 8V2"/><path d="M8 2h8"/>',
    wrench:     '<path d="M14.7 6.3a4 4 0 105.7 5.7l-1.4-1.4 2-2-3.5-3.5-2 2-1.6-1.6a4 4 0 00-.2 1.2 4 4 0 001 -.4z"/>',
    wind:       '<path d="M9.6 4.6A2 2 0 1011 8H2"/><path d="M12.6 19.4A2 2 0 1114 16H2"/><path d="M17.6 6.6A2.5 2.5 0 1020 10H2"/>',
    layers:     '<path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/>',
    target:     '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
    alertCircle:'<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>',
    infoCircle: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-5M12 8h.01"/>',
    inbox:      '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13l3.5 7v6a2 2 0 01-2 2H4a2 2 0 01-2-2v-6l3.5-7z"/>',
    trendUp:    '<path d="M23 6l-9.5 9.5-5-5L1 18"/><path d="M17 6h6v6"/>',
    trendDown:  '<path d="M23 18l-9.5-9.5-5 5L1 6"/><path d="M17 18h6v-6"/>',
    book:       '<path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/>',
    printer:    '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8" rx="1"/>',
    phone:      '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>',

    /* 特种作业 / 权限 */
    shield:     '<path d="M12 3l7 3v6c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6l7-3z"/><path d="M9 12l2 2 4-4"/>',
    lock:       '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>',
    clipboard:  '<rect x="5" y="4" width="14" height="18" rx="2"/><path d="M9 4V3a1 1 0 011-1h4a1 1 0 011 1v1"/><path d="M9 12h6M9 16h6"/>'
  };

  function get(name, size, extra) {
    var p = P[name] || P.infoCircle;
    var s = size || 16;
    return '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="none" ' +
      'stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" ' +
      'aria-hidden="true"' + (extra ? ' ' + extra : '') + '>' + p + '</svg>';
  }

  return { get: get, has: function (n) { return !!P[n]; } };
})();
