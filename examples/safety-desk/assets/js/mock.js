/* =========================================================
   mock.js — 结构化模拟数据
   设计要点：
   1) 所有日期都用「相对今天的偏移」生成，保证任何时候打开都能看到
      逾期 / 临期 / 已延期 / 已闭环 四种样本，不会随时间推移失效；
   2) 字段与 data/schema.md 一一对应，真实接口照字段名对齐即可；
   3) 只读数据，不产生副作用；需要可变副本由 store 层 clone 后写入。
   ========================================================= */
window.SD = window.SD || {};

SD.mock = (function () {
  var U = SD.utils;

  /* ---------- 枚举字典（与 schema.md 保持一致） ---------- */
  var DICT = {
    hazardStatus: [
      { v: 'pending',   n: '待整改' },
      { v: 'fixing',    n: '整改中' },
      { v: 'verifying', n: '待验收' },
      { v: 'closed',    n: '已闭环' },
      { v: 'delayed',   n: '已延期' },
      { v: 'void',      n: '已作废' }   // 登记有误时作废留痕，不物理删除
    ],
    severity: [
      { v: 'major',   n: '重大', cls: 'lv-major' },
      { v: 'large',   n: '较大', cls: 'lv-large' },
      { v: 'general', n: '一般', cls: 'lv-general' }
    ],
    statutoryLevel: [
      { v: 'major',   n: '重大事故隐患' },
      { v: 'general', n: '一般事故隐患' }
    ],
    hazardType: ['消防', '电气', '机械', '高处作业', '有限空间', '危化品', '职业健康', '特种设备', '作业环境', '其他'],
    hazardSource: ['日常巡检', '专项检查', '员工上报', '上级督查', '第三方检测'],
    inspectStatus: [
      { v: 'planned',     n: '待执行' },
      { v: 'done',        n: '已完成' },
      { v: 'rescheduled', n: '已改期' },
      { v: 'cancelled',   n: '已取消' }
    ],
    inspectType: ['日常巡检', '专项检查', '季节性检查', '节假日检查', '综合巡查'],
    trainType: ['三级教育', '专项培训', '应急演练', '特种作业'],
    certType: ['特种作业操作证', '安全生产知识考核合格证', '特种设备作业人员证', '消防设施操作员证', '内部培训合格证', '其他'],
    trainStatus: [
      { v: 'planned', n: '未开始' },
      { v: 'ongoing', n: '进行中' },
      { v: 'done',    n: '已完成' }
    ],
    noticeLevel: [
      { v: 'urgent',  n: '紧急', cls: 'b-danger' },
      { v: 'important', n: '重要', cls: 'b-warn' },
      { v: 'normal',  n: '普通', cls: 'b-mute' }
    ],

    /* ---------- 特种作业：字典（与 schema.md 第 8 节一致） ---------- */
    // 特种作业类别（应急部《特种作业人员安全技术培训考核管理规定》+ 用户补充的吊装）
    specialCategory: [
      '电工作业', '焊接与热切割作业', '高处作业', '吊装作业', '制冷与空调作业',
      '金属非金属矿山作业', '石油天然气作业', '冶金（有色）生产安全作业',
      '危险化学品安全作业', '烟花爆竹安全作业', '其他'
    ],
    // 特种作业人员资质状态
    specialStatus: [
      { v: 'valid',          n: '有效',   cls: 'b-ok' },
      { v: 'pending_review', n: '待复审', cls: 'b-warn' },
      { v: 'expired',        n: '已过期', cls: 'b-danger' },
      { v: 'suspended',      n: '停用',   cls: 'b-mute' }
    ],
    // 八大危险作业（GB 30871）
    permitType: [
      '动火作业', '受限空间作业', '盲板抽堵作业', '高处作业',
      '吊装作业', '临时用电作业', '动土作业', '断路作业'
    ],
    // 危险作业票状态机
    permitStatus: [
      { v: 'draft',    n: '草稿',     cls: 'b-mute' },
      { v: 'pending',  n: '待审批',   cls: 'b-warn' },
      { v: 'approved', n: '已批准',   cls: 'b-ok' },
      { v: 'working',  n: '作业中',   cls: 'lv-general' },
      { v: 'done',     n: '已完工',   cls: 'b-ok' },
      { v: 'void',     n: '已作废',   cls: 'b-danger' }
    ]
  };

  /** 取枚举显示名 */
  function nameOf(list, v) {
    for (var i = 0; i < list.length; i++) if (list[i].v === v) return list[i].n;
    return v || '—';
  }
  function itemOf(list, v) {
    for (var i = 0; i < list.length; i++) if (list[i].v === v) return list[i];
    return null;
  }

  /* ---------- 流转记录生成（隐患台账的法定留痕要求） ---------- */
  function flow(spec) {
    // spec: [{off:相对今天天数, by, from, to, note}]
    return spec.map(function (s) {
      var d = U.shift(U.today(), s.off);
      return { at: d + ' 09:00', by: s.by, from: s.from, to: s.to, note: s.note || '' };
    });
  }

  /* ---------- 隐患：12 条，覆盖 5 个状态 × 3 个等级 ---------- */
  function buildHazards() {
    var T = U.today();
    function d(off) { return U.shift(T, off); }

    // 字段顺序见 schema.md「hazard」
    var raw = [
      {
        code: 'FZYH-0000001', title: '装配车间消防通道被物料占用',
        type: '消防', severity: 'major', statutoryLevel: 'major',
        dept: '生产一部', owner: '张伟', location: 'A 区装配线东侧',
        source: '日常巡检', foundDate: d(-14), originalDueDate: d(-5), dueDate: d(-5),
        status: 'pending', delayCount: 0,
        measure: '清理通道内物料，划定消防通道黄线并张贴禁放标识',
        flow: flow([
          { off: -14, by: '王安全', from: '—', to: '待整改', note: '巡检发现，现场拍照取证' },
          { off: -13, by: '系统', from: '—', to: '—', note: '已推送整改通知至生产一部' }
        ])
      },
      {
        code: 'FZYH-0000002', title: '配电箱未上锁且无警示标识',
        type: '电气', severity: 'large', statutoryLevel: 'general',
        dept: '设备动力部', owner: '李强', location: '2 号配电室',
        source: '专项检查', foundDate: d(-11), originalDueDate: d(-2), dueDate: d(-2),
        status: 'fixing', delayCount: 0,
        measure: '加装门锁与"当心触电"警示牌，建立配电箱上锁台账',
        flow: flow([
          { off: -11, by: '王安全', from: '—', to: '待整改', note: '专项检查发现' },
          { off: -6,  by: '李强',   from: '待整改', to: '整改中', note: '已采购门锁，预计 3 日内完成' }
        ])
      },
      {
        code: 'FZYH-0000003', title: '行车（5t）上升限位开关失效',
        type: '特种设备', severity: 'major', statutoryLevel: 'major',
        dept: '生产二部', owner: '王磊', location: 'B 区行车',
        source: '专项检查', foundDate: d(-24), originalDueDate: d(-9), dueDate: d(7),
        status: 'delayed', delayCount: 1,
        delayReason: '限位开关需原厂备件，采购周期约 12 个工作日',
        delayApprovedBy: '安全总监 · 周建国',
        measure: '停用该行车并挂牌，更换原厂限位开关后由特检院复检',
        flow: flow([
          { off: -24, by: '王安全', from: '—', to: '待整改', note: '特检发现，已停用挂牌' },
          { off: -10, by: '王磊',   from: '待整改', to: '整改中', note: '拆解检查确认开关损坏' },
          { off: -9,  by: '王磊',   from: '整改中', to: '已延期', note: '申请延期：备件采购周期长' },
          { off: -8,  by: '周建国', from: '已延期', to: '整改中', note: '批准延期至 ' + d(7) + '，期间行车保持停用' }
        ])
      },
      {
        code: 'FZYH-0000004', title: '污水池清淤未办理有限空间作业审批',
        type: '有限空间', severity: 'major', statutoryLevel: 'major',
        dept: '生产一部', owner: '赵敏', location: '污水处理站',
        source: '员工上报', foundDate: d(-6), originalDueDate: d(1), dueDate: d(1),
        status: 'pending', delayCount: 0,
        measure: '补办有限空间作业审批，作业前完成通风检测与监护人员配置',
        flow: flow([
          { off: -6, by: '匿名上报', from: '—', to: '待整改', note: '员工上报，已核实' }
        ])
      },
      {
        code: 'FZYH-0000005', title: '打磨车间粉尘浓度超标',
        type: '职业健康', severity: 'large', statutoryLevel: 'general',
        dept: '打磨车间', owner: '陈刚', location: '打磨工位 3-6',
        source: '第三方检测', foundDate: d(-20), originalDueDate: d(2), dueDate: d(2),
        status: 'fixing', delayCount: 0,
        measure: '增设局部除尘装置，配发防尘口罩并安排岗中体检',
        flow: flow([
          { off: -20, by: '第三方机构', from: '—', to: '待整改', note: '检测报告显示超标 1.8 倍' },
          { off: -9,  by: '陈刚', from: '待整改', to: '整改中', note: '除尘设备已到货，安装中' }
        ])
      },
      {
        code: 'FZYH-0000006', title: '安全出口标识灯损坏',
        type: '消防', severity: 'general', statutoryLevel: 'general',
        dept: '行政后勤部', owner: '周芳', location: '办公楼 2 层西侧',
        source: '日常巡检', foundDate: d(-3), originalDueDate: d(6), dueDate: d(6),
        status: 'pending', delayCount: 0,
        measure: '更换损坏的应急标识灯，纳入月度消防设施点检清单',
        flow: flow([{ off: -3, by: '王安全', from: '—', to: '待整改', note: '月度点检发现' }])
      },
      {
        code: 'FZYH-0000007', title: '厂区内叉车行驶超速',
        type: '机械', severity: 'large', statutoryLevel: 'general',
        dept: '仓储物流部', owner: '孙浩', location: '厂区主干道',
        source: '日常巡检', foundDate: d(-8), originalDueDate: d(12), dueDate: d(12),
        status: 'fixing', delayCount: 0,
        measure: '安装限速器（≤5km/h），补充限速标识与反光镜',
        flow: flow([
          { off: -8, by: '王安全', from: '—', to: '待整改', note: '现场观察发现' },
          { off: -4, by: '孙浩', from: '待整改', to: '整改中', note: '限速器采购中' }
        ])
      },
      {
        code: 'FZYH-0000008', title: '危化品暂存柜未设置通风与防溢流设施',
        type: '危化品', severity: 'major', statutoryLevel: 'major',
        dept: '化学品库', owner: '吴斌', location: '危化品暂存柜',
        source: '上级督查', foundDate: d(-16), originalDueDate: d(-1), dueDate: d(-1),
        status: 'verifying', delayCount: 0,
        measure: '加装防爆通风机与防溢流托盘，修订危化品暂存操作规程',
        flow: flow([
          { off: -16, by: '市应急管理局', from: '—', to: '待整改', note: '督查交办，限期整改' },
          { off: -12, by: '吴斌', from: '待整改', to: '整改中', note: '通风机安装完成' },
          { off: -2,  by: '吴斌', from: '整改中', to: '待验收', note: '防溢流托盘已到位，申请验收' }
        ])
      },
      {
        code: 'FZYH-0000009', title: '屋面检修临边防护缺失',
        type: '高处作业', severity: 'large', statutoryLevel: 'general',
        dept: '工程项目部', owner: '郑凯', location: '3 号厂房屋面',
        source: '日常巡检', foundDate: d(-5), originalDueDate: d(9), dueDate: d(9),
        status: 'pending', delayCount: 0,
        measure: '搭设 1.2m 临边防护栏杆并挂设安全网，作业前完成交底',
        flow: flow([{ off: -5, by: '王安全', from: '—', to: '待整改', note: '巡检发现' }])
      },
      {
        code: 'FZYH-0000010', title: '应急照明灯蓄电池失效',
        type: '消防', severity: 'general', statutoryLevel: 'general',
        dept: '行政后勤部', owner: '周芳', location: '车间疏散通道',
        source: '日常巡检', foundDate: d(-2), originalDueDate: d(18), dueDate: d(18),
        status: 'pending', delayCount: 0,
        measure: '整批更换蓄电池，建立应急照明季度放电测试记录',
        flow: flow([{ off: -2, by: '王安全', from: '—', to: '待整改', note: '放电测试不合格' }])
      },
      {
        code: 'FZYH-0000011', title: '打磨工未佩戴护目镜',
        type: '职业健康', severity: 'general', statutoryLevel: 'general',
        dept: '打磨车间', owner: '陈刚', location: '打磨工位 1',
        source: '日常巡检', foundDate: d(-30), originalDueDate: d(-20), dueDate: d(-20),
        status: 'closed', delayCount: 0, closedAt: d(-21),
        measure: '配发护目镜并纳入班前检查项',
        flow: flow([
          { off: -30, by: '王安全', from: '—', to: '待整改', note: '巡检发现' },
          { off: -25, by: '陈刚',   from: '待整改', to: '整改中', note: '已配发护目镜' },
          { off: -22, by: '陈刚',   from: '整改中', to: '待验收', note: '申请验收' },
          { off: -21, by: '王安全', from: '待验收', to: '已闭环', note: '现场复核通过，班前检查已列入' }
        ])
      },
      {
        code: 'FZYH-0000012', title: '消防栓前堆放货物被遮挡',
        type: '消防', severity: 'large', statutoryLevel: 'general',
        dept: '仓储物流部', owner: '孙浩', location: '成品库 2 号栓',
        source: '日常巡检', foundDate: d(-25), originalDueDate: d(-15), dueDate: d(-15),
        status: 'closed', delayCount: 0, closedAt: d(-16),
        measure: '清理遮挡物并划定消防栓 1.5m 禁放区',
        flow: flow([
          { off: -25, by: '王安全', from: '—', to: '待整改', note: '巡检发现' },
          { off: -20, by: '孙浩',   from: '待整改', to: '整改中', note: '已安排清理' },
          { off: -17, by: '孙浩',   from: '整改中', to: '待验收', note: '申请验收' },
          { off: -16, by: '王安全', from: '待验收', to: '已闭环', note: '复核通过，已划禁放区' }
        ])
      }
    ];

    // 示例隐患照片：只给两条，便于看到「点标题看照片」的效果；其余为空
    var hzPhotos = {
      'FZYH-0000001': [samplePhoto('示例 · 消防通道占用', 640, 480), samplePhoto('示例 · 清理后通道', 640, 480)],
      'FZYH-0000003': [samplePhoto('示例 · 行车限位开关', 640, 480)]
    };

    return raw.map(function (h, i) {
      h.id = 'H' + (1000 + i);
      h.typeCode = DICT.hazardType.indexOf(h.type) + 1;
      h.photos = hzPhotos[h.code] || [];
      return h;
    });
  }

  /* ---------- 巡检计划：9 条（含 1 条已取消、1 条已改期、1 条下周） ---------- */
  function buildInspections() {
    var T = U.today();
    function d(off) { return U.shift(T, off); }

    var raw = [
      { code: 'FZXJ-2026-001', planName: '装配车间日常巡检', type: '日常巡检', area: 'A 区装配线', dept: '安环部', executor: '王安全', scheduledDate: d(-2), status: 'done', completedAt: d(-2), hazardCount: 1, remark: '发现消防通道占用，已登记 FZYH-0000001' },
      { code: 'FZXJ-2026-002', planName: '配电室专项检查', type: '专项检查', area: '2 号配电室', dept: '设备动力部', executor: '李强', scheduledDate: d(-1), status: 'done', completedAt: d(-1), hazardCount: 0, remark: '接地电阻复测合格' },
      { code: 'FZXJ-2026-003', planName: '班前安全确认', type: '日常巡检', area: '全厂区', dept: '安环部', executor: '王安全', scheduledDate: d(0), status: 'done', completedAt: d(0), hazardCount: 0, remark: '今日已完成，各班组长已签字' },
      { code: 'FZXJ-2026-004', planName: '晨会安全交底抽查', type: '日常巡检', area: '生产一部', dept: '安环部', executor: '王安全', scheduledDate: d(0), status: 'done', completedAt: d(0), hazardCount: 0, remark: '' },
      { code: 'FZXJ-2026-005', planName: '有限空间作业现场监护', type: '专项检查', area: '污水处理站', dept: '安环部', executor: '赵敏', scheduledDate: d(0), status: 'planned', hazardCount: 0, remark: '作业前须完成通风检测与审批' },
      { code: 'FZXJ-2026-006', planName: '消防设施月度点检', type: '专项检查', area: '全厂区', dept: '行政后勤部', executor: '周芳', scheduledDate: d(1), status: 'planned', hazardCount: 0, remark: '' },
      { code: 'FZXJ-2026-007', planName: '特种设备（行车）周检', type: '专项检查', area: 'B 区行车', dept: '生产二部', executor: '王磊', scheduledDate: d(-1), status: 'rescheduled', rescheduleTo: d(7), reason: '维保单位未到场', hazardCount: 0, remark: '改期不减免，仍计入本周缺口' },
      { code: 'FZXJ-2026-008', planName: '夜间突击检查', type: '综合巡查', area: '全厂区', dept: '安环部', executor: '王安全', scheduledDate: d(0), status: 'cancelled', reason: '与安全生产例会时间冲突', hazardCount: 0, remark: '已取消，不计入完成率分母' },
      { code: 'FZXJ-2026-009', planName: '节前安全大检查', type: '节假日检查', area: '全厂区', dept: '安环部', executor: '王安全', scheduledDate: d(7), status: 'planned', hazardCount: 0, remark: '覆盖消防、电气、危化品三条线' }
    ];

    // 示例巡查照片：只给两条，便于看到「点巡检区域名看照片」的效果；其余为空
    var photoMap = {
      'FZXJ-2026-001': [samplePhoto('示例 · 装配线巡查', 640, 480), samplePhoto('示例 · 通道占用整改后', 640, 480)],
      'FZXJ-2026-002': [samplePhoto('示例 · 配电室点检', 640, 480)]
    };
    return raw.map(function (r, i) {
      r.id = 'I' + (2000 + i);
      r.photos = photoMap[r.code] || [];             // 巡查照片（dataURL 数组），由表单上传
      // 已完成的补一条执行记录入口
      if (r.status === 'done') {
        r.record = {
          findings: r.remark || '现场正常，无异常项',
          signedBy: r.executor,
          signedAt: r.completedAt + ' 17:00'
        };
      }
      return r;
    });
  }

  /* ---------- 培训计划：4 条 ---------- */
  function buildTrainings() {
    var T = U.today();
    function d(off) { return U.shift(T, off); }
    var raw = [
      { code: 'FZPX-2026-001', name: '新员工三级安全教育', type: '三级教育', target: '9 月新入职员工', trainer: '王安全', startDate: d(5), endDate: d(7), status: 'planned', required: 12, actual: 0 },
      { code: 'FZPX-2026-002', name: '有限空间作业专项培训', type: '专项培训', target: '生产一部、污水处理站', trainer: '外部专家 · 王老师', startDate: d(-1), endDate: d(2), status: 'ongoing', required: 30, actual: 18 },
      { code: 'FZPX-2026-003', name: '下半年消防应急演练', type: '应急演练', target: '全员', trainer: '王安全', startDate: d(20), endDate: d(20), status: 'planned', required: 260, actual: 0 },
      { code: 'FZPX-2026-004', name: '特种设备作业人员复训', type: '特种作业', target: '行车、叉车作业人员', trainer: '市特检院', startDate: d(-35), endDate: d(-30), status: 'done', required: 24, actual: 24 }
    ];
    // 示例培训照片：只给两条，便于看到「点培训名称看照片」的效果；其余为空
    var trPhotos = {
      'FZPX-2026-002': [samplePhoto('示例 · 专项培训现场', 640, 480), samplePhoto('示例 · 培训签到', 640, 480)],
      'FZPX-2026-004': [samplePhoto('示例 · 复训考核', 640, 480)]
    };
    return raw.map(function (r, i) {
      r.id = 'T' + (3000 + i);
      r.photos = trPhotos[r.code] || [];   // 培训照片（dataURL 数组），由表单上传
      return r;
    });
  }

  /* ---------- 人员证书：7 条（覆盖已过期 / ≤30天 / 31-90天 / 正常） ---------- */
  function buildCertificates() {
    var T = U.today();
    function d(off) { return U.shift(T, off); }
    var raw = [
      { code: 'ZGZS-001', person: '张伟', dept: '生产一部', certName: '低压电工作业', certType: '特种作业操作证', certNo: 'T3201-2020-0182', issuer: '市应急管理局', validFrom: d(-1460), validTo: d(-12) },
      { code: 'ZGZS-002', person: '孙浩', dept: '仓储物流部', certName: '叉车司机', certType: '特种作业操作证', certNo: 'T3201-2021-0447', issuer: '市应急管理局', validFrom: d(-1095), validTo: d(-3) },
      { code: 'ZGZS-003', person: '吴斌', dept: '化学品库', certName: '危险化学品从业人员', certType: '从业资格证', certNo: 'H3201-2022-0091', issuer: '市应急管理局', validFrom: d(-1085), validTo: d(7) },
      { code: 'ZGZS-004', person: '李强', dept: '设备动力部', certName: '高压电工作业', certType: '特种作业操作证', certNo: 'T3201-2020-0133', issuer: '市应急管理局', validFrom: d(-1440), validTo: d(18) },
      { code: 'ZGZS-005', person: '王磊', dept: '生产二部', certName: '起重机械指挥', certType: '特种作业操作证', certNo: 'T3201-2021-0260', issuer: '市应急管理局', validFrom: d(-1200), validTo: d(58) },
      { code: 'ZGZS-006', person: '赵敏', dept: '生产一部', certName: '有限空间作业监护', certType: '岗位培训合格证', certNo: 'P3201-2025-0030', issuer: '公司安环部', validFrom: d(-300), validTo: d(120) },
      { code: 'ZGZS-007', person: '陈刚', dept: '打磨车间', certName: '焊接与热切割作业', certType: '特种作业操作证', certNo: 'T3201-2023-0512', issuer: '市应急管理局', validFrom: d(-800), validTo: d(200) }
    ];
    return raw.map(function (r, i) { r.id = 'C' + (4000 + i); return r; });
  }

  /* ---------- 通知公告：4 条 ---------- */
  function buildNotices() {
    var T = U.today();
    function d(off) { return U.shift(T, off); }
    var raw = [
      { code: 'FZTG-2026-001', title: '关于开展重大事故隐患专项排查整治的通知', source: '公司安全生产委员会', level: 'urgent', publishAt: d(0), pinned: true, summary: '即日起开展为期一个月的重大隐患专项排查，重点覆盖危化品、有限空间、特种设备三条线，请各部门于每周五 17:00 前报送排查台账。' },
      { code: 'FZTG-2026-002', title: '关于更新《隐患排查治理台账》填报口径的通知', source: '安环部', level: 'important', publishAt: d(-2), pinned: false, summary: '隐患等级按「重大/较大/一般」三档填报；对外上报口径仍按法定两级（重大事故隐患/一般事故隐患）归类。' },
      { code: 'FZTG-2026-003', title: '三季度安全生产例会纪要', source: '安环部', level: 'normal', publishAt: d(-5), pinned: false, summary: '通报三季度隐患整改完成率 87.5%，四季度重点推进特种设备与职业健康两条线的闭环管理。' },
      { code: 'FZTG-2026-004', title: '高温季节作业防护提示', source: '安环部', level: 'normal', publishAt: d(-8), pinned: false, summary: '日最高气温 ≥35℃ 时，11:00–15:00 停止室外露天作业，各车间备足防暑降温饮品与应急药品。' }
    ];
    return raw.map(function (r, i) { r.id = 'N' + (5000 + i); return r; });
  }

  /* ---------- 演示用示例照片 ----------
     纯 SVG 生成的占位图，带「示例」字样，不引外链、断网也能显示。
     只为了让照片区 / 证件照列在演示数据下不是空的；接真实数据后由上传的照片覆盖。 */
  function samplePhoto(text, w, h) {
    w = w || 640; h = h || 480;
    var cx = Math.round(w / 2), m = Math.min(w, h);
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '">' +
      '<rect width="100%" height="100%" fill="#eef2f7"/>' +
      '<circle cx="' + cx + '" cy="' + Math.round(h * 0.40) + '" r="' + Math.round(m * 0.15) + '" fill="#d7e0ea"/>' +
      '<path d="M' + Math.round(cx - m * 0.26) + ' ' + Math.round(h * 0.92) +
        ' Q' + cx + ' ' + Math.round(h * 0.58) + ' ' + Math.round(cx + m * 0.26) + ' ' + Math.round(h * 0.92) +
        ' Z" fill="#d7e0ea"/>' +
      '<text x="50%" y="' + (h - 14) + '" text-anchor="middle" font-family="sans-serif" font-size="' +
        Math.round(m * 0.075) + '" fill="#94a3b8">' + text + '</text>' +
      '<rect x="0.5" y="0.5" width="' + (w - 1) + '" height="' + (h - 1) + '" fill="none" stroke="#cbd5e1"/>' +
      '</svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  /* ---------- 特种作业人员：8 条（覆盖 有效 / 待复审 / 已过期 / 停用） ---------- */
  function buildSpecialPersonnel() {
    var T = U.today();
    function d(off) { return U.shift(T, off); }
    var raw = [
      { code: 'TZZY-001', name: '张伟', dept: '生产一部', category: '电工作业', operation: '低压电工作业', certNo: 'T3201-2020-0182', issuer: '市应急管理局', validFrom: d(-1460), validTo: d(-12), reviewDate: d(-12), status: 'expired' },
      { code: 'TZZY-002', name: '孙浩', dept: '仓储物流部', category: '焊接与热切割作业', operation: '熔化焊接与热切割', certNo: 'T3201-2021-0447', issuer: '市应急管理局', validFrom: d(-1095), validTo: d(-3), reviewDate: d(-3), status: 'expired' },
      { code: 'TZZY-003', name: '陈刚', dept: '打磨车间', category: '焊接与热切割作业', operation: '熔化焊接与热切割', certNo: 'T3201-2023-0512', issuer: '市应急管理局', validFrom: d(-800), validTo: d(20), reviewDate: d(20), status: 'pending_review' },
      { code: 'TZZY-004', name: '李强', dept: '设备动力部', category: '电工作业', operation: '高压电工作业', certNo: 'T3201-2020-0133', issuer: '市应急管理局', validFrom: d(-1440), validTo: d(180), reviewDate: d(180), status: 'valid' },
      { code: 'TZZY-005', name: '王磊', dept: '生产二部', category: '高处作业', operation: '高处安装维护拆除', certNo: 'T3201-2021-0260', issuer: '市应急管理局', validFrom: d(-1200), validTo: d(58), reviewDate: d(58), status: 'pending_review' },
      { code: 'TZZY-006', name: '赵敏', dept: '生产一部', category: '高处作业', operation: '登高架设', certNo: 'T3201-2022-0099', issuer: '市应急管理局', validFrom: d(-700), validTo: d(300), reviewDate: d(300), status: 'valid' },
      { code: 'TZZY-007', name: '吴斌', dept: '化学品库', category: '危险化学品安全作业', operation: '化工自动化控制', certNo: 'H3201-2022-0031', issuer: '市应急管理局', validFrom: d(-1085), validTo: d(7), reviewDate: d(7), status: 'pending_review' },
      { code: 'TZZY-008', name: '周芳', dept: '行政后勤部', category: '电工作业', operation: '低压电工作业', certNo: 'T3201-2019-0210', issuer: '市应急管理局', validFrom: d(-2000), validTo: d(-90), reviewDate: d(-90), status: 'suspended' }
    ];
    // 示例证件照：给三个人，便于看到「点姓名看证件照」与
    // 「作业票照片打印页按姓名自动带出证件照」的效果；其余为空
    var idPhotos = {
      'TZZY-001': [samplePhoto('示例证件照 · 张伟', 420, 560)],
      'TZZY-004': [samplePhoto('示例证件照 · 李强', 420, 560)],
      'TZZY-005': [samplePhoto('示例证件照 · 王磊', 420, 560)]   // 王磊在 TZZY-001 里，打印页能带出来
    };
    return raw.map(function (r, i) {
      r.id = 'SP' + (6000 + i);
      r.photos = idPhotos[r.code] || [];   // 证件照（dataURL 数组）
      return r;
    });
  }

  /* ---------- 特种设备人员（2026-10-24 新增；数据来自「2026叉车证人员名单.xlsx」共 78 人） ----------
     来源表头：姓名 / 工号 / 部门 / 岗位 / 技能证书 / 证件编号 / 证书有效期至 / 联系方式 / 备注
     · 工号、身份证号一律按**文本**存（有前导零 06359、X 结尾 32062219691202173X）
     · 「证书有效期至」原表写法不统一（2028-5 / 2029-11-30 / 2029-04-01 00:00:00），
       导入时统一成 YYYY-MM-DD；**只有年月的按当月最后一天算**（宁早不晚，安全口径）
     · status 不写死：按 validTo 与今天实时算（过期 / certNoticeDays 内待复审 / 有效），
       隔天打开页面也会自动更新 */
  function statusOfCert(validTo, today) {
    if (!validTo) return 'valid';
    var days = Math.round((new Date(validTo + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400000);
    if (days < 0) return 'expired';
    if (days <= ((SD.CONFIG.thresholds && SD.CONFIG.thresholds.certNoticeDays) || 90)) return 'pending_review';
    return 'valid';
  }

  function buildDevicePersonnel() {
    var T = U.today();
    /* 名单数据在 assets/js/data/deviceSeed.js（两版共用），这里只做派生：
       id / 空照片 / 按 fecha 算初始状态 */
    var raw = (SD.deviceSeed || []).map(function (x) { return Object.assign({}, x); });
    return raw.map(function (r, i) {
      r.id = 'DP' + (7000 + i);
      r.photos = r.photos || [];           // 证书照片（可后补，编辑里上传）
      r.status = statusOfCert(r.validTo, T);
      return r;
    });
  }

  /* ---------- 危险作业票（八大危险作业）：8 条（覆盖 草稿/待审批/已批准/作业中/已完工/已作废） ---------- */
  function buildWorkPermits() {
    var T = U.today();
    function d(off) { return U.shift(T, off); }
    var raw = [
      { code: 'FZZY-0000001', type: '动火作业', location: 'B 区焊接工位', dept: '生产二部', applicant: '王磊', leader: '王磊', guardian: '孙浩', risk: '火灾、灼伤、有毒烟气', measures: '清理周边可燃物 10m、配灭火器 2 具、开具动火证、设专人监护', planStart: d(0), planEnd: d(0), status: 'pending', approvedBy: '', approvedAt: '', remark: '储罐区管线切割' },
      { code: 'FZZY-0000002', type: '受限空间作业', location: '污水处理站', dept: '生产一部', applicant: '赵敏', leader: '赵敏', guardian: '王安全', risk: '缺氧、有毒气体、淹溺', measures: '作业前通风 30min、气体检测合格、佩戴防毒面具、连续监护', planStart: d(0), planEnd: d(0), status: 'approved', approvedBy: '王安全', approvedAt: d(0) + ' 08:30', remark: '污水池清淤' },
      { code: 'FZZY-0000003', type: '高处作业', location: '3 号厂房屋面', dept: '工程项目部', applicant: '郑凯', leader: '郑凯', guardian: '孙浩', risk: '高处坠落', measures: '系挂安全带、设 1.2m 临边防护、禁止抛掷', planStart: d(1), planEnd: d(1), status: 'draft', approvedBy: '', approvedAt: '', remark: '屋面防水施工' },
      { code: 'FZZY-0000004', type: '临时用电作业', location: '成品库改造区', dept: '设备动力部', applicant: '李强', leader: '李强', guardian: '周芳', risk: '触电、短路起火', measures: '三级配电两级保护、电缆架空或穿管、电工持证接线', planStart: d(-1), planEnd: d(2), status: 'working', approvedBy: '王安全', approvedAt: d(-1) + ' 09:00', remark: '临时照明布线' },
      { code: 'FZZY-0000005', type: '吊装作业', location: 'B 区设备平台', dept: '生产二部', applicant: '王磊', leader: '王磊', guardian: '孙浩', risk: '物体打击、起重伤害', measures: '吊具检查、设警戒区、指挥持证、风速 ≤6 级', planStart: d(-3), planEnd: d(-3), status: 'done', approvedBy: '王安全', approvedAt: d(-3) + ' 08:00', remark: '行车电机吊装' },
      { code: 'FZZY-0000006', type: '盲板抽堵作业', location: '化学品库管道', dept: '化学品库', applicant: '吴斌', leader: '吴斌', guardian: '赵敏', risk: '物料泄漏、中毒', measures: '确认管线泄压、佩戴防护、双人确认盲板编号', planStart: d(-2), planEnd: d(-2), status: 'done', approvedBy: '王安全', approvedAt: d(-2) + ' 10:00', remark: '溶剂管线检修' },
      { code: 'FZZY-0000007', type: '动土作业', location: '厂区西侧管沟', dept: '工程项目部', applicant: '郑凯', leader: '郑凯', guardian: '李强', risk: '破坏地下管线、坍塌', measures: '探明地下管线、设边坡支护、夜间警示', planStart: d(5), planEnd: d(6), status: 'draft', approvedBy: '', approvedAt: '', remark: '新增给水管沟' },
      { code: 'FZZY-0000008', type: '断路作业', location: '厂区主干道', dept: '仓储物流部', applicant: '孙浩', leader: '孙浩', guardian: '周芳', risk: '车辆伤害、交通中断', measures: '设交通导改、夜间警示灯、专人引导', planStart: d(-1), planEnd: d(-1), status: 'void', approvedBy: '', approvedAt: '', remark: '计划取消，改走北侧通道' }
    ];
    // 作业人员：谁进场干活（一组人，不像申请人那样只有一个）
    var workersMap = {
      'FZZY-0000001': ['王磊', '孙浩'],
      'FZZY-0000002': ['赵敏', '王安全'],
      'FZZY-0000003': ['郑凯'],
      'FZZY-0000004': ['李强', '周芳'],
      'FZZY-0000005': ['王磊', '孙浩', '郑凯'],
      'FZZY-0000006': ['吴斌'],
      'FZZY-0000007': ['郑凯', '李强'],
      'FZZY-0000008': ['孙浩']
    };
    // 示例现场照片：只给两张票，便于看到「照片专区 + 点击查看」
    var photoMap = {
      'FZZY-0000001': [samplePhoto('示例 · 动火作业面', 640, 480), samplePhoto('示例 · 灭火器配备', 640, 480)],
      'FZZY-0000004': [samplePhoto('示例 · 临时配电箱', 640, 480), samplePhoto('示例 · 电缆架空', 640, 480), samplePhoto('示例 · 接地检测', 640, 480)]
    };
    return raw.map(function (r, i) {
      r.id = 'WP' + (7000 + i);
      r.flow = [];
      r.workers = workersMap[r.code] || [];          // 作业人员名单
      r.photos = photoMap[r.code] || [];             // 现场照片（dataURL 数组），由表单上传
      return r;
    });
  }

  /* ---------- 隐患趋势：近 12 个月（新增 / 闭环） ---------- */
  // 全厂口径（条/月）；deptTrend 按部门分摊后，各月合计必须等于这里的 created
  var TREND_CREATED = [7, 9, 6, 11, 8, 12, 10, 9, 13, 11, 8, 10];
  var TREND_CLOSED  = [6, 8, 7, 9, 7, 10, 9, 8, 11, 10, 7, 9];
  // 部门分摊权重：与隐患台账的 8 个部门一致（权重和 = 100）
  var DEPT_WEIGHTS = [
    { dept: '生产一部',   w: 22 },
    { dept: '设备动力部', w: 16 },
    { dept: '生产二部',   w: 14 },
    { dept: '化学品库',   w: 12 },
    { dept: '工程项目部', w: 10 },
    { dept: '行政后勤部', w: 9  },
    { dept: '打磨车间',   w: 9  },
    { dept: '仓储物流部', w: 8  }
  ];

  function buildTrend() {
    var thisYM = U.ym(U.today());
    var out = [];
    for (var i = 11; i >= 0; i--) {
      out.push({
        ym: U.shiftYM(thisYM, -i),
        created: TREND_CREATED[11 - i],
        closed: TREND_CLOSED[11 - i]
      });
    }
    return out;
  }

  /* ---------- 各部门隐患趋势：近 12 个月（按部门分摊新增） ----------
     形状：[{dept, ym, count}]；各月「各部门合计 = 全厂 trend.created」，
     保证「全厂趋势」与「部门趋势」两张图讲的是同一件事。
     权重加确定性扰动让曲线有起伏；最大余额法补齐取整误差。 */
  function buildDeptTrend() {
    var thisYM = U.ym(U.today());
    var months = [];
    for (var i = 11; i >= 0; i--) months.push(U.shiftYM(thisYM, -i));
    var rows = [];
    months.forEach(function (ym, m) {
      var total = TREND_CREATED[m];
      var exact = DEPT_WEIGHTS.map(function (d, i) {
        return { dept: d.dept, v: d.w * (1 + 0.3 * Math.sin(m * 1.3 + i * 0.9)) / 100 * total };
      });
      var alloc = exact.map(function (e) { return { dept: e.dept, ym: ym, count: Math.floor(e.v) }; });
      var rest = total - alloc.reduce(function (a, b) { return a + b.count; }, 0);
      exact
        .map(function (e, i) { return { i: i, frac: e.v - Math.floor(e.v) }; })
        .sort(function (a, b) { return b.frac - a.frac; })
        .forEach(function (o, k) { if (k < rest) alloc[o.i].count += 1; });
      rows = rows.concat(alloc);
    });
    return rows;
  }

  /** 交接班记录（2026-10-25 新增）：内置前两天的两份，今天留空方便现场录入 */
  function daysAgo(n) {
    var d = new Date();
    d.setDate(d.getDate() - n);
    function p2(x) { return (x < 10 ? '0' : '') + x; }
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
  }

  function buildShiftLogs() {
    function mk(i, date, shift, inspector, bads, events) {
      var checks = [];
      for (var k = 0; k < 19; k++) checks.push(bads.indexOf(k + 1) >= 0 ? 'bad' : 'ok');
      return {
        id: 'SL' + (8200 + i),
        date: date,
        shift: shift,
        inspector: inspector,
        checks: checks,
        events: events,
        createdAt: date + ' 08:10',
        updatedAt: date + ' 08:10'
      };
    }
    return [
      mk(1, daysAgo(1), 'day', '王安全', [9],
        ['3 号门消防通道被成型车间物料占用约 2 米，已通知当班组长 20 分钟内清理完毕，复查已通畅。',
         '发泡车间 2 号熟化区温度记录 28℃，接近上限，已提醒当班开启风机并加密记录。']),
      mk(2, daysAgo(2), 'night', '王志强', [],
        ['夜班整体正常，配电房巡检记录齐全；东侧应急照明 1 盏闪烁，已报维修。'])
    ];
  }

  /** 组装整份数据集（每次调用返回全新对象） */
  function build() {
    return {
      updatedAt: new Date().toISOString(),
      hazards: buildHazards(),
      inspections: buildInspections(),
      trainings: buildTrainings(),
      certificates: buildCertificates(),
      notices: buildNotices(),
      trend: buildTrend(),
      deptTrend: buildDeptTrend(),
      specialPersonnel: buildSpecialPersonnel(),
      devicePersonnel: buildDevicePersonnel(),
      workPermits: buildWorkPermits(),
      shiftLogs: buildShiftLogs()
    };
  }

  return { build: build, DICT: DICT, nameOf: nameOf, itemOf: itemOf };
})();
