/* =========================================================
   views/reportCommon.js — 日报 / 周报 共用渲染逻辑
   ────────────────────────────────────────────────────────
   · dailyReport / weeklyReport 只负责 name/sub 与 kind，渲染复用本模块
   · 单向数据流：读 ctx.state.data → SD.report 聚合 → 渲染；导出调 xlsxWriter
   · 日期/周期选择存 ctx.state.filters.report[kind]，刷新不丢
   ========================================================= */
window.SD = window.SD || {};
SD.views = SD.views || {};

SD.views.reportCommon = (function () {
  var U = SD.utils;
  var REPORTER = '王安全';
  var DEPT = '安环部';

  function periodLabel(kind, agg) {
    return kind === 'weekly'
      ? (agg.ws + ' ~ ' + agg.we + '（第 ' + weekNo(agg.ws) + ' 周）')
      : (agg.date + ' ' + agg.weekday);
  }

  // 简单周次（年内第几周，周一为周首）
  function weekNo(weekStart) {
    var d = new Date(weekStart + 'T00:00:00');
    var start = new Date(d.getFullYear(), 0, 1);
    var days = Math.floor((d - start) / 86400000);
    return Math.ceil((days + start.getDay() + 1) / 7);
  }

  function buildCards(kind, agg) {
    var insp = agg.inspections;
    var rate = insp.rate == null ? '—' : Math.round(insp.rate * 100) + '%';
    if (kind === 'weekly') {
      return [
        { label: '本周登记隐患', value: agg.hazards.createdN, unit: '条', icon: 'hazard', tone: agg.hazards.createdN ? 'orange' : 'slate' },
        { label: '本周闭环隐患', value: agg.hazards.closedN, unit: '条', icon: 'check', tone: 'green' },
        { label: '巡检完成率', value: rate, icon: 'inspection', tone: 'blue' },
        { label: '资质预警', value: agg.certWarnN, unit: '人', icon: 'award', tone: agg.certWarnN ? 'red' : 'slate' }
      ];
    }
    return [
      { label: '当日登记隐患', value: agg.hazards.createdN, unit: '条', icon: 'hazard', tone: agg.hazards.createdN ? 'orange' : 'slate' },
      { label: '当日闭环隐患', value: agg.hazards.closedN, unit: '条', icon: 'check', tone: 'green' },
      { label: '当日巡检完成', value: insp.doneN + ' / ' + insp.plannedN, icon: 'inspection', tone: 'blue' },
      { label: '资质预警', value: agg.certWarnN, unit: '人', icon: 'award', tone: agg.certWarnN ? 'red' : 'slate' }
    ];
  }

  function renderSection(sec) {
    var card = U.h('<section class="card"><div class="card-head"><h3>' + U.esc(sec.title) + '</h3></div><div class="js-body"></div></section>');
    var body = card.querySelector('.js-body');

    // 关键指标（chip 形式）
    if (sec.kv && sec.kv.length) {
      var kv = U.h('<div class="rpt-kv"></div>');
      sec.kv.forEach(function (k) {
        kv.appendChild(U.h(
          '<div class="kv' + (k.danger ? ' danger' : '') + '">' +
          '<span class="kv-k">' + U.esc(k.k) + '</span>' +
          '<span class="kv-v">' + U.esc(k.v) + '</span>' +
          '<span class="kv-note">' + U.esc(k.note || '') + '</span></div>'
        ));
      });
      body.appendChild(kv);
    }

    // 明细表
    (sec.tables || []).forEach(function (tb) {
      var box = U.h('<div class="rpt-table"><div class="rpt-table-title">' + U.esc(tb.title) + '</div></div>');
      var cols = tb.head.map(function (h, i) {
        return { key: 'c' + i, title: h, render: function (r) { return U.esc(r[i] == null ? '—' : r[i]); } };
      });
      var rows = (tb.rows && tb.rows.length) ? tb.rows : [[]];
      if (!(tb.rows && tb.rows.length)) {
        // 空态行
        var emptyWrap = U.h('<div class="rpt-empty">（' + U.esc(tb.empty) + '）</div>');
        box.appendChild(emptyWrap);
      } else {
        box.appendChild(SD.comp.table.build({ columns: cols, rows: rows, minWidth: 560 }));
      }
      body.appendChild(box);
    });

    return card;
  }

  function renderReport(kind, host, ctx) {
    var s = ctx.summary;
    if (!s) return;
    U.clear(host);

    var isWeekly = kind === 'weekly';
    var title = isWeekly ? '安全生产周报' : '安全生产日报';

    // 周期选择（存 filters，刷新不丢）
    var rf = ctx.state.filters.report = ctx.state.filters.report || {};
    var date = rf[kind] || U.today();
    rf[kind] = date;

    var agg = isWeekly ? SD.report.weekly(ctx.state.data, date) : SD.report.daily(ctx.state.data, date);

    /* ---------- 顶部：周期选择 + 导出 ---------- */
    var bar = U.h('<div class="filters"><label class="field" style="flex-direction:row;align-items:center;gap:8px">' +
      '<span class="lbl" style="margin:0">' + (isWeekly ? '周内任选一天' : '日期') + '</span>' +
      '<input type="date" class="input" id="rptDate" value="' + U.esc(date) + '"></label>' +
      '<span class="rpt-period" id="rptPeriod">' + U.esc(periodLabel(kind, agg)) + '</span>' +
      '<div class="spacer"></div>' +
      '<button class="btn primary" id="rptExport">' + SD.icons.get('download', 15) + '生成' + (isWeekly ? '周报' : '日报') + ' Excel</button></div>');
    host.appendChild(bar);

    // 说明
    host.appendChild(U.h('<p class="t-3 t-sm" style="margin:2px 2px 12px">数据来自本工作台当前记录，' +
      '按「' + (isWeekly ? '周一至周日' : '当日') + '」自动汇总；导出为 .xlsx 文件，可用 Excel / WPS 打开打印。</p>'));

    /* ---------- 指标卡 ---------- */
    var cards = U.h('<div class="grid cols-4"></div>');
    SD.comp.statCard.renderAll(cards, buildCards(kind, agg));
    host.appendChild(cards);

    /* ---------- 分节预览 ---------- */
    SD.report.sections(kind, agg).forEach(function (sec) {
      host.appendChild(renderSection(sec));
    });

    /* ---------- 事件 ---------- */
    var dateInput = bar.querySelector('#rptDate');
    dateInput.addEventListener('change', function () {
      var v = (dateInput.value || '').trim();
      if (!v) return;
      rf[kind] = v;
      ctx.refresh();
    });

    bar.querySelector('#rptExport').addEventListener('click', function () {
      var meta = {
        title: title,
        sheetName: isWeekly ? '安全周报' : '安全日报',
        period: periodLabel(kind, agg),
        reporter: REPORTER,
        dept: DEPT,
        generatedAt: new Date().toISOString().slice(0, 16).replace('T', ' ')
      };
      try {
        var sheets = SD.report.toSheets(kind, agg, meta);
        var blob = SD.comp.xlsxWriter.build(sheets);
        var stamp = isWeekly ? (agg.ws + '_' + agg.we) : agg.date;
        SD.comp.xlsxWriter.download(blob, meta.sheetName + '-' + stamp + '.xlsx');
        U.toast('已生成 ' + meta.sheetName + '（' + stamp + '）', 'ok');
      } catch (e) {
        U.toast('生成 Excel 失败：' + (e && e.message ? e.message : e), 'err');
      }
    });
  }

  return { render: renderReport };
})();
