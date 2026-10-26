/* =========================================================
   components/photoPicker.js — 照片选择器（表单内嵌用）
   ────────────────────────────────────────────────────────
   为什么抽出来：
     登记隐患（开单时拍现场）与危险作业票（作业前安全措施拍照）
     都要「选照片 → 缩略图预览 → 可移除 → 随表单一起保存」，
     如果两处各写一遍 FileReader + canvas 压缩，改动就要改两处。
     这里统一成：create() 出一个自持状态的 DOM 控件，get() 取当前照片数组。

   存储约定：
     照片以 JPEG dataURL 字符串存进记录的 photos 数组（随台账一起持久化）。
     dataURL 可直接给 <img src> 用，打印与 Word 导出都从这里取，
     代价是体积较大（单张压到 1000px / 质量 0.82，约 100~250KB），
     对本地 localStorage 台账场景可接受；接真实后端时改存 URL 即可。

   用法：
     var ph = SD.comp.photoPicker.mount(container, { value: [], max: 3 });
     ...提交时 ph.get()  // → ['data:image/jpeg;base64,...']
   ========================================================= */
window.SD = window.SD || {};
SD.comp = SD.comp || {};

SD.comp.photoPicker = (function () {
  var U = SD.utils;

  var MAX_W = 1000;                    // 仅「压缩模式」生效（config.photo.compress = true）
  var DEF_MAX = 3;                     // 默认最多张数（调用方可覆盖）
  var MAX_BYTES = 25 * 1024 * 1024;    // 单张上限：再大就拒绝，避免一张图撑爆仓库

  function conf() { return (SD.CONFIG && SD.CONFIG.photo) || {}; }
  function wantCompress() { return conf().compress === true; }

  /* ---------------- 压缩（不引任何外部库） ----------------
     ★ 2026-10-24 起默认**不压缩**（用户要求保留手机原图，下载「原图」要清晰）。
       大图不再靠压缩解决容量，而是由 components/photoVault.js 外置到 IndexedDB。
       这里的分支保留：把 config.photo.compress 改成 true 就退回压缩模式。 */
  /**
   * 读取文件（默认原样，不压缩）
   * @param {File} file
   * @param {function(string|null, string=)} cb  (dataURL, 错误说明)
   * @param {object} [opts] { compress: boolean, maxBytes: number }
   */
  function readFile(file, cb, opts) {
    opts = opts || {};
    var pc = conf();
    var limit = opts.maxBytes || pc.maxBytes || MAX_BYTES;
    if (!file) { cb(null, '没有取到文件'); return; }
    if (file.size > limit) {
      cb(null, '这张 ' + (file.size / 1048576).toFixed(1) + 'MB，超过单张上限 '
        + Math.round(limit / 1048576) + 'MB，请先在相册里裁剪或另存为较小尺寸');
      return;
    }
    var mime = String(file.type || '');
    if (mime && mime.indexOf('image/') !== 0) { cb(null, '不是图片文件（' + mime + '）'); return; }
    if (/heic|heif/i.test(mime)) {
      cb(null, 'HEIC 格式浏览器无法显示，请在手机相册里另存为 JPG 后再上传');
      return;
    }
    if (opts.compress != null ? !opts.compress : !wantCompress()) {
      // 不压缩：原样读出，保留原始分辨率与画质
      var fr = new FileReader();
      fr.onload = function () { cb(fr.result); };
      fr.onerror = function () { cb(null, '照片读取失败'); };
      fr.readAsDataURL(file);
      return;
    }
    compress(file, cb);
  }

  function compress(file, cb, maxW) {
    maxW = maxW || MAX_W;
    var fr = new FileReader();
    fr.onload = function () {
      var img = new Image();
      img.onload = function () {
        var k = Math.min(1, maxW / (img.width || maxW));
        var c = document.createElement('canvas');
        c.width = Math.round(img.width * k);
        c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        cb(c.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = function () { cb(null); };
      img.src = fr.result;
    };
    fr.onerror = function () { cb(null); };
    fr.readAsDataURL(file);
  }

  /**
   * 创建照片选择器（自持状态，不依赖外部 onChange 也能用）
   * @param {object} o { value: string[], max: number, onChange: fn }
   * @returns {{el:HTMLElement, get:function, set:function}}
   */
  function create(o) {
    o = o || {};
    var max = o.max || DEF_MAX;
    var list = (o.value || []).slice();
    var onChange = o.onChange || function () {};

    var el = U.h(
      '<div class="ph-pick">' +
        '<div class="ph-list"></div>' +
        '<div class="ph-bar">' +
          '<button type="button" class="btn sm ghost js-ph-add">' +
            SD.icons.get('upload', 14) + '添加照片</button>' +
          '<span class="ph-count t-3 t-sm"></span>' +
        '</div>' +
        '<input type="file" accept="image/*" multiple class="js-ph-file" style="display:none">' +
      '</div>'
    );

    var listEl = el.querySelector('.ph-list');
    var fileEl = el.querySelector('.js-ph-file');
    var countEl = el.querySelector('.ph-count');
    var addBtn = el.querySelector('.js-ph-add');

    function paint() {
      listEl.innerHTML = '';
      if (!list.length) {
        listEl.appendChild(U.h('<div class="ph-empty">未添加照片</div>'));
      } else {
        list.forEach(function (src, i) {
          listEl.appendChild(U.h(
            '<span class="ph-box"><img src="' + src + '" alt="照片 ' + (i + 1) + '">' +
            '<button type="button" class="ph-del" data-i="' + i + '" title="移除这张照片">×</button></span>'
          ));
        });
      }
      countEl.textContent = list.length + ' / ' + max + ' 张';
      addBtn.disabled = list.length >= max;
    }

    /* 移除（事件委托：缩略图每次重绘，委托挂在外层容器上一次即可） */
    U.on(listEl, 'click', '.ph-del', function (e, btn) {
      var i = Number(btn.dataset.i);
      if (isNaN(i)) return;
      list.splice(i, 1);
      paint();
      onChange(list.slice());
    });

    addBtn.addEventListener('click', function () { fileEl.click(); });

    fileEl.addEventListener('change', function () {
      var files = Array.prototype.slice.call(fileEl.files || []);
      fileEl.value = '';                       // 清掉，保证同一张能重复选
      if (!files.length) return;
      var room = max - list.length;
      if (room <= 0) { U.toast('最多 ' + max + ' 张照片', 'err'); return; }
      files.slice(0, room).forEach(function (f) {
        readFile(f, function (dataUrl, errMsg) {
          if (!dataUrl) { U.toast(errMsg || '照片读取失败', 'err'); return; }
          list.push(dataUrl);
          paint();
          onChange(list.slice());
        });
      });
      if (files.length > room) U.toast('最多 ' + max + ' 张，已取前 ' + room + ' 张', 'err');
    });

    paint();

    return {
      el: el,
      get: function () { return list.slice(); },
      set: function (v) { list = (v || []).slice(); paint(); }
    };
  }

  /**
   * 把选择器挂进已有容器（表单里先留占位 div，挂载后再填内容）
   * 实例挂在 container._ph 上，供表单统一回读
   */
  function mount(container, o) {
    if (!container) return null;
    var api = create(o);
    container.innerHTML = '';
    container.appendChild(api.el);
    container._ph = api;
    return api;
  }

  return {
    create: create, mount: mount, readFile: readFile, compress: compress,
    MAX_W: MAX_W, DEF_MAX: DEF_MAX, MAX_BYTES: MAX_BYTES
  };
})();
