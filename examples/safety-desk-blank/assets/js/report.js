/* =========================================================
   report.js — 日报 / 周报 聚合计算（纯函数，与界面解耦）
   ────────────────────────────────────────────────────────
   · 输入：整份数据（SD.store 里的 data）+ 参考日期 date
   · 输出：结构化聚合对象，供「日报 / 周报」视图渲染与导出 Excel 复用
   · 口径：
       - 隐患：foundDate 登记、closedAt 闭环；未闭环 / 逾期按「截至期末」口径
       - 巡检：scheduledDate 排期、completedAt 完成；完成率 = 完成 / 计划（排除已取消）
       - 培训：起止区间 [startDate, endDate] 覆盖参考日即计为「当日/本周开展」
       - 危险作业：planStart 近似开票日；approvedAt 取日期部分；作业中按区间覆盖
       - 资质预警：validTo 距期末 ≤ 30 天的特种作业人员（已过期一并计入）
   · 2026-10-21：通知公告、资质预警两节**只留在页面预览**，导出的 Excel 只出前四节；
     保留内容的表述一并精简（note 与明细标题只留要点，去修饰与重复）。
   ========================================================= */
window.SD = window.SD || {};
var SD = window.SD;

SD.report = (function () {
  var U = SD.utils;

  function inRange(d, ws, we) { return d && d >= ws && d <= we; }
  function dayOf(dt) { return (dt || '').slice(0, 10); }

  /** 核心：按 [ws, we] 区间 + 期末 asOf 日聚合 */
  function period(data, ws, we, asOf) {
    data = data || {};
    asOf = asOf || we;

    var hazards = data.hazards || [];
    var inspections = data.inspections || [];
    var trainings = data.trainings || [];
    var permits = data.workPermits || [];
    var notices = data.notices || [];
    var special = data.specialPersonnel || [];

    /* ---------- 隐患 ---------- */
    var hzCreated = hazards.filter(function (h) { return inRange(h.foundDate, ws, we); });
    var hzClosed = hazards.filter(function (h) { return inRange(h.closedAt, ws, we); });
    var hzOpen = hazards.filter(function (h) {
      if (h.status === 'closed' || h.status === 'void') return false;
      if (!(h.foundDate <= asOf)) return false;
      if (h.closedAt && h.closedAt <= asOf) return false;   // 期末前已闭环的不算在途
      return true;
    });
    var hzOverdue = hzOpen.filter(function (h) {
      var due = h.dueDate || h.originalDueDate;
      return due && U.diffDays(due, asOf) < 0;
    });
    /* 待我验收：整改完成等确认，是安全员最需要当天处理的一类（2026-10-24 加） */
    var hzVerify = hzOpen.filter(function (h) { return h.status === 'verifying'; });

    /* ---------- 巡检 ---------- */
    var inspPlanned = inspections.filter(function (t) { return inRange(t.scheduledDate, ws, we) && t.status !== 'cancelled'; });
    var inspDone = inspections.filter(function (t) { return inRange(t.completedAt, ws, we) && t.status === 'done'; });
    var inspRate = inspPlanned.length ? (inspDone.length / inspPlanned.length) : null;
    var inspRescheduled = inspections.filter(function (t) { return inRange(t.scheduledDate, ws, we) && t.status === 'rescheduled'; }).length;
    var inspCancelled = inspections.filter(function (t) { return inRange(t.scheduledDate, ws, we) && t.status === 'cancelled'; }).length;

    /* ---------- 培训 ---------- */
    var trActive = trainings.filter(function (t) { return (t.startDate || '') <= we && (t.endDate || '') >= ws; });
    var trParticipants = trActive.reduce(function (a, t) { return a + (Number(t.actual) || 0); }, 0);

    /* ---------- 危险作业票 ---------- */
    var wpIssued = permits.filter(function (p) { return inRange(p.planStart, ws, we); });
    var wpApproved = permits.filter(function (p) { var d = dayOf(p.approvedAt); return inRange(d, ws, we); });
    var wpWorking = permits.filter(function (p) {
      return p.status === 'working' && (p.planStart || '') <= asOf && (p.planEnd || asOf) >= asOf;
    });
    var wpDone = permits.filter(function (p) { return p.status === 'done' && inRange(p.planStart, ws, we); });

    /* ---------- 通知公告 ---------- */
    var ntToday = notices.filter(function (n) { return inRange(n.publishAt, ws, we); });

    /* ---------- 待办事项（与「待办任务」页同一口径：隐患 / 巡检 / 作业票 / 培训） ---------- */
    var todos = (SD.metrics && SD.metrics.buildTodos) ? (SD.metrics.buildTodos(data, asOf) || []) : [];
    var todoBy = { hazard: 0, inspection: 0, permit: 0, training: 0 };
    todos.forEach(function (t) {
      var k = String(t.kind || '');
      var key = k.indexOf('hazard') === 0 ? 'hazard' : k;     // hazard-overdue / -due / -verify / -open 归为隐患
      if (todoBy[key] != null) todoBy[key]++;
    });

    /* ---------- 人员资质预警：特种作业人员 + 特种设备人员（30 天内到期 / 已过期） ---------- */
    var device = data.devicePersonnel || [];
    function daysLeft(v) { return U.diffDays(v, asOf); }
    function inWarn(v) { var d = daysLeft(v); return d != null && d <= 30; }

    var certWarnSpecial = special.filter(function (p) { return inWarn(p.validTo); }).map(function (p) {
      return {
        source: '特种作业', name: p.name, dept: p.dept, category: p.category,
        operation: p.operation, validTo: p.validTo, days: daysLeft(p.validTo), status: p.status
      };
    });
    var certWarnDevice = device.filter(function (p) { return inWarn(p.validTo); }).map(function (p) {
      return {
        source: '特种设备', name: p.name, dept: p.dept, category: p.post || '—',
        operation: (p.certType || 'N1') + (p.note ? '（' + p.note + '）' : ''),
        validTo: p.validTo, days: daysLeft(p.validTo), status: p.status
      };
    });
    var certWarn = certWarnSpecial.concat(certWarnDevice)
      .sort(function (a, b) { return a.days - b.days; });

    return {
      ws: ws, we: we, asOf: asOf,
      hazards: {
        created: hzCreated, closed: hzClosed, openCount: hzOpen.length, overdueCount: hzOverdue.length,
        createdN: hzCreated.length, closedN: hzClosed.length
      },
      inspections: {
        planned: inspPlanned, done: inspDone, plannedN: inspPlanned.length, doneN: inspDone.length,
        rate: inspRate, rescheduledN: inspRescheduled, cancelledN: inspCancelled
      },
      trainings: { active: trActive, activeN: trActive.length, participants: trParticipants },
      permits: { issued: wpIssued, approved: wpApproved, working: wpWorking, done: wpDone,
        issuedN: wpIssued.length, approvedN: wpApproved.length, workingN: wpWorking.length, doneN: wpDone.length },
      notices: { today: ntToday, n: ntToday.length },
      todos: { all: todos, by: todoBy, n: todos.length },
      verifyCount: hzVerify.length,
      certWarn: certWarn, certWarnN: certWarn.length,
      certWarnSpecialN: certWarnSpecial.length, certWarnDeviceN: certWarnDevice.length
    };
  }

  /** 日报：以 date 为当日（默认今天） */
  function daily(data, date) {
    date = date || U.today();
    var r = period(data, date, date, date);
    r.type = 'daily';
    r.date = date;
    r.weekday = U.weekdayCN(date);
    return r;
  }

  /** 周报：以含 date 的周一~周日为周期（默认本周） */
  function weekly(data, date) {
    date = date || U.today();
    var r = period(data, U.startOfWeek(date), U.endOfWeek(date), U.endOfWeek(date));
    r.type = 'weekly';
    r.date = date;
    return r;
  }

  /* ---------- 展示名 ---------- */
  function nm(list, v) { return SD.dict.nameOf(list, v); }
  function sevName(v) { return nm(SD.dict.DICT.severity, v); }
  function hzSt(v) { return nm(SD.dict.DICT.hazardStatus, v); }
  function inspSt(v) { return nm(SD.dict.DICT.inspectStatus, v); }
  function trainSt(v) { return nm(SD.dict.DICT.trainStatus, v); }
  function wpSt(v) { return nm(SD.dict.DICT.permitStatus, v); }
  function ntLv(v) { return nm(SD.dict.DICT.noticeLevel, v); }

  function codes(list) {
    return list && list.length ? list.map(function (x) { return x.code; }).join('、') : '—';
  }

  /* ---------- 行映射 ---------- */
  function hzRow(h) { return [h.code, sevName(h.severity), h.dept, h.owner, (h.dueDate || h.originalDueDate || '—'), hzSt(h.status)]; }
  function inspRow(t) { return [t.code, t.planName, t.area, t.executor, inspSt(t.status), (t.completedAt || '—')]; }
  function trainRow(t) { return [t.code, t.name, t.type, t.trainer, ((Number(t.actual) || 0) + '/' + (Number(t.required) || 0)), trainSt(t.status)]; }
  function wpRow(p) { return [p.code, p.type, p.location, p.leader, p.guardian, wpSt(p.status)]; }
  function ntRow(n) { return [n.code, n.title, n.source, ntLv(n.level)]; }
  function certRow(p) {
    var left = p.days < 0 ? ('已过期 ' + (-p.days) + ' 天') : ('剩 ' + p.days + ' 天');
    return [p.source || '特种作业', p.name, p.dept, p.category, p.operation, p.validTo, left];
  }

  /** 待办明细的一行（类型 / 事项 / 单据 / 部门 / 责任人 / 期限） */
  var TODO_KIND = {
    'hazard-overdue': '逾期整改', 'hazard-due': '今日到期', 'hazard-verify': '待我验收',
    'hazard-open': '隐患整改', inspection: '巡检任务', permit: '作业票', training: '培训'
  };
  function todoRow(t) {
    return [
      TODO_KIND[t.kind] || t.kind || '—',
      t.title || '—',
      t.code || '—',
      t.dept || '—',
      t.owner || '—',
      t.dueDate || '—'
    ];
  }

  /**
   * 把聚合结果转成「分节」结构，界面预览与 Excel 复用同一份。
   * 每节：{ title, kv:[{k,v,note}], tables:[{title, head, rows}] }
   *
   * 2026-10-21 调整：
   *   · 表述精简：kv 的 note 与明细表标题只留要点，去掉重复与修饰；
   *   · **导出只取前四节**（见 EXPORT_SECTIONS）：通知公告、待办、资质预警三节
   *     仍在页面预览里看，但不进 Excel（用户要求「仅导出移除」）。
   * 2026-10-24 调整（按工作台实际内容对齐）：
   *   · 隐患节加「待我验收」；
   *   · 新增「六、待办事项」——四类未完成项，与「待办任务」页同一口径（metrics.buildTodos）；
   *   · 资质预警扩为「特种作业人员 + 特种设备人员」，并标出两类各多少人。
   */
  function sections(kind, agg) {
    var W = kind === 'weekly' ? '本周' : '当日';
    var out = [];

    // 一、隐患
    out.push({
      title: '一、隐患排查与治理（' + W + '）',
      kv: [
        { k: W + '登记隐患', v: agg.hazards.createdN, note: codes(agg.hazards.created) },
        { k: W + '闭环隐患', v: agg.hazards.closedN, note: codes(agg.hazards.closed) },
        { k: '累计未闭环', v: agg.hazards.openCount, note: '截至期末仍在整改中' },
        { k: '其中逾期未整改', v: agg.hazards.overdueCount, note: '超期未闭环', danger: agg.hazards.overdueCount > 0 },
        { k: '待我验收', v: agg.verifyCount, note: '整改完成待确认，需当天处理', danger: agg.verifyCount > 0 }
      ],
      tables: [
        { title: W + '新登记隐患', head: ['编号', '等级', '部门', '责任人', '整改期限', '状态'],
          rows: agg.hazards.created.map(hzRow), empty: W + '无新登记隐患' },
        { title: W + '闭环隐患', head: ['编号', '等级', '部门', '责任人', '整改期限', '状态'],
          rows: agg.hazards.closed.map(hzRow), empty: W + '无闭环隐患' }
      ]
    });

    // 二、巡检
    out.push({
      title: '二、安全巡检执行（' + W + '）',
      kv: [
        { k: W + '计划巡检', v: agg.inspections.plannedN, note: '取消不计分母' },
        { k: W + '完成巡检', v: agg.inspections.doneN, note: '按完成时间' },
        { k: '巡检完成率', v: agg.inspections.rate == null ? '—' : Math.round(agg.inspections.rate * 100) + '%', note: '完成 / 计划' },
        { k: '改期 / 取消', v: agg.inspections.rescheduledN + ' / ' + agg.inspections.cancelledN, note: '改期不减免' }
      ],
      tables: [
        { title: W + '巡检', head: ['编号', '巡检/检查', '区域', '执行人', '状态', '完成时间'],
          rows: agg.inspections.planned.map(inspRow), empty: W + '无安全巡检' }
      ]
    });

    // 三、培训
    out.push({
      title: '三、安全教育培训（' + W + '）',
      kv: [
        { k: W + '开展培训', v: agg.trainings.activeN, note: '区间覆盖即计入' },
        { k: '参训人次', v: agg.trainings.participants, note: '实到人数合计' }
      ],
      tables: [
        { title: W + '培训', head: ['编号', '名称', '类型', '讲师', '实际/应训', '状态'],
          rows: agg.trainings.active.map(trainRow), empty: W + '无培训安排' }
      ]
    });

    // 四、危险作业
    out.push({
      title: '四、危险作业票（' + W + '）',
      kv: [
        { k: W + '开票', v: agg.permits.issuedN, note: '按计划开始日' },
        { k: W + '审批通过', v: agg.permits.approvedN, note: '按审批时间' },
        { k: '作业中', v: agg.permits.workingN, note: '截至期末作业中' },
        { k: W + '完工', v: agg.permits.doneN, note: '本期已完工' }
      ],
      tables: [
        { title: W + '作业票', head: ['编号', '类型', '地点', '作业负责人', '监护人', '状态'],
          rows: agg.permits.issued.map(wpRow), empty: W + '无作业票' }
      ]
    });

    // 五、通知
    out.push({
      title: '五、通知公告（' + W + '发布）',
      kv: [{ k: W + '发布通知', v: agg.notices.n, note: '含置顶与紧急' }],
      tables: [
        { title: W + '通知明细', head: ['编号', '标题', '来源', '级别'],
          rows: agg.notices.today.map(ntRow), empty: W + '无发布通知' }
      ]
    });

    // 六、待办事项（四类未完成项，与「待办任务」页同一口径）
    out.push({
      title: '六、待办事项（截至期末）',
      kv: [
        { k: '未完成合计', v: agg.todos.n, note: '隐患 / 巡检 / 作业票 / 培训', danger: agg.todos.n > 0 },
        { k: '隐患待处理', v: agg.todos.by.hazard, note: '含逾期、今日到期、待验收' },
        { k: '巡检待执行', v: agg.todos.by.inspection, note: '含已改期' },
        { k: '作业票未完工', v: agg.todos.by.permit, note: '草稿至作业中' },
        { k: '培训未完成', v: agg.todos.by.training, note: '未开始 / 进行中' }
      ],
      tables: [
        { title: '待办明细（按紧急度排序）', head: ['类型', '事项', '单据编号', '责任部门', '责任人', '期限'],
          rows: agg.todos.all.map(todoRow), empty: '当前没有待办事项' }
      ]
    });

    // 七、人员资质预警（特种作业 + 特种设备）
    out.push({
      title: '七、人员资质预警（30 天内到期 / 已过期）',
      kv: [{
        k: '预警合计', v: agg.certWarnN,
        note: '特种作业人员 ' + agg.certWarnSpecialN + ' 人 · 特种设备人员 ' + agg.certWarnDeviceN + ' 人，请及时安排复审换证',
        danger: agg.certWarnN > 0
      }],
      tables: [
        { title: '资质预警明细', head: ['证书来源', '姓名', '部门', '类别', '项目 / 岗位', '有效期至', '剩余'],
          rows: agg.certWarn.map(certRow), empty: '暂无资质预警' }
      ]
    });

    return out;
  }

  /* ---------- 导出用的分节（只取前四节） ----------
     页面预览保留全部六节（通知公告、资质预警在页面上看得到）；
     导出的 Excel 只要前四节（隐患 / 巡检 / 培训 / 作业票），2026-10-21 用户确认。 */
  var EXPORT_SECTIONS = 4;
  function exportSections(kind, agg) { return sections(kind, agg).slice(0, EXPORT_SECTIONS); }

  /* ---------- 生成 Excel 工作表结构（供 xlsxWriter.build） ---------- */
  function toSheets(kind, agg, meta) {
    meta = meta || {};
    var secs = exportSections(kind, agg);
    var cols = [{ width: 18 }, { width: 10 }, { width: 13 }, { width: 15 }, { width: 16 }, { width: 12 }];
    var rows = [];
    function R(cells) { rows.push(cells); }

    // 标题
    R([{ v: meta.title || '安全生产报表', bold: true, fill: '0D7A72', color: 'FFFFFF', size: 14,
      align: 'center', valign: 'center', mergeAcross: 5, h: 30 }]);
    // 元信息
    [['日期 / 周期', meta.period || '—'],
     ['填报人 / 部门', (meta.reporter || '—') + '　·　' + (meta.dept || '—')],
     ['生成时间', meta.generatedAt || '—']].forEach(function (m) {
      R([{ v: m[0], bold: true, fill: 'F4FAF9', border: true }, { v: m[1], border: true, align: 'left', mergeAcross: 4 }]);
    });
    R([{ v: '' }]);

    var W = kind === 'weekly' ? '本周' : '当日';
    secs.forEach(function (sec) {
      R([{ v: sec.title, bold: true, fill: 'D9EEEB', align: 'left', mergeAcross: 5 }]);
      // KV 行：A=key, B=value, C:F=note
      sec.kv.forEach(function (kv) {
        R([
          { v: kv.k, bold: true, border: true, fill: 'F7FBFA' },
          { v: kv.v, border: true, align: 'center', danger: !!kv.danger },
          { v: kv.note || '', border: true, align: 'left', mergeAcross: 3 }
        ]);
      });
      // 表格
      (sec.tables || []).forEach(function (tb) {
        R([{ v: tb.title, bold: true, fill: 'E6F4F2', align: 'left', mergeAcross: 5 }]);
        R(tb.head.map(function (h) { return { v: h, bold: true, fill: '0D7A72', color: 'FFFFFF', align: 'center', border: true }; }));
        if (tb.rows && tb.rows.length) {
          tb.rows.forEach(function (r) {
            R(r.map(function (c) { return { v: c, border: true, align: 'left' }; }));
          });
        } else {
          R([{ v: '（' + tb.empty + '）', border: true, align: 'left', mergeAcross: 5, color: '94A3B8' }]);
        }
      });
      R([{ v: '' }]);
    });

    // 备注区（留空手写）
    R([{ v: '备注 / 重点关注事项', bold: true, fill: 'D9EEEB', align: 'left', mergeAcross: 5 }]);
    for (var i = 0; i < 3; i++) R([{ v: '', border: true, mergeAcross: 5, h: 22 }]);

    return [{ name: meta.sheetName || (kind === 'weekly' ? '安全周报' : '安全日报'), cols: cols, rows: rows }];
  }

  return {
    daily: daily, weekly: weekly, period: period,
    sections: sections,               // 页面预览用（六节）
    exportSections: exportSections,   // 导出 Excel 用（前四节）
    EXPORT_SECTIONS: EXPORT_SECTIONS,
    toSheets: toSheets
  };
})();
