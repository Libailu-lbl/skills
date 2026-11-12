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

  /* ---------------- 全厂隐患趋势（★ 2026-11-11 补现算兜底）----------------
     以前看板「隐患趋势」直接吃 `data.trend`（后端 / 示例预聚合），
     可空白版没有任何东西会写这个集合 → 这张图**永远是空态**，看着像功能坏了。
     现在补一层现算：没有预聚合就按 hazards 自己算，与 deptTrend 同一口径。

     口径（必须与 deptTrend 对齐，否则「全厂」与「部门」两张图相加对不上）：
       · created = 当月 foundDate 的隐患数（**不排除作废**，与 deptTrend 一致）
       · closed  = 当月 closedAt 且 status==='closed' 的隐患数
       · 窗口固定近 12 个月（含本月）
       · **全 0 时返回 []**：让调用方继续渲染「暂无趋势数据」空态，
         不要把一条全 0 的折线画出来唬人。 */
  function hazardTrend(data, today) {
    today = today || U.today();
    var months = [];
    var thisYM = U.ym(today);
    for (var i = 11; i >= 0; i--) months.push(U.shiftYM(thisYM, -i));

    var rows = data && data.trend;
    if (rows && rows.length) return rows;      // 预聚合优先（兼容旧备份）

    var createdMap = {}, closedMap = {};
    ((data && data.hazards) || []).forEach(function (h) {
      if (h.foundDate) {
        var ym1 = U.ym(h.foundDate);
        if (months.indexOf(ym1) >= 0) createdMap[ym1] = (createdMap[ym1] || 0) + 1;
      }
      if (h.status === 'closed' && h.closedAt) {
        var ym2 = U.ym(h.closedAt);
        if (months.indexOf(ym2) >= 0) closedMap[ym2] = (closedMap[ym2] || 0) + 1;
      }
    });

    var sum = 0;
    var out = months.map(function (ym) {
      var c = createdMap[ym] || 0, k = closedMap[ym] || 0;
      sum += c + k;
      return { ym: ym, created: c, closed: k };
    });
    return sum ? out : [];                     // 全 0 → 空态（护栏，别画空折线）
  }

  /* ---------------- 巡检隐患照片（看板计数口径）----------------
     ★ 2026-11-10：巡检表单里「巡查照片」统一更名为「隐患照片」——
       它承载的就是巡检过程中发现的隐患现场证据。看板的「隐患计数」因此改为
       **按部门汇总巡检任务上传的隐患照片张数**，不再数隐患台账条数。

     口径（看板「口径说明」与此处必须同步，改一处就要改另一处）：
       · 统计对象：data.inspections[].photos 的**张数**。
         存储键仍是 photos（只是显示名改了），因此本功能上线前的老巡检记录
         不需要任何迁移，历史照片照常计数。
       · 部门归属：取巡检任务的 dept（责任部门）；空值统一归「未指定部门」，
         保证「各部门合计 === 总照片数」，账能对上，也提醒补填部门。
         ★ 2026-11-12：一条单可分多个部门，部门 / 类型改按「问题明细行」归属；
           老记录没有 problems，仍取顶层 dept / hazardType，结果与改造前完全一致。
       · 时间归属：按 scheduledDate（计划日期）分月，与巡检列表「归年」口径一致。
       · 不排除任何任务状态：照片一旦上传即为现场证据，任务后续改期 / 取消也照算。
         若按状态排除，用户会看到列表里明明有照片、看板却不计数，属对不上账。
       · 没上传照片的任务不进任何口径（既不计张数，也不计任务数）。
       · 隐患类型（★ 2026-11-10）：巡检表单新增 hazardType 字段，按「有照片的任务」分组，
         **一条任务记一次隐患**（不是按照片张数 —— 照片是证据，任务是事件）；
         没填类型的归「未分类」但仍计入，保证类型合计 = 有隐患照片的任务数。

     输出：{
       totalPhotos 总张数 · totalTasks 上报单元数（有照片的行；老记录=记录本身）
       totalRecords 有照片的记录数（★ 2026-11-12，多部门单据此区分「处」与「项任务」）
       byDept   [{dept, photos, tasks}] 按照片数降序
       byType   [{type, tasks, photos}] 按任务数降序（看板「隐患类型分布」用）
       trend    { months:[12], depts:[{dept, data:[12], total}] } 近 12 个月按部门
     } */
  var NO_DEPT = '未指定部门';
  var NO_TYPE = '未分类';
  var NO_LEVEL = '未定级';

  function photoCountOf(t) {
    return Object.prototype.toString.call(t && t.photos) === '[object Array]' ? t.photos.length : 0;
  }

  /* ---------------- 分部门问题明细（★ 2026-11-12）----------------
     一张巡检单可以登记多个部门各自的问题，存为 problems[]（**唯一真值**）：
       { id, dept, content, type, level, count, photos[], fixDate, fixPhotos[] }
     顶层 dept / hazardType / hazardCount / hazardLevel / photos / fixDate / fixPhotos
     降级为「兼容镜像」——保存时按行汇总写回，供列表角标、灯箱、打印、导出、报表、待办读取。
     聚合一律走本节函数：有 problems 就只读行，绝不与镜像重复累加。

     ★ 老记录（无 problems）视为「一行合成行」，所以所有统计值与改造前逐值相同。
       这是「升级不动历史数字」的结构保证，不是靠人工对账。 */
  function legacyCountOf(t) {
    if (!t) return 0;
    if (t.hazardCount != null && t.hazardCount !== '') return Math.max(0, Number(t.hazardCount) || 0);
    var r = t.record && t.record.hazardCount;
    return Math.max(0, Number(r) || 0);
  }

  function arrOf(v) {
    return Object.prototype.toString.call(v) === '[object Array]' ? v : [];
  }

  /** 行归一化：所有消费方看到的行形状必须一致（缺字段一律补默认值） */
  function normRow(r, i) {
    r = r || {};
    /* 未知等级键必须归成 ''，否则 LEVEL_ORDER 过滤后 Σ byLevel 会小于 hazardCount */
    var lv = LEVEL_ORDER.indexOf(r.level) >= 0 ? r.level : '';
    return {
      id: r.id || ('p' + (i + 1)),
      dept: String(r.dept || ''),
      content: String(r.content || ''),
      type: String(r.type || ''),
      level: lv,
      count: Math.max(0, Number(r.count) || 0),
      photos: arrOf(r.photos),
      fixDate: String(r.fixDate || ''),
      fixPhotos: arrOf(r.fixPhotos)
    };
  }

  /** 问题行（唯一取数口）：有 problems 用 problems，否则用顶层字段合成一行 */
  function problemRowsOf(t) {
    if (!t) return [];
    var list = arrOf(t.problems);
    if (list.length) return list.map(normRow);
    return [{
      id: 'legacy',
      dept: String(t.dept || ''),
      content: String((t.record && t.record.findings) || ''),
      type: String(t.hazardType || ''),
      level: LEVEL_ORDER.indexOf(t.hazardLevel) >= 0 ? t.hazardLevel : '',
      count: legacyCountOf(t),
      photos: arrOf(t.photos),
      fixDate: String(t.fixDate || ''),
      fixPhotos: arrOf(t.fixPhotos)
    }];
  }

  /** 整单隐患条数 = Σ 各行条数（老记录合成行 → 与旧实现逐值相同）
      历史背景：条数曾同时落在顶层与 record.hazardCount，读取一律走这里，
      任何地方都不要再直接读 t.hazardCount。 */
  function hazardCountOf(t) {
    return problemRowsOf(t).reduce(function (a, r) { return a + r.count; }, 0);
  }

  /** 单行整改状态：有整改日期=已整改；只有整改照片=整改中；都没有=未整改 */
  function rowFixStatusOf(r) {
    if (!r) return 'none';
    if (r.fixDate) return 'done';
    if (arrOf(r.fixPhotos).length) return 'doing';
    return 'none';
  }

  /** 整单整改状态：按「有条数的行」聚合 —— 全 done 才 done；有 none 则 none；否则 doing。
      纯照片行（条数 0）不参与判定，否则「没登记的隐患」会把整单拖成未整改。 */
  function fixStatusOf(t) {
    if (!t) return 'none';
    var rows = problemRowsOf(t).filter(function (r) { return r.count > 0; });
    if (!rows.length) {
      if (t.fixDate) return 'done';
      return arrOf(t.fixPhotos).length ? 'doing' : 'none';
    }
    var allDone = true, hasNone = false;
    rows.forEach(function (r) {
      var s = rowFixStatusOf(r);
      if (s !== 'done') allDone = false;
      if (s === 'none') hasNone = true;
    });
    return allDone ? 'done' : (hasNone ? 'none' : 'doing');
  }

  /** 整单隐患照片（逐行拼接；老记录即 t.photos）。列表角标 / 灯箱 / 打印用 */
  function problemPhotosOf(t) {
    var out = [];
    problemRowsOf(t).forEach(function (r) { out = out.concat(r.photos); });
    return out;
  }

  /** 照片「上报单元」：有 problems 时 = 有照片的行，老记录 = 记录本身。
      ← 「项 / 次」这个量的分母。按单元而不是按记录，才能让
        Σ byType.tasks === totalTasks 在多部门单上依然成立（否则图例说 2、中心说 1）。 */
  function photoUnitsOf(t) {
    var units = [];
    problemRowsOf(t).forEach(function (r) {
      if (!r.photos.length) return;
      units.push({ dept: r.dept || NO_DEPT, type: r.type || NO_TYPE, n: r.photos.length });
    });
    return units;
  }

  function inspectionPhotos(data, today) {
    today = today || U.today();
    var insp = (data && data.inspections) || [];

    var months = [];
    var thisYM = U.ym(today);
    for (var i = 11; i >= 0; i--) months.push(U.shiftYM(thisYM, -i));

    var totalPhotos = 0, totalTasks = 0, totalRecords = 0;
    var byDept = {};
    var trendMap = {};
    var byTypeMap = {};

    insp.forEach(function (t) {
      /* ★ 2026-11-12：按「上报单元」累加（多部门单 = 各行，老记录 = 记录本身）。
         注意与条数口径的过滤条件不同 —— 这里是 photos 为空才跳过，
         0 条但拍了照的行必须照常计张数（现场常见：拍了照忘了填条数）。 */
      var units = photoUnitsOf(t);
      if (!units.length) return;
      totalRecords += 1;

      var ym = t.scheduledDate ? U.ym(t.scheduledDate) : '';
      var inWin = !!ym && months.indexOf(ym) >= 0;

      units.forEach(function (u) {
        totalPhotos += u.n;
        totalTasks += 1;

        byDept[u.dept] = byDept[u.dept] || { dept: u.dept, photos: 0, tasks: 0 };
        byDept[u.dept].photos += u.n;
        byDept[u.dept].tasks += 1;

        byTypeMap[u.type] = byTypeMap[u.type] || { type: u.type, tasks: 0, photos: 0 };
        byTypeMap[u.type].tasks += 1;
        byTypeMap[u.type].photos += u.n;

        if (!inWin) return;
        trendMap[u.dept] = trendMap[u.dept] || {};
        trendMap[u.dept][ym] = (trendMap[u.dept][ym] || 0) + u.n;
      });
    });

    var list = Object.keys(byDept).map(function (k) { return byDept[k]; })
      .sort(function (a, b) { return b.photos - a.photos || b.tasks - a.tasks; });

    var typeList = Object.keys(byTypeMap).map(function (k) { return byTypeMap[k]; })
      .sort(function (a, b) { return b.tasks - a.tasks || b.photos - a.photos; });

    var depts = Object.keys(trendMap).map(function (dept) {
      var m = trendMap[dept];
      var series = months.map(function (ym) { return m[ym] || 0; });
      return { dept: dept, data: series, total: series.reduce(function (a, b) { return a + b; }, 0) };
    }).sort(function (a, b) { return b.total - a.total; });

    return {
      totalPhotos: totalPhotos,
      totalTasks: totalTasks,
      /* ★ 2026-11-12 新增：有照片的记录数。多部门单的 totalTasks 是「处」，
         与「任务」不是一回事 —— 看板据此在两者不等时补一句「共 N 项任务」 */
      totalRecords: totalRecords,
      byDept: list,
      byType: typeList,
      trend: { months: months, depts: depts }
    };
  }

  /* ---------------- 巡检任务 / 隐患条数 / 整改状态（★ 2026-11-11 新增）----------------
     ★ 为什么要有它：用户要求「巡检与看板统一数据来源与统计口径」。
       以前巡检页自己算完成率、看板自己算照片张数与类型次数，
       同一个月在两页看到的数字不是一回事。现在**巡检侧所有数字只从这里出**：
       巡检页顶部汇总条、看板「安全巡检」段都读 inspectionStats，数值必然一致。

     口径（与本文件外的口径说明段必须同步）：
       · records      = 全部巡检记录数（含改期 / 取消，不筛状态）
       · byStatus     = 四种任务状态各自条数
       · weekRate     = 复用 weekInspectionRate（本周已完成 / 本周计划，排除取消，改期不减免）
       · hazardCount  = Σ 各行 count ← **隐患条数的唯一口径**（人工填报，不是照片张数）
       · hazardTasks  = 条数 > 0 的**任务**数（"这 N 条来自几个巡检任务"）
                        ⚠ 记录级：一张单不论拆几个部门都只算 1 个任务
       · fix          = 整改三态，**按条数累计**（不是任务数），按行判定：
                        该行 fixDate 有 → done；只有 fixPhotos → doing；否则 none
       · fixTasks     = 整改三态按**记录**累计（整单闭环任务数，供对照，UI 未使用）
       · fixRate      = done / hazardCount（0 条时为 null，页面显示「—」）
                        —— 用条数做分母，才能和上面几个数字同量纲，不会出现
                           「隐患 5 条、已整改 4 条、整改率 50%」这种自相矛盾
       · byLevel      = 按行 level 分组，value = 该组 Σ count（空 → 未定级）
                        每一行的条数整体计入该行等级 → Σ byLevel === hazardCount
       · byDept       = 按行 dept 分组（空 → 未指定部门），给条数与涉及任务数
                        → Σ hazardCount === hazardCount；tasks 按 (记录,部门) 去重
       · **不按任务状态过滤**：照片/条数都是既成事实，任务改期或取消也照算
         （与 inspectionPhotos 同一态度，否则列表里有、看板没有，属对不上账）。
       · 无隐患任务（Σ 条数 = 0）不进隐患 / 整改口径，避免"没发现问题"被算成"未整改"。
     ------------------------------------------------------------------ */
  var LEVEL_ORDER = ['major', 'large', 'general'];

  function inspectionStats(data, today) {
    today = today || U.today();
    var insp = (data && data.inspections) || [];

    var byStatus = { planned: 0, done: 0, rescheduled: 0, cancelled: 0 };
    var hazardCount = 0, hazardTasks = 0;
    var fix = { none: 0, doing: 0, done: 0 };
    var fixTasks = { none: 0, doing: 0, done: 0 };
    var byLevelMap = {}, byDeptMap = {};

    insp.forEach(function (t) {
      if (byStatus[t.status] != null) byStatus[t.status]++;

      var rows = problemRowsOf(t);
      var n = 0;
      rows.forEach(function (r) { n += r.count; });
      if (!n) return;                       // 无隐患任务：不进隐患 / 整改口径

      hazardCount += n;
      hazardTasks += 1;                     // ★ 记录级，不能按行 ++

      fixTasks[fixStatusOf(t)] += 1;        // 整单闭环任务数

      var seenDept = {};
      rows.forEach(function (r) {
        if (!r.count) return;               // ★ 条数口径的过滤条件，与照片口径分开写
        fix[rowFixStatusOf(r)] += r.count;
        byLevelMap[r.level] = (byLevelMap[r.level] || 0) + r.count;

        var dept = r.dept || NO_DEPT;
        byDeptMap[dept] = byDeptMap[dept] || { dept: dept, hazardCount: 0, tasks: 0 };
        byDeptMap[dept].hazardCount += r.count;
        seenDept[dept] = 1;
      });
      /* 同一张单多个部门：每个部门各 +1 个任务，但同一部门在一张单里只算一次 */
      Object.keys(seenDept).forEach(function (d) { byDeptMap[d].tasks += 1; });
    });

    /* 等级固定顺序（重大→较大→一般→未定级），配色与台账等级图一致；
       只输出有条数的档位，但顺序不变 */
    var byLevel = LEVEL_ORDER.concat(['']).filter(function (k) {
      return byLevelMap[k] != null;
    }).map(function (k) {
      return { level: k || '', name: k ? levelName(k) : NO_LEVEL, count: byLevelMap[k] };
    });

    var byDept = Object.keys(byDeptMap).map(function (k) { return byDeptMap[k]; })
      .sort(function (a, b) { return b.hazardCount - a.hazardCount || b.tasks - a.tasks; });

    return {
      records: insp.length,
      byStatus: byStatus,
      weekRate: weekInspectionRate(insp, today),
      hazardCount: hazardCount,
      hazardTasks: hazardTasks,
      byLevel: byLevel,
      byDept: byDept,
      fix: fix,
      fixTasks: fixTasks,
      fixRate: hazardCount ? fix.done / hazardCount : null
    };
  }

  /** 等级 key → 中文（取字典，取不到给 key 本身，避免出现空白） */
  function levelName(k) {
    var dict = (window.SD && SD.dict && SD.dict.DICT && SD.dict.DICT.severity) || [];
    for (var i = 0; i < dict.length; i++) if (dict[i].v === k) return dict[i].n;
    return k;
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
      violations: (data.violations || []).slice(),   /* 安全违章考核单（2026-11-04） */
      keyWorks: (data.keyWorks || []).slice(),       /* 安全重要工作看板（★ 2026-11-10） */
      deptRates: deptRates(live),
      deptTrend: deptTrend(data, today),
      /* ★ 2026-11-10：看板隐患计数的新口径 —— 巡检任务上传的隐患照片，按部门汇总 */
      inspectionPhotos: inspectionPhotos(data, today),
      /* ★ 2026-11-11：巡检侧统一口径（记录 / 隐患条数 / 整改三态）。
         巡检页与看板都只读这一份，保证两页数字一致。 */
      inspectionStats: inspectionStats(data, today),
      typeDist: typeDist(live),
      trend: hazardTrend(data, today),

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
    inspectionPhotos: inspectionPhotos,
    inspectionStats: inspectionStats,
    hazardTrend: hazardTrend,
    hazardCountOf: hazardCountOf,
    /* ★ 2026-11-12 分部门明细：视图侧唯一取数口。任何地方都不要再直接读 t.problems */
    hazardRowsOf: problemRowsOf,
    problemPhotosOf: problemPhotosOf,
    rowFixStatusOf: rowFixStatusOf,
    fixStatusOf: fixStatusOf,
    NO_DEPT: NO_DEPT,
    NO_LEVEL: NO_LEVEL,
    typeDist: typeDist,
    severityDist: severityDist,
    summarize: summarize
  };
})();
