/* =========================================================
   initial.js — 空白初始状态
   ────────────────────────────────────────────────────────
   本版本不带任何示例 / 模拟数据：build() 返回一份「结构齐全、
   内容全空」的数据集，首次打开即为空白工作台，由用户自己录入。
   字段与 data/schema.md 一一对应；trend / deptTrend 留空数组，
   由真实记录随时间自然积累（看板趋势图按月从台账现算兜底）。
   ========================================================= */
window.SD = window.SD || {};

SD.initial = (function () {
  /** 组装空白数据集（每次调用返回全新对象） */
  function build() {
    return {
      updatedAt: new Date().toISOString(),
      hazards: [],          // 隐患台账
      inspections: [],      // 巡检计划
      trainings: [],        // 培训计划
      certificates: [],     // 人员证书
      notices: [],          // 通知公告
      trend: [],            // 全厂隐患趋势（近 12 个月，按月从台账现算）
      deptTrend: [],        // 各部门隐患趋势（预聚合；留空则现算）
      specialPersonnel: [],
      devicePersonnel: [], // 特种作业人员
      workPermits: [],      // 危险作业票
      shiftLogs: []         // 安全巡检交接班记录（2026-10-25）
    };
  }

  return { build: build };
})();
