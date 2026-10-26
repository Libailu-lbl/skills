/* =========================================================
   components/photoWatermark.js — 培训照片下载（可先编辑水印）
   ────────────────────────────────────────────────────────
   为什么要水印：
     安全培训的现场/签到照片要归档留痕，水印写清「什么手机拍的、在哪拍的、什么时候拍的」，
     事后核对时不会与别处照片混淆。两行固定样式：

         第一行：手机型号 · 地点
         第二行：日期 时间
         位置：照片**左下角**（两行紧贴，白字 + 深色描边，任何底色都看得清）

   2026-10-24 细化（用户指定）：
     · 字号四档「很小 / 小 / 中 / 大」，**很小 = 小的 2/3**
     · 第二行（日期 时间）比第一行（型号 地点）**小一个字号**
     · 日期用**正斜杠**分隔：2026/10/24
     · **型号 / 日期 / 时间**三段纵向压扁到 **70%**；地点保持正常
     · 全部字重 **300（细体，不加粗）**
     · 第一行里**地点与型号同字号**，只是地点不压扁（2026-10-24）
     · **时间可留空**：留空时第二行只写日期，不会留一个空洞（2026-10-25）

   用法：
     SD.comp.photoWatermark.open(photos, {
       code: 'FZPX-2026-001',            // 文件名用
       title: 'FZPX-2026-001 消防器材实操',
       date: '2026-10-24',               // 默认日期（一般取培训日期）
       place: '江苏省南通市',             // 默认地点（不传则取 config.watermark.place）
       phone: 'HUAWEI Mate 60 Pro'       // 默认手机型号（不传则取上次记住的值）
     });

   设计要点：
     · 填过的手机型号 / 地点会记住（localStorage），下次自动带出——型号只需填一次
     · 预览即所得：改任一输入立即重绘
     · 三种下载：当前张（加水印）/ 全部（加水印）/ 原图（不加水印）
     · 不引任何外部库：canvas 2d 直接合成，导出 JPEG
   ========================================================= */
window.SD = window.SD || {};
SD.comp = SD.comp || {};

SD.comp.photoWatermark = (function () {
  var U = SD.utils;

  /** 记住填过的水印参数（按工作台实例分开存，避免两版串数据） */
  function prefKey() { return (SD.CONFIG.storageKey || 'sd') + '_wm'; }
  function loadPref() {
    try { return JSON.parse(localStorage.getItem(prefKey()) || '{}') || {}; } catch (e) { return {}; }
  }
  function savePref(o) {
    try { localStorage.setItem(prefKey(), JSON.stringify(o)); } catch (e) { /* 隐私模式忽略 */ }
  }
  function conf() { return (SD.CONFIG && SD.CONFIG.watermark) || {}; }

  function p2(n) { return (n < 10 ? '0' : '') + n; }
  /** 当前日期 / 时间（本地时区） */
  function nowParts() {
    var d = new Date();
    return {
      date: d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()),
      time: p2(d.getHours()) + ':' + p2(d.getMinutes())
    };
  }

  /**
   * 两行水印文案
   * @param {object} o { phone, place, date, time }
   * @returns {string[]} [第一行, 第二行]；某行没有内容则为空串
   */
  function lines(o) {
    o = o || {};
    var l1 = [String(o.phone || '').trim(), String(o.place || '').trim()]
      .filter(function (x) { return !!x; }).join(' · ');
    var l2 = [String(o.date || '').trim(), String(o.time || '').trim()]
      .filter(function (x) { return !!x; }).join(' ');
    return [l1, l2];
  }

  /**
   * 水印排版参数（按图片宽度等比缩放，保证大图小图观感一致）
   * @param {number} W 图片宽（像素）
   * @param {object} o { size: 'small'|'mid'|'large' }
   */
  /* ---------------- 字号与字体形态（2026-10-24 按用户要求细化） ----------------
     · 四档字号：很小 / 小 / 中 / 大，按图宽等比；**很小 = 小的一半**
     · 第二行（日期 时间）比第一行（型号 地点）**小一个字号**
     · 型号与日期这两种「编号类」文字用**纵向轻微压扁**的字形（0.86），
       地点与时间保持正常字形，视觉上主次分明 */
  var SIZE_K = { small: 0.020, mid: 0.026, large: 0.034 };
  var XSMALL_RATIO = 2 / 3;    // 「很小」= 小的 2/3（2026-10-24 用户调整：原为 1/2）
  var MIN_FS = 8;
  var SQUASH = 0.70;           // 纵向压扁到 70%（型号 / 日期 / 时间三段都压）
  var SUB_RATIO = 0.82;        // 第二行相对第一行的字号比例（约「小一个字号」）
  var WEIGHT = '300';          // 细体（不加粗），靠深色描边保证任何底色都看得清
  var FONT_STACK = '"Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", system-ui, sans-serif';

  function fontOf(fs) { return WEIGHT + ' ' + fs + 'px ' + FONT_STACK; }

  /**
   * 水印排版参数（按图片宽度等比缩放，保证大图小图观感一致）
   * @param {number} W 图片宽（像素）
   * @param {object} o { size: 'xsmall'|'small'|'mid'|'large' }
   * @returns {{fs:number, fs2:number, pad:number, lh:number}}
   *   fs 第一行字号；fs2 第二行字号（比第一行小一档）；pad 边距；lh 两行行距
   */
  function layout(W, o) {
    o = o || {};
    var k = (o.size === 'xsmall') ? (SIZE_K.small * XSMALL_RATIO) : (SIZE_K[o.size] || SIZE_K.mid);
    var fs = Math.max(MIN_FS, Math.round(W * k));
    return {
      fs: fs,
      fs2: Math.max(MIN_FS - 1, Math.round(fs * SUB_RATIO)),
      pad: Math.round(W * 0.022),          // 距左 / 距底
      lh: Math.round(fs * 1.34)            // 行距
    };
  }

  /** 日期分隔符统一成正斜杠：2026-10-24 / 2026\\10\\24 → 2026/10/24 */
  function dateSlash(s) {
    return String(s == null ? '' : s).trim().replace(/[-\\/\.]/g, '/');
  }

  /**
   * 拆成「行 → 片段」，每个片段带自己的字号与是否压扁
   * 第一行：型号（压扁） + · + 地点（正常）
   * 第二行：日期（压扁，反斜杠分隔） + 空格 + 时间（正常），整行字号比第一行小一档
   */
  function buildRows(o, L) {
    var rows = [];
    var phone = String(o.phone || '').trim();
    var place = String(o.place || '').trim();
    var date = dateSlash(o.date);
    var time = String(o.time || '').trim();

    /* 第一行：型号与地点**同字号**（都取 L.fs），只有型号压扁、地点不压扁 —— 2026-10-24 用户指定 */
    var p1 = [];
    if (phone) p1.push({ text: phone, squash: true, fs: L.fs });
    if (place) {
      if (p1.length) p1.push({ text: ' · ', squash: false, fs: L.fs });
      p1.push({ text: place, squash: false, fs: L.fs });
    }
    if (p1.length) rows.push({ fs: L.fs, parts: p1 });

    /* 第二行：日期与时间同为第二行字号（比第一行小一档），两段都压扁 */
    var p2 = [];
    if (date) p2.push({ text: date, squash: true, fs: L.fs2 });
    if (time) {
      if (p2.length) p2.push({ text: ' ', squash: false, fs: L.fs2 });
      p2.push({ text: time, squash: true, fs: L.fs2 });
    }
    if (p2.length) rows.push({ fs: L.fs2, parts: p2 });

    return rows;
  }

  /**
   * 把水印画到 canvas（先铺原图，再左下角两行）
   * @param {HTMLCanvasElement} cv
   * @param {HTMLImageElement} img
   * @param {object} o { phone, place, date, time, size, on }
   * @returns {HTMLCanvasElement}
   */
  function paint(cv, img, o) {
    o = o || {};
    var W = img.naturalWidth || img.width;
    var H = img.naturalHeight || img.height;
    cv.width = W; cv.height = H;
    var ctx = cv.getContext('2d');
    if (!ctx) return cv;                   // 无 canvas 环境（如 jsdom）直接跳过绘制
    ctx.drawImage(img, 0, 0, W, H);
    if (o.on === false) return cv;

    var L = layout(W, o);
    var rows = buildRows(o, L);
    if (!rows.length) return cv;

    ctx.textBaseline = 'alphabetic';

    function rowWidth(r) {
      ctx.font = fontOf(r.fs);
      return r.parts.reduce(function (a, p) { return a + ctx.measureText(p.text).width; }, 0);
    }

    // 太长的文案整体缩字号，保证不超出右边
    var maxW = W - L.pad * 2;
    var widest = 0;
    rows.forEach(function (r) { widest = Math.max(widest, rowWidth(r)); });
    if (widest > maxW && widest > 0) {
      var k = maxW / widest;
      rows.forEach(function (r) { r.fs = Math.max(6, Math.floor(r.fs * k)); });
      L.lh = Math.round(L.lh * k);
    }

    var y = H - L.pad;                     // 最后一行基线
    for (var i = rows.length - 1; i >= 0; i--) {
      var r = rows[i];
      ctx.font = fontOf(r.fs);
      var lw = Math.max(1.2, Math.round(r.fs * 0.14));
      var x = L.pad;

      for (var j = 0; j < r.parts.length; j++) {
        var p = r.parts[j];
        ctx.font = fontOf(p.fs || r.fs);        // 片段字号优先（同一行可保持同字号，见 buildRows）
        ctx.save();
        ctx.translate(x, y);
        if (p.squash) ctx.scale(1, SQUASH);     // 型号 / 日期：轻微压扁
        ctx.lineJoin = 'round';
        ctx.lineWidth = lw;
        ctx.strokeStyle = 'rgba(0,0,0,.58)';
        ctx.strokeText(p.text, 0, 0);
        ctx.fillStyle = 'rgba(255,255,255,.97)';
        ctx.fillText(p.text, 0, 0);
        ctx.restore();
        x += ctx.measureText(p.text).width;     // 压扁不改变宽度，按正常宽度累加即可
      }
      y -= L.lh;                                // 画完第二行再往上抬到第一行
    }
    return cv;
  }

  /** 文件名：培训照片-编号-序号.jpg */
  function fileName(code, n, raw, total) {
    var base = (code ? code + '-' : '') + '培训照片' + (total > 1 ? '-' + n : '');
    return base + (raw ? '-原图' : '') + '.jpg';
  }

  function triggerDownload(url, name) {
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  /** canvas → 下载（toBlob 优先，不支持时退回 dataURL） */
  function saveCanvas(cv, name) {
    return new Promise(function (resolve, reject) {
      function fire(url, revoke) {
        try { triggerDownload(url, name); } catch (e) { return reject(e); }
        if (revoke) setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
        resolve(name);
      }
      if (typeof cv.toBlob === 'function') {
        cv.toBlob(function (b) {
          if (!b) return fire(cv.toDataURL('image/jpeg', 0.92), false);
          fire(URL.createObjectURL(b), true);
        }, 'image/jpeg', 0.92);
      } else {
        fire(cv.toDataURL('image/jpeg', 0.92), false);
      }
    });
  }

  function loadImg(src) {
    return new Promise(function (resolve, reject) {
      var im = new Image();
      im.onload = function () { resolve(im); };
      im.onerror = function () { reject(new Error('照片加载失败')); };
      im.src = src;
    });
  }

  /**
   * 打开「下载照片 + 水印编辑」弹窗
   * @param {string[]} photos dataURL 数组
   * @param {object} [opts] { code, title, date, place, phone }
   * @returns {{close:function, el:HTMLElement}|null}
   */
  function open(photos, opts) {
    opts = opts || {};
    var list = (photos || []).filter(Boolean);
    if (!list.length) { U.toast('这条记录还没有照片', 'err'); return null; }

    var pref = loadPref();
    var np = nowParts();
    var st = {
      i: 0,
      imgs: [],
      val: {
        phone: opts.phone != null ? opts.phone : (pref.phone || conf().phone || ''),
        place: opts.place != null ? opts.place : (pref.place || conf().place || ''),
        date: opts.date || np.date,
        time: opts.time || np.time,
        size: pref.size || 'mid',
        on: pref.on !== false
      }
    };

    var mask = U.h(
      '<div class="mask wm-mask" role="dialog" aria-modal="true">' +
        '<div class="modal wm-modal">' +
          '<div class="modal-head">' +
            '<h3>下载照片' + (opts.title ? ' · ' + U.esc(opts.title) : '') + '</h3>' +
            '<button type="button" class="modal-close" aria-label="关闭">' + SD.icons.get('x', 18) + '</button>' +
          '</div>' +
          '<div class="modal-body">' +
            '<div class="wm-wrap">' +
              '<div class="wm-stage">' +
                '<canvas class="js-wm-cv" aria-label="水印预览"></canvas>' +
                '<div class="wm-nav">' +
                  '<button type="button" class="btn ghost sm js-wm-prev" aria-label="上一张">&#8249;</button>' +
                  '<span class="js-wm-idx num">1 / ' + list.length + '</span>' +
                  '<button type="button" class="btn ghost sm js-wm-next" aria-label="下一张">&#8250;</button>' +
                '</div>' +
              '</div>' +
              '<div class="wm-side">' +
                '<label class="field"><span>手机型号（第一行前半）</span>' +
                  '<input class="input js-wm-phone" maxlength="40" placeholder="例：HUAWEI Mate 60 Pro"></label>' +
                '<label class="field"><span>地点（第一行后半）</span>' +
                  '<input class="input js-wm-place" maxlength="40" placeholder="例：江苏省南通市 · 厂区 3 号门"></label>' +
                '<div class="wm-row2">' +
                  '<label class="field"><span>日期</span><input class="input js-wm-date" type="date"></label>' +
                  '<label class="field"><span>时间（可留空）</span>' +
                    '<span class="wm-time-wrap">' +
                      '<input class="input js-wm-time" type="time" title="可留空：留空时第二行只显示日期">' +
                      '<button type="button" class="btn sm ghost js-wm-time-clear" title="清空时间，只留日期">清空</button>' +
                    '</span>' +
                  '</label>' +
                '</div>' +
                '<label class="field"><span>水印字号</span>' +
                  '<select class="input ctl-select js-wm-size">' +
                    '<option value="xsmall">很小（小的 2/3）</option>' +
                    '<option value="small">小</option><option value="mid">中（默认）</option><option value="large">大</option>' +
                  '</select></label>' +
                '<label class="switch"><input type="checkbox" class="js-wm-on" checked> 加水印（取消勾选则导出原样）</label>' +
                '<div class="wm-tip">水印固定照片<b>左下角</b>，两行：<br>「手机型号 · 地点」<br>「日期 时间」<b>（时间可留空，只写日期）</b>' +
                  '<br><span class="t-3">型号/日期/时间压扁至 70%，日期用正斜杠；第二行比第一行小一档</span></div>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="modal-foot">' +
            '<button type="button" class="btn ghost js-wm-close">关闭</button>' +
            '<button type="button" class="btn ghost js-wm-raw">下载原图（无水印）</button>' +
            '<button type="button" class="btn ghost js-wm-all">下载全部（' + list.length + ' 张）</button>' +
            '<button type="button" class="btn primary js-wm-one">下载这张</button>' +
          '</div>' +
        '</div>' +
      '</div>'
    );

    var cv = mask.querySelector('.js-wm-cv');
    var idx = mask.querySelector('.js-wm-idx');
    var phoneEl = mask.querySelector('.js-wm-phone');
    var placeEl = mask.querySelector('.js-wm-place');
    var dateEl = mask.querySelector('.js-wm-date');
    var timeEl = mask.querySelector('.js-wm-time');
    var sizeEl = mask.querySelector('.js-wm-size');
    var onEl = mask.querySelector('.js-wm-on');

    phoneEl.value = st.val.phone;
    placeEl.value = st.val.place;
    dateEl.value = st.val.date;
    timeEl.value = st.val.time;
    sizeEl.value = st.val.size;
    onEl.checked = st.val.on;

    /** 从输入框回收当前编辑值 */
    function collect() {
      st.val.phone = phoneEl.value.trim();
      st.val.place = placeEl.value.trim();
      st.val.date = dateEl.value;
      st.val.time = String(timeEl.value || '').trim();
      st.val.size = sizeEl.value;
      st.val.on = onEl.checked;
      return st.val;
    }

    function render() {
      var im = st.imgs[st.i];
      if (!im) return;
      paint(cv, im, collect());
      idx.textContent = (st.i + 1) + ' / ' + list.length;
    }

    var timer = null;
    function renderSoon() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(render, 120);
    }

    function close() {
      if (mask.parentNode) mask.parentNode.removeChild(mask);
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') go(st.i - 1);
      else if (e.key === 'ArrowRight') go(st.i + 1);
    }
    function go(i) {
      var n = st.imgs.length;
      if (!n) return;
      st.i = (i + n) % n;
      render();
    }

    mask.querySelector('.modal-close').addEventListener('click', close);
    mask.querySelector('.js-wm-close').addEventListener('click', close);
    mask.addEventListener('mousedown', function (e) { if (e.target === mask) close(); });
    document.addEventListener('keydown', onKey);

    mask.querySelector('.js-wm-prev').addEventListener('click', function () { go(st.i - 1); });
    mask.querySelector('.js-wm-next').addEventListener('click', function () { go(st.i + 1); });

    /* 时间可留空：一键清空后第二行只写日期（2026-10-25 用户要求） */
    var timeClear = mask.querySelector('.js-wm-time-clear');
    if (timeClear) {
      timeClear.addEventListener('click', function () {
        timeEl.value = '';
        st.val.time = '';
        renderSoon();
      });
    }
    [phoneEl, placeEl, dateEl, timeEl].forEach(function (el) {
      el.addEventListener('input', renderSoon);
      el.addEventListener('change', renderSoon);
    });
    sizeEl.addEventListener('change', render);
    onEl.addEventListener('change', render);

    /* 下载：当前张 / 全部 / 原图 */
    function remember() {
      var v = collect();
      savePref({ phone: v.phone, place: v.place, size: v.size, on: v.on });
    }

    mask.querySelector('.js-wm-one').addEventListener('click', function () {
      var im = st.imgs[st.i];
      if (!im) return;
      remember();
      var out = document.createElement('canvas');
      paint(out, im, collect());
      saveCanvas(out, fileName(opts.code, st.i + 1, false, list.length)).then(function (n) {
        U.toast('已下载 ' + n, 'ok');
      }, function (e) {
        U.toast((e && e.message) || '下载失败', 'err');
      });
    });

    mask.querySelector('.js-wm-raw').addEventListener('click', function () {
      var src = list[st.i];
      var name = fileName(opts.code, st.i + 1, true, list.length);
      if (/^data:/.test(src)) {
        triggerDownload(src, name);
        U.toast('已下载原图 ' + name, 'ok');
      } else {
        U.toast('这张照片不是本地图片，无法直接下载', 'err');
      }
    });

    mask.querySelector('.js-wm-all').addEventListener('click', function () {
      remember();
      var btn = mask.querySelector('.js-wm-all');
      btn.disabled = true;
      var old = btn.textContent;
      btn.textContent = '导出中…';
      var seq = Promise.resolve();
      st.imgs.forEach(function (im, i) {
        seq = seq.then(function () {
          var out = document.createElement('canvas');
          paint(out, im, collect());
          return saveCanvas(out, fileName(opts.code, i + 1, false, list.length))
            .then(function () { return new Promise(function (r) { setTimeout(r, 260); }); });
        });
      });
      seq.then(function () {
        U.toast('已下载 ' + st.imgs.length + ' 张（浏览器若拦截多文件下载，请选择允许）', 'ok');
      }, function (e) {
        U.toast((e && e.message) || '批量下载失败', 'err');
      }).then(function () {
        btn.disabled = false;
        btn.textContent = old;
      });
    });

    document.body.appendChild(mask);

    /* 预加载全部照片（最多 6 张，串行更稳） */
    var chain = Promise.resolve();
    list.forEach(function (src) {
      chain = chain.then(function () {
        return loadImg(src).then(function (im) { st.imgs.push(im); }, function () { st.imgs.push(null); });
      });
    });
    chain.then(function () {
      if (!st.imgs.some(Boolean)) {
        cv.parentNode.insertAdjacentHTML('beforeend', '<div class="wm-empty">照片加载失败，请换一张重试</div>');
        return;
      }
      st.i = 0;
      while (st.i < st.imgs.length && !st.imgs[st.i]) st.i++;   // 跳过加载失败的那张
      render();
    });

    return { el: mask, close: close };
  }

  return {
    open: open, lines: lines, layout: layout, paint: paint,
    buildRows: buildRows, dateSlash: dateSlash, fontOf: fontOf,
    SIZE_K: SIZE_K, SQUASH: SQUASH, SUB_RATIO: SUB_RATIO, XSMALL_RATIO: XSMALL_RATIO, WEIGHT: WEIGHT,
    fileName: fileName, loadPref: loadPref, savePref: savePref, nowParts: nowParts
  };
})();
