/* =========================================================
   components/xlsxWriter.js — 零依赖「真 .xlsx」生成器
   ────────────────────────────────────────────────────────
   · 不引任何外部库、不依赖 CDN，断网可用，file:// 直接可用。
   · 用 stored（不压缩）ZIP + CRC32 把若干 XML 部件打包成合法 OOXML。
   · 单元格用 inlineStr（内联字符串），避免共享字符串表，简单且 Excel 原生支持。
   · 支持：多工作表、加粗、底纹填充、文字色、水平/垂直对齐、自动换行、
           细边框、数字格式（如 0.0%）、列宽、合并单元格、行高。
   · 用法：
       var blob = SD.comp.xlsxWriter.build([{ name:'日报', cols:[{width:20}], rows:[...] }]);
       SD.comp.xlsxWriter.download(blob, '安全日报.xlsx');
   · 单元格 cell 允许：
       - 原始值（string / number / boolean）→ 普通单元格
       - 对象 { v, bold, fill, color, align, valign, wrap, border, numFmt, h, mergeAcross, mergeDown, t }
       - sheet.page（可选）：{ orientation:'landscape', paperSize:9, fitToWidth:1, fitToHeight:1 }
         出件就是为了打印的表格（如交接班记录）用：A4 横向 + 缩放到一页，内容不会漏到第二页
         · fill / color 用 6 位十六进制（不含 #），如 'D9E1F2'
         · align: 'left' | 'center' | 'right'
         · valign: 'top' | 'center' | 'bottom'
         · numFmt: 格式串，如 '0.0%'、'0.00'、'#,##0'
         · h: 行高（数字，单位 pt）
         · mergeAcross / mergeDown: 跨列 / 跨行数（合并以左上角单元格为准）
   ========================================================= */
window.SD = window.SD || {};
var SD = window.SD;
SD.comp = SD.comp || {};

SD.comp.xlsxWriter = (function () {
  /* ---------------- 基础工具 ---------------- */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // UTF-8 编码（手写，避免环境差异）
  function utf8(s) {
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) {
        out.push(c);
      } else if (c < 0x800) {
        out.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F));
      } else if (c >= 0xD800 && c <= 0xDBFF) {
        var c2 = s.charCodeAt(++i);
        var cp = 0x10000 + ((c - 0xD800) << 10) + (c2 - 0xDC00);
        out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3F), 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
      } else {
        out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
      }
    }
    return new Uint8Array(out);
  }

  // CRC32（标准表，置反）
  var CRC = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(buf) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /* ---------------- 列式编号 ---------------- */
  function colLetter(idx) {
    var s = '';
    idx = idx + 1;
    while (idx > 0) {
      var m = (idx - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      idx = Math.floor((idx - 1) / 26);
    }
    return s;
  }

  /* ---------------- 样式管理 ----------------
     收集用到的字体 / 填充 / 边框 / 数字格式，统一生成 cellXfs。 */
  var DEFAULT_FONT = '等线';
  function   StyleEngine() {
    this.fonts = [{ bold: false, color: null, size: 11, name: DEFAULT_FONT }];   // 索引 0 默认
    this.fills = [null, null];                                // 0 none, 1 gray125（占位）
    this.borders = [{ key: null }];                            // 0 无边框
    this.numFmts = [];                                        // {id, code}
    this.xfs = [];                                            // 样式描述 → xf 索引
    this.xfMap = {};
  }
  StyleEngine.prototype.fontId = function (f) {
    var name = f.name || DEFAULT_FONT;
    for (var i = 0; i < this.fonts.length; i++) {
      var x = this.fonts[i];
      if (x.bold === (f.bold || false) && (x.color || null) === (f.color || null) &&
          (x.size || 11) === (f.size || 11) && (x.name || DEFAULT_FONT) === name) return i;
    }
    this.fonts.push({ bold: !!f.bold, color: f.color || null, size: f.size || 11, name: name });
    return this.fonts.length - 1;
  };
  StyleEngine.prototype.fillId = function (hex) {
    if (!hex) return 0;
    hex = String(hex).replace(/^#/, '').toUpperCase();
    for (var i = 0; i < this.fills.length; i++) if (this.fills[i] === hex) return i;
    this.fills.push(hex);
    return this.fills.length - 1;
  };
  StyleEngine.prototype.borderId = function (on) {
    if (!on) return 0;
    /* 逐边边框：border: true = 四边细线（老用法）；
       border: {l:'m',r:'m',t:'t',b:'t'} = 左边中等、右边中等、上/下细线，
       'm' = medium（原表的外框用）、't' = thin、缺省 = 不画。
       交接班记录要照原表复刻：外框 medium、内线 thin，「检查内容」列没有左右竖线。 */
    var d = (on === true) ? { l: 't', r: 't', t: 't', b: 't' }
      : { l: on.l || null, r: on.r || null, t: on.t || null, b: on.b || null };
    var key = [d.l, d.r, d.t, d.b].join(',');
    for (var i = 0; i < this.borders.length; i++) if (this.borders[i].key === key) return i;
    this.borders.push({ key: key, l: d.l, r: d.r, t: d.t, b: d.b });
    return this.borders.length - 1;
  };
  StyleEngine.prototype.numFmtId = function (code) {
    if (!code) return 0;
    for (var i = 0; i < this.numFmts.length; i++) if (this.numFmts[i].code === code) return this.numFmts[i].id;
    var id = 164 + this.numFmts.length;
    this.numFmts.push({ id: id, code: code });
    return id;
  };
  // 取（或新建）某单元格样式对应的 xf 索引
  StyleEngine.prototype.xf = function (cell) {
    var f = {
      bold: !!cell.bold,
      color: cell.color || null,
      size: cell.size || 11,
      font: cell.font || null,          /* 字体名，如 '宋体'（不传用等线） */
      fill: cell.fill || null,
      border: cell.border || null,          /* true 或 {l,r,t,b}（逐边） */
      align: cell.align || null,
      valign: cell.valign || null,
      wrap: !!cell.wrap,
      numFmt: cell.numFmt || null
    };
    var key = JSON.stringify(f);
    if (this.xfMap[key] != null) return this.xfMap[key];
    var xf = {
      fontId: this.fontId({ bold: f.bold, color: f.color, size: f.size, name: f.font }),
      fillId: this.fillId(f.fill),
      borderId: this.borderId(f.border),
      numFmtId: this.numFmtId(f.numFmt),
      align: f.align, valign: f.valign, wrap: f.wrap
    };
    this.xfs.push(xf);
    /* 0 号 xf 是「默认样式」的保留位：cellValueXml 只在 s>0 时写 s 属性，
       如果第一个用到的样式拿到 0，这一格的加粗 / 居中 / 底纹会被整个丢掉
       （交接班记录的标题行就踩过：16pt 加粗居中全没了）。所以从 1 开始编号。 */
    var idx = this.xfs.length;
    this.xfMap[key] = idx;
    return idx;
  };

  StyleEngine.prototype.stylesXml = function () {
    var i, x;
    // fonts
    var fb = ['<fonts count="' + this.fonts.length + '">'];
    this.fonts.forEach(function (f) {
      var s = '<font>';
      if (f.bold) s += '<b/>';
      s += '<sz val="' + (f.size || 11) + '"/>';
      if (f.color) s += '<color rgb="FF' + f.color.toUpperCase() + '"/>';
      else s += '<color theme="1"/>';
      s += '<name val="' + esc(f.name || DEFAULT_FONT) + '"/><family val="2"/></font>';
      fb.push(s);
    });
    fb.push('</fonts>');

    // fills（索引 0 none，1 gray125，其后自定义纯色）
    var flb = ['<fills count="' + this.fills.length + '">'];
    flb.push('<fill><patternFill patternType="none"/></fill>');
    flb.push('<fill><patternFill patternType="gray125"/></fill>');
    for (i = 2; i < this.fills.length; i++) {
      flb.push('<fill><patternFill patternType="solid"><fgColor rgb="FF' + this.fills[i] + '"/><bgColor indexed="64"/></patternFill></fill>');
    }
    flb.push('</fills>');

    // borders
    var bb = ['<borders count="' + this.borders.length + '">'];
    this.borders.forEach(function (b) {
      if (!b.key) {
        bb.push('<border><left/><right/><top/><bottom/><diagonal/></border>');
      } else {
        /* 逐边生成：'m' → medium、't' → thin、null → 不画 */
        function side(name, st) {
          return '<' + name + (st ? ' style="' + (st === 'm' ? 'medium' : 'thin') + '"' : '') +
            '><color rgb="FF000000"/></' + name + '>';
        }
        bb.push('<border>' + side('left', b.l) + side('right', b.r) +
          side('top', b.t) + side('bottom', b.b) + '<diagonal/></border>');
      }
    });
    bb.push('</borders>');

    // numFmts
    var nb = '';
    if (this.numFmts.length) {
      nb = '<numFmts count="' + this.numFmts.length + '">';
      this.numFmts.forEach(function (n) { nb += '<numFmt numFmtId="' + n.id + '" formatCode="' + esc(n.code) + '"/>'; });
      nb += '</numFmts>';
    }

    // cellXfs（0 号是默认样式占位，真正用到的样式从 1 号开始）
    var xb = ['<cellXfs count="' + (this.xfs.length + 1) + '">'];
    xb.push('<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>');
    this.xfs.forEach(function (xf) {
      var s = '<xf numFmtId="' + xf.numFmtId + '" fontId="' + xf.fontId + '" fillId="' + xf.fillId +
              '" borderId="' + xf.borderId + '" xfId="0"';
      var apply = [];
      if (xf.fontId) apply.push('applyFont="1"');
      if (xf.fillId) apply.push('applyFill="1"');
      if (xf.borderId) apply.push('applyBorder="1"');
      if (xf.numFmtId) apply.push('applyNumberFormat="1"');
      if (xf.align || xf.valign || xf.wrap) apply.push('applyAlignment="1"');
      s += ' ' + apply.join(' ') + '>';
      if (xf.align || xf.valign || xf.wrap) {
        s += '<alignment' +
          (xf.align ? ' horizontal="' + xf.align + '"' : '') +
          (xf.valign ? ' vertical="' + xf.valign + '"' : '') +
          (xf.wrap ? ' wrapText="1"' : '') + '/>';
      }
      s += '</xf>';
      xb.push(s);
    });
    xb.push('</cellXfs>');

    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      nb +
      fb.join('') + flb.join('') + bb.join('') +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      xb.join('') +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      '</styleSheet>';
  };

  /* ---------------- 工作表 XML ---------------- */
  function cellValueXml(cell, se, ref) {
    var isObj = cell && typeof cell === 'object';
    var v = isObj ? cell.v : cell;
    var styleIdx = isObj ? se.xf(cell) : 0;
    var sAttr = styleIdx ? ' s="' + styleIdx + '"' : '';
    if (v == null || v === '') {
      return '<c r="' + ref + '"' + sAttr + '/>';
    }
    if (typeof v === 'number' && isFinite(v)) {
      return '<c r="' + ref + '"' + sAttr + '><v>' + v + '</v></c>';
    }
    if (typeof v === 'boolean') {
      return '<c r="' + ref + '"' + sAttr + ' t="inlineStr"><is><t>' + (v ? '是' : '否') + '</t></is></c>';
    }
    // 字符串 → 内联字符串
    return '<c r="' + ref + '"' + sAttr + ' t="inlineStr"><is><t xml:space="preserve">' + esc(v) + '</t></is></c>';
  }

  function sheetXml(sheet, se, withDrawing) {
    var rowsXml = [];
    var merges = [];
    var r = 0;
    (sheet.rows || []).forEach(function (row, ri) {
      r = ri + 1;
      var cells = row.cells || row;   // 兼容 {cells:[...], h:行高} 与 纯数组
      /* 行高：写在行上（{cells:[...], h:30}）或写在首格上（[{v:.., h:30}]）都认。
         之前只认行上的，调用方普遍写在首格 → ht 属性从来没生效过。 */
      var h = row.h || null;
      if (!h && cells.length && cells[0] && typeof cells[0] === 'object' && cells[0].h) h = cells[0].h;
      var attrs = ' r="' + r + '"';
      if (h) attrs += ' ht="' + h + '" customHeight="1"';
      var inner = '';
      var c = -1;   /* 默认从 A 列（0）起；带 col 的格子直接钉到指定列 */
      cells.forEach(function (cell) {
        /* ★ 支持显式列位 cell.col（0 起）。
           之前一律按数组顺序往 A/B/C… 落，一旦某行前面出现 mergeAcross 的格子，
           后面的格子就会落到被合并掉的列上、内容被一口吃掉
           （交接班记录的抬头行：班次 / 日期被 A:C 合并吞掉 → 保存页上「漏了班次和时间」）。
           带 col 的格子直接钉到指定列，合并算的也是它自己的位置。 */
        if (cell && typeof cell === 'object' && cell.col != null) c = cell.col;
        else c = c + 1;
        var ref = colLetter(c) + r;
        inner += cellValueXml(cell, se, ref);
        if (cell && typeof cell === 'object') {
          if (cell.mergeAcross || cell.mergeDown) {
            var toC = c + (cell.mergeAcross || 0);
            var toR = r + (cell.mergeDown || 0);
            merges.push(colLetter(c) + r + ':' + colLetter(toC) + toR);
          }
        }
      });
      rowsXml.push('<row' + attrs + '>' + inner + '</row>');
    });

    var colsXml = '';
    if (sheet.cols && sheet.cols.length) {
      colsXml = '<cols>';
      sheet.cols.forEach(function (col, i) {
        var w = (col.width || 12);
        // 没显式给 min 时按数组下标递增。之前写成 col.index || 1，而调用方
        // （report.js）传的 cols 不带 index → 6 个 col 全是 min=1/max=1，
        // 重叠定义同一列，Excel / WPS / openpyxl 都会判「工作表损坏」拒开。
        var min = col.min || (i + 1);
        var max = col.max || min;
        colsXml += '<col min="' + min + '" max="' + max + '" width="' + w + '" customWidth="1"/>';
      });
      colsXml += '</cols>';
    }

    var mergeXml = '';
    if (merges.length) {
      mergeXml = '<mergeCells count="' + merges.length + '">' +
        merges.map(function (m) { return '<mergeCell ref="' + m + '"/>'; }).join('') + '</mergeCells>';
    }

    /* 页面设置（可选）：orientation / paperSize / fitToWidth / fitToHeight / margins
       margins 用英寸；不传时用「常规」（Excel「普通」预设：左右 0.7、上下 0.75、页眉页脚 0.3） */
    var pg = sheet.page || null;
    var sheetPrXml = '';
    var pageXml = '';
    if (pg) {
      var o = pg.orientation || 'portrait';
      var fit = (pg.fitToWidth || pg.fitToHeight) ? 1 : 0;
      var mg = pg.margins || {};
      sheetPrXml = '<sheetPr>' + (fit ? '<pageSetUpPr fitToPage="1"/>' : '') + '</sheetPr>';
      pageXml =
        '<pageMargins left="' + (mg.left != null ? mg.left : 0.7) +
        '" right="' + (mg.right != null ? mg.right : 0.7) +
        '" top="' + (mg.top != null ? mg.top : 0.75) +
        '" bottom="' + (mg.bottom != null ? mg.bottom : 0.75) +
        '" header="' + (mg.header != null ? mg.header : 0.3) +
        '" footer="' + (mg.footer != null ? mg.footer : 0.3) + '"/>' +
        '<pageSetup orientation="' + o + '"' +
        ' paperSize="' + (pg.paperSize || 9) + '"' +
        (fit ? ' fitToWidth="' + (pg.fitToWidth || 1) + '" fitToHeight="' + (pg.fitToHeight || 1) + '"' : '') +
        '/>';
    }

    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      sheetPrXml +
      /* sheetView 不带 pane：ECMA-376 里 pane 的 state 合法值只有
         frozen/split/frozenSplit，之前写的 state="visible" 是臆造值，
         严格解析器（新版 Excel / openpyxl）会拒开并报「工作表损坏」。
         这里本来就不冻结任何行，pane 整个去掉即可。 */
      '<sheetViews><sheetView workbookViewId="0"/></sheetViews>' +
      '<sheetFormatPr defaultRowHeight="16"/>' +
      colsXml +
      '<sheetData>' + rowsXml.join('') + '</sheetData>' +
      mergeXml +
      pageXml +
      (withDrawing ? '<drawing r:id="rId1"/>' : '') +
      '</worksheet>';
  }

  /* ---------------- 图片（如左上角公司标识） ----------------
     sheet.image = { data:'<base64>', w:165, h:30, col:0, row:0, colOff:6350, rowOff:85725 }
     用 oneCellAnchor 钉在指定格子的左上角，尺寸按 w/h（px）换算 EMU（1px = 9525EMU）。
     原表《现场安全巡检与交接班记录.xlsx》就是把 logo 钉在第 1 行 A1:C1 区域里的。 */
  function b64ToBytes(b64) {
    var T = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    var s = String(b64 || '').replace(/[^A-Za-z0-9+/]/g, '');
    var pad = s.length % 4 === 2 ? 1 : (s.length % 4 === 3 ? 2 : 0);
    var out = [], i = 0;
    while (i < s.length) {
      var a = T.indexOf(s.charAt(i++)), b = T.indexOf(s.charAt(i++));
      var c = i < s.length ? T.indexOf(s.charAt(i++)) : -1;
      var d = i < s.length ? T.indexOf(s.charAt(i++)) : -1;
      var n = (a << 18) | (b << 12) | ((c < 0 ? 0 : c) << 6) | (d < 0 ? 0 : d);
      out.push((n >> 16) & 255);
      if (c >= 0) out.push((n >> 8) & 255);
      if (d >= 0) out.push(n & 255);
    }
    return new Uint8Array(out);
  }

  function drawingXml(img) {
    var w = img.w || 165, h = img.h || 30;
    var cx = Math.round(w * 9525), cy = Math.round(h * 9525);
    var col = img.col || 0, row = img.row || 0;
    var colOff = img.colOff == null ? 6350 : img.colOff;
    var rowOff = img.rowOff == null ? 85725 : img.rowOff;
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" ' +
      'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<xdr:oneCellAnchor>' +
      '<xdr:from><xdr:col>' + col + '</xdr:col><xdr:colOff>' + colOff + '</xdr:colOff>' +
      '<xdr:row>' + row + '</xdr:row><xdr:rowOff>' + rowOff + '</xdr:rowOff></xdr:from>' +
      '<xdr:ext cx="' + cx + '" cy="' + cy + '"/>' +
      '<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="logo"/><xdr:cNvPicPr/><xdr:nvPr/></xdr:nvPicPr>' +
      '<xdr:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>' +
      '<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm>' +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic>' +
      '<xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>';
  }

  function sheetNameSafe(name, i) {
    var s = String(name || ('Sheet' + (i + 1))).replace(/[\\\/\?\*\[\]:]/g, '').substring(0, 31);
    if (!s) s = 'Sheet' + (i + 1);
    return s;
  }

  /* ---------------- 打包 ZIP（stored，不压缩） ---------------- */
  function zip(files) {
    var parts = [];
    var central = [];
    var offset = 0;
    files.forEach(function (f) {
      var nameBytes = utf8(f.name);
      var data = f.data;
      var crc = crc32(data);
      var local = new Uint8Array(30 + nameBytes.length + data.length);
      var dv = new DataView(local.buffer);
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, 20, true);
      dv.setUint16(6, 0, true);
      dv.setUint16(8, 0, true);
      dv.setUint16(10, 0, true);
      dv.setUint16(12, 0, true);
      dv.setUint32(14, crc, true);
      dv.setUint32(18, data.length, true);
      dv.setUint32(22, data.length, true);
      dv.setUint16(26, nameBytes.length, true);
      dv.setUint16(28, 0, true);
      local.set(nameBytes, 30);
      local.set(data, 30 + nameBytes.length);
      parts.push(local);

      var cd = new Uint8Array(46 + nameBytes.length);
      var cv = new DataView(cd.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, 0, true);
      cv.setUint16(14, 0, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(42, offset, true); // relative offset of local header
      cd.set(nameBytes, 46);
      central.push(cd);

      offset += local.length;
    });

    var centralSize = central.reduce(function (a, c) { return a + c.length; }, 0);
    var total = offset + centralSize + 22;
    var out = new Uint8Array(total);
    var pos = 0;
    parts.forEach(function (p) { out.set(p, pos); pos += p.length; });
    central.forEach(function (c) { out.set(c, pos); pos += c.length; });
    var ev = new DataView(out.buffer, pos);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);
    ev.setUint16(20, 0, true);
    return out;
  }

  /* ---------------- 对外：build / download ---------------- */
  function build(sheets, opts) {
    opts = opts || {};
    sheets = (sheets || []).map(function (s, i) {
      return { name: sheetNameSafe(s.name, i), cols: s.cols || [], rows: s.rows || [], page: s.page, image: s.image };
    });
    var se = new StyleEngine();

    var contentTypes =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      (sheets.some(function (s) { return s.image && s.image.data; }) ? '<Default Extension="png" ContentType="image/png"/>' : '') +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      sheets.map(function (s, i) {
        var s1 = '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
        if (s.image && s.image.data) {
          s1 += '<Override PartName="/xl/drawings/drawing' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>';
        }
        return s1;
      }).join('') +
      '</Types>';

    var rootRels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>';

    var wbSheets = sheets.map(function (s, i) {
      return '<sheet name="' + esc(s.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>';
    }).join('');
    var workbook =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets>' + wbSheets + '</sheets></workbook>';

    var wbRels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map(function (s, i) {
        return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>';
      }).join('') +
      '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>';

    // 先渲染所有工作表，把用到的样式收集进 se（样式必须早于 styles.xml 生成）
    var sheetXmls = sheets.map(function (s) { return sheetXml(s, se, !!(s.image && s.image.data)); });
    var styles = se.stylesXml();

    var files = [
      { name: '[Content_Types].xml', data: utf8(contentTypes) },
      { name: '_rels/.rels', data: utf8(rootRels) },
      { name: 'xl/workbook.xml', data: utf8(workbook) },
      { name: 'xl/_rels/workbook.xml.rels', data: utf8(wbRels) },
      { name: 'xl/styles.xml', data: utf8(styles) }
    ];
    sheetXmls.forEach(function (xml, i) {
      files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: utf8(xml) });
    });
    /* 图片部件：media + drawing + 两级 rels（工作表 → drawing → 图片） */
    sheets.forEach(function (s, i) {
      if (!s.image || !s.image.data) return;
      var n = i + 1;
      files.push({ name: 'xl/media/image' + n + '.png', data: b64ToBytes(s.image.data) });
      files.push({ name: 'xl/drawings/drawing' + n + '.xml', data: utf8(drawingXml(s.image)) });
      files.push({
        name: 'xl/drawings/_rels/drawing' + n + '.xml.rels',
        data: utf8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" ' +
          'Target="../media/image' + n + '.png"/></Relationships>')
      });
      files.push({
        name: 'xl/worksheets/_rels/sheet' + n + '.xml.rels',
        data: utf8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" ' +
          'Target="../drawings/drawing' + n + '.xml"/></Relationships>')
      });
    });

    var bytes = zip(files);
    // Blob（浏览器）；Node 环境下用 Buffer 兼容
    if (typeof Blob === 'function') return new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    return bytes;
  }

  function download(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename || 'report.xlsx';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  return { build: build, download: download, _zip: zip, _utf8: utf8, _crc32: crc32, _colLetter: colLetter, _b64ToBytes: b64ToBytes, _drawingXml: drawingXml };
})();
