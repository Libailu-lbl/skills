/* =========================================================
   components/printPhotos.js — 照片单页 A4 出件（打印 / Word）
   ────────────────────────────────────────────────────────
   需求来源（用户 2026-10-19）：危险作业票只要「把照片打出来」——
   票面信息在系统里看就够了，纸质件用于现场张贴 / 签字 / 归档，
   所以这一版只输出照片，并且**所有照片缩排在一张 A4 上**，不出第二页。

   一页怎么保证：
     · 屏幕预览   .pp-sheet 固定 210×297mm，网格用 grid-auto-rows:1fr
                  平分剩余高度，张数再多也压在一页内（最多 12 张）；
                  一排一张长边横向，与 Word 保存页同一版式。
     · 打印       @page 给 10mm 边距，纸张高度锁 277mm（297−20），
                  由 JS 在打印时注入（见 injectPageRule），避免与
                  通知书那套 31.7mm 的 @page 互相覆盖。
     · Word       导出真 .docx（docxWriter），照片作为 media 部件内嵌，
                  按单元格尺寸等比算宽高，同样排在一页。
   ★ 三页照片统一再等比缩 5%（PHOTO_SHRINK / CSS scale(.95)），现场张贴留白签字。

   ★ 为什么 Word 走 .docx 而不是 HTML/MHTML：
     Word 的 HTML 导入不认 data:URI；MHTML（multipart/related + cid）虽然能嵌图，
     但 2026-10-22 用户实测「打开空白、照片不显示」——Word 各版本对 MHTML 的
     解析行为不一致。.docx 是 Word/WPS 亲生格式，图片走 DrawingML 引用，
     零歧义、也不会弹「格式与扩展名不匹配」。

   调用链（严格单向）：
     views/specPermit.js ──▶ printPhotos.open() ──▶ 打印/导出
   刷新一律交给调用方传进来的 ctx，本组件不反向调用任何视图。
   ========================================================= */
window.SD = window.SD || {};
SD.comp = SD.comp || {};

SD.comp.printPhotos = (function () {
  var U = SD.utils;

  var MAX_PHOTOS = 12;        // 一张 A4 最多 12 张（4 列 × 3 行）
  var A4_W_PT = 538;          // A4 210mm − 左右各 10mm ≈ 538pt
  var A4_H_PT = 785;          // A4 297mm − 上下各 10mm ≈ 785pt
  /* ★ 2026-10-22 用户要求：照片墙**所有页**（屏幕预览 / 浏览器打印 / Word 保存页）
     上的照片一律再等比缩 5%——现场张贴的纸质件边上留点余量，签字不压到画面。
     · Word 保存页：docSpec 最终尺寸乘这个系数（kAll 之后再乘，只会更小不会超页）
     · 屏幕预览 / 打印：CSS 侧 .pp-cell img { transform: scale(.95) }（见 print.css）
     两处同一个数，改这里即可同步三页。 */
  var PHOTO_SHRINK = 0.95;

  /** 张数 → 列数：1 张占满，2~4 两列，5~9 三列，再多四列 */
  function colsOf(n) {
    if (n <= 1) return 1;
    if (n <= 4) return 2;
    if (n <= 9) return 3;
    return 4;
  }
  function rowsOf(n, cols) { return Math.max(1, Math.ceil(n / cols)); }

  /** 纸张抬头一行：票号 · 类型 · 地点 · 计划时段（便于纸质件归档识别） */
  function headLine(p) {
    var seg = [p.code, p.type, p.location];
    var t = p.planStart ? (p.planStart + (p.planEnd && p.planEnd !== p.planStart ? ' ~ ' + p.planEnd : '')) : '';
    if (t) seg.push(t);
    return seg.filter(function (x) { return !!x; }).join(' · ');
  }

  /* ---------------- 作业人员证件照（自动带出，排在最前） ----------------
     按作业票的 workers（作业人员姓名）去特种作业人员台账里找同名的人，
     取其第一张证件照，标注「姓名 · 作业类别 · 证件照」。
     纸质件用于现场核查「是不是持证的人进场干活」，所以证件照要排第一张。

     ★ 人员名单由调用方通过 opts.people 传入（单向依赖：组件不反向读视图数据）。
     ★ 姓名可能带括号备注（如「王磊（T3201-…）」），匹配前先截掉括号部分。 */
  function certsOf(p, people) {
    var list = people || [];
    if (!list.length || !(p.workers || []).length) return [];
    var out = [];
    (p.workers || []).forEach(function (w) {
      var nm = String(w || '').replace(/[（(].*$/, '').trim();
      if (!nm) return;
      var hit = null;
      for (var i = 0; i < list.length; i++) {
        if (list[i].name === nm && (list[i].photos || []).length) { hit = list[i]; break; }
      }
      if (!hit) return;
      // 同一个作业票里同名只带一次（台账里可能有同名的多条资质记录）
      for (var j = 0; j < out.length; j++) if (out[j].name === nm) return;
      out.push({
        name: nm,
        src: hit.photos[0],
        cap: nm + ' · ' + (hit.category || hit.operation || '特种作业') + ' · 证件照'
      });
    });
    return out;
  }

  /** 作业类型短名（文件名用）：'吊装作业' → '吊装'；空/异常时兜底 '照片' */
  function typeShort(t) {
    var s = String(t || '').trim().replace(/作业\s*$/, '');
    return s || '照片';
  }

  /** 出件顺序：证件照在前，现场照片在后 */
  function itemsOf(st) {
    return (st.certs || []).concat(
      (st.photos || []).map(function (src) { return { src: src, cap: '' }; })
    );
  }

  /* ---------------- 按长宽自动旋转（2026-10-20 新增） ----------------
     现场照片手机横竖混拍，固定网格下竖图塞进宽扁格会留大片空白、版面零碎。
     这里按「照片长宽比 vs 单元格长宽比」决定要不要转 90°：
       · 缩放系数 = min(格宽/图宽, 格高/图高)，取能塞进格子的最大倍率；
       · 分别算「不转」和「转 90°」两个倍率，转完提升不足 ROT_MIN_GAIN 就不折腾
         （避免接近正方形、或转不转都差不多的图被无谓翻转）。
       · 旋转用 canvas 真实转像素生成新图，屏幕预览 / 打印 / Word 三处看到的是同一张，
         Word 里不需要任何 CSS transform（Word 对 transform 支持很差）。
       · 2026-10-21：**证件照（带 cap）也一并按长宽比旋转**——证件照多为竖图，
         塞进宽扁格子会留大片空白；横过来更贴合格子、版面更整齐。说明文字仍水平排在图下方。 */
  var ROT_MIN_GAIN = 1.08;

  function rotOf(w, h, cellW, cellH) {
    w = Math.max(1, w || 4); h = Math.max(1, h || 3);
    var s1 = Math.min(cellW / w, cellH / h);      // 不转
    var s2 = Math.min(cellW / h, cellH / w);      // 转 90°（宽高互换）
    if (!(s1 > 0)) return 0;
    return (s2 / s1 > ROT_MIN_GAIN) ? 90 : 0;
  }

  /** 单张图的原始宽高（读不到按 4:3 兜底） */
  function sizeOf(src, cb) {
    var img = new Image();
    img.onload = function () { cb({ w: img.naturalWidth || 4, h: img.naturalHeight || 3 }); };
    img.onerror = function () { cb({ w: 4, h: 3 }); };
    img.src = src;
  }

  /** 真实旋转像素，返回新 dataURL（白底 JPEG）；失败或无需旋转则原样返回 */
  function rotateSrc(src, deg, cb) {
    if (!deg) return cb(src, 0);
    var img = new Image();
    img.onload = function () {
      try {
        var w = img.naturalWidth, h = img.naturalHeight;
        if (!w || !h) return cb(src, 0);
        var c = document.createElement('canvas');
        c.width = h; c.height = w;
        var g = c.getContext && c.getContext('2d');
        if (!g) return cb(src, 0);                       // 无 canvas（如 jsdom）：不转
        g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
        g.translate(c.width / 2, c.height / 2);
        g.rotate(Math.PI / 2);
        g.drawImage(img, -w / 2, -h / 2, w, h);
        cb(c.toDataURL('image/jpeg', 0.92), 90);
      } catch (e) { cb(src, 0); }
    };
    img.onerror = function () { cb(src, 0); };
    img.src = src;
  }

  /** 对整个出件做一次「要不要转」的计算，返回新的 items（src 可能已被转成新图）
      2026-10-22 用户要求「按原始插入图片长边横向」：屏幕/打印也改一排一张，
      格子即横长条（整行宽 × 行高），rotOf 按长宽比判定——竖图转 90°、横图不动。 */
  function autoRotate(items, cb) {
    var n = items.length;
    if (!n) return cb([]);
    var cols = 1, rows = n;                 // 一排一张：整行宽一格格高
    var cellW = A4_W_PT / cols;
    // 格子必须保持「横长条」：单张时若按 785/n 会给成竖高格，横图会被误转。
    // 高度上限取行宽/1.2，保证 rotOf 的判定等价于「竖图转、横图不转」。
    var cellH = Math.min(A4_H_PT / rows, cellW / 1.2);
    var out = new Array(n), left = n;
    function one(i) {
      var it = items[i];
      sizeOf(it.src, function (m) {
        var deg = rotOf(m.w, m.h, cellW, cellH);   // 证件照一并按长宽比参与旋转
        rotateSrc(it.src, deg, function (src2, real) {
          out[i] = { src: src2, cap: it.cap, rot: real };
          if (--left <= 0) cb(out);
        });
      });
    }
    for (var i = 0; i < n; i++) one(i);
  }

  /** 实际用于出件的 items：开了自动旋转且已算好就用算好的，否则原样 */
  function sheetItems(st) {
    return (st.rotItems && st.rotItems.length) ? st.rotItems : itemsOf(st);
  }

  /* ---------------- 屏幕 / 打印用纸张内容 ----------------
     2026-10-22 用户要求与保存页一致：一排一张、长边横向、同比例缩放保一页。
     CSS 侧 .pp-grid 的 grid-auto-rows:1fr 平分剩余高度、.pp-cell img 的
     object-fit:contain 等比缩放——这里只需把网格改单列即成一排一张。 */
  function buildSheet(p, st) {
    var items = sheetItems(st);
    var n = items.length;
    if (!n) {
      return '<div class="pp-head">' + U.esc(headLine(p)) + '</div>' +
        '<div class="pp-empty">未上传照片　·　可在上方「上传照片」添加，或在作业票表单里添加</div>';
    }
    var cells = items.map(function (it, i) {
      return '<div class="pp-cell"><img src="' + it.src + '" alt="照片 ' + (i + 1) + '">' +
        (it.cap ? '<span class="pp-cap">' + U.esc(it.cap) + '</span>' : '') +
        '<span class="pp-no">' + (i + 1) + '</span></div>';
    }).join('');
    return '<div class="pp-head">' + U.esc(headLine(p) + certNote(st)) + '</div>' +
      '<div class="pp-grid" style="grid-template-columns:1fr">' + cells + '</div>';
  }

  /** 抬头末尾补一句「含 N 张作业人员证件照」，纸质件归档时能一眼看出带了证 */
  function certNote(st) {
    var n = (st.certs || []).length;
    return n ? ' · 含 ' + n + ' 张作业人员证件照' : '';
  }

  /* ---------------- Word 导出 ---------------- */

  /** 读回每张照片的原始宽高（Word 里要按单元格等比缩放，不然会拉伸变形） */
  function loadSizes(list, cb) {
    var out = [], left = list.length, finished = false;
    if (!left) return cb(out);
    function done() { if (--left <= 0 && !finished) { finished = true; cb(out); } }
    list.forEach(function (src, i) {
      var img = new Image();
      img.onload = function () { out[i] = { w: img.naturalWidth || 4, h: img.naturalHeight || 3 }; done(); };
      img.onerror = function () { out[i] = { w: 4, h: 3 }; done(); };   // 读不到就按 4:3 兜底
      img.src = src;
    });
    setTimeout(function () { if (!finished) { finished = true; cb(out); } }, 800);
    /* ★ 2026-10-27 修 bug：原来不判 finished → 图片正常加载完后（约几百毫秒）
       这里的兜底又回调一次，整个导出链跑两遍，一次点击生成两份同名 .docx。*/   // 兜底：读不到尺寸也按时出件，不挂死
  }

  /* ---------------- Word 导出（真 .docx） ----------------
     2026-10-22：从「MHTML 冒充 .doc」换成 docxWriter 生成真 .docx。
     原因：MHTML 补齐 MIME 头后用户实测仍「打开空白、照片不显示」——
     Word 的 HTML 导入行为各版本不一，.docx 是亲生格式，图片走 media 部件
     + DrawingML 引用，没有任何导入歧义。
     ★ 2026-10-22 用户两项要求：
       ① Word 出件只要干净的照片墙——不输出抬头行（票号那行），照片格下方
          不放任何文字（证件照说明 / 序号都不进 Word）；.docx 本身也无页眉页脚。
       ② 照片优先一排一张横放、**长边横向**——按每张横宽比决定占宽，每张独立成行：
          横图（宽高比≥1.15）单独一行、占满行宽（20/20 细列，≈538pt 宽）；
          方图单独一行占 13/20（≈350pt）；竖图单独一行占 6/20（≈161pt）。
          高度各自设上限（横 380 / 方 340 / 竖 300pt），防止单张顶满整页；
          一律不放大超过原尺寸。
       ③ 2026-10-22 用户要求「按照片长度长的一边横向放」——saveAsDoc 链路里的
          ensureLandscape 会先把竖图（高>宽）旋转 90° 成横图，所以进 docSpec 的
          基本都是横图（span 20）；竖图分支只作兜底（jsdom 等无 canvas 环境）。
       ④ 2026-10-22 用户要求「照片墙所有页上的照片全部等比例缩小 5%」——
          屏幕预览 / 浏览器打印 / Word 保存页三处同一幅：
          Word 走 PHOTO_SHRINK，屏幕与打印走 CSS .pp-cell img{transform:scale(.95)}。
     屏幕预览与浏览器打印同为一排一张横放（buildSheet 单列网格），与保存页一致。 */
  var PP_PAGE = { w: 11906, h: 16838, mTop: 567, mRight: 567, mBottom: 567, mLeft: 567 }; // A4 · 10mm 边距
  var PP_FINE = 20;          // 细粒度列数（tblGrid 20 等宽列，用 gridSpan 拼每行）

  /** 横宽比 → 占几细列 + 高度上限（pt）：横 20 列 380 / 方 13 列 340 / 竖 6 列 300 */
  function spanOf(w, h) {
    var r = (w || 4) / (h || 3);
    if (r >= 1.15) return { span: 20, maxH: 380 };
    if (r >= 0.85) return { span: 13, maxH: 340 };
    return { span: 6, maxH: 300 };
  }

  /** 生成 docx 文档描述（一排一张横放；抬头 / 说明 / 序号都不进 Word）
      2026-10-22 用户要求「按原始插入图片长边横向，为保证全部照片在同一张 A4 纸内
      显示可同比例缩放」：每张先按占宽等比（受类型高度上限约束），若总高度超一页
      预算（内容高 785pt − 每行约 6pt 的边距边框 − 底部 10pt 余量），全体按同一
      系数 k 缩小，保证一页 A4。 */
  function docSpec(p, st, sizes) {
    var items = sheetItems(st);
    var n = items.length;
    if (!n) {
      return {
        title: '危险作业票现场照片',
        page: PP_PAGE,
        blocks: [{ p: '（未上传照片）', size: 21, align: 'center' }]
      };
    }
    var contentW = 11906 - 567 * 2;                 // 10772 twips
    var colPt = (contentW / PP_FINE) / 20;          // 每细列 pt

    // 第一步：每张按占宽等比缩放（横图满行宽、方图 65%、竖图 30%；高度受类型上限约束）
    var placed = items.map(function (it, i) {
      var s = sizes[i] || { w: 4, h: 3 };
      var w = Math.max(1, s.w || 4), h = Math.max(1, s.h || 3);
      var cfg = spanOf(w, h);
      var wPt = cfg.span * colPt;
      var k = Math.min(1, wPt / w, cfg.maxH / h);
      return { it: it, span: cfg.span, wPt: w * k, hPt: h * k };
    });

    // 第二步：总高超一页预算 → 全体同比例缩小
    var availH = 785 - 6 * n - 10;
    var sumH = placed.reduce(function (a, x) { return a + x.hPt; }, 0);
    var kAll = sumH > availH ? availH / sumH : 1;

    // floor 而非 round：n 张图的 rounding 误差会累积，只小不进才能保证总高不超预算
    // ★ 末了再统一乘 PHOTO_SHRINK（0.95）：三页（预览 / 打印 / Word）同幅缩 5%
    var rows = placed.map(function (x) {
      return { cells: [{
        span: x.span,
        imgs: [{
          src: x.it.src,
          wPt: Math.floor(x.wPt * kAll * PHOTO_SHRINK),
          hPt: Math.floor(x.hPt * kAll * PHOTO_SHRINK)
        }],
        valign: 'center'
      }] };
    });

    var fineCols = [];
    for (var c = 0; c < PP_FINE; c++) fineCols.push(Math.floor(contentW / PP_FINE));
    // 尾差补进最后一列，保证总宽 = 内容宽
    fineCols[PP_FINE - 1] += contentW - fineCols.reduce(function (a, b) { return a + b; }, 0);

    return {
      title: '危险作业票现场照片' + (p.code ? '（' + p.code + '）' : ''),
      page: PP_PAGE,
      blocks: [
        { table: { cols: fineCols, border: '999999', rows: rows } }
      ]
    };
  }

  /** 确保「要不要旋转」已经算过（开关关掉时清空结果，回到原图） */
  function ensureRot(st, cb) {
    var items = itemsOf(st);
    if (st.autoRot === false) { st.rotItems = null; return cb(); }
    if (st.rotItems && st.rotItems.length === items.length) return cb();
    if (!items.length) { st.rotItems = []; return cb(); }
    autoRotate(items, function (out) { st.rotItems = out; cb(); });
  }

  /** Word 路径前把非位图（SVG 示例图）栅格化成 PNG；位图原样返回 */
  function ensureRaster(items, cb) {
    var out = new Array(items.length), left = items.length;
    if (!left) return cb([]);
    items.forEach(function (it, i) {
      SD.comp.docxWriter.rasterize(it.src, function (src2) {
        out[i] = { src: src2 || it.src, cap: it.cap };
        if (--left <= 0) cb(out);
      });
    });
  }

  /** 长边横向：竖图（高>宽）旋转 90° 成横图，横图原样返回。
      用户 2026-10-22 要求「按照片长度长的一边横向放」——竖拍的证件照/现场照
      在照片墙里统一转成横放，Word 里不出现窄条竖图。旋转用 canvas 真实转像素
      （与屏幕预览同一套 rotateSrc），jsdom 无 canvas 时原样返回不挂死。 */
  function ensureLandscape(items, sizes, cb) {
    var out = new Array(items.length), left = items.length;
    if (!left) return cb([]);
    items.forEach(function (it, i) {
      var m = (sizes && sizes[i]) || { w: 4, h: 3 };
      if (m.h > m.w) {
        rotateSrc(it.src, 90, function (src2) {
          out[i] = { src: src2 || it.src, cap: it.cap };
          if (--left <= 0) cb(out);
        });
      } else {
        out[i] = { src: it.src, cap: it.cap };
        if (--left <= 0) cb(out);
      }
    });
  }

  function saveAsDoc(p, st) {
    /* Word 链路（2026-10-22 用户要求「按原始插入图片长边横向」）：
       ① itemsOf(st) 取**原始插入图片**，不读 st.rotItems——屏幕预览的自动旋转
         可能已把某些横图转成竖的，Word 出件必须从原图重新判定；
       ② 不走 ensureRot（屏幕网格的旋转），由 ensureLandscape 统一按长边横向处理；
       ③ 读尺寸 → 竖图转横 → 栅格化 → 再读旋转后尺寸 → 出件（docSpec 内做一页同比例缩放）。 */
    var items = itemsOf(st);
    loadSizes(items.map(function (it) { return it.src; }), function (sizes0) {
      ensureLandscape(items, sizes0, function (landItems) {
        ensureRaster(landItems, function (rItems) {
          loadSizes(rItems.map(function (it) { return it.src; }), function (sizes) {
            try {
              var doc = docSpec(p, Object.assign({}, st, { rotItems: rItems }), sizes);
              var blob = SD.comp.docxWriter.build(doc);
              /* 文件名（2026-10-22 用户要求）：20261022吊装.docx
                 —— 出件日期 + 作业类型（去掉结尾的「作业」二字）；
                 同名再出一件自动加 -1 / -2 / -3（见 U.docName）。 */
              SD.comp.docxWriter.download(blob, U.docName(U.compactDate() + typeShort(p.type)));
              U.toast('已保存为 Word（.docx，含照片），可用 Word/WPS 打开打印', 'ok');
            } catch (err) {
              U.toast('导出失败：' + ((err && err.message) || err), 'err');
            }
          });
        });
      });
    });
  }

  /* ---------------- 打印时的 @page ----------------
     通知书那套 @page 是 31.7mm，照片页要 10mm。
     @page 不能按选择器区分，只能在运行时注入一条更靠后的规则覆盖它。
     ★ 打开预览时就注入（而不是等点「打印」）：
         用户也可能直接按 Ctrl+P，那时就不会走我们的按钮，
         不提前注入就会沿用 31.7mm 边距 + 277mm 纸高 → 溢出第二页。 */
  function injectPageRule() {
    var old = document.getElementById('ppPageRule');
    if (old) old.parentNode.removeChild(old);
    var s = document.createElement('style');
    s.id = 'ppPageRule';
    s.setAttribute('data-for', 'printPhotos');
    s.textContent = '@media print{@page{size:A4 portrait;margin:10mm;}}';
    document.head.appendChild(s);
  }
  function dropPageRule() {
    var s = document.getElementById('ppPageRule');
    if (s && s.parentNode) s.parentNode.removeChild(s);
  }

  /* ---------------- 主入口 ----------------
     @param {object} p    作业票记录（需含 photos、workers）
     @param {object} opts { ctx, people }
              ctx.reload 用于上传照片后整体刷新；
              people 为特种作业人员台账（用于按姓名自动带出证件照，不传则不带）
  ------------------------------------------------ */
  function open(p, opts) {
    opts = opts || {};
    var ctx = opts.ctx || null;
    var st = {
      photos: (p.photos || []).slice(),
      certs: certsOf(p, opts.people),     // 作业人员证件照，排在所有照片之前
      autoRot: true,                      // 按长宽自动旋转（默认开）
      rotItems: null                      // 算好的出件 items（src 可能已被转过）
    };

    var overlay = U.h(
      '<div class="pp-overlay">' +
        '<div class="pp-toolbar">' +
          '<span class="pp-tb-title">作业票照片 · 单页 A4 出件</span>' +
          '<button class="btn sm ghost js-upload">' + SD.icons.get('upload', 14) + '上传照片</button>' +
          '<label class="pp-chk"><input type="checkbox" class="js-rot" checked>按长宽自动旋转</label>' +
          '<span class="pp-spacer"></span>' +
          '<button class="btn sm ghost js-doc">' + SD.icons.get('download', 14) + '保存为 Word</button>' +
          '<button class="btn sm primary js-print">' + SD.icons.get('printer', 14) + '打印</button>' +
          '<button class="btn sm ghost js-close">关闭</button>' +
          '<input type="file" accept="image/*" multiple class="js-file" style="display:none">' +
          '<span class="pp-tip js-tip">所有照片自动缩排在一张 A4 上（最多 ' + MAX_PHOTOS +
            ' 张）；打印时纸张选 A4、缩放「默认」。若出现网址/日期页眉，取消「页眉和页脚」；' +
            '要完全干净的件用「保存为 Word」</span>' +
        '</div>' +
        '<div class="pp-wrap"><div class="pp-sheet js-sheet"></div></div>' +
      '</div>'
    );

    var sheet = overlay.querySelector('.js-sheet');
    var fileInput = overlay.querySelector('.js-file');

    function paint() { sheet.innerHTML = buildSheet(p, st); fit(); }

    /** 算完旋转再画一遍（旋转是异步的：要等图片加载 + canvas 转像素） */
    function refresh() { ensureRot(st, paint); }

    /* 开关：关掉就回到原图方向；打开重新算一遍 */
    overlay.querySelector('.js-rot').addEventListener('change', function () {
      st.autoRot = this.checked;
      st.rotItems = null;
      U.toast(st.autoRot ? '已开启：按长宽自动旋转' : '已关闭：照片保持原始方向', 'ok');
      refresh();      // 关掉时 ensureRot 会清空结果并直接重画原图
    });

    /** 窄屏等比缩放，保证一屏看得全 */
    function fit() {
      var wrap = overlay.querySelector('.pp-wrap');
      var avail = (wrap && wrap.clientWidth ? wrap.clientWidth : window.innerWidth) - 16;
      var need = sheet.offsetWidth || 794;
      var k = Math.min(1, avail / need);
      if (!isFinite(k) || k <= 0) k = 1;
      sheet.style.transform = 'scale(' + k + ')';
      sheet.style.transformOrigin = 'top center';
      sheet.style.marginBottom = (-1 * (1 - k) * (sheet.offsetHeight || 1123)) + 'px';
    }

    /** 照片存进作业票，下次打开还在 */
    function savePhotos() {
      return SD.api.updateWorkPermit(p.id, { photos: st.photos.slice() })
        .then(function () {
          U.toast('照片已存入作业票', 'ok');
          if (ctx && ctx.reload) ctx.reload();
        })
        .catch(function () { U.toast('照片保存失败（仅本次预览有效）', 'err'); });
    }

    overlay.querySelector('.js-close').addEventListener('click', function () {
      dropPageRule();
      window.removeEventListener('resize', fit);
      document.body.removeChild(overlay);
    });

    overlay.querySelector('.js-upload').addEventListener('click', function () { fileInput.click(); });

    fileInput.addEventListener('change', function () {
      var files = Array.prototype.slice.call(fileInput.files || []);
      fileInput.value = '';
      if (!files.length) return;
      var room = MAX_PHOTOS - itemsOf(st).length;   // 证件照也占格子，一起算
      if (room <= 0) { U.toast('一张 A4 最多排 ' + MAX_PHOTOS + ' 张照片', 'err'); return; }
      var take = files.slice(0, room);
      var left = take.length;
      take.forEach(function (f) {
        SD.comp.photoPicker.compress(f, function (dataUrl) {
          if (dataUrl) st.photos.push(dataUrl);
          if (--left <= 0) { st.rotItems = null; refresh(); savePhotos(); }
        });
      });
      if (files.length > room) U.toast('最多 ' + MAX_PHOTOS + ' 张，已取前 ' + room + ' 张', 'err');
    });

    overlay.querySelector('.js-doc').addEventListener('click', function () { saveAsDoc(p, st); });

    overlay.querySelector('.js-print').addEventListener('click', function () {
      U.toast('纸张 A4、缩放「默认」；如出现网址/日期页眉，取消「页眉和页脚」', 'ok');
      injectPageRule();          // 保险：万一之前被撤掉了
      try { window.print(); } catch (err) { /* 无打印机环境忽略 */ }
    });

    document.body.appendChild(overlay);
    paint();
    refresh();                   // 图加载完再按长宽重排一次
    injectPageRule();            // 打开预览即生效，Ctrl+P 也不会用错页边距
    window.addEventListener('resize', fit);

    return {
      el: overlay,
      close: function () {
        dropPageRule();
        window.removeEventListener('resize', fit);
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }
    };
  }

  return {
    open: open,
    buildSheet: buildSheet,     // 供冒烟测试校验版式
    certsOf: certsOf,           // 供冒烟测试校验「按姓名自动带证件照」
    itemsOf: itemsOf,
    sheetItems: sheetItems,
    colsOf: colsOf,
    PHOTO_SHRINK: PHOTO_SHRINK, // 供冒烟测试校验「三页统一缩 5%」
    typeShort: typeShort,       // 供冒烟测试校验文件名里的作业类型短名
    rotOf: rotOf,               // 供冒烟测试校验「按长宽比判断要不要转 90°」
    autoRotate: autoRotate,
    docSpec: docSpec,             // 供冒烟测试校验 Word 出件内容
    ensureRaster: ensureRaster,   // 供冒烟测试校验栅格化
    ensureLandscape: ensureLandscape, // 供冒烟测试校验「长边横向」
    saveAsDoc: saveAsDoc
  };
})();
