/* =========================================================
   dialog.js — 弹窗组件（登记 / 流转 / 延期 / 确认）
   ────────────────────────────────────────────────────────
   约定：onOk(modalEl) 返回值
     · 返回 undefined / true  → 关闭弹窗
     · 返回字符串            → 视为校验失败，弹窗内顶部红字提示，不关闭
     · 返回 Promise          → 先显示「处理中…」，resolve 后关闭，reject 显示错误
   ========================================================= */
window.SD = window.SD || {};
SD.comp = SD.comp || {};

SD.comp.dialog = (function () {
  var U = SD.utils;

  function root() {
    var r = document.getElementById('dialogRoot');
    if (!r) { r = document.createElement('div'); r.id = 'dialogRoot'; document.body.appendChild(r); }
    return r;
  }

  function onEsc(e, close) {
    if (e.key === 'Escape') { document.removeEventListener('keydown', escHandler); close(); }
  }
  var escHandler = null;

  /**
   * @param {object} o {title, body, okText, cancelText, danger, hint, width, onOk, onMount}
   *   onMount(modalEl) —— 弹窗插入 DOM 之后触发。
   *   用途：body 里放的是占位容器，真正需要绑事件的控件（如照片选择器）
   *   必须等进了 DOM 才能初始化，否则 querySelector 拿不到。
   * @returns {{close:function, el:HTMLElement}}
   */
  function open(o) {
    o = o || {};
    var modal = U.h(
      '<div class="mask" role="dialog" aria-modal="true">' +
        '<div class="modal"' + (o.width ? ' style="max-width:' + o.width + 'px"' : '') + '>' +
          '<div class="modal-head">' +
            '<h3>' + U.esc(o.title || '') + '</h3>' +
            '<button class="modal-close" aria-label="关闭">' + SD.icons.get('x', 18) + '</button>' +
          '</div>' +
          '<div class="modal-body"></div>' +
          '<div class="modal-foot">' +
            (o.hint ? '<span class="hint">' + U.esc(o.hint) + '</span>' : '') +
            '<button class="btn ghost js-cancel">' + U.esc(o.cancelText || '取消') + '</button>' +
            '<button class="btn ' + (o.danger ? 'danger' : 'primary') + ' js-ok">' + U.esc(o.okText || '确定') + '</button>' +
          '</div>' +
        '</div>' +
      '</div>'
    );

    var bodyEl = modal.querySelector('.modal-body');
    if (typeof o.body === 'string') bodyEl.innerHTML = o.body;
    else if (o.body && o.body.nodeType) bodyEl.appendChild(o.body);

    // 校验错误提示位（插在 body 最上面）
    var errEl = U.h('<div class="field-err" hidden></div>');
    bodyEl.insertBefore(errEl, bodyEl.firstChild);

    function showErr(msg) {
      errEl.textContent = msg || '';
      errEl.hidden = !msg;
      if (msg) bodyEl.scrollTop = 0;
    }

    function close() {
      document.removeEventListener('keydown', escHandler);
      if (modal.parentNode) modal.parentNode.removeChild(modal);
    }

    modal.querySelector('.modal-close').addEventListener('click', close);
    modal.querySelector('.js-cancel').addEventListener('click', close);
    modal.addEventListener('mousedown', function (e) { if (e.target === modal) close(); });

    escHandler = function (e) { onEsc(e, close); };
    document.addEventListener('keydown', escHandler);

    var okBtn = modal.querySelector('.js-ok');
    okBtn.addEventListener('click', function () {
      if (typeof o.onOk !== 'function') { close(); return; }
      var ret;
      try { ret = o.onOk(modal); }
      catch (e) { showErr(e && e.message ? e.message : '操作失败'); return; }

      if (ret && typeof ret.then === 'function') {
        // 异步：按钮进入处理中，成功后关闭
        var old = okBtn.innerHTML;
        okBtn.disabled = true;
        okBtn.innerHTML = '<span class="spinner" style="border-color:#fff;border-top-color:rgba(255,255,255,.35)"></span>处理中';
        ret.then(function () { close(); }, function (e) {
          okBtn.disabled = false; okBtn.innerHTML = old;
          showErr((e && e.message) ? e.message : '操作失败，请重试');
        });
        return;
      }
      if (typeof ret === 'string' && ret) { showErr(ret); return; }
      close();
    });

    root().appendChild(modal);
    // 进 DOM 之后再初始化需要绑事件的控件（照片选择器等）
    if (typeof o.onMount === 'function') {
      try { o.onMount(modal); } catch (e) { /* 挂载失败不应阻断弹窗 */ }
    }
    var first = bodyEl.querySelector('input,select,textarea');
    if (first) setTimeout(function () { first.focus(); }, 30);

    return { close: close, el: modal };
  }

  /** 二次确认弹窗 */
  function confirm(o) {
    o = o || {};
    return open({
      title: o.title || '确认操作',
      width: o.width || 420,
      body: '<p style="font-size:13.5px;color:var(--text-2)">' + U.esc(o.message || '') + '</p>',
      okText: o.okText || '确认',
      cancelText: o.cancelText || '取消',
      danger: !!o.danger,
      onOk: o.onOk
    });
  }

  return { open: open, confirm: confirm };
})();
