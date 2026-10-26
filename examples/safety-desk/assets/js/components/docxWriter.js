/* =========================================================
   components/docxWriter.js — 零依赖「真 .docx」生成器
   ────────────────────────────────────────────────────────
   为什么从 MHTML(.doc) 换成真 .docx：
     之前 Word 出件走「规范 MHTML 冒充 .doc」，虽然补齐了 MIME-Version /
     Content-Location / base64 折行，用户实测仍出现「打开空白、照片不显示」——
     Word 的 HTML 导入对各版本行为不一（cid 解析、Content-Location 优先权、
     SVG 位图支持都有差异），.doc 里塞 HTML 本质是猜格式。
     .docx 是 Word/WPS 的亲生格式：图片作为 media 部件 + DrawingML 引用，
     没有任何导入歧义，也不会再弹「格式与扩展名不匹配」。

   做法（与 xlsxWriter 同套路）：
     · stored（不压缩）ZIP + CRC32，把若干 XML 部件打包成合法 OOXML；
     · 段落 / 表格（行高、跨列、边框、垂直对齐）/ 内嵌图片（EMU 尺寸）；
     · 图片只认 base64 位图 dataURL（jpeg/png/gif）；SVG 等先用
       rasterize() 过一遍 canvas 转 PNG（示例数据的占位图是 SVG，真实照片
       走 photoPicker 压缩出来就是 JPEG，通常不需要转）。

   用法：
     SD.comp.docxWriter.build({
       title: '隐患整改通知书',
       page: { w:11906, h:16838, mTop:1440, mRight:1797, mBottom:697, mLeft:1797 },
       blocks: [
         { p:'标题', size:44, bold:true, align:'center' },
         { table:{ cols:[989,7323], border:'000000', rows:[
           { h:780, cells:[ { span:2, paras:[{p:'隐患整改通知书', size:44, bold:true, align:'center'}], valign:'center' } ] },
           { h:6600, cells:[
             { paras:[{p:'事故隐患', size:40, bold:true, align:'center'}], valign:'center' },
             { valign:'top',
               paras:[{p:'正文…', size:24, line:432}],
               imgs:[{ src:'data:image/jpeg;base64,…', wPt:180, hPt:120 }] }
           ] }
         ] } }
       ]
     });
     SD.comp.docxWriter.download(blob, 'xxx.docx');

   单位约定：
     · page / 表格列宽 / 行高：twips（1pt = 20 twips，1mm ≈ 56.7 twips）
     · 字号 size：半点（half-point，22pt 写 44）
     · 图片 wPt / hPt：磅（pt），内部按 1pt = 12700 EMU 换算
   ========================================================= */
window.SD = window.SD || {};
SD.comp = SD.comp || {};

SD.comp.docxWriter = (function () {
  /* ---------------- 基础工具（与 xlsxWriter 同源） ---------------- */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }

  function utf8(s) {
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F));
      else if (c >= 0xD800 && c <= 0xDBFF) {
        var c2 = s.charCodeAt(++i);
        var cp = 0x10000 + ((c - 0xD800) << 10) + (c2 - 0xDC00);
        out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3F), 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
      } else {
        out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
      }
    }
    return new Uint8Array(out);
  }

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

  /* stored ZIP（不压缩）：OOXML 合法，且解包方不需要 inflate */
  function zip(files) {
    var parts = [], central = [], offset = 0;
    files.forEach(function (f) {
      var nameBytes = utf8(f.name);
      var data = f.data;
      var crc = crc32(data);
      var local = new Uint8Array(30 + nameBytes.length + data.length);
      var dv = new DataView(local.buffer);
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, 20, true); dv.setUint16(6, 0, true); dv.setUint16(8, 0, true);
      dv.setUint16(10, 0, true); dv.setUint16(12, 0, true);
      dv.setUint32(14, crc, true);
      dv.setUint32(18, data.length, true); dv.setUint32(22, data.length, true);
      dv.setUint16(26, nameBytes.length, true); dv.setUint16(28, 0, true);
      local.set(nameBytes, 30);
      local.set(data, 30 + nameBytes.length);
      parts.push(local);

      var cd = new Uint8Array(46 + nameBytes.length);
      var cv = new DataView(cd.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0, true);
      cv.setUint16(10, 0, true); cv.setUint16(12, 0, true); cv.setUint16(14, 0, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
      cv.setUint16(28, nameBytes.length, true); cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true); cv.setUint16(34, 0, true); cv.setUint16(36, 0, true);
      cv.setUint32(42, offset, true);
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
    ev.setUint16(4, 0, true); ev.setUint16(6, 0, true);
    ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
    ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true);
    ev.setUint16(20, 0, true);
    return out;
  }

  /* base64 → bytes（浏览器 atob / Node Buffer 双环境） */
  function b64ToBytes(b64) {
    var clean = String(b64 || '').replace(/[\r\n\s]/g, '');
    if (!clean) return new Uint8Array(0);
    if (typeof atob === 'function') {
      var bin = atob(clean);
      var out = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    return new Uint8Array(Buffer.from(clean, 'base64'));
  }

  function splitData(src) {
    var m = /^data:([^;,]+);base64,([\s\S]*)$/.exec(src || '');
    return m ? { mime: m[1], b64: m[2] } : null;
  }

  /* ---------------- 图片规范化：SVG 等非位图过 canvas 转 PNG ----------------
     示例数据的占位图是 URL 编码的 SVG dataURL，Word 嵌不了；
     真实照片（photoPicker 出来）本就是 JPEG base64，原样返回不折腾。
     无 canvas 环境（jsdom 测试）返回 null，调用方跳过该图。 */
  function rasterize(src, cb) {
    if (!src) return cb(null);
    if (/^data:image\/(jpeg|png|gif);base64,/i.test(src)) return cb(src);
    if (!/^data:/i.test(src)) return cb(null);                 // blob:/http: 同步拿不到字节
    if (typeof document === 'undefined' || !document.createElement || typeof Image === 'undefined') return cb(null);
    // 先探 canvas：没有 2d 上下文（如 jsdom 测试环境）直接放弃，
    // 不然 new Image() 的 onload 永远不触发，调用方会被挂死
    var probe = document.createElement('canvas');
    if (!probe.getContext || !probe.getContext('2d')) return cb(null);
    var img = new Image();
    img.onload = function () {
      try {
        var w = img.naturalWidth || 640, h = img.naturalHeight || 480;
        var c = document.createElement('canvas');
        c.width = w; c.height = h;
        var g = c.getContext('2d');
        if (!g) return cb(null);
        g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
        g.drawImage(img, 0, 0, w, h);
        cb(c.toDataURL('image/png'));
      } catch (e) { cb(null); }
    };
    img.onerror = function () { cb(null); };
    img.src = src;
  }

  /* ---------------- WordprocessingML 片段 ---------------- */
  var XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

  function rPrXml(r) {
    var s = '<w:rPr>';
    if (r.bold) s += '<w:b/><w:bCs/>';
    if (r.color) s += '<w:color w:val="' + esc(r.color) + '"/>';
    s += '<w:rFonts w:ascii="SimSun" w:eastAsia="SimSun" w:hAnsi="SimSun" w:cs="SimSun"/>';
    s += '<w:sz w:val="' + (r.size || 21) + '"/><w:szCs w:val="' + (r.size || 21) + '"/>';
    return s + '</w:rPr>';
  }

  /** 段落：{ p:'文本', size, bold, color, align, after, line } */
  function paraXml(p) {
    p = p || {};
    var s = '<w:p><w:pPr>';
    if (p.align) s += '<w:jc w:val="' + esc(p.align) + '"/>';
    s += '<w:spacing w:before="0" w:after="' + (p.after || 0) +
         '" w:line="' + (p.line || 240) + '" w:lineRule="auto"/>';
    s += '</w:pPr>';
    var t = p.p == null ? '' : String(p.p);
    if (t) s += '<w:r>' + rPrXml(p) + '<w:t xml:space="preserve">' + esc(t) + '</w:t></w:r>';
    return s + '</w:p>';
  }

  /** 图片段：注册 media + 关系，返回 <w:p>（含 DrawingML 引用） */
  function imgParaXml(im, ctx) {
    return drawingRun(im, ctx, true);
  }

  /** 横排图片组：同一段内多个 inline 图片（Word 中横向并排），整段居中 */
  function imgRowXml(ims, ctx) {
    var runs = '';
    (ims || []).forEach(function (im) { runs += drawingRun(im, ctx, false); });
    if (!runs) return '<w:p/>';
    return '<w:p><w:pPr><w:jc w:val="center"/>' +
      '<w:spacing w:before="0" w:after="40" w:line="240" w:lineRule="auto"/></w:pPr>' +
      runs + '</w:p>';
  }

  /** 单图 DrawingML run；asPara=true 时外面再包 <w:p> */
  function drawingRun(im, ctx, asPara) {
    var d = splitData(im.src);
    if (!d) return asPara ? '<w:p/>' : '';
    var ext = d.mime === 'image/png' ? 'png' : (d.mime === 'image/gif' ? 'gif' : 'jpg');
    var idx = ctx.media.length + 1;
    ctx.media.push({ ext: ext, mime: d.mime, bytes: b64ToBytes(d.b64) });
    var rid = 'rId' + idx;
    var id = ++ctx.docId;
    var cx = Math.round((im.wPt || 60) * 12700);
    var cy = Math.round((im.hPt || 45) * 12700);
    var run = '<w:r><w:rPr><w:noProof/></w:rPr><w:drawing>' +
      '<wp:inline distT="0" distB="0" distL="0" distR="0">' +
      '<wp:extent cx="' + cx + '" cy="' + cy + '"/>' +
      '<wp:effectExtent l="0" t="0" r="0" b="0"/>' +
      '<wp:docPr id="' + id + '" name="图片' + id + '"/>' +
      '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
      '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      '<pic:pic><pic:nvPicPr><pic:cNvPr id="' + id + '" name="图片' + id + '"/><pic:cNvPicPr/></pic:nvPicPr>' +
      '<pic:blipFill><a:blip r:embed="' + rid + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
      '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm>' +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
      '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
    return asPara ? '<w:p><w:pPr><w:jc w:val="center"/>' +
      '<w:spacing w:before="0" w:after="40" w:line="240" w:lineRule="auto"/></w:pPr>' +
      run + '</w:p>' : run;
  }

  var BORDER_SIDE = function (color) {
    return '<w:top w:val="single" w:sz="4" w:color="' + color + '"/>' +
           '<w:left w:val="single" w:sz="4" w:color="' + color + '"/>' +
           '<w:bottom w:val="single" w:sz="4" w:color="' + color + '"/>' +
           '<w:right w:val="single" w:sz="4" w:color="' + color + '"/>' +
           '<w:insideH w:val="single" w:sz="4" w:color="' + color + '"/>' +
           '<w:insideV w:val="single" w:sz="4" w:color="' + color + '"/>';
  };

  function tableXml(t, ctx) {
    var cols = t.cols || [];
    var totalW = cols.reduce(function (a, b) { return a + b; }, 0);
    var grid = cols.map(function (c) { return '<w:gridCol w:w="' + c + '"/>'; }).join('');
    var rows = (t.rows || []).map(function (row) {
      // trHeight 必须包在 <w:trPr> 里（直接挂 <w:tr> 下是非法的，Word 会忽略行高）
      var tr = '<w:tr>';
      if (row.h) tr += '<w:trPr><w:trHeight w:val="' + row.h + '" w:hRule="atLeast"/></w:trPr>';
      var cells = (row.cells || []).map(function (cell) {
        var span = cell.span || 1;
        var w = cell.w != null ? cell.w : cols.slice(0, span).reduce(function (a, b) { return a + b; }, 0);
        var tcPr = '<w:tcPr><w:tcW w:w="' + w + '" w:type="dxa"/>';
        if (span > 1) tcPr += '<w:gridSpan w:val="' + span + '"/>';
        if (cell.valign) tcPr += '<w:vAlign w:val="' + esc(cell.valign) + '"/>';
        tcPr += '</w:tcPr>';
        var inner = '';
        (cell.imgRows || []).forEach(function (row) { inner += imgRowXml(row, ctx); });
        (cell.imgs || []).forEach(function (im) { inner += imgParaXml(im, ctx); });
        (cell.paras || []).forEach(function (p) { inner += paraXml(p); });
        if (!inner) inner = '<w:p/>';
        return '<w:tc>' + tcPr + inner + '</w:tc>';
      }).join('');
      return tr + cells + '</w:tr>';
    }).join('');
    var borders = t.border === false ? '' :
      '<w:tblBorders>' + BORDER_SIDE(esc(t.border || '000000')) + '</w:tblBorders>';
    /* 版式参数（默认值兼容旧调用）：
       layout  : 'fixed'（默认，列宽按 tblGrid 精确排）| 'autofit'（照企业原件的通知书用）
       cellMar : { top, left, bottom, right } 单元格内边距 twips（默认 40/100/40/100）
       ind     : 表格整体缩进 twips（参考原件 tblInd=270） */
    var layout = t.layout === 'autofit' ? 'autofit' : 'fixed';
    var cm = t.cellMar || {};
    var cellMar = '<w:tblCellMar>' +
      '<w:top w:w="' + (cm.top != null ? cm.top : 40) + '" w:type="dxa"/>' +
      '<w:left w:w="' + (cm.left != null ? cm.left : 100) + '" w:type="dxa"/>' +
      '<w:bottom w:w="' + (cm.bottom != null ? cm.bottom : 40) + '" w:type="dxa"/>' +
      '<w:right w:w="' + (cm.right != null ? cm.right : 100) + '" w:type="dxa"/>' +
      '</w:tblCellMar>';
    var ind = t.ind ? '<w:tblInd w:w="' + t.ind + '" w:type="dxa"/>' : '';
    return '<w:tbl><w:tblPr>' +
      '<w:tblW w:w="' + totalW + '" w:type="dxa"/>' +
      ind +
      borders +
      '<w:tblLayout w:type="' + layout + '"/>' +
      cellMar +
      '</w:tblPr><w:tblGrid>' + grid + '</w:tblGrid>' + rows + '</w:tbl>';
  }

  /* ---------------- 打包 ---------------- */
  function buildBytes(doc) {
    doc = doc || {};
    var page = Object.assign(
      { w: 11906, h: 16838, mTop: 1440, mRight: 1440, mBottom: 1440, mLeft: 1440 },
      doc.page || {});
    var ctx = { media: [], docId: 0 };

    var body = (doc.blocks || []).map(function (b) {
      return b.table ? tableXml(b.table, ctx) : paraXml(b);
    }).join('');

    var documentXml = XML_HEAD +
      '<w:document ' +
      'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
      'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
      'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
      'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      '<w:body>' + body +
      '<w:sectPr><w:pgSz w:w="' + page.w + '" w:h="' + page.h + '"/>' +
      '<w:pgMar w:top="' + page.mTop + '" w:right="' + page.mRight + '" w:bottom="' + page.mBottom +
      '" w:left="' + page.mLeft + '" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>' +
      '</w:body></w:document>';

    var stylesXml = XML_HEAD +
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:docDefaults><w:rPrDefault><w:rPr>' +
      '<w:rFonts w:ascii="SimSun" w:eastAsia="SimSun" w:hAnsi="SimSun" w:cs="SimSun"/>' +
      '<w:sz w:val="21"/><w:szCs w:val="21"/><w:lang w:val="en-US" w:eastAsia="zh-CN"/>' +
      '</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr>' +
      '<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
      '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/>' +
      '<w:tblPr><w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="100" w:type="dxa"/>' +
      '<w:bottom w:w="40" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>' +
      '</w:styles>';

    var relsXml = XML_HEAD +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      ctx.media.map(function (m, i) {
        return '<Relationship Id="rId' + (i + 1) + '" ' +
          'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" ' +
          'Target="media/image' + (i + 1) + '.' + m.ext + '"/>';
      }).join('') +
      '<Relationship Id="rId' + (ctx.media.length + 1) + '" ' +
      'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>';

    var exts = {};
    ctx.media.forEach(function (m) { exts[m.ext] = m.mime; });
    var ctDefaults = '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      Object.keys(exts).map(function (e) {
        return '<Default Extension="' + e + '" ContentType="' + exts[e] + '"/>';
      }).join('');
    var contentTypes = XML_HEAD +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' + ctDefaults +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
      '</Types>';

    var now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    var coreXml = XML_HEAD +
      '<cp:coreProperties ' +
      'xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
      'xmlns:dc="http://purl.org/dc/elements/1.1/" ' +
      'xmlns:dcterms="http://purl.org/dc/terms/" ' +
      'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      '<dc:title>' + esc(doc.title || '安全员工作台出件') + '</dc:title>' +
      '<dc:creator>安全员工作台</dc:creator><cp:lastModifiedBy>安全员工作台</cp:lastModifiedBy>' +
      '<dcterms:created xsi:type="dcterms:W3CDTF">' + now + '</dcterms:created>' +
      '<dcterms:modified xsi:type="dcterms:W3CDTF">' + now + '</dcterms:modified>' +
      '</cp:coreProperties>';

    var appXml = XML_HEAD +
      '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" ' +
      'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
      '<Application>安全员工作台</Application></Properties>';

    var rootRels = XML_HEAD +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
      '</Relationships>';

    var files = [
      { name: '[Content_Types].xml', data: utf8(contentTypes) },
      { name: '_rels/.rels', data: utf8(rootRels) },
      { name: 'word/document.xml', data: utf8(documentXml) },
      { name: 'word/_rels/document.xml.rels', data: utf8(relsXml) },
      { name: 'word/styles.xml', data: utf8(stylesXml) },
      { name: 'docProps/core.xml', data: utf8(coreXml) },
      { name: 'docProps/app.xml', data: utf8(appXml) }
    ];
    ctx.media.forEach(function (m, i) {
      files.push({ name: 'word/media/image' + (i + 1) + '.' + m.ext, data: m.bytes });
    });

    var bytes = zip(files);
    return bytes;
  }

  function build(doc, opts) {
    var bytes = buildBytes(doc);
    if (typeof Blob === 'function') {
      return new Blob([bytes], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      });
    }
    return bytes;
  }

  function download(blob, filename) {
    var url = (window.URL || window.webkitURL).createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename || '文档.docx';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { (window.URL || window.webkitURL).revokeObjectURL(url); }, 3000);
  }

  return {
    build: build,
    buildBytes: buildBytes,
    download: download,
    rasterize: rasterize,
    splitData: splitData,
    _zip: zip, _utf8: utf8, _crc32: crc32, _b64ToBytes: b64ToBytes
  };
})();
