/* =========================================================
   views/notice.js — 通知公告 + 常用功能快捷入口（模块 7）
   ────────────────────────────────────────────────────────
   · 通知公告：置顶优先，其余按发布时间倒序；紧急/重要/普通三档
   · 常用功能快捷入口：高频动作直达（未接入的给明确提示，不做假按钮）
   ========================================================= */
window.SD = window.SD || {};
SD.views = SD.views || {};

SD.views.notice = (function () {
  var U = SD.utils;

  function sub(s) {
    if (!s) return '';
    var pinned = s.notices.filter(function (n) { return n.pinned; }).length;
    return '共 ' + s.notices.length + ' 条' + (pinned ? ' · 置顶 ' + pinned + ' 条' : '');
  }

  /* ---------------- 字段定义（新增 / 编辑共用） ----------------
     与 data/schema.md 的 notice 一节一一对应。 */
  var FIELDS = [
    SD.code.field('notice'),              /* 通知编号：必填，手动填写 */
    { name: 'title', label: '标题', type: 'text', required: true, full: true, placeholder: '例：关于开展四季度消防安全专项检查的通知' },
    { name: 'level', label: '级别', type: 'select', options: function () { return SD.mock.DICT.noticeLevel; }, def: 'normal' },
    { name: 'source', label: '发布单位', type: 'text', required: true, placeholder: '例：安环部' },
    { name: 'publishAt', label: '发布日期', type: 'date', required: true, def: function () { return SD.utils.today(); } },
    { name: 'summary', label: '摘要正文', type: 'textarea', full: true, rows: 4, placeholder: '通知要点，列表页展示这段' },
    { name: 'pinned', label: '置顶', type: 'switch', switchText: '置顶显示（优先于其它公告）', def: false }
  ];

  function resolve(n) {
    return FIELDS.map(function (f) {
      var g = (typeof f.options === 'function') ? Object.assign({}, f, { options: f.options() }) : f;
      if (g.type === 'code') g = Object.assign({}, g, { selfId: n ? n.id : null });
      return g;
    });
  }

  /* ---------------- 过滤 + 排序 ----------------
     搜索（标题 / 摘要 / 单位 / 编号）→ 排序：默认「智能」（置顶优先 + 发布时间倒序），
     也可按发布时间 / 级别 / 标题 / 编号排 */
  var LEVEL_RANK = { urgent: 0, important: 1, normal: 2 };
  var SORTS = [
    { v: 'smart',     n: '智能排序（置顶优先）' },
    { v: 'publishAt', n: '按发布日期' },
    { v: 'level',     n: '按级别（紧急在前）' },
    { v: 'title',     n: '按标题' },
    { v: 'code',      n: '按编号' }
  ];

  function applyFilter(s, f, sort) {
    var list = s.notices.slice();
    if (f.q) {
      var q = String(f.q).toLowerCase();
      list = list.filter(function (n) {
        return (n.title + ' ' + n.summary + ' ' + n.source + ' ' + n.code).toLowerCase().indexOf(q) >= 0;
      });
    }
    var key = (sort && sort.key) || 'smart';
    var dir = (sort && sort.dir) || 'desc';
    if (key === 'smart') {
      // 智能排序固定「置顶优先 + 时间倒序」，不随 dir 翻转
      return U.sortBy(list, function (a, b) {
        if (!!b.pinned !== !!a.pinned) return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
        return String(b.publishAt).localeCompare(String(a.publishAt));
      });
    }
    list = U.sortBy(list, function (a, b) {
      var va, vb;
      if (key === 'level') { va = LEVEL_RANK[a.level]; vb = LEVEL_RANK[b.level]; }
      else { va = a[key]; vb = b[key]; }
      if (va == null) va = ''; if (vb == null) vb = '';
      if (va < vb) return -1; if (va > vb) return 1; return 0;
    });
    if (dir === 'asc') list = list.slice().reverse();   // 列表型默认倒序（最新在前）
    return list;
  }

  /* ---------------- 发布 / 编辑 / 删除公告 ---------------- */
  function openForm(ctx, n) {
    var isEdit = !!n;
    SD.comp.formDialog.open({
      title: isEdit ? '编辑公告' : '发布通知',
      width: 620,
      fields: resolve(n),
      values: n || {},
      onSubmit: function (v) {
        var payload = {
          code: v.code,
          title: v.title, level: v.level || 'normal', source: v.source,
          publishAt: v.publishAt, summary: v.summary || '', pinned: !!v.pinned
        };
        return (isEdit ? SD.api.updateNotice(n.id, payload) : SD.api.createNotice(payload))
          .then(function () { U.toast(isEdit ? '公告已更新' : '公告已发布', 'ok'); ctx.reload(); });
      }
    });
  }

  function remove(ctx, n) {
    SD.comp.dialog.confirm({
      title: '删除公告',
      message: '将删除「' + n.title + '」（' + n.code + '）。',
      okText: '确认删除', danger: true,
      onOk: function () {
        return SD.api.removeNotice(n.id).then(function () { U.toast('已删除', 'ok'); ctx.reload(); });
      }
    });
  }

  function render(host, ctx) {
    var s = ctx.summary;
    U.clear(host);

    var f = (ctx.state.filters.notice = ctx.state.filters.notice || {});
    if (f.q == null) f.q = '';
    var sort = (ctx.state.sort.notice = ctx.state.sort.notice || { key: 'smart', dir: 'desc' });

    /* ---------- 通知公告 ---------- */
    var card = U.h(
      '<section class="card"><div class="card-head">' +
      '<div><h3>通知公告</h3><div class="sub">置顶优先，其余按发布时间倒序</div></div>' +
      '<div class="js-head"></div></div>' +
      '<div class="notice-list js-list"></div></section>'
    );
    var listBox = card.querySelector('.js-list');

    /* 头部工具：搜索 + 排序 + 发布 */
    var head = card.querySelector('.js-head');
    var q = U.h('<input class="input" placeholder="搜标题 / 摘要 / 单位" style="width:190px" data-keep-focus="notice">');
    q.value = f.q || '';
    q.addEventListener('input', U.debounce(function () { f.q = q.value; redraw(); }, 250));
    head.appendChild(q);
    var sortSel = U.h('<select class="ctl-select" style="width:auto"></select>');
    sortSel.innerHTML = SORTS.map(function (o) {
      return '<option value="' + o.v + '"' + (sort.key === o.v ? ' selected' : '') + '>' + U.esc(o.n) + '</option>';
    }).join('');
    sortSel.addEventListener('change', function () {
      sort.key = sortSel.value;
      sort.dir = (sortSel.value === 'publishAt' || sortSel.value === 'code') ? 'asc' : 'desc';
      redraw();
    });
    var sortFg = U.h('<div class="fg"><label>排序</label></div>');
    sortFg.appendChild(sortSel);
    head.appendChild(sortFg);
    var addBtn = U.h('<button class="btn sm primary">' + SD.icons.get('plus', 14) + '发布通知</button>');
    addBtn.addEventListener('click', function () { openForm(ctx, null); });
    head.appendChild(addBtn);

    /* 列表容器只建一次：搜索 / 排序只重绘这里，输入框不销毁（连续打字与输入法不受影响） */
    function redraw() {
    U.clear(listBox);
    var list = applyFilter(s, f, sort);

    if (!list.length) {
      listBox.appendChild(SD.comp.state.build('empty', {
        title: s.notices.length ? '没有匹配的通知' : '暂无通知公告',
        desc: s.notices.length
          ? '没有匹配「' + f.q + '」的通知，换个关键词或清空搜索。'
          : '点右上角「发布通知」录入第一条；已录入的通知按置顶优先、其余按发布时间倒序展示。',
        action: s.notices.length ? null : { text: '发布通知', onClick: function () { openForm(ctx, null); } }
      }));
    } else {
      list.forEach(function (n) {
        listBox.appendChild(SD.comp.listItem.notice(n, {
          onEdit: function (x) { openForm(ctx, x); },
          onDelete: function (x) { remove(ctx, x); }
        }));
      });
    }
    }

    redraw();
    host.appendChild(card);

    /* ---------- 说明 ---------- */
    host.appendChild(U.h(
      '<section class="card tight t-3 t-sm"><b class="t-2">说明</b>　' +
      '常用功能快捷入口已移至左侧导航下方；未接入的功能会在点击时给出提示，' +
      '接入方式：在对应按钮里换成真实链接或调用 SD.api 的语义函数即可，页面其余部分不受影响。</section>'
    ));
  }

  return { name: '通知公告', sub: sub, render: render };
})();
