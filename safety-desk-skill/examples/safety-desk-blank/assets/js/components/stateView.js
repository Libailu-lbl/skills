/* =========================================================
   stateView.js — 状态视图组件：加载中 / 空数据 / 加载失败
   需求明确要求三种状态都要有对应展示，且失败要能重试。
   统一由这里产出，避免每个视图各写一份、样式和行为跑偏。
   ========================================================= */
window.SD = window.SD || {};
SD.comp = SD.comp || {};

SD.comp.state = (function () {
  var U = SD.utils;

  /**
   * 渲染一个状态块
   * @param {string} kind  'loading' | 'empty' | 'error'
   * @param {object} o     { title, desc, icon, retry, action:{text,onClick} }
   * @returns {HTMLElement}
   */
  function build(kind, o) {
    o = o || {};
    var icon = o.icon || (kind === 'error' ? 'alertCircle' : (kind === 'empty' ? 'inbox' : 'clock'));
    var title = o.title || (kind === 'error' ? '数据加载失败' : (kind === 'empty' ? '暂无数据' : '加载中…'));
    var desc = o.desc || (kind === 'error'
      ? '可能是网络异常或接口未就绪。改动都已保存在本机，可稍后重试。'
      : (kind === 'empty' ? '当前筛选条件下没有记录，换个条件试试。' : ''));

    var el = U.h(
      '<div class="state ' + (kind === 'error' ? 'err' : '') + '">' +
        '<div class="state-ico">' + SD.icons.get(icon, 22) + '</div>' +
        '<h4>' + U.esc(title) + '</h4>' +
        (desc ? '<p>' + U.esc(desc) + '</p>' : '') +
        '<div class="state-actions"></div>' +
      '</div>'
    );

    var box = el.querySelector('.state-actions');

    // 失败态：重试按钮
    if (kind === 'error' && typeof o.retry === 'function') {
      var btn = U.h('<button class="btn primary">' + SD.icons.get('refresh', 15) + '重试</button>');
      btn.addEventListener('click', o.retry);
      box.appendChild(btn);
    }
    // 空态：可选的主行动（如「登记第一条隐患」）
    if (kind === 'empty' && o.action && o.action.text) {
      var ab = U.h('<button class="btn">' + SD.icons.get(o.action.icon || 'plus', 15) + U.esc(o.action.text) + '</button>');
      if (typeof o.action.onClick === 'function') ab.addEventListener('click', o.action.onClick);
      box.appendChild(ab);
    }
    return el;
  }

  /** 骨架屏块（用于卡片区加载中） */
  function skeleton(n, lines) {
    n = n || 3; lines = lines || 3;
    var wrap = U.h('<div class="grid cols-' + (n >= 4 ? 4 : (n === 3 ? 3 : 2)) + '"></div>');
    for (var i = 0; i < n; i++) {
      var card = U.h('<div class="sk-card"><div class="skeleton"></div></div>');
      var box = card.querySelector('.skeleton');
      for (var j = 0; j < lines; j++) {
        box.appendChild(U.h('<div class="sk-line" style="width:' + (90 - j * 18) + '%"></div>'));
      }
      wrap.appendChild(card);
    }
    return wrap;
  }

  /**
   * 往容器里画状态（会先清空容器）
   * @param {HTMLElement} host
   * @param {string} kind
   * @param {object} o
   */
  function render(host, kind, o) {
    if (!host) return;
    U.clear(host);
    if (kind === 'loading' && o && o.skeleton) {
      host.appendChild(skeleton(o.skeleton, o.lines));
    } else {
      host.appendChild(build(kind, o));
    }
  }

  return { build: build, render: render, skeleton: skeleton };
})();
