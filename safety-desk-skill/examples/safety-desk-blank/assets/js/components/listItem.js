/* =========================================================
   listItem.js — 待办条目渲染（概览页与待办页共用同一份）
   抽成组件的原因：概览「今日要处理」与待办页列表必须长一致，
   否则用户从概览点进待办会觉得"东西变了"。
   ========================================================= */
window.SD = window.SD || {};
SD.comp = SD.comp || {};

SD.comp.listItem = (function () {
  var U = SD.utils;
  var B = function () { return SD.comp.badge; };   // 延迟取，避免加载顺序问题

  /** 各类型一键动作的悬停文案（待办区四类单据，2026-10-24 起） */
  var ACT_TITLE = {
    'hazard-overdue': '推进到下一状态', 'hazard-due': '推进到下一状态',
    'hazard-verify': '复核通过，推进到下一状态', 'hazard-open': '推进到下一状态',
    'inspection': '标记完成', 'permit': '按状态机推进下一步', 'training': '标记完成'
  };
  /** 非隐患类的类型标签（图标 + 文案） */
  var KIND_TAG = {
    inspection: ['巡检', 'inspection'],
    permit:     ['作业票', 'clipboard'],
    training:   ['培训', 'book']
  };

  /**
   * @param {object} item  metrics.buildTodos 产出的条目
   * @param {object} opts  { showDone:true, onDone(item) }
   * @returns {HTMLElement}
   */
  function todo(item, opts) {
    opts = opts || {};
    var badge = B();
    var isOverdue = item.kind === 'hazard-overdue';

    var meta = '';
    // 隐患类显示等级 + 状态；巡检 / 作业票 / 培训显示类型标签 + 各自状态
    if (KIND_TAG[item.kind]) {
      var kt = KIND_TAG[item.kind];
      meta += badge.tag(kt[0], kt[1]) + ' ';
      if (item.statusName) {
        meta += '<span class="badge ' + (item.statusCls || 'b-mute') + '">' + U.esc(item.statusName) + '</span> ';
      }
    } else {
      meta += badge.severity(item.severity) + ' ';
      meta += badge.status(item.ref.status) + ' ';
    }
    if (isOverdue) meta += badge.overdue(item.ref._overdueDays || 0) + ' ';
    else if (item.kind === 'hazard-due') meta += badge.soon(0) + ' ';
    else if (item.kind === 'hazard-verify') meta += badge.tag('待复核', 'target') + ' ';
    if (item.ref._delayedTrack) meta += badge.delayed(item.ref.delayCount) + ' ';

    meta += badge.tag(item.code, 'file') + ' ';
    if (item.dept) meta += badge.tag(item.dept, 'building');
    if (item.owner) meta += ' ' + badge.tag(item.owner, 'user');
    if (item.dueDate) meta += ' ' + badge.tag('期限 ' + item.dueDate, 'calendar');

    var actTitle = ACT_TITLE[item.kind] || '标记完成';
    /* ★ 2026-11-10：受限模式（未解锁安全员）**不能推进任务状态**。
       这里把按钮渲染成 disabled —— 比「点了弹一句没权限」清楚，
       用户一眼看出这条只能看不能动；同时 app.js 的写操作守卫也加了 .todo-check 兜底，
       防止别处直接构造出可点的按钮。
       opts.canAct 默认 true，只有明确传 false 才锁。 */
    var canAct = opts.canAct !== false;
    var lockTitle = '受限模式：推进任务状态需要安全员权限（点右上角「受限模式」输入六位密码解锁）';
    var el = U.h(
      '<div class="todo-item ' + (item.severity || 'general') + (isOverdue ? ' overdue' : '') + '">' +
        (opts.showDone !== false
          ? (canAct
              ? '<button class="todo-check" title="' + U.esc(actTitle) + '" aria-label="' + U.esc(actTitle) + '">' + SD.icons.get('check', 15) + '</button>'
              : '<button class="todo-check is-locked" title="' + U.esc(lockTitle) + '" aria-label="' + U.esc(lockTitle) + '"' +
                ' aria-disabled="true" disabled>' + SD.icons.get('lock', 13) + '</button>')
          : '<span class="todo-check" style="border-style:dashed;cursor:default"></span>') +
        '<div class="body">' +
          '<div class="title">' + U.esc(item.title) + '</div>' +
          '<div class="meta">' + meta + '</div>' +
          '<div class="why">' + U.esc(item.why || '') + '</div>' +
        '</div>' +
      '</div>'
    );

    if (canAct && opts.showDone !== false && typeof opts.onDone === 'function') {
      var btn = el.querySelector('.todo-check');
      btn.addEventListener('click', function (e) { e.stopPropagation(); opts.onDone(item); });
    }
    return el;
  }

  /**
   * 通知条目
   * @param {object} n     通知对象
   * @param {object} opts  { onEdit(n), onDelete(n), onOpen(n) }
   *   传了 onOpen 且这条公告**带附件**时，标题变成可点按钮 —— 点开看文档；
   *   没有附件的标题保持纯文本：不做「点了什么也没有」的假按钮。
   */
  function notice(n, opts) {
    opts = opts || {};
    var badge = B();
    var docs = Array.isArray(n.docs) ? n.docs : [];
    var canOpen = docs.length > 0 && typeof opts.onOpen === 'function';

    var el = U.h(
      '<div class="notice-item' + (n.pinned ? ' pinned' : '') + '">' +
        '<div class="nh">' + badge.noticeLevel(n.level) +
          (n.pinned ? ' <span class="tag">' + SD.icons.get('alertCircle', 12) + '置顶</span>' : '') +
          (canOpen
            ? '<button type="button" class="nt nt-link" title="点击查看文档">' + U.esc(n.title) + '</button>' +
              badge.tag(docs.length + ' 个附件', 'file')
            : '<span class="nt">' + U.esc(n.title) + '</span>') +
        '</div>' +
        '<div class="ns">' + U.esc(n.summary || '') + '</div>' +
        '<div class="nf">' + U.esc(n.source || '') + ' · ' + U.esc(n.publishAt || '') + ' · ' + U.esc(n.code || '') + '</div>' +
      '</div>'
    );

    if (canOpen) {
      el.querySelector('.nt-link').addEventListener('click', function (e) {
        e.stopPropagation();
        opts.onOpen(n);
      });
    }

    if (opts.onEdit || opts.onDelete) {
      // 与其它模块一致：操作收成一个「操作 ▾」下拉
      var ops = U.h('<div class="nops"></div>');
      var btn = U.h(SD.comp.dropdown.opsButton('nops', n.id || n.code || ''));
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var items = [];
        if (opts.onEdit) items.push({ act: 'edit', text: '编辑' });
        if (opts.onDelete) items.push({ act: 'del', text: '删除', danger: true });
        SD.comp.dropdown.open({
          anchor: btn,
          items: items,
          onPick: function (it) {
            if (it.act === 'edit' && opts.onEdit) opts.onEdit(n);
            else if (it.act === 'del' && opts.onDelete) opts.onDelete(n);
          }
        });
      });
      ops.appendChild(btn);
      el.appendChild(ops);
    }
    return el;
  }

  /** 常用功能快捷入口 */
  function quick(cfg) {
    var el = U.h(
      '<button class="quick"' + (cfg.title ? ' title="' + U.esc(cfg.title) + '"' : '') + '>' +
        '<span class="qi">' + SD.icons.get(cfg.icon || 'external', 18) + '</span>' +
        '<span class="qt">' + U.esc(cfg.text) + '</span>' +
      '</button>'
    );
    if (typeof cfg.onClick === 'function') el.addEventListener('click', cfg.onClick);
    else el.addEventListener('click', function () { SD.utils.toast('该入口待接入：' + cfg.text); });
    return el;
  }

  return { todo: todo, notice: notice, quick: quick };
})();
