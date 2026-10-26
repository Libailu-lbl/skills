/* =========================================================
   views/todo.js — 待办任务区（模块 2）
   ────────────────────────────────────────────────────────
   · 聚合四类单据的全部未完成项（2026-10-24 起扩容）：
       隐患管理（未闭环）/ 安全巡检（未完成）/ 危险作业票（未完工）/ 安全培训（未完成）
   · 每条可一键处理：隐患按状态机推进、巡检直接完成、
     作业票按状态机推进（批准自动写审批人）、培训标记完成
   · 筛选按类型，搜索按关键词，排序可按优先级 / 期限 / 标题 / 类型
   · 状态：加载中（骨架）/ 空数据 / 加载失败（可重试）三态齐全
   ========================================================= */
window.SD = window.SD || {};
SD.views = SD.views || {};

SD.views.todo = (function () {
  var U = SD.utils;

  /* 筛选：全部 + 四类单据；隐患再细分「逾期」方便盯最急的 */
  var KINDS = [
    { v: 'all',             n: '全部' },
    { v: 'hazard',          n: '隐患' },
    { v: 'hazard-overdue',  n: '逾期整改' },
    { v: 'hazard-due',      n: '今日到期' },
    { v: 'hazard-verify',   n: '待我验收' },
    { v: 'inspection',      n: '巡检任务' },
    { v: 'permit',          n: '作业票' },
    { v: 'training',        n: '培训' }
  ];

  var SORTS = [
    { v: 'priority', n: '综合优先级' },
    { v: 'due',      n: '按截止日期' },
    { v: 'title',    n: '按标题' },
    { v: 'kind',     n: '按类型' }
  ];

  var KIND_RANK = {
    'hazard-overdue': 0, 'hazard-due': 1, 'hazard-verify': 2,
    'inspection': 3, 'permit': 4, 'training': 5, 'hazard-open': 6
  };
  var KIND_NAME = {
    'hazard-overdue': '逾期整改', 'hazard-due': '今日到期', 'hazard-verify': '待我验收',
    'hazard-open': '隐患整改', 'inspection': '巡检任务', 'permit': '作业票', 'training': '培训'
  };
  /* 搜索关键词表：隐患类统一带「隐患」二字，搜「隐患 / 巡检 / 作业票 / 培训」都能按类型筛出来 */
  var KIND_SEARCH = {
    'hazard-overdue': '隐患 逾期整改', 'hazard-due': '隐患 今日到期', 'hazard-verify': '隐患 待我验收',
    'hazard-open': '隐患 整改', 'inspection': '巡检 巡检任务', 'permit': '作业票', 'training': '培训 培训计划'
  };

  function kindCount(s, v) {
    if (v === 'all') return s.todos.length;
    if (v === 'hazard') return s.todos.filter(function (t) { return t.kind.indexOf('hazard') === 0; }).length;
    return s.todos.filter(function (t) { return t.kind === v; }).length;
  }

  function sub(s) {
    if (!s) return '';
    var hz = s.todos.filter(function (t) { return t.kind.indexOf('hazard') === 0; }).length;
    var insp = kindCount(s, 'inspection'), permit = kindCount(s, 'permit'), train = kindCount(s, 'training');
    return '共 ' + s.todos.length + ' 项 · 隐患 ' + hz + ' · 巡检 ' + insp + ' · 作业票 ' + permit + ' · 培训 ' + train +
           '（逾期 ' + s.overdueCount + ' · 待验收 ' + s.verifyCount + '）';
  }

  /** 搜索 + 排序（列表型，不用表格）；kind 取顶层 filters.todoKind */
  function applyView(s, kind, f, sort) {
    var list = s.todos.filter(function (t) {
      if (!kind || kind === 'all') return true;
      if (kind === 'hazard') return t.kind.indexOf('hazard') === 0;
      return t.kind === kind;
    });
    if (f.q) {
      var q = String(f.q).toLowerCase();
      list = list.filter(function (t) {
        // 除了文本字段，也匹配条目类型的中文名（搜「隐患」「巡检」「作业票」「培训」都能筛出来）
        var kindName = KIND_SEARCH[t.kind] || '';
        return (t.title + ' ' + t.code + ' ' + (t.dept || '') + ' ' + (t.owner || '') + ' ' + (t.why || '') + ' ' + kindName)
          .toLowerCase().indexOf(q) >= 0;
      });
    }
    var key = (sort && sort.key) || 'priority';
    var dir = (sort && sort.dir) || 'asc';
    if (key === 'priority') return list;    // 优先级顺序由 metrics 算好，原样返回
    list = list.slice();
    list = U.sortBy(list, function (a, b) {
      var va, vb;
      if (key === 'kind') { va = KIND_RANK[a.kind]; vb = KIND_RANK[b.kind]; }
      else if (key === 'due') { va = a.dueDate || ''; vb = b.dueDate || ''; }
      else { va = a.title || ''; vb = b.title || ''; }
      if (va < vb) return -1; if (va > vb) return 1; return 0;
    });
    if (dir === 'desc') list = list.slice().reverse();
    return list;
  }

  function render(host, ctx) {
    var s = ctx.summary;
    U.clear(host);

    /* ---------- 筛选 + 搜索 + 排序 ---------- */
    var cur = (ctx.state.filters.todoKind) || 'all';
    var f = (ctx.state.filters.todo = ctx.state.filters.todo || {});
    if (f.q == null) f.q = '';
    var sort = (ctx.state.sort.todo = ctx.state.sort.todo || { key: 'priority', dir: 'asc' });

    var bar = U.h('<div class="filters"><div class="chip-group"></div><div class="spacer"></div></div>');
    var cg = bar.querySelector('.chip-group');
    KINDS.forEach(function (k) {
      var n = kindCount(s, k.v);
      var chip = U.h('<button class="chip' + (cur === k.v ? ' on' : '') + '">' + U.esc(k.n) + ' ' + n + '</button>');
      chip.addEventListener('click', function () {
        cur = k.v;                                   // 局部重绘用当前 kind，不再整页刷新
        ctx.state.filters.todoKind = k.v;
        Array.prototype.forEach.call(cg.children, function (el, i) { el.classList.toggle('on', KINDS[i].v === k.v); });
        redraw();
      });
      cg.appendChild(chip);
    });
    var spacer = bar.querySelector('.spacer');
    var q = U.h('<input class="input" placeholder="搜标题 / 编号 / 部门 / 责任人" style="width:200px" data-keep-focus="todo">');
    q.value = f.q || '';
    q.addEventListener('input', U.debounce(function () { f.q = q.value; redraw(); }, 250));
    spacer.appendChild(q);
    var sortSel = U.h('<select class="ctl-select" style="width:auto"></select>');
    sortSel.innerHTML = SORTS.map(function (o) {
      return '<option value="' + o.v + '"' + (sort.key === o.v ? ' selected' : '') + '>' + U.esc(o.n) + '</option>';
    }).join('');
    sortSel.addEventListener('change', function () {
      sort.key = sortSel.value;
      sort.dir = 'asc';
      redraw();
    });
    var sortFg = U.h('<div class="fg"><label>排序</label></div>');
    sortFg.appendChild(sortSel);
    spacer.appendChild(sortFg);
    spacer.appendChild(U.h('<span class="t-3 t-sm">默认：逾期 › 临期 › 待验收 › 巡检 › 作业票 › 培训 › 其它隐患</span>'));
    host.appendChild(bar);

    /* 列表容器只建一次：筛选 / 搜索 / 排序只重绘这里，输入框不销毁
       （否则连续打字被重建打断，中文输入法组合也会丢） */
    var box = U.h('<section class="card"><div class="todo-list"></div></section>');
    var lb = box.querySelector('.todo-list');
    host.appendChild(box);

    function redraw() {
    U.clear(lb);
    var list = applyView(s, cur, f, sort);

    if (!list.length) {
      lb.appendChild(SD.comp.state.build('empty', {
        title: s.todos.length ? '这一类没有待办' : '四类单据都没有未完成项',
        desc: s.todos.length
          ? (f.q ? '没有匹配「' + f.q + '」的待办，换个关键词或清空搜索。' : '换个筛选条件看看。')
          : '隐患整改完、巡检执行完、作业票完工、培训结束后，这里就清了。'
      }));
    } else {
      list.forEach(function (item) {
        lb.appendChild(SD.comp.listItem.todo(item, {
          showDone: true,
          onDone: function (it) { ctx.completeTodo(it); }
        }));
      });
    }
    }

    redraw();

    /* ---------- 口径说明（让看的人知道数字怎么来的） ---------- */
    var note = U.h(
      '<section class="card tight t-3 t-sm"><b class="t-2">口径说明</b>　' +
      '待办 = 四类单据的<b>全部未完成项</b>：隐患（未闭环，已作废的不算）、巡检（待执行 + 已改期）、' +
      '作业票（草稿 / 待审批 / 已批准 / 作业中）、培训（未开始 / 进行中）。' +
      '一键处理规则：隐患按「待整改 → 整改中 → 待验收 → 已闭环」推进；巡检直接标记完成（补默认执行记录，现场情况可回模块里补填）；' +
      '作业票按状态机推进（草稿 → 待审批 → 已批准 → 作业中 → 已完工，批准时自动记录审批人）；培训直接标记完成。' +
      '逾期 = 整改期限 &lt; 今天且未闭环（已批准延期的不再计逾期，单列延期跟进）。' +
      '</section>'
    );
    host.appendChild(note);
  }

  return { name: '待办任务', sub: sub, render: render };
})();
