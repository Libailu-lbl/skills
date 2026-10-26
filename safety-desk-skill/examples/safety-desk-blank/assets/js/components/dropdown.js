/* =========================================================
   components/dropdown.js — 通用下拉操作菜单（零依赖）
   ────────────────────────────────────────────────────────
   为什么要有它：表格「操作」列按钮一多（推进/通知书/编辑/作废/详情）
   就把行撑爆，窄屏更没法看。收成一个「操作 ▾」，点开再选。

   用法：
     SD.comp.dropdown.open({
       anchor: 按钮元素,
       items: [ { act:'advance', to:'fixing', text:'开始整改', primary:true },
                { act:'void', text:'作废', danger:true } ],
       onPick: function (item) { ... }
     });

   统一触发按钮（各模块「操作」列都用它，保证文字与三角一致）：
     render: function (r) { return SD.comp.dropdown.opsButton('ops', r.id); }

   定位：fixed，默认挂按钮下方；下方空间不足自动翻到上方；
   点击菜单外 / 滚动 / 缩放窗口即关闭。同时只允许存在一个菜单。
   ========================================================= */
window.SD = window.SD || {};
SD.comp = SD.comp || {};

SD.comp.dropdown = (function () {
  var U = SD.utils;
  var cur = null;

  function close() {
    if (!cur) return;
    if (cur.el.parentNode) cur.el.parentNode.removeChild(cur.el);
    cur = null;
    document.removeEventListener('mousedown', onDown, true);
    window.removeEventListener('resize', close);
    window.removeEventListener('scroll', close, true);
  }

  function onDown(e) {
    if (!cur) return;
    var t = e.target;
    if (cur.el === t || cur.el.contains(t)) return;          // 点菜单里
    if (cur.anchor === t || (cur.anchor.contains && cur.anchor.contains(t))) return;  // 点按钮本身
    close();
  }

  function open(opts) {
    opts = opts || {};
    close();
    var items = opts.items || [];
    if (!items.length) return null;

    var html = '<div class="dd-menu" role="menu">' + items.map(function (it, i) {
      var cls = 'dd-item' + (it.danger ? ' danger' : '') + (it.primary ? ' primary' : '') +
                (it.disabled ? ' disabled' : '');
      return '<button type="button" class="' + cls + '" ' +
             'data-i="' + i + '" role="menuitem"' + (it.disabled ? ' disabled' : '') + '>' +
             U.esc(it.text) + '</button>';
    }).join('') + '</div>';

    var el = U.h(html);
    document.body.appendChild(el);

    var anchor = opts.anchor;
    var r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect()
          : { left: 0, right: 0, top: 0, bottom: 0 };
    var w = el.offsetWidth || 150;
    var h = el.offsetHeight || 120;
    var left = Math.max(8, Math.min((r.right || 0) - w, (window.innerWidth || 1024) - w - 8));
    var top = (r.bottom || 0) + 4;
    if (top + h > (window.innerHeight || 768) - 8) {
      top = Math.max(8, (r.top || 0) - h - 4);     // 下方不够 → 翻到按钮上方
    }
    el.style.left = left + 'px';
    el.style.top = top + 'px';

    cur = { el: el, anchor: anchor, items: items };

    U.on(el, 'click', '.dd-item', function (ev, btn) {
      var it = items[Number(btn.dataset.i)];
      close();
      if (it && opts.onPick) opts.onPick(it);
    });

    document.addEventListener('mousedown', onDown, true);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return el;
  }

  /**
   * 统一的「操作 ▾」触发按钮 HTML
   * 各模块操作列都用它，避免各写一份导致文字/三角/类名不一致。
   * @param {string} act    data-act 值（视图内唯一即可）
   * @param {string} id     行 id
   * @param {string} [text] 按钮文字，默认「操作」（三角由 CSS ::after 补）
   * @returns {string}
   */
  function opsButton(act, id, text) {
    return '<button type="button" class="btn sm ghost js-ops" data-act="' + U.esc(act) +
      '" data-id="' + U.esc(id) + '">' + U.esc(text || '操作') + '</button>';
  }

  return { open: open, close: close, opsButton: opsButton };
})();
