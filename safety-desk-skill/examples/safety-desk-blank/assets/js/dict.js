/* =========================================================
   dict.js — 枚举字典 + 取值助手
   ────────────────────────────────────────────────────────
   这里只放「数据契约」：状态下拉、等级字典、作业类别等枚举，
   以及 nameOf / itemOf 两个取值助手。不含任何业务数据。
   表单下拉、徽标显示名、报表列都从这里取，保证全站口径一致。
   字段含义见 data/schema.md。
   ========================================================= */
window.SD = window.SD || {};

SD.dict = (function () {
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

  return { DICT: DICT, nameOf: nameOf, itemOf: itemOf };
})();
