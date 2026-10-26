/* =========================================================
   views/dailyReport.js — 日报（按当日工作生成，可导出 Excel）
   渲染复用 views/reportCommon.js，本文件只声明元信息与 kind。
   ========================================================= */
window.SD = window.SD || {};
SD.views = SD.views || {};

SD.views.dailyReport = (function () {
  return {
    name: '日报',
    sub: function () { return '按当日工作自动汇总 · 一键导出 Excel'; },
    render: function (host, ctx) { SD.views.reportCommon.render('daily', host, ctx); }
  };
})();
