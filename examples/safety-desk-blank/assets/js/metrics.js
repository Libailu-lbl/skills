/* =========================================================
   metrics.js — 计算层：所有口径集中在这里
   ────────────────────────────────────────────────────────
   本文件是纯函数层：只吃数据、吐结果，不碰 DOM、不发请求。
   口径一旦要改，只改这一个文件，界面全站跟着变。

   已锁定的口径（与需求确认一致）：
   1. 逾期     = 原始/当前整改期限 < 今天，且状态不在 {已闭环, 已延期}
                （走完审批的延期不重复计逾期，改期限洗不掉逾期，因为
                  originalDueDate 永不改写，只推 dueDate）
   2. 临期     = 剩余天数 ≤ soonDays（默认 3 天）
   3. 未整改   = 状态 ≠ 已闭环（含 待整改/整改中/待验收/已延期）
   4. 今日待办 = 逾期隐患 + 今日到期隐患 + 今日应执行巡检 + 待我验收隐患；
                昨日未完成的自动顺延（因为逾期项天然留在列表里）
   5. 本周巡检完成率 = 本周已完成 / 本周计划数（排除已取消）；
                已改期任务仍留在分母，未完成即算缺口（改期不减免）
   6. 综合排序 = 逾期 > 临期 > 正常 > 已延期，其次 等级(红>橙>黄)，
                其次 截止近的优先，同分按登记早的优先
   7. 证书预警 = 已过期(红) / ≤30天(橙) / ≤90天(黄) / 正常，阈值可配
   8. 本周起算 = 周一
   ========================================================= */
window.SD = window.SD || {};

SD.metrics = (function () {
  var U = SD.utils;

  var SEV_RANK = { major: 0, large: 1, general: 2 };       // 红 > 橙 > 黄
  var OPEN_STATUS = { pending: 1, fixing: 1, verifying: 1, delayed: 1 }; // 未闭环
  var VOID = 'void';   // 已作废：台账留痕，但不计入任何在办口径

  /* ---------------- 单条隐患的派生量 ---------------- */

  /** 剩余天数：负数=已超期；null=日期非法 */
  function daysLeft(h, today) {
    return U.diffDays(h.dueDate || h.originalDueDate, today || U.today());
  }

  /** 是否逾期（口径 1） */
  function isOverdue(h, today) {
    if (h.status === 'closed' || h.status === 'delayed' || h.status === VOID) return false;
    var d = daysLeft(h, today);
    return d !== null && d < 0;
  }

  /** 逾期天数（未逾期返回 0） */
  function overdueDays(h, today) {
    if (!isOverdue(h, today)) return 0;
    return -daysLeft(h, today);
  }

  /** 是否临期（口径 2） */
  function isSoon(h, today) {
    if (h.status === 'closed' || h.status === 'delayed' || h.status === VOID) return false;
    if (isOverdue(h, today)) return false;
    var d = daysLeft(h, today);
    var soon = SD.CONFIG.thresholds.soonDays;
    return d !== null && d >= 0 && d <= soon;
  }

  /** 是否进入「延期跟进」：状态已延期，或历史上申请过延期 */
  function isDelayedTrack(h) {
    return h.status === 'delayed' || (h.delayCount || 0) > 0;
  }

  /** 是否未闭环（口径 3） */
  function isOpen(h) { return !!OPEN_STATUS[h.status]; }

  /**
   * 综合优先级排序键（口径 6）
   * @returns {[bucket, severity, dueDate, foundDate]} 依次比较
   */
  function priorityKey(h, today) {
    var bucket;
    if (isOverdue(h, today)) bucket = 0;
    else if (isSoon(h, today)) bucket = 1;
    else if (h.status === VOID) bucket = 8;      // 作废的沉到最后，但不消失
    else if (h.status === 'closed') bucket = 9;
    else if (h.status === 'delayed') bucket = 3;
    else bucket = 2;

    var sev = SEV_RANK[h.severity];
    if (sev == null) sev = 3;

    // 日期用字符串比较即可（ISO 格式字典序 = 时间序）
    return [bucket, sev, (h.dueDate || '9999-12-31'), (h.foundDate || '9999-12-31')];
  }

  /** 按综合优先级排序，返回新数组（不改原数组） */
  function sortByPriority(arr, today) {
    return U.sortBy(arr, function (a, b) {
      var ka = priorityKey(a, today), kb = priorityKey(b, today);
      for (var i = 0; i < ka.length; i++) {
        if (ka[i] < kb[i]) return -1;
        if (ka[i] > kb[i]) return 1;
      }
      return 0;
    });
  }

  /** 给隐患挂上派生字段（下划线前缀表示「计算出来的，不是接口字段」） */
  function enrichHazard(h, today) {
    var x = Object.assign({}, h);
    x._daysLeft = daysLeft(x, today);
    x._overdue = isOverdue(x, today);
    x._overdueDays = overdueDays(x, today);
    x._soon = isSoon(x, today);
    x._delayedTrack = isDelayedTrack(x);
    x._open = isOpen(x);
    x._sevName = SD.dict.nameOf(SD.dict.DICT.severity, x.severity);
    x._sevCls = (SD.dict.itemOf(SD.dict.DICT.severity, x.severity) || {}).cls || '';
    x._stName = SD.dict.nameOf(SD.dict.DICT.hazardStatus, x.status);
    x._statutoryName = SD.dict.nameOf(SD.dict.DICT.statutoryLevel, x.statutoryLevel);
    return x;
  }

  /* ---------------- 证书 ---------------- */
  function certDaysLeft(c, today) { return U.diffDays(c.validTo, today || U.today()); }

  /** 证书预警档位（口径 7）：expired / warn / notice / ok */
  function certLevel(c, today) {
    var d = certDaysLeft(c, today);
    if (d === null) return 'unknown';
    var t = SD.CONFIG.thresholds;
    if (d < 0) return 'expired';
    if (d <= t.certWarnDays) return 'warn';
    if (d <= t.certNoticeDays) return 'notice';
    return 'ok';
  }
  var CERT_META = {
    expired: { n: '已过期', cls: 'b-danger', rank: 0 },
    warn:    { n: '即将到期', cls: 'b-warn',  rank: 1 },
    notice:  { n: '需关注',  cls: 'lv-general', rank: 2 },
    ok:      { n: '正常',    cls: 'b-ok',     rank: 3 },
    unknown: { n: '—',       cls: 'b-mute',   rank: 4 }
  };
  function enrichCert(c, today) {
    var x = Object.assign({}, c);
    x._daysLeft = certDaysLeft(x, today);
    x._level = certLevel(x, today);
    x._levelName = (CERT_META[x._level] || CERT_META.unknown).n;
    x._levelCls = (CERT_META[x._level] || CERT_META.unknown).cls;
    return x;
  }

  /* ---------------- 巡检 ---------------- */
  /**
   * 本周巡检完成率（口径 5）
   * 分母 = 本周计划任务（排除已取消）；已改期不减免，未完成即算缺口
   */
  function weekInspectionRate(inspections, today) {
    today = today || U.today();
    var ws = U.startOfWeek(today), we = U.endOfWeek(today);
    var inWeek = (inspections || []).filter(function (t) {
      var d = t.scheduledDate;
      return d && d >= ws && d <= we && t.status !== 'cancelled';
    });
    var done = inWeek.filter(function (t) { return t.status === 'done'; }).length;
    var total = inWeek.length;
    return {
      weekStart: ws, weekEnd: we,
      total: total,
      done: done,
      rate: total ? done / total : null,     // 无计划任务时返回 null（界面显示「—」）
      rescheduled: inWeek.filter(function (t) { return t.status === 'rescheduled'; }).length,
      cancelled: (inspections || []).filter(function (t) {
        return t.scheduledDate >= ws && t.scheduledDate <= we && t.status === 'cancelled';
      }).length
    };
  }

  /** 今日应执行的巡检（口径 4 的一部分） */
  function todayInspections(inspections, today) {
    today = today || U.today();
    return (inspections || []).filter(function (t) {
      return t.scheduledDate === today && t.status === 'planned';
    });
  }

  /* ---------------- 待办聚合（口径 4） ---------------- */
  /**
   * 待办 = 四类单据的**全部未完成项**（2026-10-24 起扩容，此前只有
   * 「逾期 / 今日到期 / 待验收隐患 + 今日巡检」）：
   *   · 隐患管理：未闭环的全部（已闭环 / 已作废不进待办）
   *   · 安全巡检：未完成的全部（待执行 + 已改期；今日执行的排最前）
   *   · 危险作业票：未完工的全部（草稿 / 待审批 / 已批准 / 作业中）
   *   · 安全培训：未完成的全部（未开始 / 进行中）
   * 每条都可一键处理：隐患按状态机推进、巡检直接完成、
   * 作业票按状态机推进（批准时自动写审批人）、培训标记完成。
   * 返回统一形状的条目，供待办区直接渲染。
   */
  function buildTodos(data, today) {
    today = today || U.today();
    var hz = (data.hazards || []).map(function (h) { return enrichHazard(h, today); });
    var items = [];

    hz.forEach(function (h) {
      if (h.status === 'closed' || h.status === 'void') return;   // 已闭环 / 已作废：不是待办
      var kind, why;
      // 先判「待验收」：整改已提交、等你复核是安全员的核心动作，
      // 即使它同时已逾期，也要以「待你复核」的姿态出现（逾期情况写进 why）
      if (h.status === 'verifying') {
        kind = 'hazard-verify';
        why = '整改已提交，待你现场复核' + (h._overdue ? '（已逾期 ' + h._overdueDays + ' 天）' : '');
      } else if (h._overdue) {
        kind = 'hazard-overdue';
        why = '已逾期 ' + h._overdueDays + ' 天（原始期限 ' + (h.originalDueDate || h.dueDate) + '）';
      } else if (h._daysLeft === 0 && h._open && h.status !== 'delayed') {
        kind = 'hazard-due';
        why = '今天到期';
      } else if (h.status === 'delayed') {
        kind = 'hazard-open';
        why = '已批准延期至 ' + h.dueDate + '，持续跟进';
      } else {
        kind = 'hazard-open';
        why = h._daysLeft > 0 ? ('距整改期限 ' + h._daysLeft + ' 天') : '整改中';
      }
      items.push({
        kind: kind, ref: h, severity: h.severity,
        title: h.title, code: h.code, dept: h.dept, owner: h.owner,
        dueDate: h.dueDate, why: why
      });
    });

    (data.inspections || []).forEach(function (t) {
      if (t.status !== 'planned' && t.status !== 'rescheduled') return;
      var why;
      if (t.scheduledDate === today) why = '今日巡检 · ' + t.area;
      else if (t.status === 'rescheduled') why = '已改期至 ' + (t.rescheduleTo || t.scheduledDate) + ' · ' + t.area;
      else why = '计划 ' + t.scheduledDate + ' 执行 · ' + t.area;
      items.push({
        kind: 'inspection', ref: t, severity: 'general',
        title: t.planName, code: t.code, dept: t.dept, owner: t.executor,
        dueDate: t.scheduledDate, why: why,
        statusName: SD.dict.nameOf(SD.dict.DICT.inspectStatus, t.status),
        statusCls: { planned: 'b-info', done: 'b-ok', rescheduled: 'b-warn', cancelled: 'b-mute' }[t.status] || 'b-mute'
      });
    });

    (data.workPermits || []).forEach(function (p) {
      if (p.status !== 'draft' && p.status !== 'pending' && p.status !== 'approved' && p.status !== 'working') return;
      var pm = SD.dict.itemOf(SD.dict.DICT.permitStatus, p.status) || {};
      items.push({
        kind: 'permit', ref: p, severity: 'general',
        title: p.type + '作业票', code: p.code, dept: p.dept, owner: p.leader,
        dueDate: p.planEnd,
        why: (pm.n || p.status) + ' · ' +
             p.planStart + (p.planEnd && p.planEnd !== p.planStart ? ' ~ ' + p.planEnd : '') +
             ' · ' + p.location,
        statusName: pm.n || p.status, statusCls: pm.cls || 'b-mute'
      });
    });

    (data.trainings || []).forEach(function (t) {
      if (t.status !== 'planned' && t.status !== 'ongoing') return;
      items.push({
        kind: 'training', ref: t, severity: 'general',
        title: t.name, code: t.code, dept: '', owner: t.trainer,
        dueDate: t.endDate,
        why: (t.status === 'ongoing' ? '进行中' : '未开始') + ' · ' +
             t.startDate + (t.endDate && t.endDate !== t.startDate ? ' ~ ' + t.endDate : ''),
        statusName: t.status === 'ongoing' ? '进行中' : '未开始',
        statusCls: t.status === 'ongoing' ? 'b-warn' : 'b-info'
      });
    });

    // 排序：先按类别（逾期 > 今日到期 > 待验收 > 巡检 > 作业票 > 培训 > 其它隐患），
    // 同类隐患看等级，其余看期限近远
    var KIND_RANK = {
      'hazard-overdue': 0, 'hazard-due': 1, 'hazard-verify': 2,
      'inspection': 3, 'permit': 4, 'training': 5, 'hazard-open': 6
    };
    items = U.sortBy(items, function (a, b) {
      var ra = KIND_RANK[a.kind], rb = KIND_RANK[b.kind];
      if (ra !== rb) return ra - rb;
      if (a.kind.indexOf('hazard') === 0) {
        var sa = SEV_RANK[a.severity], sb = SEV_RANK[b.severity];
        if ((sa == null ? 3 : sa) !== (sb == null ? 3 : sb)) return (sa == null ? 3 : sa) - (sb == null ? 3 : sb);
      }
      return String(a.dueDate || '').localeCompare(String(b.dueDate || ''));
    });

    return items;
  }

  /* ---------------- 各部门隐患趋势（看板） ----------------
     与全厂 trend 同一窗口（近 12 个月，本月收尾）。
     数据来源两级：
       ① data.deptTrend —— 后端 / 示例预聚合的 [{dept, ym, count}]（优先）
       ② 没有预聚合时，从 hazards.foundDate 现算（真实链路兜底）
     输出：{ months:['YYYY-MM'...], depts:[{dept, data:[12], total}] }，部门按总量降序。 */
  function deptTrend(data, today) {
    today = today || U.today();
    var months = [];
    var thisYM = U.ym(today);
    for (var i = 11; i >= 0; i--) months.push(U.shiftYM(thisYM, -i));

    var byDept = {};
    var rows = data && data.deptTrend;
    if (rows && rows.length) {
      rows.forEach(function (r) {
        var dept = r.dept || '未指定';
        var ym = U.ym(r.ym);
        if (months.indexOf(ym) < 0) return;      // 窗口外的月份不进图
        byDept[dept] = byDept[dept] || {};
        byDept[dept][ym] = (byDept[dept][ym] || 0) + (Number(r.count) || 0);
      });
    } else {
      ((data && data.hazards) || []).forEach(function (h) {
        if (!h.foundDate) return;
        var dept = h.dept || '未指定';
        var ym = U.ym(h.foundDate);
        if (months.indexOf(ym) < 0) return;
        byDept[dept] = byDept[dept] || {};
        byDept[dept][ym] = (byDept[dept][ym] || 0) + 1;
      });
    }

    var depts = Object.keys(byDept).map(function (dept) {
      var m = byDept[dept];
      var series = months.map(function (ym) { return m[ym] || 0; });
      return {
        dept: dept,
        data: series,
        total: series.reduce(function (a, b) { return a + b; }, 0)
      };
    }).sort(function (a, b) { return b.total - a.total; });

    return { months: months, depts: depts };
  }

  /* ---------------- 看板聚合 ---------------- */
  /** 各部门整改率 = 已闭环 / 该部门隐患总数 */
  function deptRates(hazards) {    var g = U.groupBy(hazards || [], function (h) { return h.dept || '未指定'; });
    return Object.keys(g).map(function (dept) {
      var list = g[dept];
      var closed = list.filter(function (h) { return h.status === 'closed'; }).length;
      return { dept: dept, total: list.length, closed: closed, rate: list.length ? closed / list.length : null };
    }).sort(function (a, b) {
      // 整改率低的排前面（更值得盯），率相同则总量大的在前
      var ra = a.rate == null ? 1 : a.rate, rb = b.rate == null ? 1 : b.rate;
      if (ra !== rb) return ra - rb;
      return b.total - a.total;
    });
  }

  /** 隐患类型分布（按条数降序） */
  function typeDist(hazards) {
    var g = U.groupBy(hazards || [], function (h) { return h.type || '其他'; });
    return Object.keys(g).map(function (k) {
      return { type: k, count: g[k].length };
    }).sort(function (a, b) { return b.count - a.count; });
  }

  /** 等级分布（红/橙/黄） */
  function severityDist(hazards) {
    var out = { major: 0, large: 0, general: 0 };
    (hazards || []).forEach(function (h) { if (out[h.severity] != null) out[h.severity]++; });
    return out;
  }

  /* ---------------- 状态机：允许的流转 ----------------
     主链：待整改 → 整改中 → 待验收 → 已闭环
     旁挂：已延期（任何在途状态都可申请延期，批准后可回到整改中）
     打回：待验收可退回整改中（验收不通过） */
  var TRANSITIONS = {
    pending:   ['fixing', 'delayed'],
    fixing:    ['verifying', 'delayed'],
    verifying: ['closed', 'fixing'],
    delayed:   ['fixing', 'closed'],
    closed:    [],
    void:      []          // 已作废是终态，如需恢复须重新登记
  };

  /** 某状态下可流转到的下一批状态 */
  function nextOptions(status) { return TRANSITIONS[status] || []; }

  /** 一键「标记完成」时的默认下一步（取主链上的首选） */
  function nextStatus(status) {
    var o = nextOptions(status);
    return o.length ? o[0] : null;
  }

  /* ---------------- 特种作业 ---------------- */
  /** 人员资质派生：剩余天数 + 预警档位（复用证书口径）+ 状态显示名 */
  function enrichSpecialPerson(p, today) {
    var x = Object.assign({}, p);
    x._daysLeft = certDaysLeft(x, today);
    x._level = certLevel(x, today);
    var sm = SD.dict.itemOf(SD.dict.DICT.specialStatus, x.status);
    x._statusName = sm ? sm.n : x.status;
    x._statusCls = sm ? sm.cls : 'b-mute';
    return x;
  }
  /** 特种设备人员（2026-10-24）：证书状态按 validTo **实时**算 ——
      老快照里存的是当时的 status，日期一走就过期了，这里实时纠正（停用的不动）。 */
  function enrichDevicePerson(p, today) {
    var x = Object.assign({}, p);
    x._daysLeft = certDaysLeft(x, today);
    x._level = certLevel(x, today);
    var d = x._daysLeft;
    if (d != null && x.status !== 'suspended') {
      var notice = (SD.CONFIG.thresholds && SD.CONFIG.thresholds.certNoticeDays) || 90;
      x.status = d < 0 ? 'expired' : (d <= notice ? 'pending_review' : 'valid');
    }
    var sm = SD.dict.itemOf(SD.dict.DICT.specialStatus, x.status);
    x._statusName = sm ? sm.n : x.status;
    x._statusCls = sm ? sm.cls : 'b-mute';
    return x;
  }

  /** 作业票派生：状态显示名 */
  function enrichPermit(p, today) {
    var x = Object.assign({}, p);
    var pm = SD.dict.itemOf(SD.dict.DICT.permitStatus, x.status);
    x._statusName = pm ? pm.n : x.status;
    x._statusCls = pm ? pm.cls : 'b-mute';
    return x;
  }

  /* ---------------- 总入口：一次算完，界面只读结果 ---------------- */
  function summarize(data, today) {
    today = today || U.today();
    data = data || {};
    var hazards = (data.hazards || []).map(function (h) { return enrichHazard(h, today); });
    var certs = (data.certificates || []).map(function (c) { return enrichCert(c, today); });
    var insp = data.inspections || [];

    var openList = hazards.filter(function (h) { return h._open; });
    var overdueList = hazards.filter(function (h) { return h._overdue; });
    var soonList = hazards.filter(function (h) { return h._soon; });
    var delayedList = hazards.filter(function (h) { return h._delayedTrack; });
    var verifyList = hazards.filter(function (h) { return h.status === 'verifying'; });

    // 看板与统计口径：作废的不参与。登记有误的条目不该拉低整改率，
    // 也不该出现在类型分布里；但它仍留在台账（列表）中可查 —— 这是留痕要求。
    var live = hazards.filter(function (h) { return h.status !== VOID; });

    var certSum = { expired: 0, warn: 0, notice: 0, ok: 0 };
    /* 特种设备人员：状态按 validTo 实时算，汇总与列表必须用同一份结果，
       否则种子数据（没有 status 字段）会统计成 0 */
    var deviceList = (data.devicePersonnel || []).map(function (p) { return enrichDevicePerson(p, today); });
    certs.forEach(function (c) { if (certSum[c._level] != null) certSum[c._level]++; });

    return {
      today: today,
      weekStart: U.startOfWeek(today),
      weekEnd: U.endOfWeek(today),

      hazards: sortByPriority(hazards, today),
      openCount: openList.length,
      overdueCount: overdueList.length,
      soonCount: soonList.length,
      delayedCount: delayedList.length,
      verifyCount: verifyList.length,
      closedCount: live.filter(function (h) { return h.status === 'closed'; }).length,
      totalHazards: live.length,
      voidCount: hazards.length - live.length,
      severityDist: severityDist(live),

      todos: buildTodos(data, today),

      inspections: insp,
      inspectionWeek: weekInspectionRate(insp, today),
      todayInspections: todayInspections(insp, today),

      trainings: data.trainings || [],
      certificates: certs,
      certSummary: certSum,

      notices: data.notices || [],
      deptRates: deptRates(live),
      deptTrend: deptTrend(data, today),
      typeDist: typeDist(live),
      trend: data.trend || [],

      /* 特种作业：派生 + 聚合 */
      specialPersonnel: (data.specialPersonnel || []).map(function (p) { return enrichSpecialPerson(p, today); }),
      devicePersonnel: deviceList,
      shiftLogs: (data.shiftLogs || []).slice(),
      workPermits: (data.workPermits || []).map(function (p) { return enrichPermit(p, today); }),
      specialPersonnelSummary: (function () {
        var arr = data.specialPersonnel || [];
        var s = { total: arr.length, valid: 0, pending_review: 0, expired: 0, suspended: 0 };
        arr.forEach(function (p) { if (s[p.status] != null) s[p.status]++; });
        return s;
      })(),
      /* 特种设备人员（2026-10-24）：证书同样只有「有效期止」，复用同一套派生与聚合口径 */
      devicePersonnelSummary: (function () {
        var s = { total: deviceList.length, valid: 0, pending_review: 0, expired: 0, suspended: 0 };
        deviceList.forEach(function (p) { if (s[p.status] != null) s[p.status]++; });
        return s;
      })(),
      permitSummary: (function () {
        var arr = data.workPermits || [];
        var s = { total: arr.length, draft: 0, pending: 0, approved: 0, working: 0, done: 0, void: 0 };
        arr.forEach(function (p) { if (s[p.status] != null) s[p.status]++; });
        return s;
      })()
    };
  }

  return {
    daysLeft: daysLeft,
    isOverdue: isOverdue,
    overdueDays: overdueDays,
    isSoon: isSoon,
    isDelayedTrack: isDelayedTrack,
    isOpen: isOpen,
    priorityKey: priorityKey,
    sortByPriority: sortByPriority,
    TRANSITIONS: TRANSITIONS,
    nextOptions: nextOptions,
    nextStatus: nextStatus,
    enrichHazard: enrichHazard,
    certDaysLeft: certDaysLeft,
    certLevel: certLevel,
    CERT_META: CERT_META,
    enrichCert: enrichCert,
    weekInspectionRate: weekInspectionRate,
    todayInspections: todayInspections,
    buildTodos: buildTodos,
    deptRates: deptRates,
    deptTrend: deptTrend,
    typeDist: typeDist,
    severityDist: severityDist,
    summarize: summarize
  };
})();
