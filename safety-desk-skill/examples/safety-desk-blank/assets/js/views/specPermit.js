/* =========================================================
   views/specPermit.js — 危险作业票（八大危险作业）（模块 8·b）
   ────────────────────────────────────────────────────────
   · 字段见 data/schema.md 第 8 节（workPermits）
   · 状态机：草稿 → 待审批 → 已批准 → 作业中 → 已完工；任一在办可作废（留痕）
   · 行内「操作 ▾」下拉：按状态给出可用流转 + 编辑 + 作废 + 删除
   · 批准动作自动写入审批人与审批时间（EHS 留痕要求）
   · ★ 2026-10-30 起列表按月展示：默认当月，可切月 / 上下月 / 回到本月；
     归月看 planStart（跨月作业只算开始月），指标卡与状态计数同步限定在该月，
     数据、编号、状态机、报表口径都不变（月份只是视图过滤）
   ========================================================= */
window.SD = window.SD || {};
SD.views = SD.views || {};

SD.views.specPermit = (function () {
  var U = SD.utils;

  /* 状态流转（与 schema.md 一致） */
  var TRANSITIONS = {
    draft:    ['pending'],
    pending:  ['approved', 'void'],
    approved: ['working', 'void'],
    working:  ['done'],
    done:     [],
    void:     []
  };
  var TRANS_NAME = { pending: '提交审批', approved: '批准作业', working: '开工', done: '标记完工', void: '作废' };

  var CHIPS = [
    { v: 'all', n: '全部' }, { v: 'draft', n: '草稿' }, { v: 'pending', n: '待审批' },
    { v: 'approved', n: '已批准' }, { v: 'working', n: '作业中' }, { v: 'done', n: '已完工' }, { v: 'void', n: '已作废' }
  ];

  /* 导航 / 页头用的全量摘要（不随月份视图变化：`sub` 由 router 拿去渲染，
     口径仍是 metrics.permitSummary 的全厂累计，月视图只在页面内过滤） */
  function sub(s) {
    if (!s) return '';
    var w = s.permitSummary;
    return '共 ' + w.total + ' 张 · 待审批 ' + w.pending + ' · 作业中 ' + w.working + ' · 已完工 ' + w.done;
  }

  /* ---------- 月份视图（★ 2026-10-30 起：列表按月展示，默认当月） ----------
     归月口径：取**计划开始日期 planStart** 所在月（跨月作业只算开始月，不重复出现）；
     planStart 缺失的旧数据回退 planEnd，仍没有则归入「当月」，避免记录从月视图里消失。
     月份只是**视图过滤**：数据、状态机、编号、统计口径（metrics）都不动。 */
  function monthOf(dateStr) {
    var m = String(dateStr == null ? '' : dateStr).slice(0, 7);
    var hit = /^(\d{4})-(\d{2})$/.exec(m);
    if (!hit) return '';
    var mo = Number(hit[2]);
    /* 「2019-13」这种脏值也要判无效：<input type="month"> 认不了，列表会莫名空掉 */
    return (mo >= 1 && mo <= 12) ? m : '';
  }

  /** 作业票归哪个月（见上面的口径说明） */
  function monthOfPermit(p, fallback) {
    return monthOf(p && p.planStart) || monthOf(p && p.planEnd) || fallback;
  }

  /** '2026-10' → '2026年10月' */
  function fmtMonth(m) {
    if (!m) return '';
    return m.slice(0, 4) + '年' + Number(m.slice(5, 7)) + '月';
  }

  /** 月份加减（跨年自动处理）：('2026-01', -1) → '2025-12' */
  function shiftMonth(m, delta) {
    var y = Number(m.slice(0, 4));
    var mo = Number(m.slice(5, 7)) + delta;
    y += Math.floor((mo - 1) / 12);
    mo = ((mo - 1) % 12 + 12) % 12 + 1;
    return y + '-' + (mo < 10 ? '0' : '') + mo;
  }

  /** 按状态口径统计一批作业票（与 metrics.permitSummary 同口径，只是范围限定在某月） */
  function tally(list) {
    var w = { total: list.length, draft: 0, pending: 0, approved: 0, working: 0, done: 0, void: 0 };
    list.forEach(function (p) { if (w[p.status] != null) w[p.status]++; });
    return w;
  }

  var FIELDS = [
    /* 作业票编号：前缀按作业类型动态生成（FZ + 类型名首字母），随类型联动。
       例：吊装作业 → FZDZ-0000001；动火作业 → FZDH-0000001。
       前缀规则见 code.js 的「动态前缀」段，首字母表见 pinyin.js。 */
    SD.code.field('permit', {
      dependsOn: 'type',
      help: '前缀按作业类型自动生成：FZ + 类型名称前两个字的拼音首字母（吊装作业 → FZDZ-0000001），' +
            '序号 7 位、各类型分别顺延；可手动修改，同一作业票内不可重复'
    }),
    { name: 'type', label: '作业类型', type: 'select', required: true, options: function () { return SD.dict.DICT.permitType; } },
    { name: 'location', label: '作业地点', type: 'text', required: true, full: true, placeholder: '例：B 区焊接工位' },
    { name: 'dept', label: '申请部门', type: 'text', required: true },
    { name: 'applicant', label: '申请人', type: 'text', required: true },
    { name: 'leader', label: '作业负责人', type: 'text', required: true },
    { name: 'guardian', label: '监护人', type: 'text', required: true },
    {
      name: 'workers', label: '作业人员', type: 'people', full: true, max: 8,
      help: '实际进场干活的人（可多个，回车或点「添加」）；联想名单来自「特种作业人员」台账'
    },
    { name: 'planStart', label: '计划开始', type: 'date', required: true },
    { name: 'planEnd', label: '计划结束', type: 'date', required: true },
    { name: 'risk', label: '风险辨识', type: 'textarea', full: true, rows: 2, placeholder: '例：火灾、灼伤、有毒烟气' },
    { name: 'measures', label: '安全措施', type: 'textarea', full: true, rows: 3, placeholder: '例：清理周边可燃物、配灭火器、设专人监护' },
    {
      name: 'photos', label: '作业现场照片', type: 'photos', full: true, max: 6,
      help: '最多 6 张（作业前安全措施、作业中监护、完工现场）；台账里点「作业类型」可看大图，' +
            '也可在「操作 → 照片（打印/Word）」排成一张 A4 出件'
    },
    { name: 'status', label: '状态', type: 'select', required: true, options: function () { return SD.dict.DICT.permitStatus; }, def: 'draft' }
  ];

  function resolve(p) {
    return FIELDS.map(function (f) {
      var g = (typeof f.options === 'function') ? Object.assign({}, f, { options: f.options() }) : f;
      if (g.type === 'code') g = Object.assign({}, g, { selfId: p ? p.id : null });
      return g;
    });
  }

  function openForm(ctx, p) {
    var isEdit = !!p;
    SD.comp.formDialog.open({
      title: isEdit ? '编辑作业票' : '新增危险作业票',
      width: 660,
      fields: resolve(p),
      values: p || {},
      validate: function (v) {
        if (v.planEnd && v.planStart && v.planEnd < v.planStart) return '计划结束不能早于计划开始';
        return null;
      },
      onSubmit: function (v) {
        var payload = {
          code: v.code,
          type: v.type, location: v.location, dept: v.dept, applicant: v.applicant,
          leader: v.leader, guardian: v.guardian, workers: v.workers || [],
          risk: v.risk || '', measures: v.measures || '',
          planStart: v.planStart, planEnd: v.planEnd, status: v.status || 'draft',
          photos: v.photos || []
        };
        return (isEdit ? SD.api.updateWorkPermit(p.id, payload) : SD.api.createWorkPermit(payload))
          .then(function () {
            U.toast(isEdit ? '已更新作业票' : '已新增作业票', 'ok');
            /* 月视图：新增后若这张票不在当前月，自动切到它的月份 ——
               否则「保存成功却在列表里看不见」，会让人以为没存上。
               编辑不动月份：老票改了计划日期由使用者自己决定看哪个月。 */
            if (!isEdit) {
              var flt = (ctx.state.filters.specPermit = ctx.state.filters.specPermit || {});
              var mk = monthOf(v.planStart) || monthOf(v.planEnd);
              if (mk) flt.month = mk;
            }
            ctx.reload();
          });
      }
    });
  }

  function remove(ctx, p) {
    SD.comp.dialog.confirm({
      title: '删除作业票',
      message: '将删除「' + p.type + '」作业票（' + p.code + '）。',
      okText: '确认删除', danger: true,
      onOk: function () {
        return SD.api.removeWorkPermit(p.id).then(function () { U.toast('已删除', 'ok'); ctx.reload(); });
      }
    });
  }

  /** 状态流转（批准时自动写审批人/时间） */
  function transition(ctx, p, to) {
    var payload = { status: to };
    if (to === 'approved') {
      payload.approvedBy = '王安全';
      payload.approvedAt = ctx.summary.today + ' ' + new Date().toTimeString().slice(0, 5);
    }
    SD.api.updateWorkPermit(p.id, payload)
      .then(function () {
        U.toast(to === 'void' ? '作业票已作废（留痕）' : ('已' + TRANS_NAME[to] + '：' + p.type), 'ok');
        ctx.reload();
      }, function (e) { U.toast('操作失败：' + (e && e.message), 'err'); });
  }

  function render(host, ctx) {
    var s = ctx.summary;
    if (!SD.auth.can('special.view')) return;
    U.clear(host);

    var f = (ctx.state.filters.specPermit = ctx.state.filters.specPermit || {});
    if (!f.status) f.status = 'all';
    if (f.q == null) f.q = '';
    var sort = (ctx.state.sort.specPermit = ctx.state.sort.specPermit || { key: 'status', dir: 'asc' });

    /* ---------- 月份（默认当月；切换只影响视图，不动数据） ---------- */
    var CUR_MONTH = monthOf(SD.utils.today());
    if (!monthOf(f.month)) f.month = CUR_MONTH;
    var monthList = s.workPermits.filter(function (p) { return monthOfPermit(p, CUR_MONTH) === f.month; });
    var w = tally(monthList);

    function goMonth(m) {
      if (!monthOf(m) || m === f.month) return;
      f.month = m;
      ctx.refresh();          // 整页重绘：月份条 / 指标卡 / 状态计数 / 列表都跟着走
    }

    /* ---------- 月份切换条 ---------- */
    var mbar = U.h('<div class="filters month-bar">' +
      '<div class="month-nav">' +
        '<button type="button" class="btn sm ghost js-m-prev" title="上一月" aria-label="上一月">‹</button>' +
        '<input type="month" class="input js-m-input" value="' + U.esc(f.month) + '" aria-label="选择月份">' +
        '<button type="button" class="btn sm ghost js-m-next" title="下一月" aria-label="下一月">›</button>' +
        (f.month === CUR_MONTH ? '' : '<button type="button" class="btn sm ghost js-m-now">回到本月</button>') +
      '</div>' +
      '<div class="spacer"></div>' +
      '<span class="t-3 t-sm">' + U.esc(fmtMonth(f.month)) + ' 共 ' + w.total + ' 张' +
        (s.workPermits.length !== w.total ? ' · 全部 ' + s.workPermits.length + ' 张' : '') + '</span>' +
      '</div>');
    mbar.querySelector('.js-m-prev').addEventListener('click', function () { goMonth(shiftMonth(f.month, -1)); });
    mbar.querySelector('.js-m-next').addEventListener('click', function () { goMonth(shiftMonth(f.month, 1)); });
    var mInput = mbar.querySelector('.js-m-input');
    mInput.addEventListener('change', function () { goMonth(mInput.value); });
    var mNow = mbar.querySelector('.js-m-now');
    if (mNow) mNow.addEventListener('click', function () { goMonth(CUR_MONTH); });
    host.appendChild(mbar);

    /* ---------- 指标卡（范围 = 当前所选月份） ---------- */
    var box = U.h('<div class="grid cols-4"></div>');
    SD.comp.statCard.renderAll(box, [
      { label: '待审批', value: w.pending, unit: '张', icon: 'clock', tone: 'orange',
        onClick: function () { f.status = 'pending'; ctx.refresh(); } },
      { label: '已批准', value: w.approved, unit: '张', icon: 'check', tone: 'green' },
      { label: '作业中', value: w.working, unit: '张', icon: 'zap', tone: 'blue' },
      { label: '已完工', value: w.done, unit: '张', icon: 'check', tone: 'green',
        onClick: function () { f.status = 'done'; ctx.refresh(); } }
    ]);
    host.appendChild(box);

    /* ---------- 筛选 + 搜索 + 新增 ---------- */
    var bar = U.h('<div class="filters"><div class="chip-group"></div><div class="spacer"></div></div>');
    var cg = bar.querySelector('.chip-group');
    CHIPS.forEach(function (k) {
      var n = k.v === 'all' ? w.total : (w[k.v] || 0);
      var chip = U.h('<button class="chip' + (f.status === k.v ? ' on' : '') + '">' + U.esc(k.n) + ' ' + n + '</button>');
      chip.addEventListener('click', function () {
        f.status = k.v;
        Array.prototype.forEach.call(cg.children, function (el, i) { el.classList.toggle('on', CHIPS[i].v === k.v); });
        redraw();
      });
      cg.appendChild(chip);
    });
    var spacer = bar.querySelector('.spacer');
    // 搜索（类型 / 编号 / 地点 / 部门 / 负责人 / 监护人 / 作业人员）
    var q = U.h('<input class="input" placeholder="搜类型 / 编号 / 地点 / 人员" style="width:200px" data-keep-focus="permit">');
    q.value = f.q || '';
    q.addEventListener('input', U.debounce(function () { f.q = q.value; redraw(); }, 250));
    spacer.appendChild(q);
    var addBtn = U.h('<button class="btn sm primary">' + SD.icons.get('plus', 14) + '新增作业票</button>');
    addBtn.addEventListener('click', function () { openForm(ctx, null); });
    spacer.appendChild(addBtn);
    host.appendChild(bar);

    /* ---------- 表格 ---------- */
    /* 列表容器（card）只建一次；搜索 / 排序 / 筛选只重绘 body，不重建筛选条 ——
       否则输入框会被销毁重建，连续打字与输入法都会被打断。 */
    var card = U.h('<section class="card"><div class="card-head">' +
      '<div><h3>危险作业票（八大危险作业）</h3><div class="sub">动火 / 受限空间 / 高处 / 吊装 / 临时用电 / 盲板抽堵 / 动土 / 断路</div></div></div>' +
      '<div class="js-body"></div></section>');
    var body = card.querySelector('.js-body');
    host.appendChild(card);

    function redraw() {
    U.clear(body);
    /* 先限当前月，再叠状态 chips 与搜索 —— 三层过滤，任一为空都给对应空态 */
    var list = monthList.filter(function (x) { return f.status === 'all' || x.status === f.status; });
    if (f.q) {
      var kw = String(f.q).toLowerCase();
      list = list.filter(function (x) {
        return (x.type + ' ' + x.code + ' ' + x.location + ' ' + x.dept + ' ' + x.leader + ' ' + x.guardian + ' ' +
          (x.workers || []).join(' ')).toLowerCase().indexOf(kw) >= 0;
      });
    }
    // 排序：默认按状态机次序（草稿→…→已完工）再按编号；点表头可切换
    var RANK = { draft: 0, pending: 1, approved: 2, working: 3, done: 4, void: 5 };
    var key = (sort && sort.key) || 'status';
    var dir = (sort && sort.dir) || 'asc';
    list = U.sortBy(list, function (a, b) {
      var va, vb;
      if (key === 'status') { va = RANK[a.status]; vb = RANK[b.status]; }
      else if (key === 'plan') { va = a.planStart; vb = b.planStart; }
      else { va = a[key]; vb = b[key]; }
      if (va == null) va = ''; if (vb == null) vb = '';
      if (va < vb) return -1; if (va > vb) return 1; return 0;
    });
    if (dir === 'desc') list = list.slice().reverse();


    if (!list.length) {
      var total = s.workPermits.length;
      var title, desc, action = null;
      if (!total) {
        /* 一张票都没有 */
        title = '还没有危险作业票';
        desc = '新增第一张作业票后，这里会按月展示并跟踪审批进度。';
        action = { text: '新增第一张', onClick: function () { openForm(ctx, null); } };
      } else if (!monthList.length) {
        /* 有票，但这个月一张没有 */
        title = fmtMonth(f.month) + '还没有作业票';
        desc = '可以切换上方月份查看其它月份，或新增一张计划在本月的作业票。';
        action = (f.month === CUR_MONTH)
          ? { text: '新增作业票', onClick: function () { openForm(ctx, null); } }
          : { text: '回到本月', icon: 'calendar', onClick: function () { goMonth(CUR_MONTH); } };
      } else {
        /* 本月有票，是状态 / 搜索筛掉的 */
        title = '这一月这一类没有作业票';
        desc = f.q
          ? '没有匹配「' + f.q + '」的作业票，换个关键词或清空搜索。'
          : '换个状态筛选看看，或回到「全部」。';
        action = (f.status !== 'all' || f.q)
          ? { text: '查看本月全部', onClick: function () { f.status = 'all'; f.q = ''; ctx.refresh(); } }
          : null;
      }
      body.appendChild(SD.comp.state.build('empty', { title: title, desc: desc, action: action }));
    } else {
      body.appendChild(SD.comp.table.build({
        columns: [
          {
            key: 'type', title: '作业类型', sortable: true,
            render: function (r) {
              var n = (r.photos || []).length;
              return '<span class="b js-ptype" data-id="' + r.id + '" ' +
                  'title="' + (n ? '点击查看现场照片（' + n + ' 张）' : '还没上传现场照片') + '">' +
                U.esc(r.type) +
              '</span>';
            }
          },
          { key: 'location', title: '作业地点', sortable: true, render: function (r) { return U.esc(r.location); } },
          { key: 'dept', title: '申请部门', sortable: true, render: function (r) { return U.esc(r.dept); } },
          { key: 'leader', title: '作业负责人', sortable: true, render: function (r) { return U.esc(r.leader); } },
          { key: 'guardian', title: '监护人', sortable: true, render: function (r) { return U.esc(r.guardian); } },
          {
            key: 'workers', title: '作业人员',
            render: function (r) {
              var w = r.workers || [];
              if (!w.length) return '<span class="t-3">—</span>';
              var show = w.slice(0, 2).map(function (x) { return '<span class="tag">' + U.esc(x) + '</span>'; }).join(' ');
              return '<div class="tags">' + show + (w.length > 2 ? '<span class="t-3 t-sm"> +' + (w.length - 2) + '</span>' : '') + '</div>';
            }
          },
          {
            key: 'plan', title: '计划时段', sortable: true, sortKey: 'planStart', render: function (r) {
              return '<span class="num t-sm">' + U.esc(r.planStart) + (r.planEnd && r.planEnd !== r.planStart ? ' ~ ' + U.esc(r.planEnd) : '') + '</span>';
            }
          },
          { key: 'status', title: '状态', sortable: true, render: function (r) { return '<span class="badge ' + r._statusCls + '">' + r._statusName + '</span>'; } },
          {
            key: '_ops', title: '操作', align: 'right',
            render: function (r) {
              return SD.comp.dropdown.opsButton('pops', r.id);
            }
          }
        ],
        rows: list, minWidth: 960,
        sort: { key: sort.key, dir: sort.dir },
        onSort: function (k, d) { sort.key = k; sort.dir = d; redraw(); },
        rowClass: function (r) { return r.status === 'pending' ? 'row-warn' : (r.status === 'void' ? 'row-mute' : ''); }
      }));

      /* 点作业类型 → 看现场照片大图（表格不单列照片栏，照片在作业票表单里添加）
         数据取最新 summary，防别处改过拿到旧对象 */
      U.on(body, 'click', '.js-ptype', function (e, el) {
        var p = SD.app.state.summary.workPermits.filter(function (x) { return x.id === el.dataset.id; })[0];
        if (!p) return;
        if (!(p.photos || []).length) { U.toast('「' + p.type + '」作业票还没上传现场照片，可在编辑里添加'); return; }
        SD.comp.lightbox.open(p.photos, 0, { title: p.code + ' ' + p.type });
      });

      // 行内「操作 ▾」下拉
      U.on(body, 'click', '[data-act="pops"]', function (e, btn) {
        var p = s.workPermits.filter(function (x) { return x.id === btn.dataset.id; })[0];
        if (!p) return;
        var items = [];
        (TRANSITIONS[p.status] || []).forEach(function (to) {
          items.push({ act: 'to:' + to, text: TRANS_NAME[to] + '（' + (SD.dict.itemOf(SD.dict.DICT.permitStatus, to) || {}).n + '）', primary: true });
        });
        items.push({ act: 'photos', text: '照片（打印 / Word）' });
        items.push({ act: 'edit', text: '编辑' });
        if (p.status !== 'void') items.push({ act: 'void', text: '作废', danger: true });
        items.push({ act: 'del', text: '删除', danger: true });

        SD.comp.dropdown.open({
          anchor: btn,
          items: items,
          onPick: function (it) {
            // people：特种作业人员台账，用于按作业人员姓名自动带出证件照（排第一张）
            if (it.act === 'photos') SD.comp.printPhotos.open(p, { ctx: ctx, people: s.specialPersonnel });
            else if (it.act === 'edit') openForm(ctx, p);
            else if (it.act === 'del') remove(ctx, p);
            else if (it.act === 'void') transition(ctx, p, 'void');
            else if (it.act && it.act.indexOf('to:') === 0) transition(ctx, p, it.act.slice(3));
          }
        });
      });
    }
    }

    redraw();
  }

  return { name: '危险作业票', sub: sub, render: render };
})();
