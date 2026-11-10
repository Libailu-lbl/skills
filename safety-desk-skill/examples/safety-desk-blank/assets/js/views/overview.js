/* =========================================================
   views/overview.js — 安全概览（模块 1：概览指标卡 + 安全重要工作看板）
   ────────────────────────────────────────────────────────
   结构：
     · 4 张指标卡（点卡片可下钻到对应模块）
     · 「安全重要工作」四列看板（★ 2026-11-10 替换原「今天要处理」列表，
       看板本体在 components/keyBoard.js，这里只负责摆位置）
     · 隐患等级分布 + 通知公告摘要
   本视图只读 ctx.summary，不自己取数、不调用其它视图。
   注：原「今天要处理」清单是「台账自动推导的待办」，已整体让位给看板；
       那些待办仍在「待办任务」页（导航第二项）完整保留，一条没少。
   ========================================================= */
window.SD = window.SD || {};
SD.views = SD.views || {};

SD.views.overview = (function () {
  var U = SD.utils;

  function sub(s) {
    if (!s) return '';
    return '今天是 ' + s.today + '（' + U.weekdayCN(s.today) + '）· 本周 ' + s.weekStart + ' 至 ' + s.weekEnd;
  }

  function render(host, ctx) {
    var s = ctx.summary;
    U.clear(host);

    /* ---------- 1. 概览指标卡 ---------- */
    var stats = U.h('<div class="grid cols-4"></div>');

    var maxOverdue = 0;
    s.todos.forEach(function (t) {
      if (t.ref && t.ref._overdueDays > maxOverdue) maxOverdue = t.ref._overdueDays;
    });

    SD.comp.statCard.renderAll(stats, [
      {
        label: '待办事项', value: s.todos.length, unit: '项',
        icon: 'todo', tone: '',
        foot: '逾期 ' + s.overdueCount + ' · 今日巡检 ' + s.todayInspections.length,
        footIcon: 'clock',
        hint: '口径：隐患 / 巡检 / 作业票 / 培训四类的全部未完成项；每条可一键处理',
        onClick: function () { ctx.go('todo'); }
      },
      {
        label: '未整改隐患', value: s.openCount, unit: '项',
        icon: 'hazard', tone: 'orange',
        foot: '其中重大 ' + (s.severityDist.major || 0) + ' 项',
        footIcon: 'infoCircle',
        hint: '口径：状态 ≠ 已闭环（含 待整改/整改中/待验收/已延期）',
        onClick: function () { ctx.go('hazard', { status: 'open' }); }
      },
      {
        label: '逾期整改项', value: s.overdueCount, unit: '项',
        icon: 'alertCircle', tone: 'red',
        foot: maxOverdue ? ('最久已逾期 ' + maxOverdue + ' 天') : ('另有临期 ' + s.soonCount + ' 项'),
        footIcon: 'trendUp', footTone: s.overdueCount ? 'up' : '',
        hint: '口径：整改期限 < 今天且未闭环；已批准延期的不再计逾期',
        onClick: function () { ctx.go('hazard', { status: 'overdue' }); }
      },
      {
        label: '本周巡检完成率',
        value: s.inspectionWeek.rate == null ? '—' : U.pct(s.inspectionWeek.rate, 1, 0),
        unit: s.inspectionWeek.rate == null ? '' : '%',
        icon: 'inspection', tone: 'green',
        foot: s.inspectionWeek.done + ' / ' + s.inspectionWeek.total + ' 项' +
              (s.inspectionWeek.rescheduled ? ' · 改期 ' + s.inspectionWeek.rescheduled + ' 项仍计缺口' : ''),
        bar: { pct: s.inspectionWeek.rate == null ? 0 : s.inspectionWeek.rate, cls: (s.inspectionWeek.rate != null && s.inspectionWeek.rate < 0.6) ? 'orange' : 'green' },
        hint: '口径：本周已完成 / 本周计划数（排除已取消）；已改期不减免，未完成即算缺口',
        onClick: function () { ctx.go('inspection'); }
      }
    ]);
    host.appendChild(stats);

    /* ---------- 2. 安全重要工作看板（★ 2026-11-10 替换原「今天要处理」） ----------
       原先是「台账自动推导的待办」纵向清单；现在换成手录的四列看板。
       看板自己管数据、筛选、拖动与弹窗，这里只给它一个落点。 */
    SD.comp.keyBoard.render(host, ctx);

    /* ---------- 3. 等级分布 + 通知摘要 ---------- */
    var row = U.h('<div class="grid cols-2"></div>');

    // 3.1 隐患等级分布（红/橙/黄）
    var sevCard = U.h(
      '<section class="card">' +
        '<div class="card-head"><div><h3>隐患等级分布</h3>' +
        '<div class="sub">管理三级口径（红/橙/黄）；对外报表按法定两级</div></div></div>' +
        '<div class="bars"></div>' +
      '</section>'
    );
    var sevItems = [
      { name: '重大（红）', value: s.severityDist.major || 0, color: '#d92d20' },
      { name: '较大（橙）', value: s.severityDist.large || 0, color: '#e06c00' },
      { name: '一般（黄）', value: s.severityDist.general || 0, color: '#a97600' }
    ];
    var totalSev = sevItems.reduce(function (a, b) { return a + b.value; }, 0);
    sevCard.querySelector('.bars').innerHTML =
      SD.comp.chart.bars({
        items: sevItems.map(function (i) {
          return { name: i.name, rate: totalSev ? i.value / totalSev : 0, label: i.value + ' 项' };
        })
      });
    row.appendChild(sevCard);

    // 3.2 通知公告摘要
    var ntCard = U.h(
      '<section class="card">' +
        '<div class="card-head"><div><h3>通知公告</h3><div class="sub">最新 3 条</div></div>' +
        '<div class="actions"></div></div>' +
        '<div class="notice-list"></div>' +
      '</section>'
    );
    var ntAct = ntCard.querySelector('.actions');
    var ntBtn = U.h('<button class="btn ghost sm">全部' + SD.icons.get('chevronR', 14) + '</button>');
    ntBtn.addEventListener('click', function () { ctx.go('notice'); });
    ntAct.appendChild(ntBtn);

    var ntList = ntCard.querySelector('.notice-list');
    if (!s.notices.length) {
      ntList.appendChild(SD.comp.state.build('empty', { title: '暂无通知公告' }));
    } else {
      s.notices.slice(0, 3).forEach(function (n) { ntList.appendChild(SD.comp.listItem.notice(n)); });
    }
    row.appendChild(ntCard);

    host.appendChild(row);
  }

  return { name: '安全概览', sub: sub, render: render };
})();
