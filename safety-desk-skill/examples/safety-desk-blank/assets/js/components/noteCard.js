/* =========================================================
   components/noteCard.js — 可折叠的说明卡（口径说明 / 说明）
   ────────────────────────────────────────────────────────
   为什么要有它（2026-11-12 用户要求「所有口径说明改成不点击不展开」）：
     各页底部原来常驻一大段口径说明，页面一长就被挤到看不见的地方，
     但真正需要它的人（被问「这数怎么来的」时）才会去找。
     默认收起 → 页面短一截；要看的人点一下标题就展开。

   约定（改之前先读，否则会踩坑）：
     · **默认收起**：首次进入、刷新页面都是收起态。展开态只记在内存
       （本模块的 opened 表），刷新即回收起，不落 localStorage ——
       用户没要求"记住展开"，落库反而会让下一次打开莫名长出一大段文字。
     · **正文始终在 DOM 里**：收起只靠 CSS（.note-card[data-open="0"] .note-body），
       不用 hidden、也不在收起时不渲染。两个原因：
         ① 页面内搜索（Ctrl+F）与冒烟测试的 textContent 断言仍能命中原文；
         ② 展开/收起不需要重建节点，滚动位置不跳。
     · **不要给 .note-body 挂 display:flex 之类的作者样式**：那会盖掉收起规则
       （踩坑 28：[hidden] 被 display 盖掉是同一类问题）。
     · key 用来跨重绘记住展开态（ctx.refresh 会重建整页）。同一页多个说明卡
       必须给不同 key，否则点开一个另一个也跟着开。
   ========================================================= */
window.SD = window.SD || {};
SD.comp = SD.comp || {};

SD.comp.noteCard = (function () {
  var U = SD.utils;

  /** key -> true。只存内存：刷新页面回到「全部收起」 */
  var opened = {};
  var seq = 0;

  /**
   * @param {object} o
   *   title  {string} 标题（默认「口径说明」）
   *   html   {string} 正文 HTML（原样插入，调用方自己保证转义）
   *   key    {string} 展开态标识（不传则每次都是新卡、恒为收起）
   *   open   {bool}   强制初始展开（默认 false）
   * @returns {HTMLElement}
   */
  function build(o) {
    o = o || {};
    var key = o.key || ('note-' + (++seq));
    var isOpen = o.open === true || !!opened[key];

    var el = U.h(
      '<section class="card tight note-card" data-open="' + (isOpen ? '1' : '0') + '">' +
        '<button type="button" class="note-head" aria-expanded="' + (isOpen ? 'true' : 'false') + '">' +
          '<b class="t-2">' + U.esc(o.title || '口径说明') + '</b>' +
          '<span class="note-tip">' + (isOpen ? '点击收起' : '点击展开') + '</span>' +
          '<span class="note-chev">' + SD.icons.get('chevronD', 15) + '</span>' +
        '</button>' +
        '<div class="note-body">' + (o.html || '') + '</div>' +
      '</section>'
    );

    var head = el.querySelector('.note-head');
    var tip = el.querySelector('.note-tip');

    head.addEventListener('click', function () {
      var next = el.getAttribute('data-open') !== '1';
      el.setAttribute('data-open', next ? '1' : '0');
      head.setAttribute('aria-expanded', next ? 'true' : 'false');
      if (tip) tip.textContent = next ? '点击收起' : '点击展开';
      if (next) opened[key] = true; else delete opened[key];
    });

    return el;
  }

  /** 供测试 / 调试：当前展开态（不要用它改状态，改状态请点标题） */
  function isOpen(el) {
    return !!(el && el.getAttribute && el.getAttribute('data-open') === '1');
  }

  /** 清空记忆（清空数据 / 换角色时调，避免上一轮的展开态残留） */
  function reset() { opened = {}; }

  return { build: build, isOpen: isOpen, reset: reset };
})();
