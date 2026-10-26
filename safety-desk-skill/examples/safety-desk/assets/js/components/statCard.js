/* =========================================================
   statCard.js — 概览指标卡（可点击下钻）
   ────────────────────────────────────────────────────────
   一张卡 = 标签 + 数值 + 脚注 + 可选占比条。
   整卡可点击（键盘可达），用于「点指标跳到对应模块」。
   ========================================================= */
window.SD = window.SD || {};
SD.comp = SD.comp || {};

SD.comp.statCard = (function () {
  var U = SD.utils;

  /**
   * @param {object} o
   *   label     指标名
   *   value     主数值（字符串或数字；null 显示「—」）
   *   unit      单位后缀，如「项」「%」
   *   icon      图标名
   *   tone      图标色调：''（主色）/ red / orange / green / blue
   *   foot      脚注文字
   *   footIcon  脚注图标（trendUp / trendDown / infoCircle）
   *   footTone  'up'（红，表示变差）/ 'down'（绿，表示变好）/ ''
   *   bar       { pct:0~1, cls:'red'|'orange'|'green'|'' }  底部占比条
   *   hint      title 提示（口径说明）
   *   onClick   点击回调
   * @returns {HTMLElement}
   */
  function build(o) {
    o = o || {};
    var val = (o.value === null || o.value === undefined) ? '—' : o.value;
    var barHtml = '';
    if (o.bar && o.bar.pct != null) {
      var w = Math.max(0, Math.min(100, o.bar.pct * 100));
      barHtml = '<div class="stat-bar"><i class="' + (o.bar.cls || '') + '" style="width:' + w + '%"></i></div>';
    }

    var el = U.h(
      '<div class="stat" role="button" tabindex="0"' + (o.hint ? ' title="' + U.esc(o.hint) + '"' : '') + '>' +
        '<div class="stat-top">' +
          '<span class="stat-label">' + U.esc(o.label || '') + '</span>' +
          '<span class="stat-ico ' + (o.tone || '') + '">' + SD.icons.get(o.icon || 'target', 17) + '</span>' +
        '</div>' +
        '<div class="stat-value num">' + U.esc(val) +
          (o.unit ? '<span class="unit">' + U.esc(o.unit) + '</span>' : '') +
        '</div>' +
        (o.foot ? '<div class="stat-foot">' +
            (o.footIcon ? SD.icons.get(o.footIcon, 13) : '') +
            '<span class="' + (o.footTone || '') + '">' + U.esc(o.foot) + '</span>' +
          '</div>' : '') +
        barHtml +
      '</div>'
    );

    if (typeof o.onClick === 'function') {
      el.addEventListener('click', o.onClick);
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); o.onClick(); }
      });
    }
    return el;
  }

  /** 批量渲染到容器 */
  function renderAll(host, list) {
    if (!host) return;
    U.clear(host);
    list.forEach(function (o) { host.appendChild(build(o)); });
  }

  return { build: build, renderAll: renderAll };
})();
