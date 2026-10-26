/* =========================================================
   views/inspection.js — 安全巡检与执行记录（模块 4）
   ────────────────────────────────────────────────────────
   · 本周完成率（口径：已完成 / 本周计划数，排除已取消；改期不减免）
   · 巡检列表 + 执行记录入口（已完成的可查看现场记录与签字）
   · 状态在「新增 / 编辑」表单里直接选（待执行/已完成/已改期/已取消），
     也保留行内「标记完成」（填执行记录）与「改期」（必填原因）两个 richer 入口
   · 搜索（名称/编号/区域/执行人）+ 表头排序 + 筛选；空 / 加载中 / 失败三态齐全
   ========================================================= */
window.SD = window.SD || {};
SD.views = SD.views || {};

SD.views.inspection = (function () {
  var U = SD.utils;
  var B = function () { return SD.comp.badge; };

  var CHIPS = [
    { v: 'week',       n: '本周' },
    { v: 'all',        n: '全部' },
    { v: 'planned',    n: '待执行' },
    { v: 'done',       n: '已完成' },
    { v: 'rescheduled', n: '已改期' },
    { v: 'cancelled',  n: '已取消' }
  ];

  function sub(s) {
    if (!s) return '';
    var w = s.inspectionWeek;
    return '本周 ' + w.weekStart + ' 至 ' + w.weekEnd + ' · 计划 ' + w.total + ' 项，已完成 ' + w.done + ' 项' +
           (w.rescheduled ? '，改期 ' + w.rescheduled + ' 项仍计缺口' : '');
  }

  /* ---------------- 字段定义（新增 / 编辑共用） ----------------
     与 data/schema.md 的 inspection 一节一一对应，改字段只改这里。 */
  var FIELDS = [
    SD.code.field('inspection'),          /* 巡检编号：必填，手动填写 */
    { name: 'planName', label: '计划名称', type: 'text', required: true, placeholder: '例：装配车间日常巡检' },
    { name: 'type', label: '巡检类型', type: 'select', required: true, options: function () { return SD.dict.DICT.inspectType; }, def: '日常巡检' },
    { name: 'area', label: '巡检区域', type: 'text', required: true, placeholder: '例：A 区装配线' },
    { name: 'dept', label: '责任部门', type: 'text', placeholder: '例：生产一部' },
    { name: 'executor', label: '执行人', type: 'text', required: true, placeholder: '例：王安全' },
    { name: 'scheduledDate', label: '计划日期', type: 'date', required: true, def: function () { return SD.utils.today(); } },
    /* 状态：编辑表单内直接可选（2026-10-24 起从行内操作挪进表单），
       完成时若没有执行记录会自动补一条默认记录（现场情况可随后补填） */
    { name: 'status', label: '状态', type: 'select', required: true, options: function () { return SD.dict.DICT.inspectStatus; }, def: 'planned' },
    { name: 'remark', label: '备注', type: 'textarea', full: true, rows: 2, placeholder: '可写巡检重点、携带工具等' },
    /* 巡查照片：登记 / 编辑时上传，列表里点「区域」即可看大图（与隐患标题同一套交互） */
    {
      name: 'photos', label: '巡查照片', type: 'photos', full: true, max: 6,
      help: '最多 6 张，自动压到 1000px；存进巡检记录，列表里点「区域」即可查看'
    }
  ];

  /** options 支持传函数（打开弹窗时才求值，保证读到最新数据）；
      编号字段在编辑时带上 selfId，唯一性校验好排除自己 */
  function resolveFields(t) {
    return FIELDS.map(function (f) {
      if (typeof f.options === 'function') f = Object.assign({}, f, { options: f.options() });
      if (f.type === 'code') f = Object.assign({}, f, { selfId: t ? t.id : null });
      return f;
    });
  }

  /* ---------------- 新增 / 编辑巡检任务 ---------------- */
  function openForm(ctx, t) {
    var isEdit = !!t;
    SD.comp.formDialog.open({
      title: isEdit ? '编辑巡检任务' : '新增巡检任务',
      width: 620,
      fields: resolveFields(t),
      values: t || {},
      hint: isEdit ? '' : '新增后自动计入本周完成率分母',
      okText: isEdit ? '保存' : '新增',
      onSubmit: function (v) {
        var status = v.status || 'planned';
        var payload = {
          code: v.code,
          planName: v.planName, type: v.type, area: v.area,
          dept: v.dept || '', executor: v.executor,
          scheduledDate: v.scheduledDate, remark: v.remark || '',
          status: status,
          photos: v.photos || []
        };
        /* 状态联动字段理齐，避免展示自相矛盾：
           · 已完成：补完成时间；没有执行记录就落一条默认记录（现场情况可再补）
           · 离开「已完成」：清掉完成时间与执行记录
           · 离开「已改期」：清掉改期目标与原因（改期信息只对已改期状态有意义） */
        if (status === 'done') {
          payload.completedAt = (isEdit && t.completedAt) || SD.utils.today();
          if (!(isEdit && t.record)) {
            payload.record = {
              findings: '现场正常，无异常项', hazardCount: (isEdit && t.hazardCount) || 0,
              signedBy: payload.executor, signedAt: payload.completedAt
            };
          }
        } else {
          payload.completedAt = null;
          payload.record = null;
          if (status !== 'rescheduled') { payload.rescheduleTo = null; payload.reason = ''; }
        }
        var req = isEdit
          ? SD.api.updateInspection(t.id, payload)
          : SD.api.createInspection(Object.assign({ hazardCount: 0, completedAt: null, rescheduleTo: null, reason: '' }, payload));
        return req.then(function () {
          U.toast(isEdit ? '巡检任务已更新' : '巡检任务已新增', 'ok');
          ctx.reload();
        });
      }
    });
  }

  /* ---------------- 删除巡检任务 ---------------- */
  function remove(ctx, t) {
    SD.comp.dialog.confirm({
      title: '删除巡检任务',
      message: '将删除「' + t.planName + '」（' + t.code + '）。已完成的巡检删除后，其执行记录一并消失，且无法恢复。',
      okText: '确认删除', danger: true,
      onOk: function () {
        return SD.api.removeInspection(t.id).then(function () {
          U.toast('已删除', 'ok');
          ctx.reload();
        });
      }
    });
  }

  /* ---------------- 完成巡检 ---------------- */
  function openComplete(ctx, t) {
    var body =
      '<p class="t-2 t-sm" style="margin-bottom:12px">' + U.esc(t.planName) + ' · ' + U.esc(t.area) +
      ' · 计划 ' + U.esc(t.scheduledDate) + '</p>' +
      '<div class="grid-form">' +
        '<label class="field full"><span>现场情况 / 发现</span>' +
          '<textarea class="input" id="i_findings" rows="3" placeholder="例：消防通道畅通，灭火器材完好；发现 1 处通道被占用，已登记隐患">现场正常，无异常项</textarea></label>' +
        '<label class="field"><span>发现隐患数</span><input class="input" type="number" id="i_hz" min="0" value="0"></label>' +
        '<label class="field"><span>现场签字人</span><input class="input" id="i_by" value="' + U.esc(t.executor || '') + '"></label>' +
      '</div>';

    SD.comp.dialog.open({
      title: '标记完成 · 填写执行记录', width: 560, body: body, okText: '完成并保存记录',
      onOk: function (modal) {
        var g = function (id) { var e = modal.querySelector('#' + id); return e ? e.value.trim() : ''; };
        var n = parseInt(g('i_hz'), 10);
        if (isNaN(n) || n < 0) return '发现隐患数请填非负整数';
        return SD.api.completeInspection(t.id, {
          findings: g('i_findings') || '现场正常，无异常项',
          hazardCount: n,
          signedBy: g('i_by')
        }).then(function () {
          U.toast('巡检已完成，记录已保存', 'ok');
          ctx.reload();
        });
      }
    });
  }

  /* ---------------- 改期 ---------------- */
  function openReschedule(ctx, t) {
    var body =
      '<p class="t-2 t-sm" style="margin-bottom:12px">' + U.esc(t.planName) + ' · 原计划 ' + U.esc(t.scheduledDate) + '</p>' +
      '<div class="grid-form">' +
        '<label class="field"><span class="req">改期到</span><input class="input" type="date" id="i_to" value="' +
          U.shift(t.scheduledDate, 7) + '"></label>' +
        '<label class="field full"><span class="req">改期原因</span>' +
          '<textarea class="input" id="i_reason" rows="2" placeholder="例：维保单位未到场"></textarea></label>' +
      '</div>' +
      '<p class="t-3 t-sm">改期不减免：该任务仍留在本周分母内，未完成即算缺口。</p>';

    SD.comp.dialog.open({
      title: '巡检改期', width: 520, body: body, okText: '确认改期',
      onOk: function (modal) {
        var g = function (id) { var e = modal.querySelector('#' + id); return e ? e.value.trim() : ''; };
        if (!g('i_to')) return '请选择改期后的日期';
        if (!g('i_reason')) return '请填写改期原因';
        return SD.api.rescheduleInspection(t.id, g('i_to'), g('i_reason')).then(function () {
          U.toast('已改期', 'ok');
          ctx.reload();
        });
      }
    });
  }

  /* ---------------- 查看执行记录 ---------------- */
  function openRecord(t) {
    var r = t.record || {};
    var body =
      '<div class="grid-form">' +
        '<label class="field full"><span>计划名称</span><div class="b">' + U.esc(t.planName) + '</div></label>' +
        '<label class="field"><span>巡检类型</span><div>' + U.esc(t.type) + '</div></label>' +
        '<label class="field"><span>区域</span><div>' + U.esc(t.area) + '</div></label>' +
        '<label class="field"><span>执行人</span><div>' + U.esc(t.executor) + '</div></label>' +
        '<label class="field"><span>完成日期</span><div>' + U.esc(t.completedAt || '—') + '</div></label>' +
        '<label class="field full"><span>现场情况 / 发现</span><div>' + U.esc(r.findings || '—') + '</div></label>' +
        '<label class="field"><span>发现隐患数</span><div>' + (t.hazardCount || 0) + ' 条</div></label>' +
        '<label class="field"><span>现场签字</span><div>' + U.esc(r.signedBy || '—') + '　' + U.esc(r.signedAt || '') + '</div></label>' +
        '<label class="field full"><span>巡查照片</span><div>' +
          (t.photos && t.photos.length
            ? '<button type="button" class="btn sm js-insp-ph" data-id="' + t.id + '">查看 ' + t.photos.length + ' 张照片</button>'
            : '<span class="t-3">—（登记 / 编辑巡检时可添加）</span>') +
        '</div></label>' +
      '</div>';
    var recDlg = SD.comp.dialog.open({ title: '执行记录', width: 560, body: body, okText: '关闭' });
    /* 弹窗内点「查看照片」→ 同样开大图 */
    U.on(recDlg.el, 'click', '.js-insp-ph', function (e, el) {
      var cur = SD.app.state.summary.inspections.filter(function (x) { return x.id === el.dataset.id; })[0] || t;
      var ph = cur.photos || [];
      if (ph.length) SD.comp.lightbox.open(ph, 0, { title: cur.code + ' ' + cur.area });
    });
  }

  /* ---------------- 过滤 + 排序 ----------------
     范围筛选（本周/全部/按状态）→ 关键词搜索 → 排序（默认计划日期升序，点表头切换） */
  var STATUS_RANK = { planned: 0, rescheduled: 1, done: 2, cancelled: 3 };

  function applyFilter(s, f, sort) {
    var list = s.inspections.slice();

    if (f.range === 'week') {
      var w = s.inspectionWeek;
      list = list.filter(function (t) { return t.scheduledDate >= w.weekStart && t.scheduledDate <= w.weekEnd; });
    } else if (f.range !== 'all') {
      list = list.filter(function (t) { return t.status === f.range; });
    }
    if (f.q) {
      var q = String(f.q).toLowerCase();
      list = list.filter(function (t) {
        return (t.planName + ' ' + t.code + ' ' + t.area + ' ' + t.dept + ' ' + t.executor + ' ' + t.type)
          .toLowerCase().indexOf(q) >= 0;
      });
    }

    var key = (sort && sort.key) || 'scheduledDate';
    var dir = (sort && sort.dir) || 'asc';
    list = U.sortBy(list, function (a, b) {
      var va, vb;
      if (key === 'status') { va = STATUS_RANK[a.status]; vb = STATUS_RANK[b.status]; }
      else { va = a[key]; vb = b[key]; }
      if (va == null) va = ''; if (vb == null) vb = '';
      if (va < vb) return -1; if (va > vb) return 1; return 0;
    });
    if (dir === 'desc') list = list.slice().reverse();
    return list;
  }

  /* ---------------- 主渲染 ---------------- */
  function render(host, ctx) {
    var s = ctx.summary;
    var f = (ctx.state.filters.insp = ctx.state.filters.insp || {});
    if (!f.range) f.range = 'week';
    if (f.q == null) f.q = '';
    var sort = (ctx.state.sort.insp = ctx.state.sort.insp || { key: 'scheduledDate', dir: 'asc' });

    U.clear(host);

    /* ---------- 本周完成率 ---------- */
    var w = s.inspectionWeek;
    var rateBox = U.h('<div class="grid cols-4"></div>');
    SD.comp.statCard.renderAll(rateBox, [
      {
        label: '本周完成率',
        value: w.rate == null ? '—' : U.pct(w.rate, 1, 0),
        unit: w.rate == null ? '' : '%',
        icon: 'inspection', tone: 'green',
        bar: { pct: w.rate == null ? 0 : w.rate, cls: (w.rate != null && w.rate < 0.6) ? 'orange' : 'green' },
        foot: w.done + ' / ' + w.total + ' 项',
        hint: '已完成 / 本周计划（排除已取消）'
      },
      { label: '本周计划', value: w.total, unit: '项', icon: 'calendar', tone: 'blue', foot: '含改期未完成的缺口' },
      { label: '改期', value: w.rescheduled, unit: '项', icon: 'clock', tone: 'orange', foot: '改期不减免，仍算缺口' },
      { label: '取消', value: w.cancelled, unit: '项', icon: 'x', tone: '', foot: '不计入分母' }
    ]);
    host.appendChild(rateBox);

    /* ---------- 筛选 ---------- */
    var bar = U.h('<div class="filters"><div class="chip-group"></div><div class="spacer"></div></div>');
    var cg = bar.querySelector('.chip-group');
    CHIPS.forEach(function (c) {
      var chip = U.h('<button class="chip' + (f.range === c.v ? ' on' : '') + '">' + U.esc(c.n) + '</button>');
      chip.addEventListener('click', function () {
        f.range = c.v;
        Array.prototype.forEach.call(cg.children, function (el, i) { el.classList.toggle('on', CHIPS[i].v === c.v); });
        redraw();
      });
      cg.appendChild(chip);
    });
    var spacer = bar.querySelector('.spacer');
    spacer.appendChild(U.h('<span class="t-3 t-sm">本周起算：周一</span>'));

    // 搜索（名称 / 编号 / 区域 / 执行人 / 类型）
    var q = U.h('<input class="input" placeholder="搜名称 / 编号 / 区域 / 执行人" style="width:200px" data-keep-focus="insp">');
    q.value = f.q || '';
    q.addEventListener('input', U.debounce(function () { f.q = q.value; redraw(); }, 250));
    bar.appendChild(q);

    var addBtn = U.h('<button class="btn primary">' + SD.icons.get('plus', 15) + '新增巡检</button>');
    addBtn.addEventListener('click', function () { openForm(ctx, null); });
    bar.appendChild(addBtn);

    host.appendChild(bar);

    /* ---------- 列表容器 ----------
       搜索 / 排序 / 筛选只重绘这里，不重建上面的筛选条。
       原因：全量 ctx.refresh() 会把搜索框一起销毁重建，中文输入法的组合过程会被打断、
       快速打字时字符会被重建时的旧值覆盖 —— 用户看到的就是「打不出连续的字」。 */
    var listBox = U.h('<div class="js-list-box"></div>');
    host.appendChild(listBox);

    function redraw() {
    U.clear(listBox);
    var list = applyFilter(s, f, sort);

    var noData = !s.inspections.length;
    if (!list.length) {
      listBox.appendChild(SD.comp.state.build('empty', {
        title: noData ? '还没有安全巡检任务' : '没有符合条件的巡检任务',
        desc: noData ? '新增第一条巡检后，这里会按计划日期排序并计入本周完成率。' : (f.q ? '没有匹配「' + f.q + '」的巡检，换个关键词或清空搜索。' : '换个筛选条件看看。'),
        action: noData ? { text: '新增第一条巡检', onClick: function () { openForm(ctx, null); } } : null
      }));
      return;
    }

    var columns = [
      { key: 'code', title: '编号', sortable: true, render: function (r) { return '<span class="t-sm num">' + U.esc(r.code) + '</span>'; } },
      {
        key: 'planName', title: '计划名称', sortable: true,
        render: function (r) {
          return '<div class="cell-main">' + U.esc(r.planName) + '</div>';
        }
      },
      { key: 'type', title: '类型', sortable: true, render: function (r) { return B().tag(r.type); } },
      /* 区域：与「类型」一样单独一列；有照片时区域名可点，点开看巡查照片大图 */
      {
        key: 'area', title: '区域',
        render: function (r) {
          var n = (r.photos || []).length;
          return '<div class="cell-main js-insp-area' + (n ? ' link' : '') + '" data-id="' + r.id + '" ' +
              'title="' + (n ? '点击查看巡查照片（' + n + ' 张）' : '这条巡检还没有照片') + '">' +
            U.esc(r.area || '—') +
            (n ? '<span class="hz-photo-tag">照片 ' + n + '</span>' : '') +
          '</div>';
        }
      },
      { key: 'dept', title: '部门', sortable: true, render: function (r) { return U.esc(r.dept || '—'); } },
      { key: 'executor', title: '执行人', sortable: true, render: function (r) { return U.esc(r.executor || '—'); } },
      {
        key: 'scheduledDate', title: '计划日期', sortable: true,
        render: function (r) {
          var isToday = r.scheduledDate === s.today;
          return '<span class="num">' + U.esc(r.scheduledDate) + '</span>' +
            (isToday ? ' <span class="badge b-info sm">今天</span>' : '') +
            (r.rescheduleTo ? '<div class="cell-sub">改期至 ' + U.esc(r.rescheduleTo) + '</div>' : '') +
            (r.reason ? '<div class="cell-sub">' + U.esc(r.reason) + '</div>' : '');
        }
      },
      { key: 'status', title: '状态', sortable: true, render: function (r) { return B().inspectStatus(r.status); } },
      {
        key: '_ops', title: '操作', align: 'right',
        /* 操作收成下拉（与隐患 / 作业票一致）：一行最多 4 个按钮会把表格撑爆 */
        render: function (r) {
          return '<div class="cell-actions">' + SD.comp.dropdown.opsButton('iops', r.id) + '</div>';
        }
      }
    ];

    var table = SD.comp.table.build({
      columns: columns, rows: list, minWidth: 1000,
      sort: { key: sort.key, dir: sort.dir },
      onSort: function (key, dir) { sort.key = key; sort.dir = dir; redraw(); },
      rowClass: function (r) {
        if (r.status === 'planned' && r.scheduledDate < s.today) return 'row-danger';
        if (r.status === 'rescheduled') return 'row-warn';
        return '';
      }
    });
    listBox.appendChild(table);

    /* ---------- 行内「操作 ▾」下拉菜单 ---------- */
    U.on(table, 'click', '[data-act="iops"]', function (e, el) {
      var id = el.dataset.id;
      var t = s.inspections.filter(function (x) { return x.id === id; })[0];
      if (!t) return;

      var items = [];
      if (t.status === 'planned' || t.status === 'rescheduled') {
        items.push({ act: 'done', text: '标记完成', primary: true });
        items.push({ act: 'resch', text: '改期' });
      } else if (t.status === 'done') {
        items.push({ act: 'rec', text: '执行记录' });
      }
      items.push({ act: 'edit', text: '编辑' });
      items.push({ act: 'del', text: '删除', danger: true });

      SD.comp.dropdown.open({
        anchor: el,
        items: items,
        onPick: function (it) {
          // 用最新数据，避免菜单停留期间数据被改过
          var cur = SD.app.state.summary.inspections.filter(function (x) { return x.id === id; })[0] || t;
          if (it.act === 'done') openComplete(ctx, cur);
          else if (it.act === 'resch') openReschedule(ctx, cur);
          else if (it.act === 'rec') openRecord(cur);
          else if (it.act === 'edit') openForm(ctx, cur);
          else if (it.act === 'del') remove(ctx, cur);
        }
      });
    });

    /* ---------- 点「区域」看巡查照片 ----------
       照片在新增 / 编辑表单里上传（≤6 张），与隐患标题、培训名称、作业票作业类型
       同一套交互；无照片时点名没反应（title 已说明）。 */
    U.on(table, 'click', '.js-insp-area', function (e, el) {
      var cur = SD.app.state.summary.inspections.filter(function (x) { return x.id === el.dataset.id; })[0];
      if (!cur) return;
      var ph = cur.photos || [];
      if (!ph.length) { U.toast('这条巡检还没有照片，新增 / 编辑巡检时可添加'); return; }
      SD.comp.lightbox.open(ph, 0, { title: cur.code + ' ' + cur.area });
    });

    }

    redraw();

    /* ---------- 口径说明 ---------- */
    host.appendChild(U.h(
      '<section class="card tight t-3 t-sm"><b class="t-2">口径说明</b>　' +
      '本周 = 周一至周日。完成率分母 = 本周计划任务数（已取消的不计入）；' +
      '已改期任务仍留在分母内且不算完成，因此改期不会让完成率变好看 —— 这是刻意的，避免改期成为规避手段。' +
      '状态也可在「编辑」表单里直接改（选已完成会自动补一条默认执行记录，现场情况可再补填）；' +
      '列表支持关键词搜索与点表头排序。</section>'
    ));
  }

  return { name: '安全巡检', sub: sub, render: render };
})();
