/* =========================================================
   badge.js — 徽标与标签（纯 HTML 片段生成，无状态）
   隐患等级用 红/橙/黄 区分；状态用中性色区分，避免和等级撞色。
   ========================================================= */
window.SD = window.SD || {};
SD.comp = SD.comp || {};

SD.comp.badge = (function () {
  var U = SD.utils;

  /** 隐患等级：红(重大) 橙(较大) 黄(一般) */
  function severity(sev) {
    var it = SD.dict.itemOf(SD.dict.DICT.severity, sev);
    if (!it) return '<span class="badge b-mute">—</span>';
    return '<span class="badge ' + it.cls + '">' + U.esc(it.n) + '</span>';
  }

  /** 隐患状态：待整改/整改中/待验收/已闭环/已延期/已作废 */
  function status(st) {
    var map = {
      pending:   'st-pending',
      fixing:    'st-fixing',
      verifying: 'st-verifying',
      closed:    'st-closed',
      delayed:   'st-delayed',
      void:      'st-void'
    };
    var n = SD.dict.nameOf(SD.dict.DICT.hazardStatus, st);
    return '<span class="badge ' + (map[st] || 'b-mute') + '">' + U.esc(n) + '</span>';
  }

  /** 法定两级（对外报表口径） */
  function statutory(v) {
    var n = SD.dict.nameOf(SD.dict.DICT.statutoryLevel, v);
    var cls = v === 'major' ? 'b-danger' : 'b-mute';
    return '<span class="badge sm ' + cls + '">' + U.esc(n) + '</span>';
  }

  /** 逾期标记：红底白字，写明逾期天数 */
  function overdue(days) {
    return '<span class="flag-overdue">' + SD.icons.get('alertCircle', 12) + '逾期 ' + days + ' 天</span>';
  }

  /** 临期标记 */
  function soon(daysLeft) {
    var txt = daysLeft === 0 ? '今天到期' : ('还剩 ' + daysLeft + ' 天');
    return '<span class="flag-soon">' + SD.icons.get('clock', 12) + txt + '</span>';
  }

  /** 延期跟进标记（走完审批的延期不再计逾期，但必须单独盯） */
  function delayed(count) {
    return '<span class="badge st-delayed">延期 ' + (count || 0) + ' 次</span>';
  }

  /** 巡检状态 */
  function inspectStatus(st) {
    var map = { planned: 'b-info', done: 'b-ok', rescheduled: 'b-warn', cancelled: 'b-mute' };
    var n = SD.dict.nameOf(SD.dict.DICT.inspectStatus, st);
    return '<span class="badge ' + (map[st] || 'b-mute') + '">' + U.esc(n) + '</span>';
  }

  /** 培训状态 */
  function trainStatus(st) {
    var map = { planned: 'b-info', ongoing: 'b-warn', done: 'b-ok' };
    var n = SD.dict.nameOf(SD.dict.DICT.trainStatus, st);
    return '<span class="badge ' + (map[st] || 'b-mute') + '">' + U.esc(n) + '</span>';
  }

  /** 证书预警档位 */
  function cert(level) {
    var m = SD.metrics.CERT_META[level] || SD.metrics.CERT_META.unknown;
    return '<span class="badge ' + m.cls + '">' + U.esc(m.n) + '</span>';
  }

  /** 通知级别 */
  function noticeLevel(v) {
    var it = SD.dict.itemOf(SD.dict.DICT.noticeLevel, v);
    if (!it) return '';
    return '<span class="badge ' + it.cls + '">' + U.esc(it.n) + '</span>';
  }

  /** 灰色信息标签 */
  function tag(text, icon) {
    return '<span class="tag">' + (icon ? SD.icons.get(icon, 12) : '') + U.esc(text) + '</span>';
  }

  return {
    severity: severity, status: status, statutory: statutory,
    overdue: overdue, soon: soon, delayed: delayed,
    inspectStatus: inspectStatus, trainStatus: trainStatus,
    cert: cert, noticeLevel: noticeLevel, tag: tag
  };
})();
