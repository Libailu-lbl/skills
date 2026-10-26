/* =========================================================
   components/printNotice.js — 事故隐患整改通知书（打印）
   ────────────────────────────────────────────────────────
   版式严格照企业现行《事故隐患整改通知书》：A4 单表 10 行，
   两列 11.9% : 88.1%，字号/行高/页边距见 assets/css/print.css。

   字段来源（自动带出，可现场改）：
     检查日期            ← hazard.foundDate（独占一行）
     检查单位            ← 可配（默认 安全环保部），存 localStorage（独占一行）
     事故隐患整改责任单位 ← hazard.dept
     图片及部位          ← hazard.location + title + measure + 现场照片
     要求整改完工日期     ← hazard.dueDate（当前期限）
     整改责任人          ← 留白，纸质件上手写（下发时现场填写）
     整改完工验收单位     ← 留白，纸质件上手写；配置值仅用于正文验收口径
     验收人 / 领导批示    ← 留白，纸质件上手写

   两种出件方式：
     ① 直接打印（浏览器打印对话框，A4 已排好版）
     ② 保存为 Word（.docx，docxWriter 生成的真 OOXML，Word/WPS 可直接打开、
        可再编辑或走 Word 打印）—— 浏览器打印常夹带网址/日期页眉页脚，
        走 Word 打印天然没有这些，也方便签字后再扫描归档，所以两条路都留着。

   调用链（严格单向）：
     views/hazard.js ──▶ printNotice.open() ──▶ 用户点打印 ──▶ writeFlow() ──▶ ctx.reload()
   本组件不反向调用任何视图渲染函数，刷新一律交给调用方传进来的 ctx。
   ========================================================= */
window.SD = window.SD || {};
SD.comp = SD.comp || {};

SD.comp.printNotice = (function () {
  var U = SD.utils;

  var CFG_KEY = 'sd_print_cfg_v1';   // 打印抬头配置（检查单位 / 验收单位）
  var MAX_IMG = 3;                   // 现场照片最多 3 张
  var MAX_W = 1000;                  // 照片压缩到最大宽度 1000px

  /* ---------------- 抬头配置 ---------------- */
  function loadCfg() {
    try { return JSON.parse(localStorage.getItem(CFG_KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function saveCfg(c) {
    try { localStorage.setItem(CFG_KEY, JSON.stringify(c)); } catch (e) { /* 隐私模式下忽略 */ }
  }
  function mergeCfg() {
    var c = loadCfg();
    return {
      checkDept: c.checkDept || '安全环保部',
      verifyDept: c.verifyDept || '安全环保部'
    };
  }

  /* ---------------- 日期：2026-09-08 → 2026年9月8日 ---------------- */
  function cnDate(s) {
    if (!s) return '____年__月__日';
    var p = String(s).split('-');
    if (p.length < 3) return String(s);
    return p[0] + '年' + Number(p[1]) + '月' + Number(p[2]) + '日';
  }

  /* ---------------- 正文默认描述 ----------------
     ★ 只写「部位 + 隐患事实 + 整改措施 + 整改期限 + 验收单位」，
       不写编号 / 等级 / 类型——纸质件是给责任单位签收执行用的，
       编号等级类型是内部管理信息，留在系统台账里即可（用户 2026-10-19 要求）。
  ------------------------------------------------ */
  function defaultDesc(h, cfg) {
    var l1 = (h.location ? h.location + '，' : '') + (h.title || '') + '。';
    if (h.measure) l1 += '整改措施：' + h.measure + '。';
    var l2 = '请按要求于 ' + cnDate(h.dueDate) + ' 前完成整改，整改完成后报' +
             (cfg.verifyDept || '安全环保部') + '验收。';
    return l1 + '\n' + l2;
  }

  function photosHtml(photos) {
    if (!photos || !photos.length) return '<span class="pn-img-ph">（现场照片）</span>';
    return photos.map(function (src, i) {
      return '<span class="pn-img-box"><img src="' + src + '" alt="隐患现场照片">' +
             '<button class="pn-del" data-idx="' + i + '" title="移除这张照片">×</button></span>';
    }).join('');
  }

  /* ---------------- 生成通知书纸张（纯函数，便于测试） ---------------- */
  function buildSheet(h, st) {
    var e = U.esc;
    return '' +
      '<table class="pn-table">' +
        '<colgroup><col class="pn-c1"><col class="pn-c2"></colgroup>' +
        '<tr class="r-title"><td colspan="2" class="pn-title">' + e(st.title || '隐患整改通知书') + '</td></tr>' +
        '<tr class="r-date"><td colspan="2">检查日期：' + e(cnDate(h.foundDate)) + '</td></tr>' +
        '<tr class="r-check"><td colspan="2">检查单位：' + e(st.checkDept || '') + '</td></tr>' +
        '<tr class="r-dept"><td colspan="2">事故隐患整改责任单位：' + e(h.dept || '') + '</td></tr>' +
        '<tr class="r-photo">' +
          /* 标签与保存页一致：每字一段竖排（CSS writing-mode 竖排，DOM 文本保持完整） */
          '<td class="pn-c1 pn-lab">事故隐患图片及部位</td>' +
          '<td class="pn-c2 pn-photo-cell">' +
            /* ★ 顺序与保存页一致：照片在上、正文在下（保存页 imgRows 先于 descParas） */
            '<div class="pn-imgs">' + photosHtml(st.photos) + '</div>' +
            '<div class="pn-desc" contenteditable="true" spellcheck="false">' + e(st.desc || '') + '</div>' +
          '</td>' +
        '</tr>' +
        '<tr class="r-sign">' +
          /* ★ 2026-10-22 晚用户要求：「领导批示」**四字从上到下竖排**，且不溢出格子。
             左列只有 7.8%（≈11mm），15pt 横排根本放不下，故每字独占一行（span 块级）：
             4 字 × 15pt × 1.2 行距 ≈ 72pt < 批示行 97pt，竖排也不顶格；
             保存页 Word 同样每字一段（见 docSpec），三页一致。 */
          '<td class="pn-c1 pn-lab pn-lab2">' +
            '领导批示'.split('').map(function (c) { return '<span>' + c + '</span>'; }).join('') +
          '</td>' +
          '<td class="pn-c2 pn-sign">年　　月　　日</td>' +
        '</tr>' +
        '<tr class="r-btm"><td colspan="2">要求整改完工日期：' + e(cnDate(h.dueDate)) + '</td></tr>' +
        '<tr class="r-btm"><td colspan="2">整改责任人：</td></tr>' +
        '<tr class="r-btm"><td colspan="2">整改完工验收单位：</td></tr>' +
        '<tr class="r-btm"><td colspan="2">验收人：</td></tr>' +
      '</table>';
  }

  /* ================= 导出 Word（真 .docx，零依赖） =================
     2026-10-22：从「HTML/MHTML 冒充 .doc」换成 docxWriter 生成真 .docx。
     版式与屏幕版 buildSheet 逐行对应：10 行两列（11.9% / 88.1%）、
     行高 / 字号 / 页边距全部按企业现行通知书复刻，照片作为 media 部件内嵌。
     ★ 为什么不再走 .doc(HTML)：MHTML 补齐 MIME 头后用户实测仍「打开空白、
       照片不显示」——Word 各版本对 HTML 导入的解析不一致，.docx 零歧义。
  ------------------------------------------------------------- */
  /* 版式参数对照企业现行原件《事故隐患整改通知书（26.9.8）.docx》逐格复刻
     （2026-10-22 用户给参考件重排），并按用户 10-22 晚要求调整：
       页面  A4 11906×16838，边距 1157/1406/781/1406 twips
       表格  总宽 9240 = 标签列 720 + 内容列 8520，tblInd 270，autofit，
             边框 single 0.5pt 六边，cellMar 上下 0 / 左右 108
       10 行 行高（atLeast）：781 / 640 / 640 / 663 / 6600 / 1949 / 663 / 663 / 663 / 683
             （合计 13945 twips ≈ 697pt < 页内容高 745pt，保一页）
       字号  标题 22pt、日期·检查单位·责任单位 14pt、照片标签 22pt、正文 12pt、
             批示与底部 15pt
       细节  第 2/3 行「检查日期 / 检查单位」**各自单独一行**（用户要求，同责任单位
             版式；原件是同格两段，此处按用户口径拆分）；照片标签每字一段竖排；
             照片段（居中）排在正文之前；「领导批 示」一段（中间空格）；
             右侧「年　　月　　日」右对齐靠底                                    */
  var PN_PAGE = { w: 11906, h: 16838, mTop: 1157, mRight: 1406, mBottom: 781, mLeft: 1406 };
  var PN_C1 = 720;    // 标签列
  var PN_C2 = 8520;   // 内容列
  var PN_CELLMAR = { top: 0, left: 108, bottom: 0, right: 108 };
  var PN_IMG_MAX_W = 260;   // 照片上限（pt），按原件图幅 260×299 等比内缩
  var PN_IMG_MAX_H = 290;

  /** 正文段：\n 拆多段，12pt、1.8 倍行距（对应屏幕版 pre-wrap） */
  function descParas(desc) {
    return String(desc || '').split('\n').map(function (line) {
      return { p: line, size: 24, line: 432, after: 0 };
    });
  }

  /* ---------- 照片格布局：按正文占用腾高度预算，照片自适应缩放/排布 ----------
     硬约束：照片格内容必须锁在 330pt 行高内——9 行固定行高合计 698.5pt，
     页内容高 745pt，照片格一旦被撑超就溢到第二页（用户明确要求一页 A4）。
     · 正文高度按 12pt×1.8 行距估算（415pt 列宽 ≈ 34 字/行，最多估 8 行封顶）
     · 单张    ：260×预算 内等比
     · 多张全横：横排一行（每张 415/n 宽、预算高内等比）
     · 混合/竖 ：竖排（每张 预算/n 高内等比）
     · 一律不放大超过原尺寸（小图放大发虚）                                */
  var PN_CHARS_PER_LINE = 34;   // 12pt 中文在 415pt 内容宽里每行约 34 字
  var PN_LINE_H = 21.6;         // 12pt × 1.8 行距
  var PN_PHOTO_GAP = 6;         // 横排图片间距（pt）
  var PN_AVAIL_W = 415;         // 内容列可用宽(pt) ≈ 8520twips 减去左右 cellMar
  var PN_ROW_H = 330;           // 照片格行高（pt，6600 twips）

  /** 照片能用的高度预算：行高 − 正文估算 − 底部余量 − 每张 6pt 的间距/行距开销
      ★ 保存页与预览页共用这一个函数，两页尺寸才对得上（预览页 CSS 里
        .pn-img-row 的 gap/margin 各 6pt，Word 里行与行之间同样要留这点空）。
      ★ 不扣这 6pt/张的话，3 张竖排时「图 + 间距 + 正文」会顶破 330pt 溢到第二页。 */
  function photoBudget(desc, n) {
    return PN_ROW_H - estimateBodyH(desc) - 15 - PN_PHOTO_GAP * (n || 0);
  }

  function estimateBodyH(desc) {
    var lines = 0;
    String(desc || '').split('\n').forEach(function (seg) {
      lines += Math.max(1, Math.ceil(seg.length / PN_CHARS_PER_LINE));
    });
    return Math.min(lines, 8) * PN_LINE_H;   // 封顶 8 行，desc 再长也不把照片挤没
  }

  /** @returns {{rows: Array<Array<{src,wPt,hPt}>>}} 每个内层数组是一横排组 */
  function layoutPhotos(photos, sizes, availW, availH) {
    var n = photos.length;
    if (!n) return { rows: [] };
    var metas = photos.map(function (src, i) {
      var s = (sizes && sizes[i]) || { w: 640, h: 480 };
      return { src: src, w: Math.max(1, s.w || 640), h: Math.max(1, s.h || 480) };
    });
    if (n === 1) {
      var m0 = metas[0];
      var k = Math.min(1, PN_IMG_MAX_W / m0.w, availH / m0.h);
      return { rows: [[{ src: m0.src, wPt: Math.round(m0.w * k), hPt: Math.round(m0.h * k) }]] };
    }
    var allLand = metas.every(function (m) { return m.w / m.h >= 1.15; });
    if (allLand) {
      // 横排一行：每张 availW/n（扣间距），高度不超预算
      var each = (availW - PN_PHOTO_GAP * (n - 1)) / n;
      return { rows: [metas.map(function (m) {
        var kk = Math.min(1, each / m.w, availH / m.h);
        return { src: m.src, wPt: Math.round(m.w * kk), hPt: Math.round(m.h * kk) };
      })] };
    }
    // 竖排：每张 availH/n 高内等比、宽 ≤ 260
    var eachH = availH / n;
    return { rows: metas.map(function (m) {
      var kk = Math.min(1, PN_IMG_MAX_W / m.w, eachH / m.h);
      return [{ src: m.src, wPt: Math.round(m.w * kk), hPt: Math.round(m.h * kk) }];
    }) };
  }

  /** 生成 docx 文档描述（纯函数，供冒烟测试校验） */
  function docSpec(h, st, sizes) {
    var photos = (st.photos || []).filter(Boolean);
    var rows = [
      /* 1 标题 */
      { h: 781, cells: [{ span: 2, paras: [{ p: st.title || '隐患整改通知书', size: 44, bold: true, align: 'center' }], valign: 'center' }] },
      /* 2 检查日期（单独一行，同责任单位版式） */
      { h: 640, cells: [{ span: 2, paras: [{ p: '检查日期：' + cnDate(h.foundDate), size: 28 }], valign: 'center' }] },
      /* 3 检查单位（单独一行） */
      { h: 640, cells: [{ span: 2, paras: [{ p: '检查单位：' + (st.checkDept || ''), size: 28 }], valign: 'center' }] },
      /* 4 责任单位 */
      { h: 663, cells: [{ span: 2, paras: [{ p: '事故隐患整改责任单位：' + (h.dept || ''), size: 28 }], valign: 'center' }] },
      /* 4 照片行：标签每字一段竖排；内容格图片（居中）在最上，正文随后。
         照片按正文占用腾出的预算自适应缩放/排布，锁死一页 A4。 */
      (function () {
        var availH = photoBudget(st.desc, photos.length);
        var layout = layoutPhotos(photos, sizes, PN_AVAIL_W, Math.max(60, availH));
        return { h: 6600, cells: [
          { paras: '事故隐患图片及部位'.split('').map(function (ch) {
              return { p: ch, size: 44, align: 'center' };
            }), valign: 'center' },
          { valign: 'top', paras: descParas(st.desc), imgRows: layout.rows }
        ] };
      })(),
      /* 5 领导批示：左「领导批示」**每字一段竖排**居中，右「年　　月　　日」右对齐靠底。
         ★ 2026-10-22 晚用户要求：四字从上到下排列、且不溢出格子。
           字号 15pt（sz 30 半磅）、单倍行距：4 段 ≈ 4 × 18pt = 72pt < 本行 97.45pt，
           竖排也不会把行撑高（早年 20pt 四字撑到 108pt 才压了上下相邻两格）。 */
      { h: 1949, cells: [
        { paras: '领导批示'.split('').map(function (ch) {
            return { p: ch, size: 30, align: 'center' };
          }), valign: 'center' },
        { paras: [
            { p: '', size: 30 },
            { p: '', size: 30 },
            { p: '年　　月　　日', size: 30, align: 'right' }
          ], valign: 'bottom' }
      ] },
      /* 6~9 底部四行 */
      { h: 663, cells: [{ span: 2, paras: [{ p: '要求整改完工日期：' + cnDate(h.dueDate), size: 30 }], valign: 'center' }] },
      { h: 663, cells: [{ span: 2, paras: [{ p: '整改责任人：', size: 30 }], valign: 'center' }] },
      { h: 663, cells: [{ span: 2, paras: [{ p: '整改完工验收单位：', size: 30 }], valign: 'center' }] },
      { h: 683, cells: [{ span: 2, paras: [{ p: '验收人：', size: 30 }], valign: 'center' }] }
    ];
    return {
      title: '事故隐患整改通知书' + (h.code ? '（' + h.code + '）' : ''),
      page: PN_PAGE,
      blocks: [
        { table: { cols: [PN_C1, PN_C2], border: '000000', cellMar: PN_CELLMAR, layout: 'autofit', ind: 270, rows: rows } },
        { p: '' }   // 表格后空段（Word 惯例，也照原件）
      ]
    };
  }

  /** 读每张照片的原始宽高（Word 里要按上限等比缩放）；读不到按 4:3 兜底 */
  function loadSizes(list, cb) {
    var out = [], left = list.length, done = false;
    if (!left) return cb(out);
    function finish() { if (!done) { done = true; cb(out); } }
    list.forEach(function (src, i) {
      var img = new Image();
      img.onload = function () {
        out[i] = { w: img.naturalWidth || 640, h: img.naturalHeight || 480 };
        if (--left <= 0) finish();
      };
      img.onerror = function () {
        out[i] = { w: 640, h: 480 };
        if (--left <= 0) finish();
      };
      img.src = src;
    });
    setTimeout(finish, 800);   // 兜底：读不到尺寸也按时出件，不挂死
  }

  /* ---------- 预览页照片排版：与保存页共用同一套算法 ----------
     屏幕/打印预览过去是 CSS 硬压（max-height 168pt / 打印 150pt），
     与保存页 Word 的「按正文占用腾高度预算 → 自适应缩放/横排分组」不一致，
     用户 2026-10-22 要求「打印、打印预览页按保存页修改」——
     这里在首屏渲染后按同一算法重排一遍，写死 pt 尺寸，两页逐张对齐。      */
  function fitPhotos(sheet, st, cb) {
    var box = sheet && sheet.querySelector('.pn-imgs');
    if (!box) return;
    var photos = (st.photos || []).filter(Boolean);
    if (!photos.length) return;
    loadSizes(photos, function (sizes) {
      var availH = photoBudget(st.desc, photos.length);
      var layout = layoutPhotos(photos, sizes, PN_AVAIL_W, Math.max(60, availH));
      var k = 0;
      box.innerHTML = layout.rows.map(function (row) {
        return '<div class="pn-img-row">' + row.map(function (x) {
          var idx = k++;
          return '<span class="pn-img-box">' +
                 '<img src="' + x.src + '" alt="隐患现场照片" style="width:' +
                 Math.round(x.wPt) + 'pt;height:' + Math.round(x.hPt) + 'pt">' +
                 '<button class="pn-del" data-idx="' + idx + '" title="移除这张照片">×</button>' +
                 '</span>';
        }).join('') + '</div>';
      }).join('');
      if (cb) cb();
    });
  }

  /** 保存为 .docx；照片先过栅格化（SVG 示例图 → PNG）再读尺寸，完成后回调 ok 供写留痕 */
  function saveAsDoc(h, st, cb) {
    var photos = (st.photos || []).filter(Boolean);
    var left = photos.length, rastered = new Array(photos.length);
    if (!left) return finish();
    photos.forEach(function (src, i) {
      SD.comp.docxWriter.rasterize(src, function (src2) {
        rastered[i] = src2 || src;
        if (--left <= 0) finish();
      });
    });
    function finish() {
      loadSizes(rastered, function (sizes) {
        try {
          var doc = docSpec(h, Object.assign({}, st, { photos: rastered }), sizes);
          var blob = SD.comp.docxWriter.build(doc);
          /* 文件名（2026-10-22 用户要求）：事故隐患整改通知书（2026.10.22）.docx，
             同名再出一件自动加 -1 / -2 / -3（见 U.docName）。 */
          SD.comp.docxWriter.download(blob, U.docName('事故隐患整改通知书（' + U.dotDate() + '）'));
          U.toast('已保存为 Word（.docx），可用 Word/WPS 打开、签字后再打印', 'ok');
          if (cb) cb(true);
        } catch (err) {
          U.toast('导出失败：' + ((err && err.message) || err), 'err');
          if (cb) cb(false);
        }
      });
    }
  }

  /* 照片压缩统一走 photoPicker（与登记隐患/作业票共用一套实现，改一处即可） */
  function compress(file, cb) {
    SD.comp.photoPicker.compress(file, cb, MAX_W);
  }

  /* ---------------- 主入口 ----------------
     @param {object} h    隐患记录
     @param {object} opts { ctx }  ctx.reload 用于打印留痕后整体刷新
  ------------------------------------------------ */
  function open(h, opts) {
    opts = opts || {};
    var ctx = opts.ctx || null;
    var cfg = mergeCfg();
    var st = {
      title: '隐患整改通知书',
      checkDept: cfg.checkDept,
      verifyDept: cfg.verifyDept,
      desc: defaultDesc(h, cfg),
      photos: (h.photos || []).slice()
    };
    var logged = false;   // 留痕只写一次，防止 print/afterprint 双触发

    var overlay = U.h(
      '<div class="pn-overlay">' +
        '<div class="pn-toolbar">' +
          '<span class="pn-tb-title">隐患整改通知书 · 预览出件</span>' +
          '<label class="pn-field">检查单位<input class="input js-cd" value="' + U.esc(st.checkDept) + '"></label>' +
          '<label class="pn-field">验收单位<input class="input js-vd" value="' + U.esc(st.verifyDept) + '"></label>' +
          '<span class="pn-spacer"></span>' +
          '<label class="pn-field"><input type="checkbox" class="js-log" checked>出件后写流转留痕</label>' +
          '<button class="btn sm ghost js-upload">上传现场照片</button>' +
          '<button class="btn sm ghost js-doc">保存为 Word</button>' +
          '<button class="btn sm primary js-print">打印</button>' +
          '<button class="btn sm ghost js-close">关闭</button>' +
          '<input type="file" accept="image/*" multiple class="js-file" style="display:none">' +
          '<span class="pn-tip js-tip">打印对话框里若出现网址/日期等页眉页脚，在「更多设置」取消勾选「页眉和页脚」；' +
          '想要干净件可直接「保存为 Word」用 Word 打印</span>' +
        '</div>' +
        '<div class="pn-wrap"><div class="pn-sheet js-sheet"></div></div>' +
      '</div>'
    );

    var sheet = overlay.querySelector('.js-sheet');
    var fileInput = overlay.querySelector('.js-file');

    function paint() {
      sheet.innerHTML = buildSheet(h, st);
      fit();
      fitPhotos(sheet, st, fit);   // 照片按保存页同一算法重排（异步读完尺寸后）
      // 移除照片
      U.on(sheet, 'click', '.pn-del', function (ev, el) {
        var i = Number(el.dataset.idx);
        st.photos.splice(i, 1);
        savePhotos();
        paint();
      });
    }

    /* 窄屏等比缩放，保证一屏看得全（offsetWidth 为 0 时按 A4 名义宽兜底） */
    function fit() {
      var wrap = overlay.querySelector('.pn-wrap');
      var avail = (wrap && wrap.clientWidth ? wrap.clientWidth : window.innerWidth) - 16;
      var need = sheet.offsetWidth || 794;                 // 210mm ≈ 794px
      var k = Math.min(1, avail / need);
      if (!isFinite(k) || k <= 0) k = 1;
      sheet.style.transform = 'scale(' + k + ')';
      sheet.style.transformOrigin = 'top center';
      sheet.style.marginBottom = (-1 * (1 - k) * (sheet.offsetHeight || 1123)) + 'px';
    }

    /* 照片存进隐患台账，下次打开还在 */
    function savePhotos() {
      return SD.api.updateHazard(h.id, { photos: st.photos.slice() })
        .then(function () { U.toast('照片已存入隐患台账', 'ok'); })
        .catch(function () { U.toast('照片保存失败（仅本次预览有效）', 'err'); });
    }

    /* 出件留痕：台账法定要求，谁在什么时候下发过通知书要能追溯（打印 / 导出 Word 都算） */
    function writeFlow(way) {
      if (logged) return;
      logged = true;
      var now = U.today() + ' ' + new Date().toTimeString().slice(0, 5);
      var flow = (h.flow || []).concat([{
        at: now, by: '王安全', from: '—', to: '—',
        note: '下发《事故隐患整改通知书》（' + (way || '打印') + '）：要求 ' + (h.dept || '—') + ' 于 ' +
              (h.dueDate || '—') + ' 前完成整改，责任人 ' + (h.owner || '—') + '。'
      }]);
      SD.api.updateHazard(h.id, { flow: flow }).then(function () {
        U.toast('已打印并写入流转留痕', 'ok');
        if (ctx && ctx.reload) ctx.reload();
      }).catch(function () {
        U.toast('留痕写入失败，请手动补记', 'err');
      });
    }

    /* 正文可能被现场改过，出件前统一回读一次 */
    function syncFromDom() {
      var d = sheet.querySelector('.pn-desc');
      // innerText 在部分环境（如 jsdom）不可用，用 textContent 兜底
      if (d) st.desc = String(d.innerText || d.textContent || '').replace(/\u00a0/g, ' ').trim();
      // 抬头变化存起来，下次默认沿用
      saveCfg({ checkDept: st.checkDept, verifyDept: st.verifyDept });
    }

    function doDoc() {
      var wantLog = overlay.querySelector('.js-log').checked;
      syncFromDom();
      // 照片要栅格化后才出件，异步完成再写留痕
      saveAsDoc(h, st, function (okd) {
        if (okd && wantLog) writeFlow('Word');
      });
    }

    function doPrint() {
      var wantLog = overlay.querySelector('.js-log').checked;
      syncFromDom();
      U.toast('纸张 A4、缩放「默认」；如出现网址/日期页眉，取消「页眉和页脚」', 'ok');
      try { window.print(); } catch (err) { /* 无打印机环境忽略 */ }
      if (wantLog) writeFlow('打印');
    }

    /* ---------- 事件绑定 ---------- */
    overlay.querySelector('.js-close').addEventListener('click', function () {
      document.body.removeChild(overlay);
      window.removeEventListener('resize', fit);
    });

    overlay.querySelector('.js-upload').addEventListener('click', function () {
      fileInput.click();
    });

    fileInput.addEventListener('change', function () {
      var files = Array.prototype.slice.call(fileInput.files || []);
      if (!files.length) return;
      var room = MAX_IMG - st.photos.length;
      if (room <= 0) { U.toast('最多 ' + MAX_IMG + ' 张照片', 'err'); return; }
      files.slice(0, room).forEach(function (f) {
        compress(f, function (dataUrl) {
          if (!dataUrl) { U.toast('照片读取失败', 'err'); return; }
          st.photos.push(dataUrl);
          paint();
          savePhotos();
        });
      });
      fileInput.value = '';
    });

    var cdEl = overlay.querySelector('.js-cd');
    var vdEl = overlay.querySelector('.js-vd');
    cdEl.addEventListener('input', function () { st.checkDept = cdEl.value; paint(); });
    vdEl.addEventListener('input', function () { st.verifyDept = vdEl.value; paint(); });

    overlay.querySelector('.js-print').addEventListener('click', doPrint);
    overlay.querySelector('.js-doc').addEventListener('click', doDoc);

    document.body.appendChild(overlay);
    paint();
    window.addEventListener('resize', fit);

    return { el: overlay, close: function () { document.body.removeChild(overlay); } };
  }

  return {
    open: open,
    buildSheet: buildSheet,   // 供冒烟测试直接校验版式
    cnDate: cnDate,
    defaultDesc: defaultDesc,
    docSpec: docSpec,           // 供冒烟测试校验 Word 导出内容
    photoBudget: photoBudget,   // 保存页与预览页共用的高度预算（防溢到第二页）
    layoutPhotos: layoutPhotos, // 供冒烟测试比对预览页与保存页的照片排版
    fitPhotos: fitPhotos,
    saveAsDoc: saveAsDoc
  };
})();
