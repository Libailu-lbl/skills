/* =========================================================
   router.js — hash 路由 + 导航渲染
   ────────────────────────────────────────────────────────
   · 只负责「当前是哪一页」和「导航长什么样」，不碰业务数据
   · 路由变化 → 调 onChange 通知 app，由 app.refreshAll() 统一刷新
     （铁律：渲染函数之间不许互相调用，一律走 refreshAll）
   ========================================================= */
window.SD = window.SD || {};

SD.router = (function () {
  var U = SD.utils;

  var ROUTES = [
    { id: 'today', name: '今日', icon: '◎' },
    { id: 'items', name: '全部事项', icon: '☰' }
  ];

  var onChange = null;
  var activeId = 'today';

  function find(id) {
    for (var i = 0; i < ROUTES.length; i++) if (ROUTES[i].id === id) return ROUTES[i];
    return ROUTES[0];
  }

  function parse() {
    var h = String(location.hash || '');
    var m = h.match(/^#\/([\w-]+)/);
    return m ? find(m[1]).id : 'today';
  }

  function go(id) { location.hash = '#/' + id; }

  /** 渲染左侧导航（纯 DOM，不读业务数据） */
  function renderNav(host) {
    U.clear(host);
    ROUTES.forEach(function (r) {
      var b = U.h('<button class="nav-item' + (r.id === activeId ? ' active' : '') + '" type="button">' +
        '<span>' + r.icon + '</span><span>' + U.esc(r.name) + '</span></button>');
      b.addEventListener('click', function () { go(r.id); });
      host.appendChild(b);
    });
  }

  function sync() {
    activeId = parse();
    renderNav(document.getElementById('nav'));
    if (typeof onChange === 'function') onChange(activeId);
  }

  function init(cb) {
    onChange = cb;
    window.addEventListener('hashchange', sync);
    sync();
  }

  return {
    ROUTES: ROUTES,
    find: find,
    current: function () { return activeId; },
    go: go,
    init: init
  };
})();
