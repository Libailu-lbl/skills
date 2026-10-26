/* =========================================================
   router.js — 路由与导航
   ────────────────────────────────────────────────────────
   · 用 hash 路由（#/hazard），刷新不丢当前页，也能直接分享某页链接
   · 导航分两组：常用（常驻，含带子菜单的「特种作业」父级）+ 更多（折叠，含报表小分组）
   · 常用：安全概览 / 待办任务 / 隐患管理 / 安全巡检 / 安全培训 / 特种作业（▸ 人员 · 作业票）
   · 更多（折叠）：数据看板 / 通知公告 + 报表小分组（日报 / 周报）
   · 特种作业 是「常用区里的独立父级菜单项」，点击进入落地页，其下挂两个子菜单：
       特种作业人员 / 危险作业票
   · 权限：路由可带 perm 字段，无权限时导航显示锁且点击被拦，
     由 app.js 在中央统一渲染「无权限」页（单一门禁入口）
   · 本模块只负责「路由状态」和「导航 DOM」，不碰业务数据；
     路由变化通过 onChange 回调通知 app，由 app.refreshAll 统一刷新
   ========================================================= */
window.SD = window.SD || {};

SD.router = (function () {
  var U = SD.utils;

  /* 路由表：id → {name, icon, group, [subGroup], [perm], [parent], [children]}
     group：primary=常用（常驻，含特种作业父级）｜secondary=更多（折叠）
     subGroup：更多组内的小分组标签（报表：日报/周报） */
  var ROUTES = [
    { id: 'overview',   name: '安全概览',   icon: 'overview',   group: 'primary' },
    { id: 'todo',       name: '待办任务',   icon: 'todo',       group: 'primary' },
    { id: 'hazard',     name: '隐患管理',   icon: 'hazard',     group: 'primary' },
    { id: 'inspection', name: '安全巡检',   icon: 'inspection', group: 'primary' },
    { id: 'training',   name: '安全培训',   icon: 'training',   group: 'primary' },
    { id: 'dashboard',  name: '数据看板',   icon: 'dashboard',  group: 'secondary' },
    { id: 'notice',     name: '通知公告',   icon: 'notice',     group: 'secondary' },

    /* 报表：日报 / 周报（按当日/本周工作自动生成，可导出 Excel），归入「更多」折叠组 */
    { id: 'dailyReport',  name: '日报', icon: 'daily',  group: 'secondary', subGroup: 'reports' },
    { id: 'weeklyReport', name: '周报', icon: 'weekly', group: 'secondary', subGroup: 'reports' },
    { id: 'shiftLog', name: '安全巡检交接班记录', icon: 'clipboard', group: 'secondary', subGroup: 'reports' },

    /* 特种作业：常用区里的独立父级菜单项（带子菜单与权限门禁），
       子项由 navItem 递归渲染在父级下方，不单独进组 */
    {
      id: 'special', name: '特种作业', icon: 'shield', group: 'primary', perm: 'special.view',
      children: ['specPersonnel', 'devicePersonnel', 'specPermit']
    },
    { id: 'specPersonnel', name: '特种作业人员', icon: 'user',      group: 'primary', parent: 'special', perm: 'special.view' },
    { id: 'devicePersonnel', name: '特种设备人员', icon: 'wrench', group: 'primary', parent: 'special', perm: 'special.view' },
    { id: 'specPermit',    name: '危险作业票',   icon: 'clipboard', group: 'primary', parent: 'special', perm: 'special.view' }
  ];

  var DEFAULT = 'overview';
  var currentId = DEFAULT;
  var onChange = null;

  function find(id) {
    for (var i = 0; i < ROUTES.length; i++) if (ROUTES[i].id === id) return ROUTES[i];
    return null;
  }
  function exists(id) { return !!find(id); }

  function fromHash() {
    var h = (location.hash || '').replace(/^#\/?/, '');
    return exists(h) ? h : DEFAULT;
  }

  /** 跳转（会写 hash，hashchange 再驱动刷新，保证单一入口） */
  function go(id) {
    if (!exists(id)) id = DEFAULT;
    if (location.hash === '#/' + id) {
      // 已在该页：手动触发一次刷新（例如点同一个导航项想重载）
      if (typeof onChange === 'function') onChange(id);
      return;
    }
    location.hash = '#/' + id;
  }

  function init(cb) {
    onChange = cb;
    currentId = fromHash();
    window.addEventListener('hashchange', function () {
      currentId = fromHash();
      if (typeof onChange === 'function') onChange(currentId);
    });
    if (typeof onChange === 'function') onChange(currentId);
  }

  function current() { return currentId; }

  /** 该路由（或其任一子路由）是否处于当前激活子树 */
  function inTree(r, activeId) {
    if (r.id === activeId) return true;
    if (r.children) return r.children.indexOf(activeId) >= 0;
    return false;
  }

  /** 生成单个导航节点（可能带子菜单） */
  function navItem(r, activeId, counts) {
    var hasChildren = !!(r.children && r.children.length);
    var locked = !!(r.perm && !SD.auth.can(r.perm));
    var cnt = counts && counts[r.id];

    var wrap = U.h('<div class="nav-node"></div>');

    var btn = U.h(
      '<button class="nav-item' +
        (r.id === activeId ? ' active' : '') +
        (hasChildren ? ' has-children' : '') +
        (locked ? ' locked' : '') + '" data-route="' + r.id + '">' +
        '<span class="ico">' + SD.icons.get(locked ? 'lock' : r.icon, 18) + '</span>' +
        '<span class="txt">' + U.esc(r.name) + '</span>' +
        (cnt && cnt.n ? '<span class="nav-count ' + (cnt.cls || '') + '" title="' + U.esc(cnt.title || '') + '">' + cnt.n + '</span>' : '') +
        /* 子菜单常驻展开（不再折叠），所以不画折叠箭头 */
      '</button>'
    );
    btn.addEventListener('click', function () {
      if (locked) { U.toast('无权限访问：' + r.name + '（当前角色不可见）', 'err'); return; }
      go(r.id);
    });
    wrap.appendChild(btn);

    // 父级：渲染子菜单 —— **常驻展开**：特种作业下的特种作业人员 / 特种设备人员 / 危险作业票
    // 三个入口直接可见（以前只在激活子树内展开，用户看不到「特种设备人员台帐」）
    if (hasChildren) {
      var kids = U.h('<div class="nav-children"></div>');
      r.children.forEach(function (cid) {
        var c = find(cid);
        if (c) kids.appendChild(navItem(c, activeId, counts));
      });
      wrap.appendChild(kids);
    }
    return wrap;
  }

  /** 更多组内的小分组标题（如「报表」） */
  var SUB_LABEL = { reports: '报表' };

  /**
   * 渲染一组导航
   * @param {HTMLElement} container
   * @param {string} groupName  primary / secondary / special
   * @param {string} activeId
   * @param {object} counts {routeId: {n, cls, title}}
   * 组内可带 subGroup（小分组）：先渲染普通项，再按 subGroup 分段加小标题渲染
   */
  function renderGroup(container, groupName, activeId, counts) {
    if (!container) return;
    U.clear(container);
    var items = ROUTES.filter(function (r) { return r.group === groupName && !r.parent; });
    // 普通项（无 subGroup）
    items.filter(function (r) { return !r.subGroup; })
      .forEach(function (r) { container.appendChild(navItem(r, activeId, counts)); });
    // 小分组：按出现顺序逐段加小标题
    var subs = [];
    items.forEach(function (r) {
      if (r.subGroup && subs.indexOf(r.subGroup) < 0) subs.push(r.subGroup);
    });
    subs.forEach(function (sg) {
      container.appendChild(U.h('<div class="nav-sub-title">' + U.esc(SUB_LABEL[sg] || sg) + '</div>'));
      items.filter(function (r) { return r.subGroup === sg; })
        .forEach(function (r) { container.appendChild(navItem(r, activeId, counts)); });
    });
  }

  /**
   * 渲染导航
   * @param {object} els   {primary, secondary, special, tabbar}
   * @param {string} activeId
   * @param {object} counts {routeId: {n, cls, title}}
   */
  function renderNav(els, activeId, counts) {
    counts = counts || {};
    renderGroup(els.primary, 'primary', activeId, counts);
    renderGroup(els.secondary, 'secondary', activeId, counts);

    // 手机底部 Tab：常用 3 项 + 更多 2 项（看板/通知）+ 特种作业，共 6 项
    if (els.tabbar) {
      U.clear(els.tabbar);
      ['overview', 'todo', 'hazard', 'special', 'dashboard', 'notice'].forEach(function (id) {
        var r = find(id); if (!r) return;
        var t = U.h(
          '<button class="tab' + (inTree(r, activeId) ? ' active' : '') + '">' +
            '<span class="ico">' + SD.icons.get(r.icon, 20) + '</span>' +
            '<span>' + U.esc(r.name) + '</span>' +
          '</button>'
        );
        t.addEventListener('click', function () { go(id); });
        els.tabbar.appendChild(t);
      });
    }

    // 「更多」展开状态：当前页在更多组里时强制展开；否则保留用户手动开合的状态
    // （否则在常用页展开「更多」后，一次筛选刷新就把它收回了）
    var btn = document.getElementById('navMoreBtn');
    var sec = document.getElementById('navSecondary');
    if (btn && sec) {
      var inSecondary = !!find(activeId) && find(activeId).group === 'secondary';
      var open = inSecondary || sec.dataset.userOpen === '1';
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      sec.hidden = !open;
    }
  }

  /** 绑定「更多」折叠按钮（只绑一次） */
  function bindMore() {
    var btn = document.getElementById('navMoreBtn');
    var sec = document.getElementById('navSecondary');
    if (!btn || !sec || btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', function () {
      var open = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', open ? 'false' : 'true');
      sec.hidden = open;
      sec.dataset.userOpen = open ? '0' : '1';   // 记住手动开合意图，刷新不收回
    });
  }

  function routeName(id) { var r = find(id); return r ? r.name : ''; }

  return {
    ROUTES: ROUTES, init: init, go: go, current: current,
    renderNav: renderNav, bindMore: bindMore, routeName: routeName, find: find
  };
})();
