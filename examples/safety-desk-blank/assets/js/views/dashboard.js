/* =========================================================
   views/dashboard.js — 数据看板（模块 6）
   ────────────────────────────────────────────────────────
   · 隐患趋势（近 12 个月新增 / 闭环折线）
   · 各部门隐患趋势（近 12 个月按部门折线，可多选对比）
   · 隐患类型分布（环形）
   · 隐患等级分布（环形，红/橙/黄）
   · 各部门整改率（横向条形，率低的排前面）
   图表全部内联 SVG 手写，无任何图表库依赖。
   ========================================================= */
window.SD = window.SD || {};
SD.views = SD.views || {};

SD.views.dashboard = (function () {
  var U = SD.utils;

  // 类型分布配色：与等级色区分开，用低饱和蓝绿系
  var PALETTE = ['#0d7a72', '#2f8f9d', '#4fa3a5', '#6fb3a8', '#8c9bd6', '#a98cc4', '#c48fa0', '#d9a406', '#8b9ba0', '#b7c4c7'];

  function sub(s) {
    if (!s) return '';
    return '统计口径基于当前台账：共 ' + s.totalHazards + ' 条隐患，覆盖 ' + s.deptRates.length + ' 个部门';
  }

  function render(host, ctx) {
    var s = ctx.summary;
    U.clear(host);

    /* ---------- 顶部关键数字 ---------- */
    var kpi = U.h('<div class="grid cols-4"></div>');
    SD.comp.statCard.renderAll(kpi, [
      { label: '隐患总数', value: s.totalHazards, unit: '条', icon: 'layers', tone: '' },
      { label: '已闭环', value: s.closedCount, unit: '条', icon: 'check', tone: 'green',
        bar: { pct: s.totalHazards ? s.closedCount / s.totalHazards : 0, cls: 'green' },
        foot: U.pct(s.totalHazards ? s.closedCount / s.totalHazards : 0, 1, 0) + ' 闭环率' },
      { label: '逾期未闭环', value: s.overdueCount, unit: '条', icon: 'alertCircle', tone: 'red',
        footTone: s.overdueCount ? 'up' : '', foot: s.overdueCount ? '需优先处置' : '无逾期' },
      { label: '延期跟进', value: s.delayedCount, unit: '条', icon: 'clock', tone: 'orange',
        foot: '已批准延期，单列盯办' }
    ]);
    host.appendChild(kpi);

    /* ---------- 隐患趋势 ---------- */
    var trend = s.trend || [];
    var trendCard = U.h(
      '<section class="card">' +
        '<div class="card-head"><div><h3>隐患趋势</h3>' +
        '<div class="sub">近 12 个月新增 / 闭环（单位：条）</div></div></div>' +
        '<div class="js-chart"></div><div class="js-legend"></div>' +
      '</section>'
    );
    if (!trend.length) {
      trendCard.querySelector('.js-chart').appendChild(
        SD.comp.state.build('empty', { title: '暂无趋势数据', desc: '登记隐患后，趋势图会按月份自动汇总展示。' }));
    } else {
      var sumCreated = trend.reduce(function (a, b) { return a + b.created; }, 0);
      var sumClosed = trend.reduce(function (a, b) { return a + b.closed; }, 0);
      trendCard.querySelector('.js-chart').innerHTML = SD.comp.chart.lineChart({
        labels: trend.map(function (t) { return t.ym; }),
        height: 230,
        series: [
          { name: '新增', color: '#d92d20', data: trend.map(function (t) { return t.created; }) },
          { name: '闭环', color: '#12805c', data: trend.map(function (t) { return t.closed; }) }
        ]
      });
      trendCard.querySelector('.js-legend').innerHTML = SD.comp.chart.legend([
        { name: '新增合计', color: '#d92d20', value: sumCreated + ' 条' },
        { name: '闭环合计', color: '#12805c', value: sumClosed + ' 条' },
        { name: '整体闭环率', color: '#0d7a72', value: U.pct(sumCreated ? sumClosed / sumCreated : 0, 1, 0) }
      ]);
    }
    host.appendChild(trendCard);

    /* ---------- 各部门隐患趋势 ----------
       与上面「全厂趋势」同一窗口（近 12 个月）；部门线可多选对比，
       默认勾选总量前 4 的部门，勾选状态记在 filters.dashboard，刷新不丢。 */
    var dt = s.deptTrend || { months: [], depts: [] };
    var DEPT_COLORS = ['#0d7a72', '#2f8f9d', '#4fa3a5', '#6fb3a8', '#8c9bd6', '#a98cc4', '#c48fa0', '#d9a406', '#5b7fa6', '#b7c4c7'];
    var fD = (ctx.state.filters.dashboard = ctx.state.filters.dashboard || {});
    if (!Array.isArray(fD.depts)) {
      fD.depts = dt.depts.slice(0, 4).map(function (d) { return d.dept; });
    }
    var exist = {};
    dt.depts.forEach(function (d) { exist[d.dept] = 1; });
    fD.depts = fD.depts.filter(function (d) { return exist[d]; });
    var colorOf = {};
    dt.depts.forEach(function (d, i) { colorOf[d.dept] = DEPT_COLORS[i % DEPT_COLORS.length]; });
    var picked = dt.depts.filter(function (d) { return fD.depts.indexOf(d.dept) >= 0; });

    var deptTrendCard = U.h(
      '<section class="card">' +
        '<div class="card-head"><div><h3>各部门隐患趋势</h3>' +
        '<div class="sub">近 12 个月新增（单位：条）；点部门名增减对比，默认总量前 ' + Math.min(4, dt.depts.length) + '</div></div>' +
        '<div class="js-dept-chips chip-group"></div></div>' +
        '<div class="js-chart"></div><div class="js-legend"></div>' +
      '</section>'
    );
    var chipBox = deptTrendCard.querySelector('.js-dept-chips');
    dt.depts.forEach(function (d) {
      var on = fD.depts.indexOf(d.dept) >= 0;
      var chip = U.h('<button class="chip' + (on ? ' on' : '') + '" data-dept="' + U.esc(d.dept) + '"' +
        ' style="' + (on ? 'background:' + colorOf[d.dept] + ';border-color:' + colorOf[d.dept] + ';color:#fff' : '') + '">' +
        U.esc(d.dept) + ' ' + d.total + '</button>');
      chip.addEventListener('click', function () {
        var i = fD.depts.indexOf(d.dept);
        if (i >= 0) fD.depts.splice(i, 1); else fD.depts.push(d.dept);
        ctx.refresh();
      });
      chipBox.appendChild(chip);
    });

    if (!dt.depts.length) {
      deptTrendCard.querySelector('.js-chart').appendChild(
        SD.comp.state.build('empty', { title: '暂无部门趋势数据', desc: '登记隐患后，会按部门 × 月份自动汇总展示。' }));
    } else if (!picked.length) {
      deptTrendCard.querySelector('.js-chart').appendChild(
        SD.comp.state.build('empty', { title: '选一个部门开始对比', desc: '点右上角部门名把它加进折线图。' }));
    } else {
      deptTrendCard.querySelector('.js-chart').innerHTML = SD.comp.chart.lineChart({
        labels: dt.months,
        height: 230,
        series: picked.map(function (d) {
          return { name: d.dept, color: colorOf[d.dept], data: d.data };
        })
      });
      deptTrendCard.querySelector('.js-legend').innerHTML = SD.comp.chart.legend(
        picked.map(function (d) {
          return { name: d.dept + ' 合计', color: colorOf[d.dept], value: d.total + ' 条' };
        })
      );
    }
    host.appendChild(deptTrendCard);

    /* ---------- 类型分布 + 等级分布 ---------- */
    var row = U.h('<div class="grid cols-2"></div>');

    var typeCard = U.h(
      '<section class="card"><div class="card-head"><div><h3>隐患类型分布</h3>' +
      '<div class="sub">按条数降序</div></div></div><div class="js-body"></div></section>'
    );
    if (!s.typeDist.length) {
      typeCard.querySelector('.js-body').appendChild(SD.comp.state.build('empty', { title: '暂无数据' }));
    } else {
      var items = s.typeDist.map(function (t, i) {
        return { name: t.type, value: t.count, color: PALETTE[i % PALETTE.length] };
      });
      typeCard.querySelector('.js-body').innerHTML =
        SD.comp.chart.donut({
          items: items,
          center: { top: String(s.totalHazards), bottom: '隐患总数' }
        }) +
        '<div class="chart-legend">' + items.map(function (it) {
          return '<span class="li"><span class="sw" style="background:' + it.color + '"></span>' +
            U.esc(it.name) + ' <span class="v">' + it.value + '</span></span>';
        }).join('') + '</div>';
    }
    row.appendChild(typeCard);

    var sevCard = U.h(
      '<section class="card"><div class="card-head"><div><h3>隐患等级分布</h3>' +
      '<div class="sub">管理三级（红 / 橙 / 黄）</div></div></div><div class="js-body"></div></section>'
    );
    var sevItems = [
      { name: '重大（红）', value: s.severityDist.major || 0, color: '#d92d20' },
      { name: '较大（橙）', value: s.severityDist.large || 0, color: '#e06c00' },
      { name: '一般（黄）', value: s.severityDist.general || 0, color: '#a97600' }
    ];
    if (!s.totalHazards) {
      sevCard.querySelector('.js-body').appendChild(SD.comp.state.build('empty', { title: '暂无数据' }));
    } else {
      sevCard.querySelector('.js-body').innerHTML =
        SD.comp.chart.donut({
          items: sevItems,
          center: { top: String(s.severityDist.major || 0), bottom: '重大隐患（红）' }
        }) +
        '<div class="chart-legend">' + sevItems.map(function (it) {
          return '<span class="li"><span class="sw" style="background:' + it.color + '"></span>' +
            U.esc(it.name) + ' <span class="v">' + it.value + '</span></span>';
        }).join('') + '</div>';
    }
    row.appendChild(sevCard);

    host.appendChild(row);

    /* ---------- 各部门整改率 ---------- */
    var deptCard = U.h(
      '<section class="card"><div class="card-head"><div><h3>各部门整改率</h3>' +
      '<div class="sub">已闭环 / 该部门隐患总数；整改率低的排在最前面</div></div></div><div class="js-body"></div></section>'
    );
    if (!s.deptRates.length) {
      deptCard.querySelector('.js-body').appendChild(SD.comp.state.build('empty', { title: '暂无部门数据' }));
    } else {
      deptCard.querySelector('.js-body').innerHTML = SD.comp.chart.bars({
        items: s.deptRates.map(function (d) {
          return { name: d.dept, rate: d.rate, label: (d.rate == null ? '—' : U.pct(d.rate, 1, 0)) + '（' + d.closed + '/' + d.total + '）' };
        })
      });
    }
    host.appendChild(deptCard);

    /* ---------- 口径说明 ---------- */
    host.appendChild(U.h(
      '<section class="card tight t-3 t-sm"><b class="t-2">口径说明</b>　' +
      '整改率 = 已闭环 / 该部门隐患总数（含已延期但未闭环的）；条形颜色：&lt;60% 红、60%~85% 橙、≥85% 主色。' +
      '趋势图按月聚合「新增」与「闭环」两条线，两条线的差值即为当月净增未闭环量。' +
      '各部门隐患趋势与全厂趋势同一窗口（近 12 个月），部门线可多选对比；各月「各部门合计 = 全厂新增」，两张图讲的是同一件事。</section>'
    ));
  }

  return { name: '数据看板', sub: sub, render: render };
})();
