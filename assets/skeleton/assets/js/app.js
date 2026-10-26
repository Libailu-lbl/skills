/* =========================================================
   app.js — 装配层：初始化 / 统一刷新 / 交互 / 密码弹窗 / 空闲锁
   ────────────────────────────────────────────────────────
   ★ 铁律：刷新只有一个入口 refreshAll()：
       算数据 → 渲染导航 → 渲染内容 → 同步角色 UI
     渲染函数之间**不互相调用**，事件处理一律「改数据 → refreshAll()」，
     避免 A→B→A 的递归（日历把当天列表拉崩那种事故）。
   ========================================================= */
window.SD = window.SD || {};

SD.app = (function () {
  var U = SD.utils;
  var state = { showDone: false };
  var els = {};
  var IDLE = { last: 0, timer: null };

  /* ---------------- 1. 计算层（纯函数，只读数据） ---------------- */
  function compute() {
    var t = U.today();
    var soon = SD.CONFIG.thresholds.soonDays;
    var all = SD.store.items();
    var out = { overdue: [], todayDue: [], soon: [], done: [], todo: [] };

    all.forEach(function (it) {
      if (it.status === 'done') { out.done.push(it); return; }
      out.todo.push(it);
      var d = U.diffDays(t, it.due);           // 正数 = 还有几天；负数 = 逾期
      if (d < 0) out.overdue.push(it);
      else if (d === 0) out.todayDue.push(it);
      else if (d <= soon) out.soon.push(it);
    });
    ['overdue', 'todayDue', 'soon'].forEach(function (k) {
      out[k].sort(function (a, b) { return String(a.due) < String(b.due) ? -1 : 1; });
    });
    return out;
  }

  /* ---------------- 2. 渲染层（只写 DOM，不调别的渲染函数） ---------------- */
  function tagOf(it) {
    var d = U.diffDays(U.today(), it.due);
    if (d < 0) return '<span class="tag red">逾期 ' + (-d) + ' 天</span>';
    if (d === 0) return '<span class="tag amber">今天</span>';
    if (d <= SD.CONFIG.thresholds.soonDays) return '<span class="tag">' + d + ' 天后</span>';
    return '<span class="tag">' + U.esc(it.due) + '</span>';
  }

  function itemRow(it, opts) {
    opts = opts || {};
    var canWrite = SD.auth.can('data.write');
    var row = U.h(
      '<div class="todo-item' + (opts.overdue ? ' overdue' : '') + '">' +
        '<div class="title">' + U.esc(it.title) +
          '<div class="meta">截止 ' + U.esc(it.due) + (it.note ? ' · ' + U.esc(it.note) : '') + '</div>' +
        '</div>' +
        tagOf(it) +
        (canWrite
          ? '<button class="btn sm js-done" type="button">' + (it.status === 'done' ? '撤销' : '完成') + '</button>' +
            '<button class="btn sm ghost js-del" type="button">删除</button>'
          : '<span class="hint">受限</span>') +
      '</div>');
    var done = row.querySelector('.js-done');
    if (done) done.addEventListener('click', function () { SD.store.toggle(it.id); refreshAll(); });
    var del = row.querySelector('.js-del');
    if (del) del.addEventListener('click', function () {
      U.dlg.open({
        title: '删除这条事项？', danger: true, okText: '删除',
        body: '<p>删除后无法撤销。' + U.esc(it.title) + '</p>',
        onOk: function () { SD.store.remove(it.id); U.toast('已删除', 'ok'); refreshAll(); }
      });
    });
    return row;
  }

  function renderToday(host, c) {
    var list = c.overdue.concat(c.todayDue, c.soon);
    var card = U.h('<section class="card"><div class="card-head"><h2>今天要处理</h2>' +
      '<span class="count">' + list.length + ' 条（逾期 ' + c.overdue.length + ' / 今天 ' + c.todayDue.length +
      ' / 临期 ' + c.soon.length + '）</span></div><div class="card-body todo-list"></div></section>');
    var box = card.querySelector('.todo-list');
    if (!list.length) box.appendChild(U.h('<div class="empty">今天没有要处理的事，轻松一下 ✅</div>'));
    list.forEach(function (it) { box.appendChild(itemRow(it, { overdue: U.diffDays(U.today(), it.due) < 0 })); });
    host.appendChild(card);
  }

  function renderAll(host, c) {
    var card = U.h('<section class="card"><div class="card-head"><h2>全部事项</h2>' +
      '<span class="count">共 ' + SD.store.items().length + ' 条 · 未完 ' + c.todo.length + ' · 已完成 ' + c.done.length +
      '</span></div><div class="card-body"></div></section>');
    var body = card.querySelector('.card-body');

    if (SD.auth.can('data.write')) {
      var form = U.h('<div class="row" style="margin-bottom:12px">' +
        '<div class="grow"><input class="input grow" id="newTitle" placeholder="要做的事，例如：整理本周检查记录"></div>' +
        '<div><input class="input" id="newDue" type="date"></div>' +
        '<button class="btn primary" id="btnAdd" type="button">添加</button></div>');
      form.querySelector('#newDue').value = U.today();
      form.querySelector('#btnAdd').addEventListener('click', function () {
        var t = form.querySelector('#newTitle');
        if (!String(t.value || '').trim()) { U.toast('先写一句要做的事', 'err'); return; }
        SD.store.add({ title: t.value, due: form.querySelector('#newDue').value || U.today() });
        t.value = ''; U.toast('已添加', 'ok');
        refreshAll();
      });
      body.appendChild(form);
    } else {
      body.appendChild(U.h('<p class="hint">当前是受限模式：可查看 / 导出，修改要点右上角输入密码。</p>'));
    }

    var listBox = U.h('<div class="todo-list"></div>');
    var all = c.todo.concat(state.showDone ? c.done : []);
    if (!all.length) listBox.appendChild(U.h('<div class="empty">还没有事项，先添加一条吧</div>'));
    all.forEach(function (it) { listBox.appendChild(itemRow(it, {})); });
    body.appendChild(listBox);

    if (c.done.length) {
      var t = U.h('<p class="hint" id="toggleDone" style="margin-top:10px;cursor:pointer">' +
        (state.showDone ? '收起已完成' : '展开已完成 ' + c.done.length + ' 条') + '</p>');
      t.addEventListener('click', function () { state.showDone = !state.showDone; refreshAll(); });
      body.appendChild(t);
    }
    host.appendChild(card);
  }

  function renderView() {
    var c = compute();
    var host = els.view;
    U.clear(host);
    if (SD.router.current() === 'today') {
      els.title.textContent = '今日';
      els.sub.textContent = '逾期 + 今天到期 + ' + SD.CONFIG.thresholds.soonDays + ' 天内到期，昨天没做完的自动还在';
      renderToday(host, c);
      renderAll(host, c);
    } else {
      els.title.textContent = '全部事项';
      els.sub.textContent = '按截止日期看全部项目，可展开已完成';
      renderAll(host, c);
    }
    els.todayChip.textContent = U.today();
  }

  function syncRole() {
    var isOfficer = SD.auth.current() === 'safety_officer';
    els.rolePill.setAttribute('data-role', isOfficer ? 'safety_officer' : 'restricted');
    els.rolePillTxt.textContent = isOfficer ? '安全员' : '受限模式';
    els.rolePill.title = isOfficer ? '点一下退回受限模式' : '点一下输入六位密码解锁';
  }

  /** ★ 唯一刷新入口：顺序固定，渲染函数互不调用 */
  function refreshAll() {
    syncRole();
    renderView();
  }

  /* ---------------- 3. 密码弹窗 ---------------- */
  function requireOfficer(onPass, title) {
    if (SD.auth.can('data.write')) { onPass(); return; }
    var body = U.h('<div class="field"><span class="lbl">六位登录密码</span>' +
      '<input class="input js-pin" type="password" inputmode="numeric" maxlength="6" placeholder="••••••"></div>' +
      '<p class="hint">' + (SD.auth.hasPin() ? '忘记密码只能清空站点数据（先导出备份）' : '初始密码 ' + SD.auth.DEFAULT_PIN + '，进去后请改掉') + '</p>');
    U.dlg.open({
      title: title || '进入安全员权限', body: body, okText: '解锁',
      onOk: function (m) {
        var r = SD.auth.unlock(m.querySelector('.js-pin').value);
        if (!r.ok) return r.msg;
        U.toast('已进入安全员权限', 'ok');
        onPass();
      }
    });
  }

  function openPurge() {
    var body = U.h('<p>这会清空本机全部数据，<b>无法撤销</b>。建议先「导出备份」。</p>' +
      '<div class="field"><span class="lbl">清空数据专用密码（6 位）</span>' +
      '<input class="input js-purge" type="password" inputmode="numeric" maxlength="6" placeholder="••••••"></div>' +
      '<p class="hint">' + (SD.auth.hasPurgePin() ? '专用密码与登录密码分开保存' :
        '初始专用密码 <b>' + SD.CONFIG.security.defaultPurgePin + '</b>，建议到「密码设置」里改掉') + '</p>');
    U.dlg.open({
      title: '清空数据（需专用密码）', body: body, okText: '验证并清空', danger: true,
      onOk: function (m) {
        var v = String(m.querySelector('.js-purge').value || '').trim();
        if (!/^\d{6}$/.test(v)) return '请输入 6 位数字的专用密码';
        if (!SD.auth.verifyPurge(v)) return '专用密码不正确：已阻止清空，数据没有任何改动';
        SD.store.reset();
        U.toast('已清空', 'ok');
        refreshAll();
      }
    });
  }

  function openPwd() {
    requireOfficer(function () {
      var body = U.h(
        (SD.auth.hasPin() ? '<div class="field"><span class="lbl">原密码</span><input class="input js-old" type="password" maxlength="6"></div>' : '') +
        '<div class="field"><span class="lbl">新登录密码（6 位）</span><input class="input js-new" type="password" maxlength="6"></div>' +
        '<div class="field"><span class="lbl">再输一次</span><input class="input js-new2" type="password" maxlength="6"></div>' +
        '<hr style="border:0;border-top:1px solid #e5e9f0;margin:4px 0">' +
        '<div class="field"><span class="lbl">清空专用密码（留空 = 不改）</span><input class="input js-purge" type="password" maxlength="6"></div>' +
        '<div class="field"><span class="lbl">再输一次专用密码</span><input class="input js-purge2" type="password" maxlength="6"></div>');
      U.dlg.open({
        title: '密码设置', body: body, okText: '保存',
        onOk: function (m) {
          if (SD.auth.hasPin() && !SD.auth.verifyPin(m.querySelector('.js-old').value)) return '原密码不正确';
          var a = String(m.querySelector('.js-new').value || '').trim();
          var b = String(m.querySelector('.js-new2').value || '').trim();
          if (a !== b) return '两次输入不一致';
          var p1 = String(m.querySelector('.js-purge').value || '').trim();
          var p2 = String(m.querySelector('.js-purge2').value || '').trim();
          if (p1 || p2) {
            if (p1 !== p2) return '两次输入的专用密码不一致';
            if (p1 === a) return '专用密码不能与登录密码相同';
          }
          var r1 = SD.auth.setPin(a); if (!r1.ok) return r1.msg;
          if (p1) { var r2 = SD.auth.setPurgePin(p1); if (!r2.ok) return r2.msg; }
          U.toast('密码已更新', 'ok');
        }
      });
    }, '先解锁再改密码');
  }

  /* ---------------- 4. 空闲锁 ---------------- */
  function idleMs() {
    var m = Number(SD.CONFIG.security.idleLockMin);
    return (isFinite(m) && m > 0) ? m * 60000 : 0;
  }
  function touch() { IDLE.last = Date.now(); }
  function checkIdle() {
    var ms = idleMs();
    if (!ms) return false;
    if (SD.auth.current() !== 'safety_officer') { IDLE.last = Date.now(); return false; }
    if (!IDLE.last) { IDLE.last = Date.now(); return false; }
    if (Date.now() - IDLE.last < ms) return false;
    SD.auth.lock();
    refreshAll();
    U.toast('已连续 ' + Math.round(ms / 60000) + ' 分钟无操作，自动退回受限模式', 'err');
    return true;
  }
  function startIdle() {
    touch();
    ['mousedown', 'pointerdown', 'touchstart', 'keydown', 'wheel', 'scroll'].forEach(function (ev) {
      document.addEventListener(ev, touch, { passive: true, capture: true });
    });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) checkIdle(); });
    if (IDLE.timer) clearInterval(IDLE.timer);
    IDLE.timer = setInterval(checkIdle, 15000);
  }

  /* ---------------- 5. 备份 ---------------- */
  function exportData() {
    var blob = new Blob([SD.store.exportJSON()], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = SD.CONFIG.appName + '-' + U.today() + '.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    U.toast('已导出备份', 'ok');
  }

  /* ---------------- 6. 启动 ---------------- */
  function bindToolbar() {
    els.rolePill.addEventListener('click', function () {
      if (SD.auth.can('data.write')) {
        U.dlg.open({
          title: '退回受限模式', okText: '退回受限',
          body: '<p>退回后只能查看 / 导出，改数据要重新输密码。</p>',
          onOk: function () { SD.auth.lock(); refreshAll(); U.toast('已退回受限'); }
        });
      } else {
        requireOfficer(function () { refreshAll(); });
      }
    });

    els.gearBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      els.gearMenu.hidden = !els.gearMenu.hidden;
      els.gearBtn.setAttribute('aria-expanded', String(!els.gearMenu.hidden));
    });
    document.addEventListener('click', function () { els.gearMenu.hidden = true; });
    els.gearMenu.addEventListener('click', function (e) { e.stopPropagation(); });

    document.getElementById('btnExport').addEventListener('click', function () { els.gearMenu.hidden = true; exportData(); });
    document.getElementById('btnImport').addEventListener('click', function () {
      els.gearMenu.hidden = true;
      requireOfficer(function () { els.fileInput.click(); }, '导入需要安全员权限');
    });
    document.getElementById('btnReset').addEventListener('click', function () {
      els.gearMenu.hidden = true;
      requireOfficer(openPurge, '清空数据需要安全员权限');
    });
    document.getElementById('btnPwd').addEventListener('click', function () { els.gearMenu.hidden = true; openPwd(); });

    els.fileInput.addEventListener('change', function () {
      var f = els.fileInput.files && els.fileInput.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        var r = SD.store.importJSON(reader.result);
        U.toast(r.msg, r.ok ? 'ok' : 'err');
        if (r.ok) refreshAll();
      };
      reader.readAsText(f, 'utf-8');
      els.fileInput.value = '';
    });
  }

  function init() {
    els = {
      view: document.getElementById('view'),
      title: document.getElementById('viewTitle'),
      sub: document.getElementById('viewSub'),
      todayChip: document.getElementById('todayChip'),
      rolePill: document.getElementById('rolePill'),
      rolePillTxt: document.getElementById('rolePillTxt'),
      gearBtn: document.getElementById('btnGear'),
      gearMenu: document.getElementById('gearMenu'),
      fileInput: document.getElementById('fileInput')
    };
    document.getElementById('appName').textContent = SD.CONFIG.appName;
    document.getElementById('appSub').textContent = SD.CONFIG.appSub;
    document.title = SD.CONFIG.appName;

    SD.store.load();
    bindToolbar();
    startIdle();
    SD.router.init(function () { refreshAll(); });   // 内部会触发第一次 refreshAll
  }

  return {
    init: init,
    state: state,
    refreshAll: refreshAll,
    compute: compute,
    exportData: exportData,
    idle: { check: checkIdle, touch: touch, ms: idleMs, start: startIdle }
  };
})();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function () { SD.app.init(); });
} else {
  SD.app.init();
}
