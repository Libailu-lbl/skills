/* =========================================================
   views/weeklyReport.js — 周报（按本周工作生成，可导出 Excel）
   渲染复用 views/reportCommon.js，本文件只声明元信息与 kind。
   ========================================================= */
window.SD = window.SD || {};
SD.views = SD.views || {};

SD.views.weeklyReport = (function () {
  return {
    name: '周报',
    sub: function () { return '按本周（周一至周日）工作自动汇总 · 一键导出 Excel'; },
    render: function (host, ctx) { SD.views.reportCommon.render('weekly', host, ctx); }
  };
})();
