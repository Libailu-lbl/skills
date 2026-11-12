/* =========================================================
   views/dashboard.js — 数据看板（模块 6）
   ────────────────────────────────────────────────────────
   · 关键数字（隐患条数 / 已整改 / 逾期未整改 / 整改率）+ 月档环比
   · 隐患与整改 —— 未设期限 / 及时率 / 最长逾期 + 分部门逾期
   · 缝制中心隐患趋势（年档=1–12 月 / 月档=该月逐日，上报 / 已整改两条线）
   · 各部门隐患趋势（同年档/月档的横轴，按部门折线，可多选对比）
   · 各部门隐患汇总（横向条形，按照片张数降序）
   · 隐患类型分布（环形，巡检口径，计「次」）
   · 隐患等级分布（环形，巡检口径，计「条」）
   · 各部门整改率（横向条形，巡检口径）
   图表全部内联 SVG 手写，无任何图表库依赖。

   ★ 2026-11-12 口径整体切换：本页**只讲巡检**。
   此前「已闭环 / 逾期未闭环 / 延期跟进 / 隐患趋势 / 隐患等级分布 / 各部门整改率」
   六项都基于隐患台账条数；本轮统一改为基于巡检明细（`metrics.inspectionStats`），
   并给巡检补了「整改期限」字段（`fixDueDate`），因此逾期与整改及时率现在
   可以由巡检自己算出来，不再借台账的状态机。
   台账数字**只保留口径说明里一行快照**作对照，不再占版面 —— 两套整改率并列
   是这轮要去掉的重复项之一。

   ★ 2026-11-12 统计范围收窄（用户要求）：本页**只统计当前自然年**。
     归年依据 = 巡检的计划日期（scheduledDate），筛选落在 metrics.inspectionStats /
     inspectionPhotos 内部（各筛一次容易漏，所以只在那两处筛），趋势横轴改成本年度 1–12 月。
     页面顶部的「统计范围」横幅与口径说明第四段写明这条边界，避免数字变小时被当成丢数据。

   ★ 2026-11-12 v1.3.9 按月察看（用户要求）：顶部「按月 / 看年度」两档，**默认按月**。
     · 月档：`metrics.inspectionStats(data, today, {ym})` 现算，横轴该月逐日，KPI 加环比；
     · 年档：**必须读 `ctx.summary`**（禁止现算），与巡检页 `.js-insp-sum` 同值靠这一点；
     · 区间状态存 `filters.dashboard.{mode,ym}`（内存态，刷新回当月，不落库）。
     ⚠️ 月档「已整改」曲线是**事件窗口**（本月改完的都算，含跨月补完），KPI 的「已整改」
        仍是本月记录，两者不等属正常 —— 系列名与图例必须把这个差异写出来。

   ★ 三条去重约束（改之前先读，否则会打挂冒烟测试）：
     ① 顶部 KPI 只用 `.grid.cols-4` 一处分组，且必须正好 4 张
        （测试按 `.grid.cols-4 > *` 全文档递归计数，多一个容器就变成 8）。
     ② 六张卡的 h3 文案被 `smoke_blank` / `smoke_inspection_photos` 精确匹配，
        改名必须同步改断言（v1.4.1 刚整体改过一轮：巡检隐患条数趋势 → 缝制中心隐患趋势 等）。
     ③ 段内取节点一律判空：删掉某块后若还 `fixBox.parentNode`，
        会在 appendChild 之前抛 TypeError，**其后所有段落都不渲染**。
   ========================================================= */
window.SD = window.SD || {};
SD.views = SD.views || {};

SD.views.dashboard = (function () {
  var U = SD.utils;

  // 类型分布配色：与等级色区分开，用低饱和蓝绿系
  var PALETTE = ['#0d7a72', '#2f8f9d', '#4fa3a5', '#6fb3a8', '#8c9bd6', '#a98cc4', '#c48fa0', '#d9a406', '#8b9ba0', '#b7c4c7'];
  /* 等级配色：与台账等级图沿用同一套（红 / 橙 / 黄 / 灰），换页面也认得出来 */
  var LV_COLOR = { major: '#d92d20', large: '#e06c00', general: '#a97600', '': '#8b9ba0' };

  function sub(s, state) {
    if (!s) return '';
    /* ★ 2026-11-12 v1.3.9：看板默认「按月」，页头副标题也要跟着变，否则进页面第一眼
       看到的还是年度数字，和下面的月度 KPI 打架。
       只认第 2 参：不传 state（导航摘要、老测试）时仍走年度分支，行为向后兼容。 */
    var fD = state && state.filters && state.filters.dashboard;
    if (state && state.data && (!fD || fD.mode !== 'year')) {
      var R0 = SD.metrics.inspectionRange(s.today, fD && fD.ym);
      var st0 = SD.metrics.inspectionStats(state.data, s.today, { ym: R0.ym });
      var ip0 = SD.metrics.inspectionPhotos(state.data, s.today, { ym: R0.ym });
      return R0.label + ' · 巡检记录 ' + (st0.records || 0) + ' 项 · 隐患 ' + st0.hazardCount +
        ' 条 · 隐患照片 ' + ip0.totalPhotos + ' 张';
    }
    var ip = s.inspectionPhotos || { totalPhotos: 0 };
    var st = s.inspectionStats || { hazardCount: 0, records: 0 };
    /* 页面副标题只讲巡检。记录数放在这里，是因为顶部 4 张 KPI 已经让给
       「条数 / 已整改 / 逾期 / 整改率」了，单据数没必要再占一张卡。
       ★ 2026-11-12：带上年份前缀 —— 本页所有数字都是「当前自然年」的，
         副标题不写年份，跨年后对比截图会被当成同一段时间的数据。 */
    return (st.year ? st.year + ' 年 · ' : '') + '巡检记录 ' + (st.records || 0) + ' 项 · 隐患 ' +
      st.hazardCount + ' 条 · 隐患照片 ' + ip.totalPhotos + ' 张';
  }

  /* ---------------- 环比文案（★ 2026-11-12 v1.3.9 月视图） ----------------
     三条边界都覆盖，**宁可不给百分比，也不编数**：
       · 上月 0 → 除以 0 无意义，写「较上月新增 N 条（上月 0 条）」
       · 双方 0 → 「与上月持平（上月 0 条）」
       · 本月 0 / 上月无隐患基数 → 整改率另有分支（见 deltaRate）
     着色按**好坏**（goodWhenUp），不按数值方向：已整改上升是好事，不该涂红。 */
  function deltaCount(cur, prev, goodWhenUp, unit) {
    unit = unit || '条';
    if (!prev) {
      if (!cur) return { text: '与上月持平（上月 0 ' + unit + '）', tone: '' };
      return { text: '较上月新增 ' + cur + ' ' + unit + '（上月 0 ' + unit + '）',
               tone: goodWhenUp ? 'good' : 'bad' };
    }
    var d = cur - prev;
    if (!d) return { text: '与上月持平（上月 ' + prev + ' ' + unit + '）', tone: '' };
    var pct = Math.round(Math.abs(d) / prev * 100);
    return { text: '较上月 ' + (d > 0 ? '+' : '-') + pct + '%（上月 ' + prev + ' ' + unit + '）',
             tone: (d > 0) === !!goodWhenUp ? 'good' : 'bad' };
  }

  /** 整改率环比用「个百分点」不用相对变化：33%→50% 是 +17 个百分点，
      说「+51.5%」会被读成"整改率涨了一半"，实际只涨 17 个点。 */
  function deltaRate(cur, prev, prevHazard) {
    if (cur == null) {
      return { text: prevHazard ? '本月暂无隐患（上月 ' + U.pct(prev, 1, 0) + '）' : '本月暂无隐患', tone: '' };
    }
    if (!prevHazard || prev == null) return { text: '上月无数据（无可比基数）', tone: '' };
    var pp = (cur - prev) * 100;
    if (Math.abs(pp) < 0.05) return { text: '与上月持平（上月 ' + U.pct(prev, 1, 0) + '）', tone: '' };
    return {
      text: '较上月 ' + (pp > 0 ? '+' : '-') + Math.abs(pp).toFixed(1) + ' 个百分点（上月 ' +
        U.pct(prev, 1, 0) + '）',
      tone: pp > 0 ? 'good' : 'bad'
    };
  }

  /** 归一筛选态：mode 只认 month / year，ym 必须是合法且不晚于当月的 'YYYY-MM' */
  function normDash(fD, today) {
    var cur = U.ym(today);
    if (fD.mode !== 'year') fD.mode = 'month';
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(fD.ym || ''))) fD.ym = cur;
    if (fD.ym > cur) fD.ym = cur;              // 未来月 → 当月
    if (fD.ym < '2000-01') fD.ym = cur;        // 明显脏值 → 当月
    return fD;
  }

  function render(host, ctx) {
    var s = ctx.summary;

    /* ---------- 统计范围：年 / 月双档（★ 2026-11-12 v1.3.9） ----------
       月档是**默认**：进入看板先看当月。年档保留（「看年度」），语义与 v1.3.8 完全一致。
       ⚠️ 年档必须读 `s.inspectionStats`（summary 快照），**不许现算**：
          巡检页顶部 `.js-insp-sum` 读的就是这一份，两页同值是结构保证。
       月档才用 `ctx.state.data` 现算，且与年档走**同一个** statsOf/photosOf。 */
    var fD = normDash(ctx.state.filters.dashboard = ctx.state.filters.dashboard || {}, s.today);
    var monthMode = fD.mode === 'month';
    var R = SD.metrics.inspectionRange(s.today, monthMode ? fD.ym : '');

    var ip = monthMode ? SD.metrics.inspectionPhotos(ctx.state.data, s.today, { ym: R.ym })
                       : (s.inspectionPhotos || { totalPhotos: 0, totalTasks: 0, totalRecords: 0, byDept: [], trend: { months: [], depts: [] } });
    var st = monthMode ? SD.metrics.inspectionStats(ctx.state.data, s.today, { ym: R.ym })
                       : (s.inspectionStats || {
                           records: 0, byStatus: { planned: 0, done: 0, rescheduled: 0, cancelled: 0 },
                           hazardCount: 0, hazardTasks: 0, byLevel: [], byDept: [],
                           fix: { none: 0, doing: 0, done: 0 }, fixRate: null,
                           due: { doneOnTime: 0, doneLate: 0, doneNoDue: 0, openOverdue: 0, openInDue: 0, openNoDue: 0 },
                           dueMaxDays: 0, noDue: { count: 0 }, trend: []
                         });
    var stPrev = monthMode ? SD.metrics.inspectionStats(ctx.state.data, s.today, { ym: R.prevYm }) : null;
    var monthList = SD.metrics.inspectionMonthsOf(ctx.state.data);
    if (monthMode && !monthList.some(function (m) { return m.ym === fD.ym; })) {
      /* 脏值 / 数据被删后残留的月份：把当前选中项补进列表，让下拉如实显示，
         而不是悄悄跳走（悄悄跳会被当成「我的数据丢了」） */
      monthList.push({ ym: fD.ym, records: 0 });
      monthList.sort(function (a, b) { return a.ym < b.ym ? 1 : -1; });
    }

    var due = st.due || { doneOnTime: 0, doneLate: 0, doneNoDue: 0, openOverdue: 0, openInDue: 0, openNoDue: 0 };
    var noDueN = (st.noDue && st.noDue.count) || 0;
    /* 整改及时率：分母只含「已设期限且已整改」的条数（按期 + 超期），
       未设期限的已整改判不了按期，不能进分母。分母 0 → null → 页面显示「—」。 */
    var onTimeBase = (due.doneOnTime || 0) + (due.doneLate || 0);
    var onTimeRate = onTimeBase ? due.doneOnTime / onTimeBase : null;
    /* 逾期脚注三分支：有逾期 → 需优先处置；一条期限都没设 → 坦白说没判定过；
       其余 → 无逾期。**绝不能在"没设过期限"的情况下写「无逾期」**，那是在没判定的前提上宣布平安。 */
    var overdueFoot;
    if (due.openOverdue) overdueFoot = '需优先处置' + (noDueN ? ' · 另有 ' + noDueN + ' 条未设期限' : '');
    else if (st.hazardCount && noDueN === st.hazardCount) overdueFoot = '尚未设置整改期限';
    else overdueFoot = noDueN ? '另有 ' + noDueN + ' 条未设期限' : '无逾期';

    U.clear(host);

    /* ---------- 范围条（★ 2026-11-12 v1.3.9 由静态横幅改造） ----------
       口径收窄/切换必须**写出来**：否则用户看到数字变了，第一反应是"数据丢了"。
       ⚠️ 不能放进 .grid.cols-4（测试按 `.grid.cols-4 > *` 全文档计数，塞进去就变 5 张）。 */
    var CY = st.year || String(s.today || '').slice(0, 4);

    function scopeText() {
      if (monthMode) {
        var allN2 = st.recordsAll;
        return '<b class="t-2">统计范围：' + U.esc(R.label) + '</b>（按巡检计划日期归月，当月 <b class="t-2">' +
          st.records + '</b> 项）；跨年记录不计入本页任何数字。' +
          (allN2 != null && allN2 !== st.records ? '　全库共 <b class="t-2">' + allN2 + '</b> 项巡检记录。' : '');
      }
      var allNote = (st.recordsAll != null && st.recordsAll !== st.records)
        ? '　全库共 <b class="t-2">' + st.recordsAll + '</b> 项巡检记录，其中 ' + U.esc(CY) + ' 年 <b class="t-2">' +
          st.records + '</b> 项。'
        : '';
      return '<b class="t-2">统计范围：' + U.esc(CY) + ' 年</b>（1–12 月，按巡检计划日期归年）；' +
        '跨年记录不计入本页任何数字。' + allNote;
    }

    function monthBoxHtml() {
      /* 年档**不渲染**这块，而不是渲染完再 `hidden`：
         `.dash-range .js-dash-month{ display:flex }` 会盖掉 `[hidden]` 的 display:none
         （作者样式优先于 UA 样式），结果「切年度」后月份条还明晃晃挂在上面 ——
         这是上一版实测到的坑，别再用 hidden 做显隐。 */
      if (!monthMode) return '';
      var opts = monthList.map(function (m) {
        return '<option value="' + U.esc(m.ym) + '"' + (m.ym === fD.ym ? ' selected' : '') + '>' +
          U.esc(m.ym.slice(0, 4)) + ' 年 ' + Number(m.ym.slice(5)) + ' 月 · ' + m.records + ' 项</option>';
      }).join('');
      /* 当月一条都没有、但上月有数据时，给个一键跳转 —— 月初进来看空页最容易被当成故障 */
      var prevHit = monthList.filter(function (m) { return m.ym === R.prevYm; })[0];
      var jump = (monthMode && !st.records && prevHit && prevHit.records)
        ? '<button type="button" class="btn sm ghost js-m-go" data-ym="' + U.esc(prevHit.ym) + '">' +
          '上月有 ' + prevHit.records + ' 项 ›</button>'
        : '';
      return '<div class="fg js-dash-month">' +
        '<button type="button" class="btn sm ghost js-m-prev" title="上一月（只走有数据的月份）">‹</button>' +
        '<select class="ctl-select js-m-sel" data-keep-focus="dash-month" title="选择月份（只列出有数据的年月）">' +
          opts + '</select>' +
        '<button type="button" class="btn sm ghost js-m-next" title="下一月（只走有数据的月份）">›</button>' +
        (fD.ym === U.ym(s.today) ? '' : '<button type="button" class="btn sm ghost js-m-now">回到本月</button>') +
        jump + '</div>';
    }

    var rangeBar = U.h(
      '<div class="filters dash-range js-dash-range">' +
        '<div class="chip-group js-dash-mode">' +
          '<button type="button" class="chip' + (monthMode ? ' on' : '') + '" data-mode="month">按月</button>' +
          '<button type="button" class="chip' + (monthMode ? '' : ' on') + '" data-mode="year">看年度</button>' +
        '</div>' +
        monthBoxHtml() +
        '<span class="spacer"></span>' +
        '<div class="t-3 t-sm js-year-scope">' + scopeText() + '</div>' +
      '</div>'
    );

    rangeBar.addEventListener('click', function (e) {
      var chip = e.target.closest('[data-mode]');
      if (chip) {
        fD.mode = chip.getAttribute('data-mode') === 'year' ? 'year' : 'month';
        ctx.refresh();
        return;
      }
      var jump = e.target.closest('.js-m-go');
      if (jump) { fD.ym = jump.getAttribute('data-ym'); ctx.refresh(); return; }
      if (e.target.closest('.js-m-now')) { fD.ym = U.ym(s.today); ctx.refresh(); return; }
      var back = e.target.closest('.js-m-prev'), fwd = e.target.closest('.js-m-next');
      if (!back && !fwd) return;
      /* 列表是倒序（新 → 旧）：‹ 上一月 = 索引 +1（更早），› 下一月 = 索引 -1 */
      var idx = monthList.map(function (m) { return m.ym; }).indexOf(fD.ym);
      var j = idx + (back ? 1 : -1);
      if (j >= 0 && j < monthList.length) { fD.ym = monthList[j].ym; ctx.refresh(); }
    });
    var mSel = rangeBar.querySelector('.js-m-sel');
    if (mSel) mSel.addEventListener('change', function () {
      var v = String(mSel.value || '');
      if (/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) { fD.ym = v; ctx.refresh(); }
    });
    host.appendChild(rangeBar);

    /* ---------- 顶部关键数字（★ 2026-11-12 全巡检口径；v1.3.9 月档加环比） ----------
       四张全部来自 st（年档=summary 快照 / 月档=现算的同一函数），不再混台账。
       原来这里第二、三、四张是台账的「已闭环 / 逾期未闭环 / 延期跟进」，
       而下方「安全巡检」段里又摆了一遍「已整改 / 整改率」—— 同一组数字在
       一屏里出现两次，这就是本轮要消掉的重复项。现在 KPI 只留一处。 */
    var kpiCards = [
      { label: '隐患条数', value: st.hazardCount, unit: '条', icon: 'inspection', tone: '',
        foot: st.hazardTasks ? st.hazardTasks + ' 项巡检任务上报' : '暂无上报' },
      { label: '已整改', value: st.fix.done, unit: '条', icon: 'check', tone: 'green',
        bar: { pct: st.hazardCount ? st.fix.done / st.hazardCount : 0, cls: 'green' },
        foot: (st.hazardCount ? U.pct(st.fix.done / st.hazardCount, 1, 0) + ' 整改率' : '暂无整改数据') +
          (st.fix.doing ? ' · 另有 ' + st.fix.doing + ' 条整改中' : '') },
      { label: '逾期未整改', value: due.openOverdue, unit: '条', icon: 'alertCircle',
        tone: due.openOverdue ? 'red' : '',
        footTone: due.openOverdue ? 'up' : '', foot: overdueFoot },
      { label: '整改率', value: st.fixRate == null ? null : U.pct(st.fixRate, 1, 0), unit: '',
        icon: 'clock', tone: '', foot: '已整改 / 隐患条数（不按任务数）' }
    ];
    /* 环比只在月档给：年度数字「较上月」没有意义，也会打乱年档的既有断言 */
    if (monthMode && stPrev) {
      var dTone = [ deltaCount(st.hazardCount, stPrev.hazardCount, false),
                    deltaCount(st.fix.done, stPrev.fix.done, true),
                    deltaCount(due.openOverdue, (stPrev.due || {}).openOverdue || 0, false),
                    deltaRate(st.fixRate, stPrev.fixRate, stPrev.hazardCount) ];
      dTone.forEach(function (d, i) { kpiCards[i].delta = d.text; kpiCards[i].deltaTone = d.tone; });
    }
    var kpi = U.h('<div class="grid cols-4"></div>');
    SD.comp.statCard.renderAll(kpi, kpiCards);
    host.appendChild(kpi);

    /* ---------- 隐患与整改（★ 2026-11-12 重排；★ 2026-11-12 v1.4.1 改名，原名「安全巡检（隐患与整改）」） ----------
       本段**只读 s.inspectionStats**（巡检侧唯一统计入口），巡检页顶部汇总条读同一份，
       所以「两页数值一致」是结构保证，不是人工对账。

       ★ 为什么瘦身：原来这里摆 4 格（巡检记录 / 隐患条数 / 已整改 / 整改率）加一行三态，
         而顶部 KPI 也要摆同一组数 —— 一屏两遍，正是本轮要消掉的重复项。
         现在那组数上移到 KPI，本段只放 **KPI 里没有、且必须由「整改期限」才算得出来**的三格：
         未设期限 / 整改及时率 / 最长逾期；右栏给逾期做部门下钻。

       ★ 硬约束（改了会打挂冒烟测试）：
         ① 本段**不能用 .grid.cols-4**：测试按 `.grid.cols-4 > *` 全文档递归计数，多一个就变 8。
         ② 不能插在 KPI 行之前：空态断言取首个 `.grid.cols-4 > *` 判断首卡。
         ③ h3 与空态文案「暂无巡检隐患数据」一字不改。
         ④ 删块后**不能再用 fixBox.parentNode 当挂载点** —— 那是 null 引用，
            会在 appendChild 之前抛 TypeError，导致其后所有段落都不渲染。 */
    var inspCard = U.h(
      '<section class="card">' +
        '<div class="card-head"><div><h3>隐患与整改</h3>' +
          '<div class="sub">' + U.esc(R.label) + '，按「整改期限」逐行判定：<b>有期限、期限已过、又没填整改日期 = 逾期</b>；' +
          '没设期限的单独计一格，既不判逾期也不判按期；' +
          (monthMode ? '<b>逾期天数截至今天</b>' : '') + '</div></div></div>' +
        '<div class="grid cols-2">' +
          '<div><div class="rpt-kv js-insp-kv"></div><div class="js-insp-dept-host"></div></div>' +
          '<div class="js-insp-due"></div>' +
        '</div>' +
      '</section>'
    );

    var kvBox = inspCard.querySelector('.js-insp-kv');
    if (kvBox) {
      [
        { k: '未设期限', v: noDueN + ' 条', note: '不参与逾期判定' },
        { k: '整改及时率', v: onTimeRate == null ? '—' : U.pct(onTimeRate, 1, 0),
          note: onTimeBase ? '在已设期限且已整改的 ' + onTimeBase + ' 条中算' : '暂无已设期限的整改' },
        { k: '最长逾期', v: due.openOverdue ? (st.dueMaxDays || 0) + ' 天' : '—',
          note: due.openOverdue ? ('未整改里最久的一条' + (monthMode ? '（截至今天）' : ''))
            : (st.hazardCount && noDueN === st.hazardCount ? '尚未设置整改期限' : '当前没有逾期') }
      ].forEach(function (x, i, arr) {
        /* 三格在 .rpt-kv（auto-fill 180px）里会排成 2 + 1，最后一格独占一行更整齐，
           否则第三格孤零零挂在左下角，看着像漏排 */
        kvBox.appendChild(U.h('<div class="kv"' + (i === arr.length - 1 ? ' style="grid-column:1/-1"' : '') + '>' +
          '<span class="kv-k">' + U.esc(x.k) + '</span>' +
          '<span class="kv-v">' + U.esc(x.v) + '</span>' +
          '<span class="kv-note">' + U.esc(x.note) + '</span></div>'));
      });
    }

    /* ★ 2026-11-12：分部门隐患条数
       一张巡检单可以登记多个部门的问题，这里把各部门条数摊开写一行 ——
       否则「隐患条数 N 条」在页面上是个黑盒，用户没法核对它是怎么来的。
       刻意用纯文本：不用 .bar-row（那条断言锁的是「各部门隐患」卡里的行数），
       也不进 .rpt-kv（否则空态断言与版式都会被带偏）。
       挂**固定容器**（.js-insp-dept-host），不再用某个块的 parentNode。 */
    var deptHost = inspCard.querySelector('.js-insp-dept-host');
    if (deptHost && st.hazardCount && st.byDept && st.byDept.length) {
      var dParts = st.byDept.slice(0, 5).map(function (d) {
        return U.esc(d.dept) + ' <b class="t-2">' + d.hazardCount + '</b> 条';
      });
      var dMore = st.byDept.length > 5 ? '　等 ' + st.byDept.length + ' 个部门' : '';
      deptHost.appendChild(U.h('<div class="t-3 t-sm js-insp-dept" style="margin-top:8px">' +
        '<b class="t-2">分部门隐患条数</b>　' + dParts.join(' · ') + dMore + '</div>'));
    }

    /* 右栏：分部门逾期未整改（单位：条，给顶部「逾期未整改」那张卡做下钻）
       **不用 byStatus 四态环图** —— 那是记录数（项），与段内条数混在一张卡
       会诱发「9 条 / 12 项」这类无意义除法，而且与巡检页顶部 4 张卡重复。 */
    var dueBox = inspCard.querySelector('.js-insp-due');
    if (dueBox) {
      var dueDepts = (st.byDept || []).filter(function (d) { return d.overdue > 0; });
      if (!st.hazardCount) {
        dueBox.appendChild(SD.comp.state.build('empty', {
          title: '暂无巡检隐患数据',
          desc: '在「安全巡检」里给任务填写「隐患条数」与「整改期限」后，这里会按部门显示逾期条数。'
        }));
      } else if (!dueDepts.length) {
        dueBox.appendChild(SD.comp.state.build('empty', noDueN === st.hazardCount
          ? { title: '尚未设置整改期限', desc: '在巡检表单（或分部门明细）里填「整改期限」后，这里会按部门显示逾期条数。' }
          : { title: '暂无逾期', desc: '所有已设期限的隐患都还在期限内。' }));
      } else {
        var maxOverdue = dueDepts.reduce(function (a, d) { return Math.max(a, d.overdue); }, 0) || 1;
        dueBox.innerHTML = '<div class="t-3 t-sm" style="margin-bottom:6px">分部门逾期未整改（按条数）</div>' +
          '<div class="js-due-bars"></div>';
        dueBox.querySelector('.js-due-bars').innerHTML = SD.comp.chart.bars({
          /* neutral：逾期条数是「数量」不是「比率」，少不代表好，沿用照片卡的语义 */
          neutral: true,
          items: dueDepts.map(function (d) {
            return { name: d.dept, rate: d.overdue / maxOverdue, label: d.overdue + ' 条' };
          })
        });
      }
    }
    host.appendChild(inspCard);

    /* ---------- 缝制中心隐患趋势（★ 2026-11-12 原「隐患趋势」改口径；v1.4.1 改名） ----------
       原来读台账（新增 / 闭环），现在读巡检：上报 / 已整改。
       两条线**归期依据不同**（上报按计划日期、已整改按行整改日期），
       所以某期「已整改 > 上报」是正常的（上月发现、本月改完），副标题要写明，
       否则用户第一眼就会当成算错。
       ★ 2026-11-12 v1.3.9：年档横轴 = 本年度 1–12 月；月档横轴 = 该月逐日。
         月档的「已整改」是**事件窗口**（本月改完的都算，含上月上报的），
         所以它可能大于本月「上报」，图例里单独说明补进来的条数（fixedCarryIn）。
         年档保持 containment（与 v1.3.8 一致），不改成事件窗口 —— 那会改掉既有数字。 */
    var trend = st.trend || [];
    var daily = st.daily || [];
    var trendCard = U.h(
      '<section class="card">' +
        '<div class="card-head"><div><h3>缝制中心隐患趋势</h3>' +
        '<div class="sub">' + (monthMode
          ? U.esc(R.label) + '各日巡检<b>上报</b>与<b>已整改</b>的隐患条数（单位：条）；' +
            '上报按计划日期归日、已整改按整改日期归日，两者不同日属正常'
          : U.esc(CY) + ' 年各月巡检<b>上报</b>与<b>已整改</b>的隐患条数（单位：条）；' +
            '上报按计划日期归月、已整改按整改日期归月，两者不同月属正常') +
        '</div></div></div>' +
        '<div class="js-chart"></div><div class="js-legend"></div>' +
      '</section>'
    );
    if (monthMode) {
      /* 月档：逐日。全 0 时 st.daily 是空数组 → 空态 */
      if (!daily.length) {
        trendCard.querySelector('.js-chart').appendChild(
          SD.comp.state.build('empty', {
            title: '暂无趋势数据',
            desc: '本月还没有填写「隐患条数」的巡检记录，切到别的月份或先登记一条。'
          }));
      } else {
        var dFound = daily.reduce(function (a, b) { return a + (b.found || 0); }, 0);
        var dFixed = daily.reduce(function (a, b) { return a + (b.fixed || 0); }, 0);
        var carry = st.fixedCarryIn || 0;
        trendCard.querySelector('.js-chart').innerHTML = SD.comp.chart.lineChart({
          labels: daily.map(function (d) { return d.date; }),
          xFormat: function (lb) { return Number(String(lb).slice(8, 10)) + ' 日'; },
          xStep: Math.max(1, Math.ceil(daily.length / 8)),   // 30 天 → 4，约 8 个刻度
          height: 230,
          unit: ' 条',
          series: [
            { name: '上报', color: '#d92d20', data: daily.map(function (d) { return d.found || 0; }) },
            { name: '已整改（按整改日期）', color: '#12805c', data: daily.map(function (d) { return d.fixed || 0; }) }
          ]
        });
        trendCard.querySelector('.js-legend').innerHTML = SD.comp.chart.legend([
          { name: '本月上报合计', color: '#d92d20', value: dFound + ' 条' },
          { name: '本月改完合计' + (carry ? '（其中 ' + carry + ' 条来自上月及以前上报）' : ''),
            color: '#12805c', value: dFixed + ' 条' }
        ]);
      }
    } else if (!trend.length) {
      trendCard.querySelector('.js-chart').appendChild(
        SD.comp.state.build('empty', { title: '暂无趋势数据', desc: '在「安全巡检」里填写「隐患条数」后，趋势图会按月份自动汇总。' }));
    } else {
      var sumFound = trend.reduce(function (a, b) { return a + (b.found || 0); }, 0);
      var sumFixed = trend.reduce(function (a, b) { return a + (b.fixed || 0); }, 0);
      trendCard.querySelector('.js-chart').innerHTML = SD.comp.chart.lineChart({
        labels: trend.map(function (t) { return t.ym; }),
        height: 230,
        unit: ' 条',
        series: [
          { name: '上报', color: '#d92d20', data: trend.map(function (t) { return t.found || 0; }) },
          { name: '已整改', color: '#12805c', data: trend.map(function (t) { return t.fixed || 0; }) }
        ]
      });
      trendCard.querySelector('.js-legend').innerHTML = SD.comp.chart.legend([
        { name: '上报合计（' + CY + ' 年）', color: '#d92d20', value: sumFound + ' 条' },
        { name: '已整改合计（' + CY + ' 年）', color: '#12805c', value: sumFixed + ' 条' }
      ]);
    }
    host.appendChild(trendCard);

    /* ---------- 各部门隐患趋势（v1.4.1 由「各部门隐患照片趋势」改名） ----------
       与全厂同窗口（年档=本年度 1–12 月 / 月档=该月逐日，都按巡检计划日期归期）；
       部门线可多选对比，默认勾选总量前 4 的部门，勾选状态记在 filters.dashboard，刷新不丢。 */
    var pt = monthMode ? (ip.daily || { labels: [], depts: [] })
                       : (ip.trend || { months: [], depts: [] });
    var ptLabels = monthMode ? (pt.labels || []) : (pt.months || []);
    var DEPT_COLORS = ['#0d7a72', '#2f8f9d', '#4fa3a5', '#6fb3a8', '#8c9bd6', '#a98cc4', '#c48fa0', '#d9a406', '#5b7fa6', '#b7c4c7'];
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
    /* ★ 2026-11-12 v1.3.9：切月/切档后，上月勾的部门这个月可能一张照片都没有。
       被下面的 exist 过滤掉之后就成了「选一个部门开始对比」，像是坏了。
       用 ymSeen 记「上一次渲染是哪个区间」，**只在区间刚变的那一帧**补默认勾选，
       之后照旧完全尊重用户自己的选择（包括全部取消）。 */
    var scopeKey = monthMode ? ('m:' + R.ym) : ('y:' + CY);
    var scopeChanged = fD.scopeSeen !== scopeKey;
    if (scopeChanged) {
      fD.scopeSeen = scopeKey;
      if (pt.depts.length) fD.depts = pt.depts.slice(0, 4).map(function (d) { return d.dept; });
    }
    var exist = {};
    pt.depts.forEach(function (d) { exist[d.dept] = 1; });
    fD.depts = fD.depts.filter(function (d) { return exist[d]; });
    var colorOf = {};
    pt.depts.forEach(function (d, i) { colorOf[d.dept] = DEPT_COLORS[i % DEPT_COLORS.length]; });
    var picked = pt.depts.filter(function (d) { return fD.depts.indexOf(d.dept) >= 0; });

    var deptTrendCard = U.h(
      '<section class="card">' +
        '<div class="card-head"><div><h3>各部门隐患趋势</h3>' +
        '<div class="sub">' + (monthMode ? U.esc(R.label) + '各日' : U.esc(CY) + ' 年各月') +
        '巡检上传的隐患照片（单位：张）；点部门名增减对比，默认总量前 ' + Math.min(4, pt.depts.length) + '</div></div>' +
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
          desc: monthMode
            ? '本月还没有上传隐患照片的巡检记录，切到别的月份看看。'
            : '在「安全巡检 → 新增巡检任务」里上传隐患照片后，这里会按部门 × 月份自动汇总。'
        }));
    } else if (!picked.length) {
      deptTrendCard.querySelector('.js-chart').appendChild(
        SD.comp.state.build('empty', { title: '选一个部门开始对比', desc: '点右上角部门名把它加进折线图。' }));
    } else {
      var deptChart = {
        labels: ptLabels,
        height: 230,
        unit: ' 张',            /* ★ 2026-11-11：原来没传，tooltip 落成「条」，与「张」对不上 */
        series: picked.map(function (d) {
          return { name: d.dept, color: colorOf[d.dept], data: d.data };
        })
      };
      if (monthMode) {
        deptChart.xFormat = function (lb) { return Number(String(lb).slice(8, 10)) + ' 日'; };
        deptChart.xStep = Math.max(1, Math.ceil(ptLabels.length / 8));
      }
      deptTrendCard.querySelector('.js-chart').innerHTML = SD.comp.chart.lineChart(deptChart);
      deptTrendCard.querySelector('.js-legend').innerHTML = SD.comp.chart.legend(
        picked.map(function (d) {
          return { name: d.dept + ' 合计', color: colorOf[d.dept], value: d.total + ' 张' };
        })
      );
    }
    host.appendChild(deptTrendCard);

    /* ---------- 各部门隐患（汇总条形；v1.4.1 由「各部门隐患照片」改名） ----------
       这是本次需求的核心视图：把巡检上传的隐患照片**按部门求和**摊开。
       没填责任部门的巡检统一归「未指定部门」，保证各项相加等于顶部总张数。 */
    var photoCard = U.h(
      '<section class="card">' +
        '<div class="card-head"><div><h3>各部门隐患</h3>' +
        '<div class="sub">按巡检任务的责任部门汇总照片张数；未填部门的归入「未指定部门」</div></div>' +
        '<div class="js-total t-3 t-sm"></div></div>' +
        '<div class="js-body"></div></section>'
    );
    if (!ip.byDept.length) {
      photoCard.querySelector('.js-body').appendChild(
        SD.comp.state.build('empty', { title: '暂无隐患照片', desc: '巡检任务上传照片后，按部门汇总会显示在这里。' }));
    } else {
      var maxPhotos = ip.byDept.reduce(function (a, d) { return Math.max(a, d.photos); }, 0) || 1;
      /* ★ 2026-11-12：多部门单的「项」是上报处数（= 有照片的明细行），
         与「任务」不再是一回事。只在两者不等时补一句，避免文案误导；
         单部门数据（含全部历史记录）仍是「合计 7 张 / 4 项任务」，一字未变。 */
      photoCard.querySelector('.js-total').textContent = '合计 ' + ip.totalPhotos + ' 张 / ' + ip.totalTasks + ' 项' +
        (ip.totalRecords != null && ip.totalRecords !== ip.totalTasks ? '（共 ' + ip.totalRecords + ' 项任务）' : '任务');
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

    /* ---------- 类型分布 + 等级分布（★ 2026-11-12 两张都是巡检口径） ----------
       类型分布 2026-11-10 就改巡检了（巡检表单有「隐患类型」字段）；
       等级分布本轮才改（巡检 2026-11-11 加了「隐患等级」，2026-11-12 又下沉到明细行）。
       现在两张同源同口径，副标题分别写明计数单位（次 / 条），别让人以为能相加。 */
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
          unit: ' 次',           /* ★ 2026-11-11：这里计的是「次数」，不是「条」 */
          center: { top: String(ip.totalTasks), bottom: '隐患次数' }
        }) +
        '<div class="chart-legend">' + typeItems.map(function (it) {
          return '<span class="li"><span class="sw" style="background:' + it.color + '"></span>' +
            U.esc(it.name) + ' <span class="v">' + it.value + '</span></span>';
        }).join('') + '</div>';
    }
    row.appendChild(typeCard);

    /* 等级分布：★ 2026-11-12 由「台账条数」改为「巡检条数」。
       原来页面上一共有两张等级图（巡检段一张环图 + 这张台账环图），同一件事画两遍，
       而且口径不同（按记录数 vs 按条数），最容易看混 —— 现在只留这一张，按条数。 */
    var sevCard = U.h(
      '<section class="card"><div class="card-head"><div><h3>隐患等级分布</h3>' +
      '<div class="sub">基于巡检明细，按<b>条数</b>汇总（每行一个等级，未填归「未定级」），等级合计 = 隐患条数</div>' +
      '</div></div><div class="js-body"></div></section>'
    );
    var sevItems = (st.byLevel || []).map(function (x) {
      return { name: x.name, value: x.count, color: LV_COLOR[x.level] || '#8b9ba0' };
    });
    if (!sevItems.length) {
      sevCard.querySelector('.js-body').appendChild(SD.comp.state.build('empty', { title: '暂无数据' }));
    } else {
      sevCard.querySelector('.js-body').innerHTML =
        SD.comp.chart.donut({
          items: sevItems, unit: ' 条',
          center: { top: String(st.hazardCount), bottom: '隐患条数' }
        }) +
        '<div class="chart-legend">' + sevItems.map(function (it) {
          return '<span class="li"><span class="sw" style="background:' + it.color + '"></span>' +
            U.esc(it.name) + ' <span class="v">' + it.value + '</span></span>';
        }).join('') + '</div>';
    }
    row.appendChild(sevCard);

    host.appendChild(row);

    /* ---------- 各部门整改率（★ 2026-11-12 由台账改巡检；v1.4.1 改名） ----------
       原来按台账「已闭环 / 该部门隐患总数」，现在按巡检「已整改条数 / 该部门隐患条数」。
       两套整改率并存正是本轮要消掉的重复项 —— 页面上只留巡检这一套。
       label 用 `33%（3/9）`：分母是条数不是任务数，写出来省得被当成"3 项改完 9 项"。 */
    var deptCard = U.h(
      '<section class="card"><div class="card-head"><div><h3>各部门整改率</h3>' +
      '<div class="sub">基于巡检明细：已整改条数 / 该部门隐患条数；整改率低的排在最前面</div></div></div><div class="js-body"></div></section>'
    );
    var deptRows = (st.byDept || []).map(function (d) {
      var total = d.hazardCount || 0;
      var done = (d.fix && d.fix.done) || 0;
      return { dept: d.dept, total: total, done: done, rate: total ? done / total : null };
    }).sort(function (a, b) {
      var ra = a.rate == null ? 1 : a.rate, rb = b.rate == null ? 1 : b.rate;
      if (ra !== rb) return ra - rb;
      return b.total - a.total;
    });
    if (!deptRows.length) {
      deptCard.querySelector('.js-body').appendChild(SD.comp.state.build('empty', { title: '暂无部门数据' }));
    } else {
      deptCard.querySelector('.js-body').innerHTML = SD.comp.chart.bars({
        items: deptRows.map(function (d) {
          return {
            name: d.dept, rate: d.rate == null ? 0 : d.rate,
            label: (d.rate == null ? '—' : U.pct(d.rate, 1, 0)) + '（' + d.done + '/' + d.total + '）'
          };
        })
      });
    }
    host.appendChild(deptCard);

    /* ---------- 口径说明 ----------
       ★ 2026-11-12：本页口径整体切到巡检，所以「二、台账」不再是"指标说明"，
         而是"一行快照 + 去向"；「三、巡检」补上整改期限与逾期判定。
         一、二两段里被冒烟测试逐字断言的几句（各部门相加恒等于总张数 / 未填的归
         「未指定部门」/ 闭环率、逾期未闭环 / 不是照片张数、也不是任务数 /
         有「整改日期」= 已整改 / 整改照片…整改中 / 不会自动生成隐患台账记录）**原文保留**。 */
    host.appendChild(SD.comp.noteCard.build({
      key: 'dashboard',
      html:
      '<div style="margin-top:4px"><b>一、隐患照片（主口径）</b>　统计「安全巡检 → 新增巡检任务」里上传的' +
      '<b>隐患照片张数</b>（字段原名「巡查照片」，2026-11-10 更名，存储键不变，历史记录照常计数）。' +
      '部门归属取巡检任务的「责任部门」（★ 2026-11-12 起：一张单可拆多部门，改按<b>明细行</b>的部门归属），' +
      '未填的归「未指定部门」，因此<b>各部门相加恒等于总张数</b>；' +
      '按巡检<b>计划日期</b>归月；任务改期或取消时，已上传的照片仍然计入（照片是现场证据，不随任务状态消失）。<br>' +
      '<b>隐患类型分布</b>同属巡检口径，但计的是<b>次数</b>：一处有照片的隐患记一次（按明细行；老记录 = 该任务，含未分类），' +
      '所以类型合计 = 有隐患照片的上报处数，不等于照片张数 —— 照片是证据，一次上报是一个事件。</div>' +
      '<div style="margin-top:4px"><b>二、隐患台账（仅作对照快照）</b>　台账仍在「隐患整改」模块里维护，' +
      '本页只保留一行对照：<b>台账 ' + (s.totalHazards || 0) + ' 条</b>（已闭环 ' + (s.closedCount || 0) + ' 条）—— ' +
      '这一行是<b>全期数字，不随本页年份过滤</b>（台账模块自己带年份筛选）；' +
      '闭环率、逾期未闭环、延期跟进一律以台账为准。' +
      '原「隐患趋势」与「各部门整改率」两张图已改为巡检口径，<b>不再重复展示台账</b>，' +
      '避免两套整改率在同一屏里各说各话。</div>' +
      '<div style="margin-top:4px"><b>三、巡检的隐患条数与整改状态（2026-11-12 全巡检口径）</b>　' +
      '「隐患条数」= 巡检表单（或分部门明细）里人工填写的条数之和，' +
      '<b>不是照片张数、也不是任务数</b>；部门归属未填归「未指定部门」，因此<b>各单位条数相加恒等于总条数</b>。' +
      '整改状态由证据推导、不另设字段：<b>有「整改日期」= 已整改</b>；<b>只有「整改照片」= 整改中</b>；两者都没有 = 未整改。' +
      '<b>整改率 = 已整改条数 / 隐患条数</b>（按条不按任务，才不会出现「隐患 5 条、已整改 4 条、整改率 50%」）。<br>' +
      '<b>逾期与及时率（2026-11-12 新增）</b>：巡检补了「整改期限」字段，于是可以自己判逾期 —— ' +
      '<b>有期限、期限已过、且没填整改日期 = 逾期未整改</b>（「整改中」也归未整改侧参与判定）；' +
      '<b>整改及时率 = 按期整改条数 /（按期 + 超期）</b>。' +
      '<b>未设期限</b>的条数单独成格：既不判逾期、也不判按期 —— 存量记录都没有这个字段，' +
      '硬判成任一边都是编数，所以顶栏那张「逾期未整改」在一条期限都没设时会直接写「尚未设置整改期限」。<br>' +
      '「隐患等级分布」按<b>条数</b>汇总：一张单可按部门拆成多行，<b>每行一个等级</b>、逐行计入，未填归「未定级」，' +
      '因此等级合计 = 隐患条数（页面只保留这一张等级图，原来巡检段那张重复的已删除）。<br>' +
      '<b>一单多部门（2026-11-12）</b>：表单里点「按部门拆分」即可在一张巡检单下按部门登记多条问题，' +
      '条数 / 等级 / 照片 / 整改 / 期限都按明细行归属，看板再按部门汇总 —— 所以「分部门隐患条数」' +
      '与「各部门隐患」能把同一张单拆到不同部门，而副标题里的「巡检记录 N 项」仍是单据数，不会被拆成多张。' +
      '老记录没有明细，自动视为<b>一行</b>，历史数字一个不变。' +
      '<b>巡检隐患不会自动生成隐患台账记录</b>，所以本页只讲巡检，不折算台账。</div>' +
      '<div style="margin-top:4px"><b>四、统计范围（年 / 月两档，2026-11-12 v1.3.9）</b>　' +
      '本页顶部可切<b>「按月」</b>（默认，进入即当月）与<b>「看年度」</b>：' +
      '<b>年档只统计当前自然年</b>（按巡检计划日期归年），跨年记录<b>不计入</b> KPI、隐患条数、整改三态、' +
      '整改期限、隐患照片、类型分布、等级分布、各部门条数与整改率、以及两张趋势图的任何一项；' +
      '趋势横轴就是本年度 1–12 月，不再滚动取近 12 个月。' +
      '<b>月档只统计所选自然月</b>（按计划日期归月），横轴为该月逐日；月份下拉列出<b>有数据的年月</b>，' +
      '可以回看往年 —— 回看是显式选择，不影响年档「只算当年」的口径。' +
      '往年记录也不会消失：到「安全巡检」列表用<b>年份下拉</b>即可查看，那是列表的视图过滤，不进看板。<br>' +
      '<b>月档的两个额外口径</b>：① <b>环比</b>对比「上一个自然月」，上月 0 条时不给百分比（除以 0 就是编数），' +
      '只写具体条数；整改率用「个百分点」不用相对变化。' +
      '② 趋势图的<b>已整改</b>线按<b>整改日期</b>归日、且含<b>跨月补完</b>（上月上报、本月改完的也画进来），' +
      '所以它可能大于本月「上报」；KPI 里的「已整改」仍是「本月上报且已整改」，两者不等属正常，' +
      '图例会单独标出补进来的条数。<b>逾期与最长逾期按「截至今天」判定</b>：看的是「该月上报的隐患到现在还剩多少没改」，' +
      '不是「该月月底快照」，因此回看往年月份时逾期条数可能大于当时，属正常。</div>' +
      '<div style="margin-top:4px">两条口径（照片<b>张数</b> / 隐患<b>条数</b>）在页面各段标题里已分别注明，不混算；' +
      '台账数字只保留上面一行快照。</div>'
    }));
  }

  return { name: '数据看板', sub: sub, render: render };
})();
