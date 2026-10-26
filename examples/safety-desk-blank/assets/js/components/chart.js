/* =========================================================
   chart.js — 图表组件（全部内联 SVG 手写，零图表库）
   ────────────────────────────────────────────────────────
   · lineChart  折线趋势（隐患新增 / 闭环）
   · donut     环形分布（隐患类型 / 等级）
   · bars      横向条形（各部门整改率，用 HTML 实现，窄屏更好读）
   不引任何外部库：AI 生成的页面引 CDN 图表库，一旦 404 全页图表全废。
   ========================================================= */
window.SD = window.SD || {};
SD.comp = SD.comp || {};

SD.comp.chart = (function () {
  var U = SD.utils;

  /* ---------------- 折线趋势 ---------------- */
  /**
   * @param {object} o
   *   labels  ['2025-11', ...]
   *   series  [{name:'新增', color:'#d92d20', data:[7,9,...]}]
   *   height  SVG 高度（默认 220）
   *   unit    提示后缀
   */
  function lineChart(o) {
    o = o || {};
    var labels = o.labels || [], series = o.series || [];
    var W = 700, H = o.height || 220;
    var padL = 34, padR = 14, padT = 14, padB = 28;
    var iw = W - padL - padR, ih = H - padT - padB;
    var n = labels.length;

    if (!n) return '<div class="chart"></div>';

    // Y 轴上限：取所有系列最大值，向上取整到 5 的倍数，至少 5
    var max = 0;
    series.forEach(function (s) {
      (s.data || []).forEach(function (v) { if (v > max) max = v; });
    });
    var top = Math.max(5, Math.ceil(max / 5) * 5);

    function X(i) { return padL + (n === 1 ? iw / 2 : (iw * i) / (n - 1)); }
    function Y(v) { return padT + ih - (ih * v) / top; }

    var g = '';

    // 网格线与 Y 轴刻度
    for (var t = 0; t <= 4; t++) {
      var yv = (top / 4) * t;
      var y = Y(yv);
      g += '<line x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y +
           '" stroke="#eef2f3" stroke-width="1"/>';
      g += '<text x="' + (padL - 7) + '" y="' + (y + 4) + '" text-anchor="end" font-size="10" fill="#8b9ba0">' +
           Math.round(yv) + '</text>';
    }

    // X 轴标签（点密时隔一个显示，避免挤成一团）
    var step = n > 8 ? 2 : 1;
    labels.forEach(function (lb, i) {
      if (i % step !== 0 && i !== n - 1) return;
      g += '<text x="' + X(i) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="10" fill="#8b9ba0">' +
           U.esc(String(lb).slice(5) + '月') + '</text>';
    });

    // 折线与数据点
    series.forEach(function (s) {
      var d = '', pts = '';
      (s.data || []).forEach(function (v, i) {
        var x = X(i), y = Y(v);
        d += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1) + ' ';
        pts += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="3" fill="#fff" stroke="' +
               s.color + '" stroke-width="2"><title>' + U.esc(s.name) + ' ' + U.esc(labels[i]) + '：' + v +
               (o.unit || ' 条') + '</title></circle>';
      });
      g += '<path d="' + d + '" fill="none" stroke="' + s.color + '" stroke-width="2.2" stroke-linejoin="round"/>';
      g += pts;
    });

    return '<div class="chart"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img">' + g + '</svg></div>';
  }

  /** 折线图图例 */
  function legend(items) {
    return '<div class="chart-legend">' + (items || []).map(function (it) {
      return '<span class="li"><span class="sw" style="background:' + it.color + '"></span>' +
        U.esc(it.name) + ' <span class="v">' + U.esc(it.value) + '</span></span>';
    }).join('') + '</div>';
  }

  /* ---------------- 环形分布 ---------------- */
  /**
   * @param {object} o
   *   items [{name, value, color}]
   *   size  直径（默认 190）
   *   center {top:'总数', bottom:'12'}
   */
  function donut(o) {
    o = o || {};
    var items = (o.items || []).filter(function (i) { return i.value > 0; });
    var size = o.size || 190;
    var total = items.reduce(function (a, b) { return a + b.value; }, 0);

    if (!total) {
      return '<div class="chart"><svg viewBox="0 0 200 200"><circle cx="100" cy="100" r="62" fill="none" stroke="#eef2f3" stroke-width="26"/>' +
        '<text x="100" y="104" text-anchor="middle" font-size="12" fill="#8b9ba0">暂无数据</text></svg></div>';
    }

    var R = 62, CX = 100, CY = 100, SW = 26;
    var C = 2 * Math.PI * R;
    var acc = 0, g = '';

    g += '<circle cx="' + CX + '" cy="' + CY + '" r="' + R + '" fill="none" stroke="#f2f4f7" stroke-width="' + SW + '"/>';

    items.forEach(function (it) {
      var frac = it.value / total;
      var len = C * frac;
      var dash = len + ' ' + (C - len);
      var rot = -90 + (acc * 360);
      g += '<circle cx="' + CX + '" cy="' + CY + '" r="' + R + '" fill="none" stroke="' + it.color +
           '" stroke-width="' + SW + '" stroke-dasharray="' + dash +
           '" transform="rotate(' + rot.toFixed(2) + ' ' + CX + ' ' + CY + ')">' +
           '<title>' + U.esc(it.name) + '：' + it.value + ' 条（' + (frac * 100).toFixed(1) + '%）</title></circle>';
      acc += frac;
    });

    var c = o.center || {};
    if (c.top || c.bottom) {
      g += '<text x="100" y="96" text-anchor="middle" font-size="20" font-weight="600" fill="#1c2b2f">' +
           U.esc(c.top || '') + '</text>';
      g += '<text x="100" y="116" text-anchor="middle" font-size="11" fill="#8b9ba0">' +
           U.esc(c.bottom || '') + '</text>';
    }

    return '<div class="chart" style="max-width:' + size + 'px;margin:0 auto"><svg viewBox="0 0 200 200" role="img">' + g + '</svg></div>';
  }

  /* ---------------- 横向条形 ---------------- */
  /**
   * @param {object} o
   *   items [{name, rate(0~1), label}]
   *   max   显示条数（默认全部）
   */
  function bars(o) {
    o = o || {};
    var items = (o.items || []).slice(0, o.max || 99);
    if (!items.length) return '<p class="t-3 t-sm">暂无数据</p>';
    return '<div class="bars">' + items.map(function (it) {
      var pct = it.rate == null ? 0 : Math.max(0, Math.min(1, it.rate)) * 100;
      // 整改率 <60% 标红，60%~85% 标橙，其余主色
      var cls = pct < 60 ? 'low' : (pct < 85 ? 'mid' : '');
      return '<div class="bar-row">' +
        '<span class="name" title="' + U.esc(it.name) + '">' + U.esc(it.name) + '</span>' +
        '<span class="bar-track"><i class="' + cls + '" style="width:' + pct.toFixed(1) + '%"></i></span>' +
        '<span class="val">' + U.esc(it.label != null ? it.label : U.pct(it.rate == null ? 0 : it.rate, 1, 0)) + '</span>' +
      '</div>';
    }).join('') + '</div>';
  }

  return { lineChart: lineChart, legend: legend, donut: donut, bars: bars };
})();
