/* build_print_fixture.js — 把「交接班记录打印预览」那一刻的真实 DOM 导出成独立页面，供真打印取证
   用途：用 headless Chrome 真打印成 PDF，数页数 + 量高度，验证是否一页装得下。
   用法：node tests/build_print_fixture.js [url] [out.html]（导出后样式走源站绝对地址，打印时静态服务要还开着） */
const { JSDOM, requestInterceptor } = require('jsdom');
const fs = require('fs');
const path = require('path');

const URL = process.argv[2] || 'http://127.0.0.1:8124/index.html';
const OUT = process.argv[3] || './_print_test.html';

const skipPrint = requestInterceptor(r => {
  if (String(r.url).indexOf('print-only.css') >= 0) return new Response('', { headers: { 'Content-Type': 'text/css' } });
});
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const dom = await JSDOM.fromURL(URL, {
    runScripts: 'dangerously', resources: 'usable',
    requestInterceptor: skipPrint, pretendToBeVisual: true
  });
  const win = dom.window, doc = win.document;
  await wait(2600);
  const SD = win.SD;

  SD.auth.set('safety_officer');
  SD.app.refreshAll();
  await wait(500);
  win.location.hash = '#/shiftLog';
  await wait(900);

  /* 造一条带 3 条备注的记录，让备注列有内容 */
  const logs = SD.store.data().shiftLogs || [];
  const today = SD.app.state.summary.today;
  if (!logs.some(x => x.date === today && x.shift === 'day')) {
    SD.api.createShiftLog({
      date: today, shift: 'day', inspector: '',
      checks: SD.views.shiftLog.ITEMS.map(() => 'ok'),
      events: (function () {
        var base = ['东侧消防通道堆料，已通知当班清理', '2 号配电箱门锁损坏，已报修', '夜班发泡区温控记录补登'];
        var n = parseInt(process.env.SL_EVENTS || '0', 10);   /* 压力测试：多塞几条长备注 */
        for (var i = 0; i < n; i++) base.push('第 ' + (i + 4) + ' 条：三号车间东侧消防通道被半成品托盘占用约两米，已通知当班班组长立即清理并挂警示牌');
        return base;
      })(),
      updatedAt: today + ' 08:00'
    });
    await wait(800);
  }
  SD.app.reload();
  await wait(900);

  const btns = Array.from(doc.querySelectorAll('#view .btn'));
  const printBtn = btns.filter(b => /打印/.test(b.textContent))[0];
  printBtn.click();
  await wait(400);

  const ov = doc.querySelector('.sl-overlay');
  const pageStyle = doc.getElementById('slPageStyle');
  if (!ov) throw new Error('没打开打印预览');

  const css = [
    'base.css', 'layout.css', 'components.css', 'print.css', 'print-only.css'
  ].map(f => '<link rel="stylesheet" href="assets/css/' + f + '"' + (f === 'print-only.css' ? ' media="print"' : '') + '>').join('\n');

  const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>SL-PRINT-TEST</title>
${css}
${pageStyle ? pageStyle.outerHTML : ''}
<style>
  html,body{margin:0;padding:0;background:#fff}
  /* 页面脚本：量出纸张自然尺寸并写回，供 --dump-dom 读取 */
  #probe{position:fixed;left:-9999px;top:0;font:12px monospace;white-space:pre}
</style>
</head>
<body>
${ov.outerHTML}
<div id="probe"></div>
<script>
(function(){
  function measure(tag){
    var s = document.querySelector('.sl-sheet');
    var r = s.getBoundingClientRect();
    var t = document.querySelector('.pn-toolbar');
    return tag + ' sheetRect=' + (Math.round(r.width*100)/100) + 'x' + (Math.round(r.height*100)/100)
      + ' scroll=' + s.scrollWidth + 'x' + s.scrollHeight
      + ' zoom=' + (s.style.zoom || '-') + ' transform=' + (s.style.transform || '-');
  }
  var lines = [];
  lines.push(measure('RAW'));
  /* 与 app 里 fitToPage 完全相同的算法（可印区 261x172mm）*/
  var MMPX = 96/25.4, PW = 261*MMPX, PH = 172*MMPX;
  var s = document.querySelector('.sl-sheet');
  var bb = s.getBoundingClientRect();
  var w = bb.width || 0, h = bb.height || 0;
  var k = Math.min(PW/w, PH/h, 1);
  var needScale = k < 0.995 && k >= 0.75;                  /* 与 app 一致：装得下不缩；缩不到 75% 就不缩改分页 */
  if (!needScale) k = 1;
  else k = Math.max(0.75, Math.floor(k*0.985*100)/100);
  /* zoom 支持性用 rect 判断（rect 会被 zoom 影响；scrollHeight 不会） */
  function zoomWorks(el){
    var old = el.style.zoom; el.style.zoom='';
    var w1 = el.getBoundingClientRect().width;
    el.style.zoom='0.5';
    var w2 = el.getBoundingClientRect().width;
    el.style.zoom=old;
    return w1>0 && Math.abs(w2-w1*0.5)<1.5;
  }
  if (needScale) {
    if (zoomWorks(s)) s.style.zoom = String(k);
    else { s.style.transformOrigin='top left'; s.style.transform='scale('+k+')'; }
  }
  lines.push('SCALE=' + k);
  lines.push(measure('ZOOMED'));
  lines.push('PRINTABLE=' + Math.round(PW) + 'x' + Math.round(PH) + 'px @96dpi');
  var rows = document.querySelectorAll('.sl-paper-table tr'), arr = [];
  for (var i=0;i<rows.length;i++){
    var rr = rows[i], cs = getComputedStyle(rr);
    arr.push((rr.className||'?').split(' ')[0] + '=' + (Math.round(rr.getBoundingClientRect().height/k)) + 'px/' + cs.height + '/lh' + cs.lineHeight);
  }
  lines.push('ROWS ' + arr.join(' '));
  document.getElementById('probe').textContent = lines.join(' | ');
  document.title = 'SL-PRINT-TEST ' + lines.join(' | ');
})();
</script>
</body></html>`;

  /* ★ 取证页会被放到任意目录用 Chrome 打开，`assets/css/*.css` 的相对路径就 404 了 ——
     样式一丢，工具条不会被隐藏、纸张也不会按 @page 排版，结果「多出一页」。
     这里把相对引用统一改成源站绝对地址（打印时静态服务还开着，所以能取到）。 */
  const BASE = URL.replace(/\/[^/]*$/, '');   // http://host:port/index.html -> http://host:port
  const portable = html
    .replace(/(href|src)="assets\//g, '$1="' + BASE + '/assets/')
    .replace(/url\((["']?)assets\//g, 'url($1' + BASE + '/assets/');
  fs.writeFileSync(OUT, portable, 'utf8');
  console.log('written', OUT, html.length, 'chars');
  process.exit(0);
})().catch(e => { console.log('ERR', e.stack); process.exit(1); });
