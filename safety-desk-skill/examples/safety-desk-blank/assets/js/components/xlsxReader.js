/* =========================================================
   components/xlsxReader.js — 浏览器端读 .xlsx / .csv（零依赖，2026-10-27 新增）
   ────────────────────────────────────────────────────────
   为什么自己写：项目铁律是「单文件 / 零外链 / 断网可用」，不能引 SheetJS。
   读 .xlsx 只需要三件事：
     ① 解析 ZIP 中央目录，找到 xl/worksheets/sheet1.xml 与 xl/sharedStrings.xml
     ② 解压：xlsx 内部是 deflate-raw，用浏览器原生 DecompressionStream
     ③ 解析 XML：行 <row r="1"> / 格 <c r="A1" t="s"><v>0</v></c>
   兜底：浏览器没有 DecompressionStream（老版本）时，提示改用 CSV；
         CSV 解析也在这里，纯字符串处理，任何环境都能跑。

   对外：
     readFile(file)          File|Blob → Promise<{ rows, sheetName, source }>
     readArrayBuffer(buf)    ArrayBuffer/Uint8Array → Promise 同上
     parseCsv(text)          纯文本 CSV → rows（二维数组，首行一般是表头）
     excelDate(serial)        Excel 日期序列号 → 'YYYY-MM-DD'
     （下划线开头的是测试入口）
   ========================================================= */
window.SD = window.SD || {};
SD.comp = SD.comp || {};

SD.comp.xlsxReader = (function () {
  'use strict';

  var SIG_EOCD = 0x06054b50;   // 中央目录结束
  var SIG_CD = 0x02014b50;     // 中央目录条目
  var SIG_LH = 0x04034b50;     // 本地文件头

  var decoder = (typeof TextDecoder !== 'undefined') ? new TextDecoder('utf-8') : null;

  function u8ToStr(bytes) {
    if (!decoder) return '';
    return decoder.decode(bytes);
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /* ---------------- ZIP ---------------- */

  /** 找中央目录结束记录（在文件末尾，可能带注释，最多回溯 65557 字节） */
  function findEocd(u8) {
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    var start = Math.max(0, u8.length - 65557);
    for (var i = u8.length - 22; i >= start; i--) {
      if (dv.getUint32(i, true) === SIG_EOCD) return i;
    }
    return -1;
  }

  /** 列出 ZIP 内的所有条目（名称 / 压缩方式 / 大小 / 本地头偏移） */
  function listEntries(u8) {
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    var eocd = findEocd(u8);
    if (eocd < 0) throw new Error('不是有效的 .xlsx 文件（找不到 ZIP 结构）');

    var count = dv.getUint16(eocd + 10, true);
    var cdOffset = dv.getUint32(eocd + 16, true);
    var p = cdOffset;
    var out = [];

    for (var i = 0; i < count && p + 46 <= u8.length; i++) {
      if (dv.getUint32(p, true) !== SIG_CD) break;
      var method = dv.getUint16(p + 10, true);
      var compSize = dv.getUint32(p + 20, true);
      var rawSize = dv.getUint32(p + 24, true);
      var nameLen = dv.getUint16(p + 28, true);
      var extraLen = dv.getUint16(p + 30, true);
      var cmtLen = dv.getUint16(p + 32, true);
      var lhOffset = dv.getUint32(p + 42, true);
      var name = u8ToStr(u8.subarray(p + 46, p + 46 + nameLen));
      out.push({
        name: name, method: method,
        compSize: compSize, size: rawSize, offset: lhOffset
      });
      p += 46 + nameLen + extraLen + cmtLen;
    }
    return out;
  }

  /** deflate-raw 解压（浏览器原生） */
  function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') {
      return Promise.reject(new Error('当前浏览器不支持直接读取 .xlsx（缺少 DecompressionStream）。' +
        '请用 Excel 把文件另存为 .csv 后再导入。'));
    }
    var ds = new DecompressionStream('deflate-raw');
    var stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Response(stream).arrayBuffer().then(function (ab) {
      return new Uint8Array(ab);
    });
  }

  /** 取某个条目的原始字节（stored 直接切，deflate 走 inflateRaw） */
  function readEntry(u8, ent) {
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    var p = ent.offset;
    if (dv.getUint32(p, true) !== SIG_LH) {
      return Promise.reject(new Error('ZIP 条目损坏：' + ent.name));
    }
    var nameLen = dv.getUint16(p + 26, true);
    var extraLen = dv.getUint16(p + 28, true);
    var dataStart = p + 30 + nameLen + extraLen;
    var raw = u8.subarray(dataStart, dataStart + ent.compSize);
    if (ent.method === 0) return Promise.resolve(raw);
    if (ent.method === 8) return inflateRaw(raw);
    return Promise.reject(new Error('不支持的压缩方式（' + ent.method + '）：' + ent.name));
  }

  /* ---------------- XML ---------------- */

  /** 列号："A"→0，"AA"→26，"AB1"→27 */
  function colIndex(ref) {
    var m = /^([A-Z]+)/i.exec(String(ref || ''));
    if (!m) return 0;
    var s = m[1].toUpperCase(), n = 0;
    for (var i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64);
    return n - 1;
  }

  function parseXml(text) {
    if (typeof DOMParser === 'undefined') throw new Error('当前环境无法解析 XML');
    var doc = new DOMParser().parseFromString(text, 'application/xml');
    var err = doc.getElementsByTagName('parsererror')[0];
    if (err) throw new Error('xlsx 内部 XML 解析失败');
    return doc;
  }

  /** sharedStrings：每个 <si> 取所有 <t> 拼接（富文本会拆成多个 <r><t>） */
  function parseSst(xml) {
    var out = [];
    if (!xml) return out;
    var doc = parseXml(xml);
    var sis = doc.getElementsByTagName('si');
    for (var i = 0; i < sis.length; i++) {
      var ts = sis[i].getElementsByTagName('t');
      var s = '';
      for (var j = 0; j < ts.length; j++) s += ts[j].textContent || '';
      out.push(s);
    }
    return out;
  }

  /** 工作表 XML → 二维数组（按 r 属性定位行列，空位留 ''） */
  function parseSheet(xml, sst) {
    var doc = parseXml(xml);
    var rowEls = doc.getElementsByTagName('row');
    var rows = [];

    for (var i = 0; i < rowEls.length; i++) {
      var rowEl = rowEls[i];
      var r = parseInt(rowEl.getAttribute('r'), 10);
      if (!r || r < 1) r = rows.length + 1;
      var cells = [];
      var cs = rowEl.getElementsByTagName('c');

      for (var j = 0; j < cs.length; j++) {
        var c = cs[j];
        var idx = c.getAttribute('r') ? colIndex(c.getAttribute('r')) : j;
        var t = c.getAttribute('t');
        var vEl = c.getElementsByTagName('v')[0];
        var val = '';

        if (t === 's') {
          val = (vEl ? (sst[parseInt(vEl.textContent, 10)] || '') : '');
        } else if (t === 'inlineStr') {
          var tEls = c.getElementsByTagName('t');
          for (var k = 0; k < tEls.length; k++) val += tEls[k].textContent || '';
        } else if (t === 'b') {
          val = vEl && vEl.textContent === '1' ? 'TRUE' : 'FALSE';
        } else {
          val = vEl ? (vEl.textContent || '') : '';
        }

        cells[idx] = val;
      }

      /* 补空洞：避免 [ , , 'x'] 这种稀疏数组在后续 map 时出 undefined */
      for (var m = 0; m < cells.length; m++) if (cells[m] == null) cells[m] = '';
      rows[r - 1] = cells;
    }

    for (var n = 0; n < rows.length; n++) if (!rows[n]) rows[n] = [];

    /* 统一列数：按最宽的一行补齐 */
    var width = 0;
    rows.forEach(function (row) { if (row.length > width) width = row.length; });
    rows.forEach(function (row) { while (row.length < width) row.push(''); });

    return rows;
  }

  /* ---------------- CSV ---------------- */

  /** 纯文本 CSV → 二维数组（支持引号包裹、双引号转义、CRLF、UTF-8 BOM） */
  function parseCsv(text) {
    var s = String(text == null ? '' : text);
    if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);      // 去 BOM

    var rows = [], row = [], field = '', inQuote = false;

    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);

      if (inQuote) {
        if (ch === '"') {
          if (s.charAt(i + 1) === '"') { field += '"'; i++; }
          else inQuote = false;
        } else field += ch;
        continue;
      }

      if (ch === '"') { inQuote = true; continue; }
      if (ch === ',') { row.push(field); field = ''; continue; }
      if (ch === '\r') { continue; }
      if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
      field += ch;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }

    /* 去掉尾部全空行 */
    while (rows.length && rows[rows.length - 1].every(function (x) { return String(x).trim() === ''; })) rows.pop();
    return rows;
  }

  /* ---------------- 日期 ---------------- */

  /** Excel 日期序列号 → 'YYYY-MM-DD'（1900 日期系统，含 1900 闰年 bug 补偿） */
  function excelDate(serial) {
    var n = Number(serial);
    if (!isFinite(n) || n <= 0) return '';
    var ms = Math.round((n - 25569) * 86400000);
    var d = new Date(ms);
    if (isNaN(d.getTime())) return '';
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }

  /* ---------------- 主流程 ---------------- */

  function readArrayBuffer(input) {
    var u8 = (input instanceof Uint8Array) ? input : new Uint8Array(input);

    /* 先看是不是 zip（xlsx 一定以 PK\x03\x04 开头） */
    if (!(u8[0] === 0x50 && u8[1] === 0x4b)) {
      /* 不是 zip → 当作 CSV/文本处理 */
      var text = u8ToStr(u8);
      return Promise.resolve({ rows: parseCsv(text), sheetName: '(CSV)', source: 'csv' });
    }

    var entries;
    try { entries = listEntries(u8); }
    catch (e) { return Promise.reject(e); }

    var byName = {};
    entries.forEach(function (e) { byName[e.name] = e; });

    /* 选工作表：优先 sheet1.xml，否则第一个 worksheets/*.xml */
    var sheetName = 'xl/worksheets/sheet1.xml';
    if (!byName[sheetName]) {
      var cand = entries.filter(function (e) { return /^xl\/worksheets\/.*\.xml$/.test(e.name); });
      if (!cand.length) return Promise.reject(new Error('这个 .xlsx 里没有工作表'));
      sheetName = cand[0].name;
    }

    var sstName = 'xl/sharedStrings.xml';
    var sstPromise = byName[sstName]
      ? readEntry(u8, byName[sstName]).then(function (b) { return parseSst(u8ToStr(b)); })
      : Promise.resolve([]);

    return sstPromise.then(function (sst) {
      return readEntry(u8, byName[sheetName]).then(function (b) {
        var rows = parseSheet(u8ToStr(b), sst);
        return { rows: rows, sheetName: sheetName.replace(/^xl\/worksheets\//, '').replace(/\.xml$/, ''), source: 'xlsx' };
      });
    });
  }

  function readFile(file) {
    if (!file) return Promise.reject(new Error('没有选择文件'));
    var name = String(file.name || '').toLowerCase();

    if (/\.(xlsx|xlsm)$/.test(name)) {
      return readFileAsArrayBuffer(file).then(readArrayBuffer);
    }
    if (/\.csv$/.test(name)) {
      return readFileAsText(file).then(function (text) {
        return { rows: parseCsv(text), sheetName: '(CSV)', source: 'csv' };
      });
    }
    if (/\.xls$/.test(name)) {
      return Promise.reject(new Error('不支持老版 .xls（二进制格式）。请在 Excel 里另存为 .xlsx 或 .csv 再导入。'));
    }
    /* 未知后缀：先按二进制试 zip，不行就当文本 */
    return readFileAsArrayBuffer(file).then(readArrayBuffer).catch(function () {
      return readFileAsText(file).then(function (text) {
        return { rows: parseCsv(text), sheetName: '(文本)', source: 'csv' };
      });
    });
  }

  function readFileAsArrayBuffer(file) {
    if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(new Error('读取文件失败')); };
      fr.readAsArrayBuffer(file);
    });
  }

  function readFileAsText(file) {
    if (typeof file.text === 'function') return file.text();
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result || '')); };
      fr.onerror = function () { reject(new Error('读取文件失败')); };
      fr.readAsText(file, 'utf-8');
    });
  }

  return {
    readFile: readFile,
    readArrayBuffer: readArrayBuffer,
    parseCsv: parseCsv,
    excelDate: excelDate,
    /* 测试入口 */
    _listEntries: listEntries,
    _readEntry: readEntry,
    _parseSst: parseSst,
    _parseSheet: parseSheet,
    _colIndex: colIndex,
    _inflateRaw: inflateRaw
  };
})();
