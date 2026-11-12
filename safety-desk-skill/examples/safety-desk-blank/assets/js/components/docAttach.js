/* =========================================================
   components/docAttach.js — 文档附件选择器（2026-11-12 新增）
   ────────────────────────────────────────────────────────
   用途：通知公告编辑时「添加文档」，发布后点标题查看附件。
   为什么不用照片那套：照片是 data:image，浏览器能直接渲染；PDF / Word 只能
     下载或新窗口打开，而且体积是照片的几倍 —— 校验规则、查看方式、容量兜底都不一样。

   数据结构（存在公告的 docs 字段里）：
     [{ id, name, size, mime, dataUrl }]
     · dataUrl 是完整 base64；落盘时由 photoVault 外置到 IndexedDB，
       localStorage 里只留 vault:doc:<key> 引用（见 photoVault 顶部说明）
     · id 只用于行内 key，不参与业务

   三条硬约束（改之前先读）：
     1. **类型白名单**：只收 pdf / Word / Excel / PPT / txt / 图片。
        浏览器能内联渲染的 html / svg 一律不收 —— 点开就是执行环境。
        判定看扩展名 + mime 双重，任一命中白名单即放行，但 html/svg 优先拒绝。
     2. **容量**：单文件 2MB；浏览器没有 IndexedDB（隐私模式 / 老浏览器）时降到 800KB，
        否则 base64 进 localStorage 必爆，用户只会看到「保存失败」而不知道原因。
        超限**直接拒绝并说明上限**，不静默截断、不压缩（Office 文件压不了）。
     3. **数量**：单个公告最多 3 个。够用，也不至于让手机端弹窗滚不到底。
   ========================================================= */
window.SD = window.SD || {};
SD.comp = SD.comp || {};

SD.comp.docAttach = (function () {
  var U = SD.utils;

  var MAX_COUNT = 3;
  var MAX_BYTES = 2 * 1024 * 1024;          // 有 IndexedDB：单文件 2MB
  var MAX_BYTES_SLIM = 800 * 1024;          // 只能存 localStorage：降到 800KB

  /* 扩展名 → 展示用类型名（也是白名单本身） */
  var EXT = {
    pdf: 'PDF', doc: 'Word', docx: 'Word', xls: 'Excel', xlsx: 'Excel',
    ppt: 'PPT', pptx: 'PPT', txt: '文本',
    png: '图片', jpg: '图片', jpeg: '图片', webp: '图片'
  };
  /* 明确拒绝的危险类型（不在 EXT 里本就会被拒，这里单独提是为了给出准确提示） */
  var DANGEROUS = { html: 1, htm: 1, svg: 1, js: 1, mjs: 1, exe: 1, bat: 1, cmd: 1, sh: 1 };

  var ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,image/png,image/jpeg,image/webp';

  function extOf(name) {
    var m = /\.([A-Za-z0-9]+)$/.exec(String(name || ''));
    return m ? m[1].toLowerCase() : '';
  }

  function kindOf(doc) {
    var e = extOf(doc && doc.name);
    return EXT[e] || '文件';
  }

  function humanSize(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  /** 当前环境的单文件上限（随 IndexedDB 可用性变化） */
  function limitBytes() {
    var big = !!(SD.photoVault && SD.photoVault.enabled && SD.photoVault.enabled());
    return big ? MAX_BYTES : MAX_BYTES_SLIM;
  }

  function limitText() {
    return humanSize(limitBytes());
  }

  function isImage(doc) {
    return !!(doc && /^data:image\//.test(String(doc.dataUrl || ''))) ||
      ['png', 'jpg', 'jpeg', 'webp'].indexOf(extOf(doc && doc.name)) >= 0;
  }

  /** 附件是否已丢失（photoVault 水合时给的文本占位） */
  function isLost(doc) {
    var s = String((doc && doc.dataUrl) || '');
    if (s.indexOf('data:text/plain') !== 0) return false;
    try { return /附件已丢失/.test(decodeURIComponent(s.split(',').slice(1).join(','))); }
    catch (e) { return false; }
  }

  /**
   * 读单个文件 → {ok:true, doc} / {ok:false, msg}
   * 校验顺序刻意是「类型 → 大小 → 数量」，因为类型错误最容易发生在拖了一堆杂文件时，
   * 先说清「不收这个格式」比说「太大了」有用。
   */
  function readOne(file, cb) {
    var ext = extOf(file && file.name);
    var mime = String((file && file.type) || '');

    if (DANGEROUS[ext] || /^text\/html|^image\/svg|javascript/i.test(mime)) {
      cb({ ok: false, msg: '「' + (file.name || '文件') + '」不是可收的文档类型：为安全起见不收网页 / 脚本类文件' });
      return;
    }
    if (!EXT[ext]) {
      cb({ ok: false, msg: '「' + (file.name || '文件') + '」格式不支持：只收 PDF、Word、Excel、PPT、txt 与图片' });
      return;
    }
    if (file.size > limitBytes()) {
      cb({
        ok: false,
        msg: '「' + file.name + '」' + humanSize(file.size) + '，超过单个 ' + limitText() +
          (limitBytes() === MAX_BYTES ? ' 的上限（本地存储额度有限，过大的文件请放到共享盘，通知里写链接）'
                                      : ' 的上限（当前浏览器不支持大文件仓库，上限已降到 800KB）')
      });
      return;
    }

    var fr = new FileReader();
    fr.onload = function () {
      cb({
        ok: true,
        doc: {
          id: U.uid('DOC'),
          name: file.name || ('附件.' + ext),
          size: Number(file.size) || 0,
          mime: mime || ('application/' + ext),
          dataUrl: String(fr.result || '')
        }
      });
    };
    fr.onerror = function () { cb({ ok: false, msg: '「' + file.name + '」读取失败，请重试或换个文件' }); };
    fr.readAsDataURL(file);
  }

  /** 只读查看弹窗：列出附件，图片内联、其它打开/下载 */
  function openViewer(docs, title) {
    var list = Array.isArray(docs) ? docs : [];
    if (!list.length) { U.toast('这条公告没有附件'); return null; }

    /* ⚠️ 整段必须是**单根**：U.h() 只返回 firstElementChild，
       把说明文字写在 .da-view 外面会被静默丢掉（踩坑 25 的老毛病）。 */
    var html = '<div class="da-view">' + list.map(function (d, i) {
      var lost = isLost(d);
      var img = isImage(d) && !lost;
      return '<div class="da-vrow' + (lost ? ' is-lost' : '') + '">' +
        '<span class="da-ico">' + SD.icons.get('file', 16) + '</span>' +
        '<span class="da-vmain">' +
          '<span class="da-vname" title="' + U.esc(d.name || '') + '">' + U.esc(d.name || ('附件 ' + (i + 1))) + '</span>' +
          '<span class="da-vmeta">' + kindOf(d) + ' · ' + humanSize(d.size) +
            (lost ? ' · <b>文件已丢失</b>' : '') + '</span>' +
        '</span>' +
        (lost
          ? '<span class="tag">无法打开</span>'
          : (img
              ? '<button type="button" class="btn sm ghost js-da-preview" data-i="' + i + '">预览</button>'
              : '<button type="button" class="btn sm ghost js-da-open" data-i="' + i + '">打开</button>') +
            '<button type="button" class="btn sm js-da-save" data-i="' + i + '">下载</button>') +
        '</div>' +
        (img
          ? '<div class="da-thumb"><img src="' + U.esc(d.dataUrl) + '" alt="' + U.esc(d.name) + '"></div>'
          : '');
    }).join('') +
      '<div class="t-3 t-sm" style="margin-top:8px">' +
      'PDF 与图片可在这里直接打开；Word / Excel / PPT 浏览器不能内联显示，点「下载」后用 Office / WPS 打开。' +
      '</div>' +
      '</div>';

    var box = U.h(html);

    /* 打开 / 预览：优先 blob URL（Chrome 已禁止顶级导航到 data: URL） */
    function openAt(i, download) {
      var d = list[i];
      if (!d) return;
      var url = d.dataUrl, revoke = null;
      try {
        var blob = dataUrlToBlob(d.dataUrl);
        if (blob && window.URL && window.URL.createObjectURL) {
          url = window.URL.createObjectURL(blob);
          revoke = url;
        }
      } catch (e) { /* 环境不支持就退回 dataURL（仍可下载） */ }

      if (download) {
        var a = document.createElement('a');
        a.href = url;
        a.download = d.name || '附件';
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        setTimeout(function () {
          if (a.parentNode) a.parentNode.removeChild(a);
          if (revoke) { try { window.URL.revokeObjectURL(revoke); } catch (e2) {} }
        }, 30000);
        return;
      }
      var w = window.open(url, '_blank', 'noopener');
      if (!w) U.toast('浏览器拦下了新窗口，请允许弹出窗口，或用「下载」打开');
      setTimeout(function () {
        if (revoke) { try { window.URL.revokeObjectURL(revoke); } catch (e3) {} }
      }, 60000);
    }

    U.on(box, 'click', '.js-da-open', function (e, btn) { e.stopPropagation(); openAt(Number(btn.dataset.i), false); });
    U.on(box, 'click', '.js-da-save', function (e, btn) { e.stopPropagation(); openAt(Number(btn.dataset.i), true); });
    U.on(box, 'click', '.js-da-preview', function (e, btn) {
      e.stopPropagation();
      if (SD.comp.lightbox) SD.comp.lightbox.open(list.map(function (d) { return d.dataUrl; }), Number(btn.dataset.i), { title: title || '附件预览' });
    });

    return SD.comp.dialog.open({
      title: title || '查看文档',
      width: 640,
      body: box,
      readonly: true,
      hideCancel: true,
      okText: '关闭'
    });
  }

  function dataUrlToBlob(dataUrl) {
    var s = String(dataUrl || '');
    var m = /^data:([^;,]*)(;base64)?,/.exec(s);
    if (!m) throw new Error('不是 dataURL');
    var mime = m[1] || 'application/octet-stream';
    var isB64 = !!m[2];
    var body = s.slice(m[0].length);
    var bytes;
    if (isB64) {
      var bin = atob(body), arr = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      bytes = arr;
    } else {
      var txt = decodeURIComponent(body), arr2 = new Uint8Array(txt.length);
      for (var j = 0; j < txt.length; j++) arr2[j] = txt.charCodeAt(j);
      bytes = arr2;
    }
    return new Blob([bytes], { type: mime });
  }

  /**
   * 创建附件选择器
   * @param {object} o { value: doc[], max: number, onChange: fn }
   * @returns {{el:HTMLElement, get:function, set:function, count:function}}
   */
  function create(o) {
    o = o || {};
    var max = o.max || MAX_COUNT;
    var list = (o.value || []).slice();
    var onChange = o.onChange || function () {};

    var el = U.h(
      '<div class="da-pick">' +
        '<div class="da-list"></div>' +
        '<div class="da-bar">' +
          '<button type="button" class="btn sm ghost js-da-add">' +
            SD.icons.get('upload', 14) + '添加文档</button>' +
          '<span class="da-count t-3 t-sm"></span>' +
        '</div>' +
        '<input type="file" accept="' + ACCEPT + '" multiple class="js-da-file" hidden>' +
      '</div>'
    );

    var listEl = el.querySelector('.da-list');
    var fileEl = el.querySelector('.js-da-file');
    var countEl = el.querySelector('.da-count');
    var addBtn = el.querySelector('.js-da-add');
    var reading = false;      // 读取中：锁住「添加文档」，避免同一批文件被重复选进来

    function totalSize() {
      return list.reduce(function (a, d) { return a + (Number(d.size) || 0); }, 0);
    }

    function paint() {
      listEl.innerHTML = '';
      if (!list.length) {
        listEl.appendChild(U.h('<div class="da-empty">未添加文档</div>'));
      } else {
        list.forEach(function (d, i) {
          var lost = isLost(d);
          listEl.appendChild(U.h(
            '<div class="da-row' + (lost ? ' is-lost' : '') + '">' +
              '<span class="da-ico">' + SD.icons.get('file', 15) + '</span>' +
              '<span class="da-main">' +
                '<span class="da-name" title="' + U.esc(d.name || '') + '">' + U.esc(d.name || ('附件 ' + (i + 1))) + '</span>' +
                '<span class="da-meta">' + kindOf(d) + ' · ' + humanSize(d.size) +
                  (lost ? ' · <b>文件已丢失</b>' : '') + '</span>' +
              '</span>' +
              '<button type="button" class="btn sm ghost da-view-btn" data-act="view" data-i="' + i + '">查看</button>' +
              '<button type="button" class="btn sm ghost da-del" data-act="del" data-i="' + i + '" title="移除这个附件">删除</button>' +
            '</div>'
          ));
        });
      }
      countEl.textContent = list.length + ' / ' + max + ' 个' +
        (list.length ? ' · 合计 ' + humanSize(totalSize()) + ' · 单个上限 ' + limitText() : '');
      addBtn.disabled = reading || list.length >= max;
    }

    U.on(listEl, 'click', '[data-act="del"]', function (e, btn) {
      e.stopPropagation();
      var i = Number(btn.dataset.i);
      if (isNaN(i)) return;
      list.splice(i, 1);
      paint();
      onChange(list.slice());
    });

    U.on(listEl, 'click', '[data-act="view"]', function (e, btn) {
      e.stopPropagation();
      var i = Number(btn.dataset.i);
      if (isNaN(i)) return;
      openViewer([list[i]], list[i] && list[i].name);
    });

    addBtn.addEventListener('click', function () { fileEl.click(); });

    fileEl.addEventListener('change', function () {
      var files = Array.prototype.slice.call(fileEl.files || []);
      fileEl.value = '';                      // 清掉，保证同一个文件能重复选
      if (!files.length) return;

      var room = max - list.length;
      if (room <= 0) { U.toast('最多 ' + max + ' 个文档附件', 'err'); return; }

      var queue = files.slice(0, room);
      if (files.length > room) U.toast('最多 ' + max + ' 个附件，已只处理前 ' + room + ' 个', 'err');
      if (files.length > 1) U.toast('正在读取 ' + queue.length + ' 个文件…');

      /* 串行读：多个大文件并发读会一起卡住，而且 toast 会互相覆盖。
         读取期间锁住按钮并在计数位写进度 —— 2MB 文件读完要几百毫秒，
         没有反馈的话用户会以为「点了没反应」而反复点。 */
      var idx = 0;
      reading = true;
      addBtn.disabled = true;
      function next() {
        if (idx >= queue.length) { reading = false; paint(); onChange(list.slice()); return; }
        var f = queue[idx++];
        countEl.textContent = '正在读取 ' + idx + ' / ' + queue.length + ' …';
        readOne(f, function (r) {
          if (!r.ok) { U.toast(r.msg, 'err'); next(); return; }
          list.push(r.doc);
          paint();
          next();
        });
      }
      next();
    });

    paint();

    return {
      el: el,
      get: function () { return list.slice(); },
      set: function (v) { list = (v || []).slice(); paint(); },
      count: function () { return list.length; }
    };
  }

  /** 挂进表单占位容器；实例挂在 container._da 上供 formDialog 回读 */
  function mount(container, o) {
    if (!container) return null;
    var api = create(o);
    container.innerHTML = '';
    container.appendChild(api.el);
    container._da = api;
    return api;
  }

  return {
    create: create, mount: mount, openViewer: openViewer,
    humanSize: humanSize, kindOf: kindOf, isImage: isImage, isLost: isLost,
    limitBytes: limitBytes, MAX_COUNT: MAX_COUNT
  };
})();
