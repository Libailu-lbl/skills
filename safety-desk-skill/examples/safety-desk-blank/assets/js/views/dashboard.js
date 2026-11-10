/* =========================================================
   views/dashboard.js — 数据看板（模块 6）
   ────────────────────────────────────────────────────────
   · 关键数字（隐患照片 / 已闭环 / 逾期 / 延期）
   · 各部门隐患照片趋势（近 12 个月，按部门折线，可多选对比）
   · 各部门隐患照片汇总（横向条形，按照片张数降序）
   · 隐患类型分布（环形，台账口径）
   · 隐患等级分布（环形，台账口径）
   · 各部门整改率（横向条形，台账口径）
   图表全部内联 SVG 手写，无任何图表库依赖。

   ★ 2026-11-10 口径调整：巡检表单里「巡查照片」更名为「隐患照片」，
   **看板的隐患计数改为「按部门汇总巡检任务上传的隐患照片张数」**
   （数据来自 data.inspections[].photos，见 metrics.inspectionPhotos）。
   需要注意：闭环率、逾期、延期、整改率、类型与等级分布**仍然只能基于隐患台账**
   ——照片没有状态也没有等级，算不出闭环。所以页面上两块口径分得很清楚：
   凡是照片口径的，标题/副标题里都写明「隐患照片」；凡是台账口径的，都标明「隐患台账」。
   ========================================================= */
window.SD = window.SD || {};
SD.views = SD.views || {};

SD.views.dashboard = (function () {
  var U = SD.utils;

  // 类型分布配色：与等级色区分开，用低饱和蓝绿系
  var PALETTE = ['#0d7a72', '#2f8f9d', '#4fa3a5', '#6fb3a8', '#8c9bd6', '#a98cc4', '#c48fa0', '#d9a406', '#8b9ba0', '#b7c4c7'];

  function sub(s) {
    if (!s) return '';
    var ip = s.inspectionPhotos || { totalPhotos: 0, byDept: [] };
    return '巡检隐患照片 ' + ip.totalPhotos + ' 张（覆盖 ' + ip.byDept.length + ' 个部门）· 隐患台账 ' + s.totalHazards + ' 条';
  }

  function render(host, ctx) {
    var s = ctx.summary;
    var ip = s.inspectionPhotos || { totalPhotos: 0, totalTasks: 0, byDept: [], trend: { months: [], depts: [] } };
    U.clear(host);

    /* ---------- 顶部关键数字 ----------
       第一张是本次调整的主口径：隐患照片张数（巡检上报）。
       其余三张是隐患台账的状态指标 —— 照片没有状态，闭环/逾期只能看台账。 */
    var kpi = U.h('<div class="grid cols-4"></div>');
    SD.comp.statCard.renderAll(kpi, [
      { label: '隐患照片', value: ip.totalPhotos, unit: '张', icon: 'inspection', tone: '',
        foot: ip.totalTasks ? ip.totalTasks + ' 项巡检任务上传' : '暂无巡检上传照片' },
      { label: '已闭环', value: s.closedCount, unit: '条', icon: 'check', tone: 'green',
        bar: { pct: s.totalHazards ? s.closedCount / s.totalHazards : 0, cls: 'green' },
        foot: U.pct(s.totalHazards ? s.closedCount / s.totalHazards : 0, 1, 0) + ' 闭环率（台账）' },
      { label: '逾期未闭环', value: s.overdueCount, unit: '条', icon: 'alertCircle', tone: 'red',
        footTone: s.overdueCount ? 'up' : '', foot: s.overdueCount ? '需优先处置' : '无逾期' },
      { label: '延期跟进', value: s.delayedCount, unit: '条', icon: 'clock', tone: 'orange',
        foot: '已批准延期，单列盯办' }
    ]);
    host.appendChild(kpi);

    /* ---------- 隐患趋势（台账口径） ----------
       这块是原有功能，本次口径调整**不动它**：
       「新增 / 闭环」反映的是处置能力，照片没有状态，算不出闭环，
       所以闭环只能看台账。标题里注明口径，避免与上面照片数字混读。 */
    var trend = s.trend || [];
    var trendCard = U.h(
      '<section class="card">' +
        '<div class="card-head"><div><h3>隐患趋势</h3>' +
        '<div class="sub">基于隐患台账：近 12 个月新增 / 闭环（单位：条）</div></div></div>' +
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

    /* ---------- 各部门隐患照片趋势 ----------
       与全厂同窗口（近 12 个月，按巡检计划日期归月）；部门线可多选对比，
       默认勾选总量前 4 的部门，勾选状态记在 filters.dashboard，刷新不丢。 */
    var pt = ip.trend || { months: [], depts: [] };
    var DEPT_COLORS = ['#0d7a72', '#2f8f9d', '#4fa3a5', '#6fb3a8', '#8c9bd6', '#a98cc4', '#c48fa0', '#d9a406', '#5b7fa6', '#b7c4c7'];
    var fD = (ctx.state.filters.dashboard = ctx.state.filters.dashboard || {});
    if (!Array.isArray(fD.depts)) fD.depts = [];
    /* 首次拿到部门数据时补默认勾选（总量前 4）。
       不能只判断「fD.depts 是不是数组」—— 打开看板时如果还没有隐患照片，
       pt.depts 是空的，fD.depts 会被置成 []，之后再上传照片也不会重新初始化，
       折线图就永远停在「选一个部门开始对比」。用 deptsInited 标记只补一次，
       补完之后完全尊重用户自己的勾选（包括全部取消）。 */
    if (!fD.deptsInited && pt.depts.length) {
      fD.depts = pt.depts.slice(0, 4).map(function (d) { return d.dept; });
      fD.deptsInited = true;
    }
    var exist = {};
    pt.depts.forEach(function (d) { exist[d.dept] = 1; });
    fD.depts = fD.depts.filter(function (d) { return exist[d]; });
    var colorOf = {};
    pt.depts.forEach(function (d, i) { colorOf[d.dept] = DEPT_COLORS[i % DEPT_COLORS.length]; });
    var picked = pt.depts.filter(function (d) { return fD.depts.indexOf(d.dept) >= 0; });

    var deptTrendCard = U.h(
      '<section class="card">' +
        '<div class="card-head"><div><h3>各部门隐患照片趋势</h3>' +
        '<div class="sub">近 12 个月巡检上传的隐患照片（单位：张）；点部门名增减对比，默认总量前 ' + Math.min(4, pt.depts.length) + '</div></div>' +
        '<div class="js-dept-chips chip-group"></div></div>' +
        '<div class="js-chart"></div><div class="js-legend"></div>' +
      '</section>'
    );
    var chipBox = deptTrendCard.querySelector('.js-dept-chips');
    pt.depts.forEach(function (d) {
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

    if (!pt.depts.length) {
      deptTrendCard.querySelector('.js-chart').appendChild(
        SD.comp.state.build('empty', {
          title: '暂无隐患照片',
          desc: '在「安全巡检 → 新增巡检任务」里上传隐患照片后，这里会按部门 × 月份自动汇总。'
        }));
    } else if (!picked.length) {
      deptTrendCard.querySelector('.js-chart').appendChild(
        SD.comp.state.build('empty', { title: '选一个部门开始对比', desc: '点右上角部门名把它加进折线图。' }));
    } else {
      deptTrendCard.querySelector('.js-chart').innerHTML = SD.comp.chart.lineChart({
        labels: pt.months,
        height: 230,
        series: picked.map(function (d) {
          return { name: d.dept, color: colorOf[d.dept], data: d.data };
        })
      });
      deptTrendCard.querySelector('.js-legend').innerHTML = SD.comp.chart.legend(
        picked.map(function (d) {
          return { name: d.dept + ' 合计', color: colorOf[d.dept], value: d.total + ' 张' };
        })
      );
    }
    host.appendChild(deptTrendCard);

    /* ---------- 各部门隐患照片（汇总条形） ----------
       这是本次需求的核心视图：把巡检上传的隐患照片**按部门求和**摊开。
       没填责任部门的巡检统一归「未指定部门」，保证各项相加等于顶部总张数。 */
    var photoCard = U.h(
      '<section class="card">' +
        '<div class="card-head"><div><h3>各部门隐患照片</h3>' +
        '<div class="sub">按巡检任务的责任部门汇总照片张数；未填部门的归入「未指定部门」</div></div>' +
        '<div class="js-total t-3 t-sm"></div></div>' +
        '<div class="js-body"></div></section>'
    );
    if (!ip.byDept.length) {
      photoCard.querySelector('.js-body').appendChild(
        SD.comp.state.build('empty', { title: '暂无隐患照片', desc: '巡检任务上传照片后，按部门汇总会显示在这里。' }));
    } else {
      var maxPhotos = ip.byDept.reduce(function (a, d) { return Math.max(a, d.photos); }, 0) || 1;
      photoCard.querySelector('.js-total').textContent = '合计 ' + ip.totalPhotos + ' 张 / ' + ip.totalTasks + ' 项任务';
      photoCard.querySelector('.js-body').innerHTML = SD.comp.chart.bars({
        /* neutral：照片张数是「数量」不是「比率」，少的部门不代表差，
           不能沿用整改率的红橙语义色 */
        neutral: true,
        items: ip.byDept.map(function (d) {
          return {
            name: d.dept,
            rate: d.photos / maxPhotos,
            label: d.photos + ' 张（' + d.tasks + ' 项）'
          };
        })
      });
    }
    host.appendChild(photoCard);

    /* ---------- 类型分布（巡检口径）+ 等级分布（台账口径） ----------
       类型分布能走巡检口径，是因为 2026-11-10 给巡检表单加了「隐患类型」字段；
       等级分布走不了 —— 巡检没有等级字段，硬编号称就名不副实了。
       所以这一对卡片口径不同，副标题里分别写清，别让人以为是一套数。 */
    var row = U.h('<div class="grid cols-2"></div>');

    var typeItems = (ip.byType || []).map(function (t, i) {
      return { name: t.type, value: t.tasks, color: PALETTE[i % PALETTE.length] };
    });
    var typeCard = U.h(
      '<section class="card"><div class="card-head"><div><h3>隐患类型分布</h3>' +
      '<div class="sub">基于巡检：按隐患类型归类，一条巡检记一次（含未分类），按次数降序</div></div></div>' +
      '<div class="js-body"></div></section>'
    );
    if (!typeItems.length) {
      typeCard.querySelector('.js-body').appendChild(SD.comp.state.build('empty', {
        title: '暂无隐患类型数据',
        desc: '在「安全巡检 → 新增巡检任务」里上传隐患照片并选「隐患类型」后，这里会按类型汇总。'
      }));
    } else {
      typeCard.querySelector('.js-body').innerHTML =
        SD.comp.chart.donut({
          items: typeItems,
          center: { top: String(ip.totalTasks), bottom: '隐患次数' }
        }) +
        '<div class="chart-legend">' + typeItems.map(function (it) {
          return '<span class="li"><span class="sw" style="background:' + it.color + '"></span>' +
            U.esc(it.name) + ' <span class="v">' + it.value + '</span></span>';
        }).join('') + '</div>';
    }
    row.appendChild(typeCard);

    var sevCard = U.h(
      '<section class="card"><div class="card-head"><div><h3>隐患等级分布</h3>' +
      '<div class="sub">基于隐患台账，管理三级（红 / 橙 / 黄）</div></div></div><div class="js-body"></div></section>'
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

    /* ---------- 各部门整改率（台账口径） ---------- */
    var deptCard = U.h(
      '<section class="card"><div class="card-head"><div><h3>各部门整改率</h3>' +
      '<div class="sub">基于隐患台账：已闭环 / 该部门隐患总数；整改率低的排在最前面</div></div></div><div class="js-body"></div></section>'
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
      '<section class="card tight t-3 t-sm">' +
      '<div><b class="t-2">口径说明</b></div>' +
      '<div style="margin-top:4px"><b>一、隐患照片（主口径）</b>　统计「安全巡检 → 新增巡检任务」里上传的' +
      '<b>隐患照片张数</b>（字段原名「巡查照片」，2026-11-10 更名，存储键不变，历史记录照常计数）。' +
      '部门归属取巡检任务的「责任部门」，未填的归「未指定部门」，因此<b>各部门相加恒等于总张数</b>；' +
      '按巡检<b>计划日期</b>归月；任务改期或取消时，已上传的照片仍然计入（照片是现场证据，不随任务状态消失）。<br>' +
      '<b>隐患类型分布</b>同属巡检口径，但计的是<b>次数</b>：一条有照片的巡检记一次（含未分类），' +
      '所以类型合计 = 有隐患照片的任务数，不等于照片张数 —— 照片是证据，任务是事件。</div>' +
      '<div style="margin-top:4px"><b>二、隐患台账（状态口径）</b>　隐患趋势（新增 / 闭环）、闭环率、逾期未闭环、' +
      '延期跟进、隐患等级分布、整改率均基于隐患台账条数 —— 巡检没有整改状态与等级，' +
      '算不出闭环，也无法给隐患定级，所以这些指标必须留在台账口径。</div>' +
      '<div style="margin-top:4px">两条口径在页面标题里已分别注明，不混算。</div>' +
      '</section>'
    ));
  }

  return { name: '数据看板', sub: sub, render: render };
})();
