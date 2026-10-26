/* =========================================================
   components/lightbox.js — 照片大图查看（零依赖）
   ────────────────────────────────────────────
   台账里的照片是缩略图，要看细节得点开。这个组件负责「点开看大图」：
   全屏遮罩 + 图居中 + 左右切换 + 计数 + 键盘操作。

   用法：
     SD.comp.lightbox.open(['data:image...', ...], 0, { title: 'FZZY-0000001 动火作业' });
     元素也支持对象：{ src: 'data:...', title: '作业面全景' }

   交互：Esc 或点遮罩空白处关闭；← → 切换；>1 张时才显示箭头。
   ========================================================= */
window.SD = window.SD || {};
SD.comp = SD.comp || {};

SD.comp.lightbox = (function () {
  var U = SD.utils;
  var cur = null;

  function norm(list) {
    return (list || []).map(function (it) {
      return (it && typeof it === 'object') ? { src: it.src, title: it.title || '' } : { src: it, title: '' };
    }).filter(function (it) { return !!it.src; });
  }

  function close() {
    if (!cur) return;
    if (cur.el.parentNode) cur.el.parentNode.removeChild(cur.el);
    document.removeEventListener('keydown', cur.onKey);
    cur = null;
  }

  function show(i) {
    if (!cur) return;
    var n = cur.list.length;
    if (!n) return close();
    cur.i = (i + n) % n;
    var item = cur.list[cur.i];
    cur.img.src = item.src;
    cur.cap.textContent = (item.title ? item.title + ' · ' : '') + (cur.i + 1) + ' / ' + n + (cur.title ? '（' + cur.title + '）' : '');
    cur.prev.hidden = n < 2;
    cur.next.hidden = n < 2;
  }

  /**
   * @param {Array} list  图片数组：dataURL 字符串 或 {src,title}
   * @param {number} [index] 起始下标
   * @param {object} [opts] { title: '分组标题' }
   */
  function open(list, index, opts) {
    opts = opts || {};
    var items = norm(list);
    if (!items.length) { U.toast('没有可查看的照片', 'err'); return null; }
    close();

    var el = U.h(
      '<div class="lb-mask" role="dialog" aria-modal="true">' +
        '<button type="button" class="lb-close" aria-label="关闭">&times;</button>' +
        '<button type="button" class="lb-nav lb-prev" aria-label="上一张">&#8249;</button>' +
        '<figure class="lb-figure">' +
          '<img class="lb-img" alt="照片">' +
          '<figcaption class="lb-cap"></figcaption>' +
        '</figure>' +
        '<button type="button" class="lb-nav lb-next" aria-label="下一张">&#8250;</button>' +
      '</div>'
    );

    var st = {
      el: el, list: items, i: 0, title: opts.title || '',
      img: el.querySelector('.lb-img'),
      cap: el.querySelector('.lb-cap'),
      prev: el.querySelector('.lb-prev'),
      next: el.querySelector('.lb-next'),
      onKey: function (e) {
        if (e.key === 'Escape') close();
        else if (e.key === 'ArrowLeft') show(st.i - 1);
        else if (e.key === 'ArrowRight') show(st.i + 1);
      }
    };
    cur = st;

    el.querySelector('.lb-close').addEventListener('click', close);
    st.prev.addEventListener('click', function () { show(st.i - 1); });
    st.next.addEventListener('click', function () { show(st.i + 1); });
    // 点遮罩空白处关闭，点图片本身不关
    el.addEventListener('click', function (e) { if (e.target === el) close(); });
    document.addEventListener('keydown', st.onKey);

    document.body.appendChild(el);
    show(index || 0);
    return { el: el, close: close };
  }

  return { open: open, close: close };
})();
