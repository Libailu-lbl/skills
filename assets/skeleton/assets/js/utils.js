/* =========================================================
   utils.js — 纯工具：DOM 构造 / 转义 / 日期 / 弹窗 / toast
   约定：这里只做「无状态」的事，不碰业务数据，不调渲染函数。
   ========================================================= */
window.SD = window.SD || {};

SD.utils = (function () {
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /** 从 HTML 字符串造元素（支持多个根节点时返回 DocumentFragment） */
  function h(str) {
    var tpl = document.createElement('template');
    tpl.innerHTML = String(str).trim();
    return tpl.content.childNodes.length === 1 ? tpl.content.firstChild : tpl.content;
  }

  function clear(el) { while (el && el.firstChild) el.removeChild(el.firstChild); }

  /* ---------- 日期 ---------- */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { d = d || new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function today() { return ymd(new Date()); }
  function addDays(n) { var d = new Date(); d.setDate(d.getDate() + n); return ymd(d); }
  /** b - a，单位天（用于「还有几天到期」） */
  function diffDays(a, b) {
    var A = new Date(String(a) + 'T00:00:00'), B = new Date(String(b) + 'T00:00:00');
    return Math.round((B - A) / 86400000);
  }
  function uid(prefix) { return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  /* ---------- toast ---------- */
  function toast(msg, kind) {
    var root = document.getElementById('toastRoot');
    if (!root) return;
    var el = h('<div class="toast ' + (kind || '') + '">' + esc(msg) + '</div>');
    root.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 2600);
  }

  /* ---------- 弹窗 ---------- */
  /**
   * dlg.open({title, body, okText, cancelText, danger, onOk})
   *   onOk(modalEl) 返回值：字符串 = 校验失败（弹窗不关，顶部红字提示）；其它 = 关闭
   * @returns {{close:Function, el:HTMLElement}}
   */
  function open(o) {
    o = o || {};
    var root = document.getElementById('dialogRoot');
    var mask = h(
      '<div class="mask" role="dialog" aria-modal="true">' +
        '<div class="modal">' +
          '<div class="modal-head"><h3>' + esc(o.title || '') + '</h3>' +
            '<button class="modal-close" type="button" aria-label="关闭">×</button></div>' +
          '<div class="modal-body"></div>' +
          '<div class="modal-foot">' +
            '<button class="btn ghost js-cancel" type="button">' + esc(o.cancelText || '取消') + '</button>' +
            '<button class="btn ' + (o.danger ? 'danger' : 'primary') + ' js-ok" type="button">' +
              esc(o.okText || '确定') + '</button>' +
          '</div>' +
        '</div>' +
      '</div>');
    var body = mask.querySelector('.modal-body');
    if (typeof o.body === 'string') body.innerHTML = o.body;
    else if (o.body) body.appendChild(o.body);

    function close() {
      if (mask.parentNode) mask.parentNode.removeChild(mask);
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }

    mask.querySelector('.modal-close').addEventListener('click', close);
    mask.querySelector('.js-cancel').addEventListener('click', close);
    mask.addEventListener('click', function (e) { if (e.target === mask) close(); });
    document.addEventListener('keydown', onKey);

    mask.querySelector('.js-ok').addEventListener('click', function () {
      if (typeof o.onOk !== 'function') { close(); return; }
      var old = mask.querySelector('.modal-err');
      if (old) old.parentNode.removeChild(old);
      var ret = o.onOk(mask);
      if (typeof ret === 'string' && ret) {
        var err = h('<p class="modal-err">' + esc(ret) + '</p>');
        body.insertBefore(err, body.firstChild);
        return;
      }
      close();
    });

    root.appendChild(mask);
    var first = mask.querySelector('input,select');
    if (first) setTimeout(function () { try { first.focus(); } catch (e) {} }, 50);
    return { close: close, el: mask };
  }

  return {
    esc: esc, h: h, clear: clear,
    pad: pad, ymd: ymd, today: today, addDays: addDays, diffDays: diffDays, uid: uid,
    toast: toast, dlg: { open: open }
  };
})();
