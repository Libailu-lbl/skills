/* =========================================================
   brandLogo.js — 左上角公司标识（交接班记录出件用）
   ---------------------------------------------------------
   来源：梦百合 MLILY 标识 PNG（258x47），与原表
   《现场安全巡检与交接班记录.xlsx》第 1 行左上角那张图同款。
   出件时既要在打印预览里显示（用 <img src="assets/img/mily-logo.png">），
   也要嵌进导出的 .xlsx 里 —— xlsx 里只能放字节，所以这里存一份 base64，
   由 xlsxWriter 解回 PNG 塞进 xl/media。断网 / file:// 都不受影响。
   换标识：替换 assets/img/mily-logo.png，并同步下面的 base64 即可。
   ========================================================= */
window.SD = window.SD || {};

SD.BRAND_LOGO = {
  file: 'assets/img/mily-logo.png',   /* 打印预览 <img> 用 */
  w: 165, h: 30,                       /* 出件尺寸（px），照原表 A1:C1 区域的比例 */
  base64:
  'iVBORw0KGgoAAAANSUhEUgAAAQIAAAAvCAIAAACHaFNbAAAAvUlEQVR42u3aoQ2AMBCG0c6JZIDOhMKyEwLVIWrwJDQI+r/k' +
  'TXCXT1zTsqwVwhUjgDuD82oQSAYgA5AByABkADIAGYAMQAbwJoNtPwYZNzKQATKQATKQATJ4ziDhK+93ixzfzqxkIANkIANk' +
  'IANkIANkEJYBHkxBBiADkAEznMgy+MEiZSADGchABjKQgQxk4KpxIstABjLwUoQMZIAMZIAMZIAMQAYgA5AByABkADIAGYAM' +
  'QAYQnQEkkwHUDtY6vLSetC2aAAAAAElFTkSuQmCC'
};
