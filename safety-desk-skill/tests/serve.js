/* =========================================================
   serve.js — 本地静态服务（仅测试用）
   ────────────────────────────────────────────────────────
   为什么不用 python -m http.server：
     jsdom 会并发拉取 30 来个 <script>，python 的简易服务在并发下
     偶发 "Could not load script"（连接被重置），导致冒烟测试偶发失败。
     Node 的 http 模块并发处理稳，测试不会再随机崩。
   用法：node serve.js [端口] [项目根目录]
     端口默认 8124；根目录默认 ../safety-desk（示例数据版）。
     空白单机版：node serve.js 8125 ../safety-desk-blank
   ========================================================= */
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const ROOT = process.argv[3]
  ? path.resolve(process.argv[3])
  : path.resolve(__dirname, '..', 'safety-desk');
const PORT = Number(process.argv[2] || 8124);

if (!fs.existsSync(path.join(ROOT, 'index.html'))) {
  console.error('根目录下没有 index.html：' + ROOT);
  process.exit(1);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.md': 'text/markdown; charset=utf-8'
};

http.createServer((req, res) => {
  let p = decodeURIComponent(url.parse(req.url).pathname || '/');
  if (p === '/' || p === '') p = '/index.html';
  const file = path.join(ROOT, p);
  // 防目录穿越
  if (!file.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('404'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(buf);
  });
}).listen(PORT, '127.0.0.1', () => {
  console.log('serving ' + ROOT + ' at http://127.0.0.1:' + PORT);
});
