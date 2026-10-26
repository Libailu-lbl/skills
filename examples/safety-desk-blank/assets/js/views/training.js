/* =========================================================
   views/training.js — 安全培训计划（模块 5）
   ────────────────────────────────────────────────────────
   · 培训计划：未开始 / 进行中 / 已完成，含应到-实到完成率
   · 2026-10-20：新增「培训照片」（表单上传 ≤6 张），点「培训名称」看大图
   · 2026-10-19 按用户要求：本模块只保留「培训」相关内容，
     原「人员证书台账 + 三档到期预警」整块移除（证书类资质预警
     现由「特种作业人员」模块的复审到期预警承担）。
     数据层的 certificates / certSummary 未删，仅本视图不再展示。
   ========================================================= */
window.SD = window.SD || {};
SD.views = SD.views || {};

SD.views.training = (function () {
  var U = SD.utils;
  var B = function () { return SD.comp.badge; };

  /* 状态筛选：全部 / 未开始 / 进行中 / 已完成 */
  var CHIPS = [
    { v: 'all',     n: '全部' },
    { v: 'planned', n: '未开始' },
    { v: 'ongoing', n: '进行中' },
    { v: 'done',    n: '已完成' }
  ];

  function sub(s) {
    if (!s) return '';
    var c = count(s);
    return '共 ' + s.trainings.length + ' 条 · 进行中 ' + c.ongoing + ' · 未开始 ' + c.planned + ' · 已完成 ' + c.done;
  }

  function count(s) {
    var c = { planned: 0, ongoing: 0, done: 0 };
    (s.trainings || []).forEach(function (t) { if (c[t.status] != null) c[t.status]++; });
    return c;
  }

  /* ---------------- 字段定义（新增 / 编辑共用） ----------------
     与 data/schema.md 的 training 一节一一对应。 */
  var TRAIN_FIELDS = [
    SD.code.field('training'),            /* 培训编号：必填，手动填写 */
    { name: 'name', label: '培训名称', type: 'text', required: true, full: true, placeholder: '例：新员工三级安全教育' },
    { name: 'type', label: '培训类型', type: 'select', required: true, options: function () { return SD.dict.DICT.trainType; } },
    { name: 'status', label: '状态', type: 'select', options: function () { return SD.dict.DICT.trainStatus; }, def: 'planned' },
    { name: 'target', label: '培训对象', type: 'text', required: true, placeholder: '例：2026 年新入职员工' },
    { name: 'trainer', label: '讲师 / 组织方', type: 'text' },
    { name: 'startDate', label: '开始日期', type: 'date', required: true, def: function () { return SD.utils.today(); } },
    { name: 'endDate', label: '结束日期', type: 'date', required: true, def: function () { return SD.utils.shift(SD.utils.today(), 1); } },
    { name: 'required', label: '应到人数', type: 'number', min: 0, def: 0 },
    { name: 'actual', label: '实到人数', type: 'number', min: 0, def: 0 },
    {
      name: 'photos', label: '培训照片', type: 'photos', full: true, max: 6,
      help: '培训现场 / 签到 / 考核照片，最多 6 张；台账里点「培训名称」即可看大图'
    }
  ];

  /** options 允许是函数：打开弹窗时才求值，保证读到最新字典；
      编号字段在编辑时带上 selfId（唯一性校验排除自己） */
  function resolve(fields, t) {
    return fields.map(function (f) {
      var g = (typeof f.options === 'function') ? Object.assign({}, f, { options: f.options() }) : f;
      if (g.type === 'code') g = Object.assign({}, g, { selfId: t ? t.id : null });
      return g;
    });
  }

  /* ---------------- 培训：新增 / 编辑 / 删除 ---------------- */
  function openTrainForm(ctx, t) {
    var isEdit = !!t;
    SD.comp.formDialog.open({
      title: isEdit ? '编辑培训计划' : '新增培训计划',
      width: 620,
      fields: resolve(TRAIN_FIELDS, t),
      values: t || {},
      validate: function (v) {
        if (v.endDate && v.startDate && v.endDate < v.startDate) return '结束日期不能早于开始日期';
        if (v.actual != null && v.required != null && v.actual > v.required) return '实到人数不能大于应到人数';
        return null;
      },
      onSubmit: function (v) {
        var payload = {
          code: v.code,
          name: v.name, type: v.type, status: v.status || 'planned',
          target: v.target, trainer: v.trainer || '',
          startDate: v.startDate, endDate: v.endDate,
          required: v.required == null ? 0 : v.required,
          actual: v.actual == null ? 0 : v.actual,
          photos: v.photos || []
        };
        return (isEdit ? SD.api.updateTraining(t.id, payload) : SD.api.createTraining(payload))
          .then(function () { U.toast(isEdit ? '培训计划已更新' : '培训计划已新增', 'ok'); ctx.reload(); });
      }
    });
  }

  function removeTrain(ctx, t) {
    SD.comp.dialog.confirm({
      title: '删除培训计划',
      message: '将删除「' + t.name + '」（' + t.code + '）。',
      okText: '确认删除', danger: true,
      onOk: function () {
        return SD.api.removeTraining(t.id).then(function () { U.toast('已删除', 'ok'); ctx.reload(); });
      }
    });
  }

  /* ---------------- 主渲染 ---------------- */
  function render(host, ctx) {
    var s = ctx.summary;
    var f = (ctx.state.filters.training = ctx.state.filters.training || {});
    if (!f.status) f.status = 'all';
    if (f.q == null) f.q = '';
    var sort = (ctx.state.sort.training = ctx.state.sort.training || { key: 'startDate', dir: 'asc' });

    U.clear(host);

    /* ---------- 培训指标 ---------- */
    var c = count(s);
    var attended = 0, should = 0;
    s.trainings.forEach(function (t) { attended += (t.actual || 0); should += (t.required || 0); });
    var rate = should ? Math.round((attended / should) * 100) : 0;

    var box = U.h('<div class="grid cols-4"></div>');
    SD.comp.statCard.renderAll(box, [
      {
        label: '培训计划', value: s.trainings.length, unit: '条', icon: 'book', tone: 'blue',
        foot: '覆盖三级教育 / 专项 / 应急演练', hint: '全部计划',
        onClick: function () { f.status = 'all'; ctx.refresh(); }
      },
      {
        label: '未开始', value: c.planned, unit: '条', icon: 'calendar', tone: '',
        foot: c.planned ? '待排期与通知' : '暂无待开班的计划', hint: 'status = 未开始',
        onClick: function () { f.status = 'planned'; ctx.refresh(); }
      },
      {
        label: '进行中', value: c.ongoing, unit: '条', icon: 'trendUp', tone: 'orange',
        foot: c.ongoing ? '关注签到与课时完成' : '当前没有在训班次', hint: 'status = 进行中',
        onClick: function () { f.status = 'ongoing'; ctx.refresh(); }
      },
      {
        label: '已完成', value: c.done, unit: '条', icon: 'check', tone: 'green',
        foot: '应到 ' + should + ' 人 · 实到 ' + attended + ' 人（参与率 ' + rate + '%）',
        hint: '参与率 = 实到 / 应到',
        onClick: function () { f.status = 'done'; ctx.refresh(); }
      }
    ]);
    host.appendChild(box);

    /* ---------- 筛选 + 搜索 + 新增 ---------- */
    var bar = U.h('<div class="filters"><div class="chip-group"></div><div class="spacer"></div></div>');
    var cg = bar.querySelector('.chip-group');
    CHIPS.forEach(function (k) {
      var n = k.v === 'all' ? s.trainings.length : (c[k.v] || 0);
      var chip = U.h('<button class="chip' + (f.status === k.v ? ' on' : '') + '">' + U.esc(k.n) + ' ' + n + '</button>');
      chip.addEventListener('click', function () {
        f.status = k.v;
        Array.prototype.forEach.call(cg.children, function (el, i) { el.classList.toggle('on', CHIPS[i].v === k.v); });
        redraw();
      });
      cg.appendChild(chip);
    });
    var spacer = bar.querySelector('.spacer');
    // 搜索（名称 / 编号 / 对象 / 讲师 / 类型）
    var q = U.h('<input class="input" placeholder="搜名称 / 编号 / 对象 / 讲师" style="width:200px" data-keep-focus="training">');
    q.value = f.q || '';
    q.addEventListener('input', U.debounce(function () { f.q = q.value; redraw(); }, 250));
    spacer.appendChild(q);
    var addBtn = U.h('<button class="btn sm primary">' + SD.icons.get('plus', 14) + '新增培训</button>');
    addBtn.addEventListener('click', function () { openTrainForm(ctx, null); });
    spacer.appendChild(addBtn);
    host.appendChild(bar);

    /* ---------- 培训表 ----------
       列表容器（card）只建一次；搜索 / 排序 / 筛选只重绘 body，不重建筛选条 ——
       否则输入框会被销毁重建，连续打字与输入法都会被打断。 */
    var card = U.h('<section class="card"><div class="card-head">' +
      '<div><h3>安全培训计划</h3><div class="sub js-tr-sub"></div></div>' +
      '<div class="js-tr-head"></div></div>' +
      '<div class="js-tr-body"></div></section>');
    var body = card.querySelector('.js-tr-body');
    var subEl = card.querySelector('.js-tr-sub');
    var headAdd = U.h('<button class="btn sm primary">' + SD.icons.get('plus', 14) + '新增培训</button>');
    headAdd.addEventListener('click', function () { openTrainForm(ctx, null); });
    card.querySelector('.js-tr-head').appendChild(headAdd);
    host.appendChild(card);

    function redraw() {
    U.clear(body);
    var list = s.trainings.filter(function (x) { return f.status === 'all' || x.status === f.status; });
    if (f.q) {
      var kw = String(f.q).toLowerCase();
      list = list.filter(function (x) {
        return (x.name + ' ' + x.code + ' ' + x.target + ' ' + x.trainer + ' ' + x.type).toLowerCase().indexOf(kw) >= 0;
      });
    }
    var key = (sort && sort.key) || 'startDate';
    var dir = (sort && sort.dir) || 'asc';
    list = U.sortBy(list, function (a, b) {
      var va = a[key], vb = b[key];
      if (va == null) va = ''; if (vb == null) vb = '';
      if (va < vb) return -1; if (va > vb) return 1; return 0;
    });
    if (dir === 'desc') list = list.slice().reverse();

    subEl.textContent = list.length + ' 条' + (f.status === 'all' ? '' : '（已筛选）');

    if (!list.length) {
      body.appendChild(SD.comp.state.build('empty', {
        title: s.trainings.length ? '这一类没有培训计划' : '暂无培训计划',
        desc: s.trainings.length
          ? (f.q ? '没有匹配「' + f.q + '」的培训，换个关键词或清空搜索。' : '换个筛选条件看看。')
          : '新增第一条培训计划后，这里会显示类型、对象与应到/实到完成情况。',
        action: s.trainings.length ? null : { text: '新增培训计划', onClick: function () { openTrainForm(ctx, null); } }
      }));
    } else {
      body.appendChild(SD.comp.table.build({
        columns: [
          {
            key: 'name', title: '培训名称', sortable: true,
            render: function (r) {
              // 有照片时标题变主色 + 挂「照片 N」角标，点标题开大图（照片在新增 / 编辑表单里上传）
              var n = (r.photos || []).length;
              return '<div class="cell-main js-tr-title' + (n ? ' link' : '') + '" data-id="' + r.id + '" ' +
                  'title="' + (n ? '点击查看培训照片（' + n + ' 张）' : '这条培训还没有照片') + '">' +
                U.esc(r.name) +
                (n ? '<span class="hz-photo-tag">照片 ' + n + '</span>' : '') +
              '</div><div class="cell-sub">' + U.esc(r.code) + '</div>';
            }
          },
          { key: 'type', title: '类型', sortable: true, render: function (r) { return B().tag(r.type); } },
          { key: 'target', title: '培训对象', sortable: true, render: function (r) { return U.esc(r.target); } },
          { key: 'trainer', title: '讲师 / 组织方', sortable: true, render: function (r) { return U.esc(r.trainer); } },
          {
            key: 'startDate', title: '时间', sortable: true, sortKey: 'startDate',
            render: function (r) { return '<span class="num">' + U.esc(r.startDate) + '</span>' + (r.endDate && r.endDate !== r.startDate ? ' ~ ' + U.esc(r.endDate) : ''); }
          },
          { key: 'status', title: '状态', sortable: true, render: function (r) { return B().trainStatus(r.status); } },
          {
            key: '_rate', title: '参与情况', align: 'right',
            render: function (r) {
              return '<span class="num">' + (r.actual || 0) + ' / ' + (r.required || 0) + ' 人</span>' +
                '<div class="stat-bar" style="margin-top:5px;height:4px"><i style="width:' +
                (r.required ? Math.min(100, (r.actual / r.required) * 100) : 0) + '%"></i></div>';
            }
          },
          {
            key: '_ops', title: '操作', align: 'right',
            render: function (r) {
              return '<div class="cell-actions">' + SD.comp.dropdown.opsButton('tops', r.id) + '</div>';
            }
          }
        ],
        rows: list, minWidth: 900,
        sort: { key: sort.key, dir: sort.dir },
        onSort: function (k, d) { sort.key = k; sort.dir = d; redraw(); }
      }));
      /* 行内「操作 ▾」下拉 */
      U.on(body, 'click', '[data-act="tops"]', function (e, el) {
        var id = el.dataset.id;
        var t = s.trainings.filter(function (x) { return x.id === id; })[0];
        if (!t) return;
        SD.comp.dropdown.open({
          anchor: el,
          items: [
            { act: 'download', text: '下载照片' + ((t.photos || []).length ? '（' + (t.photos || []).length + ' 张）' : '') },
            { act: 'edit', text: '编辑' },
            { act: 'del', text: '删除', danger: true }
          ],
          onPick: function (it) {
            var cur = SD.app.state.summary.trainings.filter(function (x) { return x.id === id; })[0] || t;
            if (it.act === 'edit') openTrainForm(ctx, cur);
            else if (it.act === 'del') removeTrain(ctx, cur);
            else if (it.act === 'download') {
              /* 下载原始照片：先开「水印编辑 + 预览」弹窗，确认后再下载
                 水印两行 = 手机型号·地点 / 日期 时间，固定左下角 */
              if (!(cur.photos || []).length) {
                U.toast('这条培训还没有照片，新增 / 编辑培训时可添加', 'err');
                return;
              }
              SD.comp.photoWatermark.open(cur.photos, {
                code: cur.code, title: cur.name, date: cur.startDate || ''
              });
            }
          }
        });
      });

      /* 点培训名称 → 看培训照片大图（与隐患标题、作业票作业类型同一套交互）
         数据取最新 summary，防别处改过拿到旧对象 */
      U.on(body, 'click', '.js-tr-title', function (e, el) {
        var t = SD.app.state.summary.trainings.filter(function (x) { return x.id === el.dataset.id; })[0];
        if (!t) return;
        var ph = t.photos || [];
        if (!ph.length) { U.toast('这条培训还没有照片，新增 / 编辑培训时可添加'); return; }
        SD.comp.lightbox.open(ph, 0, { title: t.code + ' ' + t.name });
      });
    }
    }

    redraw();

    /* ---------- 口径说明 ---------- */
    host.appendChild(U.h(
      '<section class="card tight t-3 t-sm"><b class="t-2">口径说明</b>　' +
      '状态：未开始 → 进行中 → 已完成；参与率 = 实到人数 ÷ 应到人数（按全部已完成班次合计）。' +
      '培训照片在「新增 / 编辑」弹窗底部上传（最多 6 张），台账里点「培训名称」看大图。' +
      '人员持证到期的预警不再放在本模块，改由「特种作业人员」按复审日期预警。' +
      '列表支持关键词搜索与点表头排序；未完成的培训也会进入「待办任务」，可一键标记完成。</section>'
    ));
  }

  return { name: '安全培训', sub: sub, render: render };
})();
