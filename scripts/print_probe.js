#!/usr/bin/env node
/* =========================================================
   print_probe.js — 用真浏览器打印成 PDF，回答「到底几页」
   ---------------------------------------------------------
   为什么需要它：jsdom 不做布局、不解析 @page、不分页，
   「打印是不是一页」只有真浏览器说了算。

   用法：
     node scripts/print_probe.js <url 或 html 路径> [out.pdf]
     node scripts/print_probe.js http://127.0.0.1:8126/index.html
     node scripts/print_probe.js "D:/tmp/_print_test.html" out.pdf

   注意：直接打印工作台首页，打的是「应用界面」而不是出件纸张。
   要验证某张单据，先用 tests/build_print_fixture.js 把「打印那一刻的 DOM」
   导出成独立 HTML，再对它跑本脚本：
     node tests/build_print_fixture.js http://127.0.0.1:8126/index.html ./_print_test.html
     node scripts/print_probe.js ./_print_test.html ./out.pdf
   ========================================================= */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const target = process.argv[2];
if (!target) {
  console.error('用法: node scripts/print_probe.js <url|html> [out.pdf]');
  process.exit(2);
}
const out = path.resolve(process.argv[3] || path.join(os.tmpdir(), 'print_probe.pdf'));

/* ---------- 找 Chrome / Edge ---------- */
function findChrome() {
  const c = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ].filter(Boolean);
  return c.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } }) || null;
}

const chrome = findChrome();
if (!chrome) {
  console.error('没找到 Chrome/Edge。可设置环境变量 CHROME_PATH 指向浏览器可执行文件。');
  process.exit(2);
}

/* ---------- 转成 file:// 或保留 http ---------- */
let url = target;
if (!/^https?:\/\//i.test(url)) {
  const p = path.resolve(url);
  if (!fs.existsSync(p)) { console.error('文件不存在: ' + p); process.exit(2); }
  url = 'file:///' + p.replace(/\\/g, '/');
}

console.log('浏览器: ' + chrome);
console.log('打印  : ' + url);

try {
  execFileSync(chrome, [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    '--no-pdf-header-footer',
    '--virtual-time-budget=5000',
    '--print-to-pdf=' + out,
    url
  ], { stdio: 'ignore', timeout: 120000 });
} catch (e) {
  console.error('打印失败：' + e.message);
  process.exit(1);
}

if (!fs.existsSync(out)) { console.error('没有生成 PDF，可能浏览器版本不支持 --print-to-pdf'); process.exit(1); }

/* ---------- 解析页数与纸张 ---------- */
const buf = fs.readFileSync(out);
const txt = buf.toString('latin1');
const cnt = /\/Count\s+(\d+)/.exec(txt);
const boxes = (txt.match(/\/MediaBox\s*\[[^\]]*\]/g) || []).slice(0, 1);
const pages = cnt ? Number(cnt[1]) : 0;
const mb = boxes[0] ? boxes[0].match(/-?[\d.]+/g).map(Number) : null;
const wmm = mb ? (mb[2] - mb[0]) * 25.4 / 72 : 0;
const hmm = mb ? (mb[3] - mb[1]) * 25.4 / 72 : 0;

console.log('');
console.log('  文件    : ' + out + '  (' + buf.length + ' bytes)');
console.log('  页数    : ' + pages);
if (mb) console.log('  纸张    : ' + wmm.toFixed(1) + ' × ' + hmm.toFixed(1) + ' mm  (' + boxes[0] + ')');
console.log('');

const portraitA4 = Math.abs(wmm - 210) < 2 && Math.abs(hmm - 297) < 2;
const landscapeA4 = Math.abs(wmm - 297) < 2 && Math.abs(hmm - 210) < 2;
console.log('  判定    : ' + (pages === 1 ? '✅ 一页' : '❌ 共 ' + pages + ' 页（预期 1 页）') +
  ' / ' + (portraitA4 ? 'A4 纵向' : landscapeA4 ? 'A4 横向' : '非标准 A4'));

/* 抽文字（有 pypdf 才做，没有就跳过） */
try {
  const { execFileSync: ex } = require('child_process');
  const py = 'import sys,re\n' +
    'from pypdf import PdfReader\n' +
    'r=PdfReader(sys.argv[1])\n' +
    't=r.pages[0].extract_text() or ""\n' +
    'print("  首页字数: %d" % len(t))\n' +
    'print("  前 120 字: " + t[:120].replace("\\n"," / "))\n';
  const o = ex('python', ['-c', py, out], { encoding: 'utf8', timeout: 60000 });
  process.stdout.write(o);
} catch (e) {
  console.log('  （安装 pypdf 后可抽首页文字核对是否截断：pip install pypdf）');
}

process.exit(pages === 1 ? 0 : 1);
