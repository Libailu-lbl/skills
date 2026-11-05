/* =========================================================
   router.js — 路由与导航
   ────────────────────────────────────────────────────────
   · 用 hash 路由（#/hazard），刷新不丢当前页，也能直接分享某页链接
   · 导航分两块：常用（常驻，含「特种作业」下拉）+ 下方两个并列下拉「报表」「更多」
   · 常用：安全概览 / 待办任务 / 隐患管理 / 安全巡检 / 安全培训 / 特种作业（▸ 人员 · 设备人员 · 作业票）
   · 报表（★ 2026-11-05 从「更多」提出，与它同级且排在它前面）：日报 / 周报 / 交接班记录 / 违章考核单
   · 更多：数据看板 / 通知公告
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

  /* 路由表：id → {name, icon, group, [subGroup], [perm], [parent], [children], [short]}
     group：primary=常用（常驻，含特种作业父级）｜secondary=更多（折叠）
     subGroup：更多组内的小分组标签（报表：日报/周报）
     short：侧栏「常用功能」磁贴用的短名（不给就用 name）——磁贴窄，全名会换行
     ★ 这张表同时也是**使用频率统计的范围**：15 项都是页面级功能（都有独立视图），
       报表 / 更多只做折叠、没有落点，不在表里，也就不进统计 */
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
    { id: 'shiftLog', name: '安全巡检交接班记录', short: '交接班记录', icon: 'clipboard', group: 'secondary', subGroup: 'reports' },
    /* 安全违章考核单（★ 2026-11-04）：一单一次违章，编号 FZKH-001，默认看全年 */
    { id: 'violation', name: '安全违章考核单', short: '违章考核单', icon: 'file', group: 'secondary', subGroup: 'reports' },

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

  /* ---------------- 下拉菜单（★ 2026-11-05） ----------------
     特种作业 / 报表 / 更多 三处统一成同一套下拉：
       · **只有点击才开合**：★ 2026-11-05 起取消「悬停自动展开」，
         鼠标移入 / 移出不再触发任何展开或收起动作（避免误触把菜单弹开、也避免移开就收）
       · 互斥：同一时间只有一个下拉展开（三者同处一层，不存在父子嵌套）
       · 图标指示：父项右侧箭头随展开旋转 180°；子树内激活时父项加 .in-tree 高亮
       · 状态记忆：dropOpen 记住用户显式开合，renderNav 重建 DOM 后按它恢复，
         不会「点一下筛选就把菜单收回去」；换页时按当前页自动展开所属分支
     ========================================================= */

  var dropOpen = {};                                  // key → bool（只记用户显式操作过的）
  var lastActive = null;                              // 上一次渲染时的页面，用于判断「换页了」
  var SUB_LABEL = { reports: '报表' };
  var DROP_META = {
    more:    { name: '更多', icon: 'layers' },
    reports: { name: '报表', icon: 'daily' }
  };

  /** 路由（或其子路由）是否等于当前页 */
  function subtreeHas(r, activeId) {
    if (!r) return false;
    if (r.id === activeId) return true;
    return !!(r.children && r.children.indexOf(activeId) >= 0);
  }

  /** 节点描述里是否有当前页（用来决定父项高亮与自动展开） */
  function descHas(desc, activeId) {
    if (!desc) return false;
    if (desc.kind === 'route') return subtreeHas(desc.route, activeId);
    if (subtreeHas(desc.nav, activeId)) return true;
    return (desc.items || []).some(function (x) { return descHas(x, activeId); });
  }

  /** 把展开状态刷到 DOM（data-open / aria-expanded / 箭头旋转） */
  function applyDrop(wrap, on) {
    wrap.dataset.open = on ? '1' : '0';
    if (on) wrap.classList.add('open'); else wrap.classList.remove('open');
    var head = wrap.firstElementChild;
    if (!head || !head.dataset.dropHead) return;
    head.setAttribute('aria-expanded', on ? 'true' : 'false');
    var chev = head.querySelector('.chev');
    if (chev) { if (on) chev.classList.add('open'); else chev.classList.remove('open'); }
  }

  /** 这个下拉此刻是否真的看得见（任一祖先下拉收起，它就不可见） */
  function visibleDrop(d) {
    var p = d.parentElement;
    while (p) {
      if (p.classList && p.classList.contains('nav-drop') && p.dataset.open !== '1') return false;
      p = p.parentElement;
    }
    return true;
  }

  /** 设置某个下拉的开合；展开时关掉其它**并列**下拉
      —— 只关「看得见的」那些：父级收起时子级只是被藏起来，状态留着，父级再展开还是原样 */
  function setDrop(wrap, key, on) {
    dropOpen[key] = !!on;
    applyDrop(wrap, on);
    if (!on) return;
    Array.prototype.forEach.call(document.querySelectorAll('.nav-drop[data-open="1"]'), function (d) {
      if (d === wrap || d.contains(wrap) || wrap.contains(d)) return;
      if (!visibleDrop(d)) return;
      dropOpen[d.dataset.drop] = false;
      applyDrop(d, false);
    });
  }

  /** 单个路由项（叶子节点） */
  function plainNode(r, activeId, counts) {
    var locked = !!(r.perm && !SD.auth.can(r.perm));
    var cnt = counts && counts[r.id];
    var btn = U.h(
      '<button class="nav-item' + (r.id === activeId ? ' active' : '') + (locked ? ' locked' : '') +
        '" data-route="' + r.id + '">' +
        '<span class="ico">' + SD.icons.get(locked ? 'lock' : r.icon, 18) + '</span>' +
        '<span class="txt">' + U.esc(r.name) + '</span>' +
        (cnt && cnt.n ? '<span class="nav-count ' + (cnt.cls || '') + '" title="' + U.esc(cnt.title || '') + '">' + cnt.n + '</span>' : '') +
      '</button>'
    );
    btn.addEventListener('click', function () {
      if (locked) { U.toast('无权限访问：' + r.name + '（当前角色不可见）', 'err'); return; }
      go(r.id);
    });
    return btn;
  }

  /**
   * 下拉父项
   * @param {object} desc { key, name, icon, nav, items:[{kind:'route',route}|{kind:'drop',...}], count }
   *   nav 有值 = 这个父项本身也是个页面（特种作业），点开会顺带进落地页
   */
  function dropNode(desc, activeId, counts) {
    var has = descHas(desc, activeId);
    /* 三个下拉**一律默认收起**，只在「当前页就在它里面」时自动展开
       （★ 2026-11-05 晚：报表不再默认摊开，首屏更短；进日报/周报/交接班/考核单时它自己展开） */
    var auto = has;
    var open = dropOpen[desc.key] == null ? auto : !!dropOpen[desc.key];
    var locked = !!(desc.nav && desc.nav.perm && !SD.auth.can(desc.nav.perm));
    var cnt = desc.count;

    var wrap = U.h('<div class="nav-drop" data-drop="' + desc.key + '" data-open="' + (open ? '1' : '0') +
      '"><div class="nav-children nav-drop-body" id="nd-' + desc.key + '"></div></div>');
    var body = wrap.querySelector('.nav-drop-body');

    /* 父项本身就是页面时（特种作业），落到该页要像普通项一样显示「选中」 */
    var isActive = !!(desc.nav && desc.nav.id === activeId);
    var head = U.h(
      '<button class="nav-item has-children' + (has ? ' in-tree' : '') + (isActive ? ' active' : '') +
        (locked ? ' locked' : '') +
        '" data-drop-head="' + desc.key + '" aria-expanded="' + (open ? 'true' : 'false') + '"' +
        ' aria-controls="nd-' + desc.key + '"' +
        (desc.nav ? ' data-route="' + desc.nav.id + '"' : '') + '>' +
        '<span class="ico">' + SD.icons.get(locked ? 'lock' : desc.icon, 18) + '</span>' +
        '<span class="txt">' + U.esc(desc.name) + '</span>' +
        (cnt && cnt.n ? '<span class="nav-count ' + (cnt.cls || '') + '" title="' + U.esc(cnt.title || '') + '">' + cnt.n + '</span>' : '') +
        '<span class="chev' + (open ? ' open' : '') + '">' + SD.icons.get('chevronD', 14) + '</span>' +
      '</button>'
    );
    wrap.insertBefore(head, body);
    if (open) wrap.classList.add('open');

    /* 子项：叶子直接渲染，子下拉递归 */
    (desc.items || []).forEach(function (it) {
      body.appendChild(it.kind === 'drop' ? dropNode(it, activeId, counts) : plainNode(it.route, activeId, counts));
    });

    /* ---- 点击：**唯一的开合入口**（悬停不参与，鼠标移入/移出不改状态） ---- */
    head.addEventListener('click', function (e) {
      e.preventDefault();
      if (locked) { U.toast('无权限访问：' + desc.name + '（当前角色不可见）', 'err'); return; }
      if (wrap.dataset.open === '1') {
        setDrop(wrap, desc.key, false);
        return;
      }
      setDrop(wrap, desc.key, true);
      /* 父项自己有落地页（特种作业）且当前不在它的子树里 → 顺手进去；
         已经在里面就只切展开，免得「想收起菜单却被弹回落地页」 */
      if (desc.nav && !subtreeHas(desc.nav, activeId)) go(desc.nav.id);
    });

    /* 注意：这里**不再绑定 mouseenter / mouseleave**。
       悬停开合容易误触（鼠标划过整列菜单会被逐个弹开），且与「点击展开」语义冲突，
       2026-11-05 按需求取消；视觉上的 hover 高亮仍由 CSS 的 :hover 负责。 */
    return wrap;
  }

  /**
   * 渲染导航
   *   els.primary  ← 常用项 + 特种作业下拉
   *   els.secondary ← 报表下拉 + 更多下拉（并列同级，报表在前）
   * @param {object} els   {primary, secondary, tabbar}
   * @param {string} activeId
   * @param {object} counts {routeId: {n, cls, title}}
   */
  function renderNav(els, activeId, counts) {
    counts = counts || {};

    /* 换页就把「手动开合」清零，回到「按当前页自动展开所属分支」的默认。
       这样做的好处：① 从别的页跳进来，所属分支一定是展开的，不会因为上次手动收起而看不见；
       ② 同一页里点筛选、改数据触发的重绘（activeId 没变）仍保留刚刚的手动开合。 */
    if (lastActive !== activeId) {
      dropOpen = {};
      lastActive = activeId;
    }

    /* 常用组：普通项 + 「特种作业」下拉 */
    if (els.primary) {
      U.clear(els.primary);
      ROUTES.filter(function (r) { return r.group === 'primary' && !r.parent; })
        .forEach(function (r) {
          if (!r.children) { els.primary.appendChild(plainNode(r, activeId, counts)); return; }
          els.primary.appendChild(dropNode({
            kind: 'drop', key: r.id, name: r.name, icon: r.icon, nav: r,
            items: r.children.map(function (cid) {
              var c = find(cid);
              return c ? { kind: 'route', route: c } : null;
            }).filter(Boolean),
            count: counts[r.id]
          }, activeId, counts));
        });
    }

    /* 靠下的两个顶层下拉：**「报表」在前、「更多」在后，两者并列同级**
       （★ 2026-11-05：报表从「更多」里提出来，不再嵌在它内部，缩进与字号跟「更多」完全一致） */
    if (els.secondary) {
      U.clear(els.secondary);
      var sec = ROUTES.filter(function (r) { return r.group === 'secondary' && !r.parent; });

      /* ① 先渲染各小分组（目前只有 reports），保证「报表」排在「更多」之前 */
      var subs = [];
      sec.forEach(function (r) { if (r.subGroup && subs.indexOf(r.subGroup) < 0) subs.push(r.subGroup); });
      subs.forEach(function (sg) {
        var meta = DROP_META[sg] || { name: SUB_LABEL[sg] || sg, icon: 'file' };
        els.secondary.appendChild(dropNode({
          kind: 'drop', key: sg, name: meta.name, icon: meta.icon, nav: null,
          items: sec.filter(function (r) { return r.subGroup === sg; })
                    .map(function (r) { return { kind: 'route', route: r }; })
        }, activeId, counts));
      });

      /* ② 再渲染「更多」：只装没分组的那几项；一项都不剩时整块不出现，不留空壳 */
      var rest = sec.filter(function (r) { return !r.subGroup; })
        .map(function (r) { return { kind: 'route', route: r }; });
      if (rest.length) {
        els.secondary.appendChild(dropNode({
          kind: 'drop', key: 'more', name: DROP_META.more.name, icon: DROP_META.more.icon,
          nav: null, items: rest
        }, activeId, counts));
      }
    }

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
  }

  /** 全局只绑一次：Esc 收起所有下拉（键盘用户的出口） */
  var dropBound = false;
  function bindMore() {
    if (dropBound) return;
    dropBound = true;
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      Array.prototype.forEach.call(document.querySelectorAll('.nav-drop[data-open="1"]'), function (d) {
        dropOpen[d.dataset.drop] = false;
        applyDrop(d, false);
      });
    });
  }

  function routeName(id) { var r = find(id); return r ? r.name : ''; }

  return {
    ROUTES: ROUTES, init: init, go: go, current: current,
    renderNav: renderNav, bindMore: bindMore, routeName: routeName, find: find
  };
})();
