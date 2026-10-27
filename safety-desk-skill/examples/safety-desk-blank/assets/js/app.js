/* =========================================================
   app.js — 启动与统一刷新入口
   ────────────────────────────────────────────────────────
   架构（严格遵守单向调用，杜绝渲染函数互相调用成环）：

     数据层 store / api
        ↑
     计算层 metrics.summarize()   ← 只算一次，结果放 state.summary
        ↑
     装配层 refreshAll()          ← 唯一刷新入口
        ↓
     视图层 views.xxx.render()    ← 只读 state.summary，不取数、不互调

   任何交互（点按钮、改筛选、推进状态）都只允许：
     改数据 → 调 refreshAll() 或 reload()
   绝不允许在某个 render() 内部直接调用另一个 render()。

   单机离线版：无数据源切换、无模拟故障开关、无示例数据；
   顶栏只保留真实可用的操作（导出 / 导入 / 清空 / 设置 / 角色）。
   ========================================================= */
window.SD = window.SD || {};

SD.app = (function () {
  var U = SD.utils;

  /* ---------------- 全局状态 ---------------- */
  var state = {
    loading: true,        // 首次取数中
    error: null,          // 取数失败原因
    data: null,           // 原始数据集
    summary: null,        // metrics.summarize 的结果
    filters: {
      todoKind: 'all',
      hazard: { status: 'all', severity: 'all', type: 'all', dept: 'all', q: '' },
      insp: { range: 'week', q: '' },
      training: { status: 'all', q: '' },
      specPermit: { status: 'all', q: '' },
      specPersonnel: { status: 'all', q: '' },
      devicePersonnel: { status: 'all', q: '' },
      notice: { q: '' },
      todo: { q: '' },
      cert: { level: 'all' }
    },
    sort: {
      hazard: { key: 'priority', dir: 'asc' },
      insp: { key: 'scheduledDate', dir: 'asc' },
      training: { key: 'startDate', dir: 'asc' },
      specPermit: { key: 'status', dir: 'asc' },
      specPersonnel: { key: '_daysLeft', dir: 'asc' },
      devicePersonnel: { key: '_daysLeft', dir: 'asc' },
      notice: { key: 'smart', dir: 'desc' },
      todo: { key: 'priority', dir: 'asc' }
    },
    pending: null         // 跳转时携带的参数（如 openDialog）
  };

  var els = {};

  /* ---------------- 取数 ---------------- */
  function load() {
    state.loading = true;
    state.error = null;
    refreshAll();

    SD.api.fetchAll().then(function (data) {
      state.data = data || {};
      state.summary = SD.metrics.summarize(state.data);
      state.loading = false;
      state.error = null;
      refreshAll();
    }, function (e) {
      state.loading = false;
      state.error = (e && e.message) ? e.message : '未知错误';
      refreshAll();
    });
  }

  /** 写操作后重新取数（保证界面与数据源一致） */
  function reload() { load(); }

  /* ---------------- 导航计数徽标 ---------------- */
  function navCounts() {
    var s = state.summary;
    if (!s) return {};
    var c = {};
    c.todo = { n: s.todos.length, cls: s.overdueCount ? 'alert' : '', title: '待办事项（隐患 / 巡检 / 作业票 / 培训未完成项）' };
    c.hazard = { n: s.openCount, cls: s.overdueCount ? 'alert' : '', title: '未闭环隐患' };
    if (s.todayInspections.length) {
      c.inspection = { n: s.todayInspections.length, cls: 'warn', title: '今日待执行巡检' };
    }
    // 培训徽标：进行中 + 未开始（提醒排期与跟课）
    var trainOpen = (s.trainings || []).filter(function (t) {
      return t.status === 'ongoing' || t.status === 'planned';
    }).length;
    if (trainOpen) {
      c.training = { n: trainOpen, cls: 'warn', title: '进行中 + 未开始的培训' };
    }
    // 特种作业：人员资质预警（已过期 + 待复审）+ 待审批作业票
    var specialRisk = (s.specialPersonnelSummary.expired + s.specialPersonnelSummary.pending_review) + s.permitSummary.pending;
    if (specialRisk) {
      c.special = {
        n: specialRisk,
        cls: s.specialPersonnelSummary.expired ? 'alert' : 'warn',
        title: '特种作业：人员资质预警 ' + (s.specialPersonnelSummary.expired + s.specialPersonnelSummary.pending_review) +
               ' 项 · 待审批作业票 ' + s.permitSummary.pending + ' 张'
      };
    }
    return c;
  }

  /* ---------------- 无权限占位页 ---------------- */
  function forbiddenState(route) {
    var role = SD.auth.roleInfo();
    var box = U.h(
      '<section class="card forbidden-card">' +
        '<div class="fb-ico">' + SD.icons.get('lock', 30) + '</div>' +
        '<h3>无访问权限</h3>' +
        '<p class="t-2">「' + U.esc(route ? route.name : '该模块') + '」需要 <b>特种作业</b> 权限，' +
          '当前角色「' + U.esc(role.name) + '」无权访问。</p>' +
        '<p class="t-3 t-sm">' + U.esc(role.desc || '') + '</p>' +
        '<div class="actions"></div>' +
      '</section>'
    );
    // 仅当受限角色时，给出「切换为安全员」的快捷修复入口
    if (!SD.auth.can('special.view')) {
      var btn = U.h('<button class="btn primary">' + SD.icons.get('shield', 16) + '切换为「安全员（全权）」</button>');
      btn.addEventListener('click', function () {
        SD.auth.set('safety_officer');
        syncRoleUI();
        U.toast('已切换为安全员，权限已恢复', 'ok');
        refreshAll();
      });
      box.querySelector('.actions').appendChild(btn);
    }
    return box;
  }

  /* ---------------- 统一刷新入口 ---------------- */
  /** 记下当前聚焦的「需保持聚焦」控件（各版块搜索框，data-keep-focus 标记） */
  function captureFocus() {
    var ae = document.activeElement;
    if (ae && ae.dataset && ae.dataset.keepFocus) {
      return {
        key: ae.dataset.keepFocus,
        start: ae.selectionStart == null ? null : ae.selectionStart,
        end: ae.selectionEnd == null ? null : ae.selectionEnd
      };
    }
    return null;
  }
  /** 重渲析后把聚焦还给同一个搜索框。
      否则：在搜索框打字 → 停顿 250ms 触发 ctx.refresh() → 整个视图 DOM 重建 →
      新输入框虽然文字从 f.q 恢复，聚焦却丢了，表现为「没法连续输入」。 */
  function restoreFocus(f) {
    if (!f || !els.view) return;
    var el = els.view.querySelector('[data-keep-focus="' + f.key + '"]');
    if (!el) return;
    el.focus();
    if (f.start != null) { try { el.setSelectionRange(f.start, f.end); } catch (e) {} }
  }

  function refreshAll() {
    syncRolePill();   // 角色徽标随每次刷新同步
    var focus = captureFocus();
    renderView();
    restoreFocus(focus);
  }

  function renderView() {
    var id = SD.router.current();
    var view = SD.views[id];
    if (!view) id = 'overview', view = SD.views.overview;

    var s = state.summary;

    // 1) 导航（含计数徽标）
    SD.router.renderNav(els, id, navCounts());
    SD.router.bindMore();

    // 2) 顶部标题
    if (els.title) els.title.textContent = view.name;
    if (els.sub) {
      els.sub.textContent = state.loading ? '加载中…'
        : (state.error ? '数据加载失败' : (typeof view.sub === 'function' ? view.sub(s) : ''));
    }

    // 3) 内容区三态：加载中 / 失败 / 正常
    U.clear(els.view);

    if (state.loading) {
      els.view.appendChild(SD.comp.state.skeleton(4, 3));
      return;
    }
    if (state.error) {
      els.view.appendChild(SD.comp.state.build('error', {
        title: '数据加载失败',
        desc: state.error + '。你的改动都已保存在本机，可稍后重试。',
        retry: function () { load(); }
      }));
      return;
    }
    if (!s) {
      els.view.appendChild(SD.comp.state.build('empty', { title: '暂无数据' }));
      return;
    }

    // 3.5) 权限门禁：路由声明了 perm 且当前角色无权 → 统一渲染无权限页
    var route = SD.router.find(id);
    if (route && route.perm && !SD.auth.can(route.perm)) {
      els.view.appendChild(forbiddenState(route));
      return;
    }

    // 4) 正常渲染（视图只读 ctx，不反向调用其它视图）
    var ctx = {
      state: state,
      summary: s,
      go: go,
      refresh: refreshAll,     // 只重绘，不取数
      reload: reload,          // 重新取数后重绘
      completeTodo: completeTodo,
      exportData: exportData
    };
    view.render(els.view, ctx);

    // 5) 处理跳转携带的参数（如「登记隐患」直达弹窗）
    if (state.pending) {
      var p = state.pending;
      state.pending = null;
      if (id === 'hazard') {
        if (p.status) state.filters.hazard.status = p.status;
        if (p.openDialog) {
          SD.views.hazard.openCreate(ctx, s);
        } else if (p.status) {
          refreshAll();
        }
      }
    }
  }

  /* ---------------- 跳转 ---------------- */
  function go(route, params) {
    state.pending = params || null;
    SD.router.go(route);
  }

  /* ---------------- 待办「标记完成」 ----------------
     乐观更新：先按本地规则改内存数据并刷新（界面立刻响应），
     成功后再 reload 与数据源对齐；失败则整体回滚并提示。
     四类单据各走各的状态机（2026-10-24 起待办覆盖四类全部未完成项）：
       隐患   → 按状态机推进一步（待整改→整改中→待验收→已闭环）
       巡检   → 直接标记完成（补默认执行记录）
       作业票 → 按状态机推进（草稿→待审批→已批准→作业中→已完工；批准自动写审批人）
       培训   → 直接标记已完成 */
  var PERMIT_ACT = { pending: '提交审批', approved: '批准', working: '开工', done: '标记完工' };

  function completeTodo(item) {
    var s = state.summary;
    if (!s) return;

    var prev = U.clone(state.data);   // 回滚快照

    function applyLocal() {
      state.summary = SD.metrics.summarize(state.data);
      refreshAll();
    }
    function rollback(msg) {
      state.data = prev;
      state.summary = SD.metrics.summarize(state.data);
      refreshAll();
      U.toast(msg || '操作失败，已回滚', 'err');
    }

    if (item.kind === 'inspection') {
      var t = findById(state.data.inspections, item.ref.id);
      if (!t) return U.toast('任务不存在', 'err');
      t.status = 'done';
      t.completedAt = s.today;
      t.record = { findings: '现场正常，无异常项', signedBy: t.executor, signedAt: s.today };
      applyLocal();
      SD.api.completeInspection(t.id, { findings: '现场正常，无异常项', hazardCount: 0, signedBy: t.executor })
        .then(function () { U.toast('巡检已标记完成', 'ok'); reload(); }, function (e) { rollback(e && e.message); });
      return;
    }

    if (item.kind === 'permit') {
      var p = findById(state.data.workPermits, item.ref.id);
      if (!p) return U.toast('作业票不存在', 'err');
      var NEXT = { draft: 'pending', pending: 'approved', approved: 'working', working: 'done' };
      var to = NEXT[p.status];
      if (!to) return U.toast('该作业票已完工，无需再处理');
      // 本地镜像（与 views/specPermit.transition 的 local 实现保持一致）
      var patch = { status: to };
      if (to === 'approved') {
        patch.approvedBy = '李伯陆';
        patch.approvedAt = s.today + ' ' + new Date().toTimeString().slice(0, 5);
      }
      Object.keys(patch).forEach(function (k) { p[k] = patch[k]; });
      applyLocal();
      SD.api.updateWorkPermit(p.id, patch)
        .then(function () { U.toast('作业票已' + PERMIT_ACT[to], 'ok'); reload(); },
              function (e) { rollback(e && e.message); });
      return;
    }

    if (item.kind === 'training') {
      var tr = findById(state.data.trainings, item.ref.id);
      if (!tr) return U.toast('培训不存在', 'err');
      tr.status = 'done';
      applyLocal();
      SD.api.updateTraining(tr.id, { status: 'done' })
        .then(function () { U.toast('培训已标记完成', 'ok'); reload(); },
              function (e) { rollback(e && e.message); });
      return;
    }

    // 隐患类：按状态机推进一步
    var h = findById(state.data.hazards, item.ref.id);
    if (!h) return U.toast('隐患不存在', 'err');
    var next = SD.metrics.nextStatus(h.status);
    if (!next) return U.toast('该隐患已闭环，无需再处理');

    // 本地镜像（与 dataSource.advanceHazard 的 local 实现保持一致）
    var NAME = { pending: '待整改', fixing: '整改中', verifying: '待验收', closed: '已闭环', delayed: '已延期' };
    var from = NAME[h.status] || h.status;
    if (next === 'closed') h.closedAt = s.today;
    h.status = next;
    h.flow = h.flow || [];
    h.flow.push({
      at: s.today + ' ' + new Date().toTimeString().slice(0, 5),
      by: '王安全', from: from, to: NAME[next], note: '待办区一键推进'
    });
    applyLocal();

    SD.api.advanceHazard(h.id, next, { note: '待办区一键推进' })
      .then(function () { U.toast('已推进到「' + NAME[next] + '」', 'ok'); reload(); },
            function (e) { rollback(e && e.message); });
  }

  function findById(arr, id) {
    if (!arr) return null;
    for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i];
    return null;
  }

  /* ---------------- 导出备份 ---------------- */
  function exportData() {
    var text = SD.store.exportJSON();
    var blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = (SD.store.getSettings().appName || '安全员工作台') + '备份-' + U.today() + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
    U.toast('已导出 JSON 备份', 'ok');
  }

  /* ---------------- 工作台外观（左上角图标 + 名称） ---------------- */
  var BRAND_ICONS = ['shield', 'helmet', 'flame', 'zap', 'award', 'clipboard', 'building', 'layers', 'target', 'wrench', 'book', 'printer'];

  function iconHtml(key, size) {
    try { return SD.icons.get(key, size || 20) || ''; } catch (e) { return ''; }
  }

  /** 把设置里的图标 / 名称 / 副标题渲染到左上角与浏览器标签 */
  function applyBrand() {
    var s = SD.store.getSettings();
    if (els.appName) els.appName.textContent = s.appName;
    if (els.appSub) els.appSub.textContent = s.appSub;
    document.title = s.appName;

    var mark = els.appMark;
    if (!mark) return;
    var ic = s.appIcon || 'shield';
    if (String(ic).indexOf('data:') === 0) {
      U.clear(mark);
      var img = document.createElement('img');
      img.alt = '';
      img.src = ic;
      mark.appendChild(img);
    } else {
      var html = iconHtml(ic, 20) || iconHtml('shield', 20);
      if (html) mark.innerHTML = html;
    }
    mark.setAttribute('data-icon', String(ic).indexOf('data:') === 0 ? 'custom' : ic);
  }

  /** 上传的图片缩到 96×96 的 PNG dataURL（图标不该把备份文件拖大） */
  function shrinkIcon(file, cb) {
    var fr = new FileReader();
    fr.onload = function () {
      var img = new Image();
      img.onload = function () {
        try {
          var cv = document.createElement('canvas');
          cv.width = 96; cv.height = 96;
          var ctx = cv.getContext('2d');
          if (!ctx) return cb(null);
          var k = Math.min(96 / img.width, 96 / img.height);
          var w = Math.max(1, Math.round(img.width * k));
          var h = Math.max(1, Math.round(img.height * k));
          ctx.clearRect(0, 0, 96, 96);
          ctx.drawImage(img, Math.round((96 - w) / 2), Math.round((96 - h) / 2), w, h);
          cb(cv.toDataURL('image/png'));
        } catch (e) { cb(null); }
      };
      img.onerror = function () { cb(null); };
      img.src = String(fr.result);
    };
    fr.onerror = function () { cb(null); };
    fr.readAsDataURL(file);
  }

  /** 「工作台外观」弹窗：图标（内置 12 个 / 上传图片）+ 名称 + 副标题 */
  function openSettings() {
    var cur = SD.store.getSettings();
    var picked = cur.appIcon || 'shield';

    var body = U.h('<div class="form-grid">' +
      '<div class="field"><span class="lbl">工作台图标</span>' +
        '<div class="brand-pick js-pick"></div>' +
        '<div class="brand-up"><label class="btn sm ghost js-up">上传图片<input type="file" accept="image/*" hidden></label>' +
        '<span class="t-3 t-sm">正方形效果最好，会自动缩到 96×96</span></div>' +
      '</div>' +
      '<label class="field"><span class="lbl">工作台名称</span>' +
        '<input class="input" id="setName" maxlength="20" value="' + U.esc(cur.appName) + '" placeholder="如：示例 EHS 台">' +
      '</label>' +
      '<label class="field"><span class="lbl">副标题</span>' +
        '<input class="input" id="setSub" maxlength="30" value="' + U.esc(cur.appSub) + '" placeholder="如：日常安全办公">' +
      '</label>' +
      '<p class="t-3 t-sm" style="margin:2px 0 0">左上角的图标和文字都能点开这里；名称同时作为浏览器标签名，随「导出」一起备份。</p>' +
    '</div>');

    var pick = body.querySelector('.js-pick');
    function paintPick() {
      U.clear(pick);
      if (String(picked).indexOf('data:') === 0) {
        var cu = U.h('<button class="brand-ico is-on" data-icon="custom" title="自定义图片">' +
          '<img alt="" src="' + picked + '"></button>');
        pick.appendChild(cu);
      }
      BRAND_ICONS.forEach(function (k) {
        pick.appendChild(U.h('<button class="brand-ico' + (k === picked ? ' is-on' : '') +
          '" data-icon="' + k + '" title="' + k + '">' + iconHtml(k, 18) + '</button>'));
      });
    }
    paintPick();

    pick.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('.brand-ico') : null;
      if (!b) return;
      picked = b.getAttribute('data-icon');
      paintPick();
    });

    var upInput = body.querySelector('.js-up').querySelector('input');
    upInput.addEventListener('change', function () {
      var f = upInput.files && upInput.files[0];
      if (!f) return;
      shrinkIcon(f, function (dataUrl) {
        if (!dataUrl) { U.toast('这张图片读不了，换一张 JPG / PNG 试试', 'err'); return; }
        picked = dataUrl;
        paintPick();
        U.toast('已选好自定义图标，点保存生效', 'ok');
      });
      upInput.value = '';
    });

    var dlg = SD.comp.dialog.open({
      title: '工作台外观',
      width: 480,
      body: body,
      okText: '保存',
      hint: '名称不能为空',
      onOk: function (modal) {
        var name = (modal.querySelector('#setName').value || '').trim();
        var sub = (modal.querySelector('#setSub').value || '').trim();
        if (!name) return '工作台名称不能为空';
        SD.store.setSettings({ appName: name, appSub: sub, appIcon: picked });
        applyBrand();
        U.toast('已更新工作台外观', 'ok');
      }
    });
    if (dlg && dlg.el) dlg.el.setAttribute('data-auth', '1');
  }

  /* ---------------- 六位密码：解锁 / 修改 ---------------- */
  /** 受限 → 安全员：输入六位密码 */
  function openPinDialog(opts) {
    opts = opts || {};
    var body = U.h('<div class="form-grid">' +
      '<p class="t-2 t-sm" style="margin:0 0 2px">' +
        U.esc(opts.desc || '输入六位安全员密码解锁。本次打开有效，关掉页面再进仍是受限。') + '</p>' +
      '<label class="field"><span class="lbl">安全员密码（6 位数字）</span>' +
        '<input class="input pin-input" id="pinInput" type="password" inputmode="numeric" maxlength="6" autocomplete="off" placeholder="••••••">' +
      '</label>' +
      '<p class="t-3 t-sm js-pin-hint"></p>' +
    '</div>');

    var dlg = SD.comp.dialog.open({
      title: opts.title || '进入安全员权限',
      width: 420,
      body: body,
      okText: '解锁',
      onOk: function (modal) {
        var v = (modal.querySelector('#pinInput').value || '').trim();
        if (!/^\d{6}$/.test(v)) return '请输入 6 位数字';
        var r = SD.auth.unlock(v);
        if (!r.ok) return r.msg;
        syncRoleUI();
        refreshAll();
        U.toast('已进入安全员权限', 'ok');
        if (typeof opts.onOk === 'function') opts.onOk();
      }
    });
    if (dlg && dlg.el) dlg.el.setAttribute('data-auth', '1');

    var hint = body.querySelector('.js-pin-hint');
    if (hint) {
      hint.textContent = SD.auth.usingDefaultPin()
        ? '还没改过密码：默认 123456，进去后请在「设置 → 密码设置」里改掉'
        : '忘记密码没有找回入口：只能清空站点数据（会丢本机数据，先导出备份）';
    }
    var inp = body.querySelector('#pinInput');
    setTimeout(function () { try { inp.focus(); } catch (e) {} }, 60);
    return dlg;
  }

  /** 修改密码（需先解锁为安全员） */
  function openPwdDialog() {
    if (!SD.auth.can('settings.write')) {
      openPinDialog({ title: '先解锁再改密码', onOk: openPwdDialog });
      return;
    }
    var needOld = SD.auth.hasPin();
    var body = U.h('<div class="form-grid">' +
      (needOld ? '<label class="field"><span class="lbl">原密码</span>' +
        '<input class="input" id="pwOld" type="password" inputmode="numeric" maxlength="6" autocomplete="off" placeholder="6 位数字"></label>' : '') +
      '<label class="field"><span class="lbl">新密码（6 位数字）</span>' +
        '<input class="input" id="pwNew" type="password" inputmode="numeric" maxlength="6" autocomplete="off" placeholder="6 位数字"></label>' +
      '<label class="field"><span class="lbl">再输一次</span>' +
        '<input class="input" id="pwNew2" type="password" inputmode="numeric" maxlength="6" autocomplete="off" placeholder="6 位数字"></label>' +
      '<p class="t-3 t-sm">' + (needOld ? '' : '现在用的是默认密码 123456。') +
        '密码只存本机（加盐摘要）；换浏览器或清站点数据后回到默认。</p>' +
      /* ---- 清空数据专用密码（与登录密码分开） ---- */
      '<hr style="border:0;border-top:1px solid var(--line,#e3e7ee);margin:10px 0 6px">' +
      '<p class="t-2 t-sm" style="margin:0">清空数据专用密码：<b>「清空数据」这类不可撤销的操作</b>专用，' +
        '与上面的登录密码相互独立。' +
        (SD.auth.hasPurgePin() ? '' : '现在用的是默认 <b>' + SD.auth.DEFAULT_PURGE_PIN + '</b>，建议改掉。') + '</p>' +
      '<label class="field"><span class="lbl">新的专用密码（6 位数字，留空 = 不改）</span>' +
        '<input class="input" id="pwPurge" type="password" inputmode="numeric" maxlength="6" autocomplete="off" placeholder="留空表示不改"></label>' +
      '<label class="field"><span class="lbl">再输一次专用密码</span>' +
        '<input class="input" id="pwPurge2" type="password" inputmode="numeric" maxlength="6" autocomplete="off" placeholder="留空表示不改"></label>' +
    '</div>');

    var dlg = SD.comp.dialog.open({
      title: '密码设置',
      width: 430,
      body: body,
      okText: '保存密码',
      onOk: function (modal) {
        if (needOld) {
          var old = (modal.querySelector('#pwOld').value || '').trim();
          if (!SD.auth.verifyPin(old)) return '原密码不正确';
        }
        var a = (modal.querySelector('#pwNew').value || '').trim();
        var b = (modal.querySelector('#pwNew2').value || '').trim();
        if (!/^\d{6}$/.test(a)) return '新密码必须是 6 位数字';
        if (a !== b) return '两次输入不一致';
        if (a === SD.auth.DEFAULT_PIN) return '别再用 123456，换一个';

        /* 专用密码：留空 = 不改；填了就必须合法且两次一致 */
        var p1 = (modal.querySelector('#pwPurge').value || '').trim();
        var p2 = (modal.querySelector('#pwPurge2').value || '').trim();
        if (p1 || p2) {
          if (!/^\d{6}$/.test(p1)) return '清空专用密码必须是 6 位数字';
          if (p1 !== p2) return '两次输入的专用密码不一致';
          if (p1 === a) return '专用密码不能与登录密码相同';
        }

        var r = SD.auth.setPin(a);
        if (!r.ok) return r.msg;
        var msg2 = '';
        if (p1) {
          var r2 = SD.auth.setPurgePin(p1);
          if (!r2.ok) return r2.msg;
          msg2 = '，清空专用密码也已更新';
        }
        U.toast('密码已更新，下次进入用新密码解锁' + msg2, 'ok');
      }
    });
    if (dlg && dlg.el) dlg.el.setAttribute('data-auth', '1');
  }

  /* ---------------- 清空数据：必须输专用密码 ---------------- */
  /**
   * 破坏性操作专用：清空前必须输入「清空数据专用密码」（与登录密码相互独立）。
   * 密码错误 → **不执行**，弹窗不关、顶部红字给出明确提示，数据一点不动。
   * @param {object} opts { onDone } 成功后回调（默认重新加载数据）
   */
  function openPurgeDialog(opts) {
    opts = opts || {};
    var isBlank = !!SD.initial;        // 空白版 = 清成空白；示例版 = 恢复出厂示例
    var body = U.h('<div class="form-grid">' +
      '<p class="t-2 t-sm" style="margin:0 0 4px">' +
        (isBlank
          ? '这会把本机录入的<strong>全部数据清空</strong>，且<strong>无法撤销</strong>。建议先「导出备份」。'
          : '这会丢弃你在本机做的<strong>全部改动</strong>（隐患、巡检、培训、台账…），恢复成出厂示例数据。建议先「导出备份」。') +
      '</p>' +
      '<label class="field"><span class="lbl">清空数据专用密码（6 位数字）</span>' +
        '<input class="input pin-input js-purge-inp" type="password" inputmode="numeric" maxlength="6" ' +
        'autocomplete="off" placeholder="••••••"></label>' +
      '<p class="t-3 t-sm js-purge-hint"></p>' +
    '</div>');

    var dlg = SD.comp.dialog.open({
      title: '清空数据（需专用密码）',
      width: 460,
      danger: true,
      okText: '验证并清空',
      body: body,
      onOk: function (modal) {
        var v = (modal.querySelector('.js-purge-inp').value || '').trim();
        if (!/^\d{6}$/.test(v)) return '请输入 6 位数字的专用密码';
        if (!SD.auth.verifyPurge(v)) return '专用密码不正确：已阻止清空，数据没有任何改动';
        SD.store.reset();
        U.toast(isBlank ? '已清空全部数据（空白初始状态）' : '已清空并恢复为示例数据', 'ok');
        if (typeof opts.onDone === 'function') opts.onDone();
        else load();
      }
    });
    if (dlg && dlg.el) dlg.el.setAttribute('data-auth', '1');

    var hint = body.querySelector('.js-purge-hint');
    if (hint) {
      hint.innerHTML = SD.auth.hasPurgePin()
        ? '这是专用的破坏性操作密码，与登录密码分开保存（本机加盐摘要）。'
        : '还没改过专用密码：默认 <b>' + SD.auth.DEFAULT_PURGE_PIN +
          '</b>，建议到「设置 → 密码设置」里改掉。';
    }
    var inp = body.querySelector('.js-purge-inp');
    setTimeout(function () { try { inp.focus(); } catch (e) {} }, 60);
    return dlg;
  }

  /* ---------------- 空闲自动退回受限（默认 30 分钟无操作） ---------------- */
  var IDLE = { last: 0, timer: null };
  function idleLockMs() {
    var m = SD.CONFIG && SD.CONFIG.security ? SD.CONFIG.security.idleLockMin : 30;
    m = Number(m);
    return (isFinite(m) && m > 0) ? m * 60000 : 0;   // 0 / 负数 = 关闭自动锁定
  }
  /** 有任何操作就把「最后活动时间」刷新（只记录时间戳，开销可忽略） */
  function noteActivity() { IDLE.last = Date.now(); }
  /**
   * 检查是否已经闲置超时 → 自动退回受限模式。
   * 只在「安全员」状态下生效（受限本来就没权限，不用再锁）。
   * @returns {boolean} 是否刚刚因超时被锁
   */
  function checkIdle() {
    var ms = idleLockMs();
    if (!ms) return false;
    if (SD.auth.current() !== 'safety_officer') { IDLE.last = Date.now(); return false; }
    if (!IDLE.last) { IDLE.last = Date.now(); return false; }
    if (Date.now() - IDLE.last < ms) return false;
    SD.auth.lock();
    syncRoleUI();
    refreshAll();
    U.toast('已连续 ' + Math.round(ms / 60000) + ' 分钟无操作，自动退回受限模式；继续改数据请重新输入密码', 'err');
    return true;
  }
  function startIdleWatch() {
    noteActivity();
    var EVS = ['mousedown', 'pointerdown', 'touchstart', 'keydown', 'wheel', 'scroll'];
    EVS.forEach(function (ev) {
      try { document.addEventListener(ev, noteActivity, { passive: true, capture: true }); }
      catch (e) { document.addEventListener(ev, noteActivity, true); }
    });
    // 切回页面时立刻补一次判定（后台标签页的定时器会被浏览器节流）
    document.addEventListener('visibilitychange', function () { if (!document.hidden) checkIdle(); });
    if (IDLE.timer) clearInterval(IDLE.timer);
    IDLE.timer = setInterval(checkIdle, 15000);   // 每 15s 查一次
  }

  /* ---------------- 设置齿轮菜单 ---------------- */
  function closeGear() {
    if (!els.gearMenu || !els.gearBtn) return;
    els.gearMenu.hidden = true;
    els.gearBtn.setAttribute('aria-expanded', 'false');
  }

  function toggleGear(open) {
    if (!els.gearMenu || !els.gearBtn) return;
    var willOpen = (open == null) ? !!els.gearMenu.hidden : !!open;
    els.gearMenu.hidden = !willOpen;
    els.gearBtn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
  }

  /* ---------------- 受限模式：拦下所有写操作 ---------------- */
  var WRITE_SEL = '.btn.primary, .btn.danger, [data-act="edit"], [data-act="del"], [data-write], .sl-ev-add, .sl-ev-del';
  function installWriteGuard() {
    document.addEventListener('click', function (e) {
      if (SD.auth.can('data.write')) return;
      var t = e.target;
      if (!t || !t.closest) return;
      var hit = t.closest(WRITE_SEL);
      if (!hit) return;
      if (hit.closest('[data-auth]')) return;      // 密码 / 外观弹窗自身不受限
      if (hit.closest('.gear-menu')) return;       // 菜单项由各自处理
      e.preventDefault();
      e.stopPropagation();
      U.toast('受限模式：该操作需要安全员权限。点右上角「受限模式」输入六位密码解锁。', 'err');
    }, true);
  }

  function syncRolePill() {
    if (!els.rolePill) return;
    var isOfficer = SD.auth.current() === 'safety_officer';
    els.rolePill.setAttribute('data-role', isOfficer ? 'safety_officer' : 'restricted');
    if (els.rolePillTxt) els.rolePillTxt.textContent = isOfficer ? '安全员' : '受限模式';
    if (els.rolePillIco) els.rolePillIco.innerHTML = iconHtml(isOfficer ? 'check' : 'lock', 13);
    els.rolePill.title = isOfficer
      ? '当前：安全员（全权）。点一下退回受限模式'
      : '当前：受限用户（只能查看 / 打印 / 导出）。点一下输入六位密码进入安全员权限';
  }

  /* ---------------- 侧栏常用功能快捷入口（位于左侧导航下方） ----------------
     只放真实可用的功能，不做「待接入」占位按钮。 */
  function renderSidebarQuick() {
    var box = document.querySelector('.js-sidebar-quick');
    if (!box) return;
    U.clear(box);
    var QUICKS = [
      { icon: 'plus',       text: '登记隐患',   onClick: function () { SD.app.go('hazard', { openDialog: 1 }); } },
      { icon: 'todo',       text: '待办任务',   onClick: function () { SD.app.go('todo'); } },
      { icon: 'inspection', text: '巡检打卡',   onClick: function () { SD.app.go('inspection'); } },
      { icon: 'training',   text: '安全培训',   onClick: function () { SD.app.go('training'); } },
      { icon: 'trendUp',    text: '数据看板',   onClick: function () { SD.app.go('dashboard'); } },
      { icon: 'download',   text: '导出台账',   onClick: function () { SD.app.exportData(); } }
    ];
    QUICKS.forEach(function (q) { box.appendChild(SD.comp.listItem.quick(q)); });
  }

  /* ---------------- 顶部工具栏 ---------------- */
  function syncRoleUI() {
    if (els.roleSel) els.roleSel.value = SD.auth.current();
    syncRolePill();
  }

  /** 刷新顶栏日期区与侧栏数据来源标识（单机版固定「本机数据」） */
  function syncStatusUI() {
    if (els.srcLabel) els.srcLabel.textContent = '本机数据';
    if (els.srcDot) els.srcDot.className = 'dot local';
    syncRoleUI();
    if (els.todayChip && state.summary) {
      var s = state.summary;
      els.todayChip.textContent = s.today + ' ' + U.weekdayCN(s.today) + ' · 本周 ' + s.weekStart.slice(5) + '~' + s.weekEnd.slice(5);
    }
  }

  function bindToolbar() {
    // 齿轮菜单里的图标（内联 SVG，统一注入，HTML 里只写 data-ico）
    Array.prototype.forEach.call(document.querySelectorAll('.gear-item[data-ico]'), function (b) {
      var box = b.querySelector('.gi-ico');
      if (!box) {
        box = document.createElement('span');
        box.className = 'gi-ico';
        b.insertBefore(box, b.firstChild);
      }
      box.innerHTML = iconHtml(b.getAttribute('data-ico'), 15);
    });

    els.btnExport.addEventListener('click', function () { closeGear(); exportData(); });

    // 设置齿轮：导入 / 导出 / 清空数据 / 角色 / 密码设置
    if (els.gearBtn) {
      els.gearBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        syncRoleUI();
        toggleGear();
      });
    }
    if (els.gearMenu) els.gearMenu.addEventListener('click', function (e) { e.stopPropagation(); });
    document.addEventListener('click', function () { closeGear(); });

    if (els.rolePill) {
      els.rolePill.addEventListener('click', function () {
        if (SD.auth.can('data.write')) {
          SD.comp.dialog.confirm({
            title: '退回受限模式',
            message: '退回后只能查看 / 打印 / 导出，改数据要重新输密码。',
            okText: '退回受限',
            onOk: function () { SD.auth.lock(); syncRoleUI(); refreshAll(); U.toast('已退回受限模式'); }
          });
        } else {
          openPinDialog();
        }
      });
    }

    if (els.brandText) els.brandText.addEventListener('click', openSettings);
    var brandMarkEl = document.querySelector('.brand-mark');
    if (brandMarkEl) {
      brandMarkEl.style.cursor = 'pointer';
      brandMarkEl.addEventListener('click', openSettings);
    }

    if (els.btnSettings) els.btnSettings.addEventListener('click', function () { closeGear(); openSettings(); });
    if (els.btnPwd) els.btnPwd.addEventListener('click', function () { closeGear(); openPwdDialog(); });

    els.btnImport.addEventListener('click', function () {
      closeGear();
      if (!SD.auth.can('settings.write')) {
        openPinDialog({ title: '导入需要安全员权限', onOk: function () { els.fileInput.click(); } });
        return;
      }
      els.fileInput.click();
    });
    els.fileInput.addEventListener('change', function () {
      var f = els.fileInput.files && els.fileInput.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        var r = SD.store.importJSON(String(reader.result));
        if (!r.ok) { U.toast(r.msg, 'err'); return; }
        U.toast(r.msg, 'ok');
        state.filters = {
          todoKind: 'all',
          hazard: { status: 'all', severity: 'all', type: 'all', dept: 'all', q: '' },
          insp: { range: 'week' },
          cert: { level: 'all' }
        };
        load();
      };
      reader.onerror = function () { U.toast('文件读取失败', 'err'); };
      reader.readAsText(f, 'utf-8');
      els.fileInput.value = '';   // 允许连续导入同一个文件
    });

    els.btnReset.addEventListener('click', function () {
      closeGear();
      if (!SD.auth.can('settings.write')) {
        openPinDialog({ title: '清空数据需要安全员权限' });
        return;
      }
      /* ★ 2026-10-25：清空是**不可撤销**的操作 → 必须再输入「清空数据专用密码」。
         密码不对就停在弹窗里给红字提示，数据一点不动（不再只是点一下「确认清空」）。 */
      openPurgeDialog();
    });

    // 角色切换：控制「特种作业」模块的访问权限
    if (els.roleSel) {
      els.roleSel.addEventListener('change', function () {
        var want = els.roleSel.value;
        if (want === 'safety_officer' && !SD.auth.can('data.write')) {
          els.roleSel.value = 'restricted';
          openPinDialog({ title: '切换为安全员需输入密码' });
          return;
        }
        SD.auth.set(want);
        U.toast('已切换角色：' + SD.auth.roleInfo().name);
        refreshAll();   // 重绘导航（锁/解锁）与内容（权限门禁）
      });
    }
  }

  /* ---------------- 启动 ---------------- */
  function init() {
    els = {
      primary: document.getElementById('navPrimary'),
      secondary: document.getElementById('navSecondary'),
      tabbar: document.getElementById('tabbar'),
      title: document.getElementById('viewTitle'),
      sub: document.getElementById('viewSub'),
      view: document.getElementById('view'),
      srcLabel: document.getElementById('srcLabel'),
      srcDot: document.getElementById('srcDot'),
      btnExport: document.getElementById('btnExport'),
      btnImport: document.getElementById('btnImport'),
      btnReset: document.getElementById('btnReset'),
      btnSettings: document.getElementById('btnSettings'),
      fileInput: document.getElementById('fileInput'),
      roleSel: document.getElementById('roleSel'),
      appName: document.getElementById('appName'),
      appSub: document.getElementById('appSub'),
      brandText: document.getElementById('brandText'),
      todayChip: document.getElementById('todayChip'),
      appMark: document.querySelector('.brand-mark'),
      gearBtn: document.getElementById('btnGear'),
      gearMenu: document.getElementById('gearMenu'),
      rolePill: document.getElementById('rolePill'),
      rolePillTxt: document.getElementById('rolePillTxt'),
      rolePillIco: document.getElementById('rolePillIco'),
      btnPwd: document.getElementById('btnPwd')
    };

    // 1) 读本机快照 + 同步配置（阈值）
    SD.store.load();
    SD.store.syncConfig();
    applyBrand();     // 把自定义的图标 / 名称 / 副标题渲染到左上角

    // 2) 工具栏
    bindToolbar();
    syncStatusUI();

    // 3) 路由初始化（会触发一次 refreshAll，此时是骨架屏）
    SD.router.init(function () { refreshAll(); });

    // 3.5) 左侧导航下方的「常用功能」快捷入口
    renderSidebarQuick();

    // 3.6) 受限模式的写操作门禁 + 右上角角色徽标
    installWriteGuard();
    syncRolePill();

    // 3.7) 空闲看门狗：连续 30 分钟（config.security.idleLockMin）无操作 → 自动退回受限
    startIdleWatch();

    // 4) 取数（先等照片仓库就绪：localStorage 里的大图是 vault 引用，要水合回内存）
    if (SD.store && SD.store.init) SD.store.init().then(load, load);
    else load();
  }

  return {
    init: init,
    state: state,
    refreshAll: refreshAll,
    reload: reload,
    go: go,
    completeTodo: completeTodo,
    exportData: exportData,
    openPurgeDialog: openPurgeDialog,
    /** 空闲自动锁定（默认 30 分钟）：自检与外部可手动触发 check / 刷新时间戳 */
    idle: {
      check: checkIdle,
      touch: noteActivity,
      ms: idleLockMs,
      start: startIdleWatch
    }
  };
})();

/* DOM 就绪后启动（脚本在 body 末尾，通常已就绪，这里做双保险） */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function () { SD.app.init(); });
} else {
  SD.app.init();
}
