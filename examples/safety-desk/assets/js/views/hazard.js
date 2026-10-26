/* =========================================================
   views/hazard.js — 隐患管理（模块 3）
   ────────────────────────────────────────────────────────
   · 登记隐患（类型 / 等级 / 责任部门 / 整改期限）
   · 状态流转：待整改 → 整改中 → 待验收 → 已闭环，旁挂「已延期」
   · 每次流转强制留痕（谁 / 何时 / 从什么到什么 / 备注）
   · 双字段口径：severity(红橙黄，管理用) + statutoryLevel(法定两级，对外用)
   · 筛选、搜索、排序齐全；空 / 加载中 / 失败 三态齐全
   ========================================================= */
window.SD = window.SD || {};
SD.views = SD.views || {};

SD.views.hazard = (function () {
  var U = SD.utils;
  var B = function () { return SD.comp.badge; };

  var STATUS_CHIPS = [
    { v: 'all',        n: '全部' },
    { v: 'open',       n: '未闭环' },
    { v: 'overdue',    n: '逾期' },
    { v: 'soon',       n: '临期' },
    { v: 'delayed',    n: '延期跟进' },
    { v: 'pending',    n: '待整改' },
    { v: 'fixing',     n: '整改中' },
    { v: 'verifying',  n: '待验收' },
    { v: 'closed',     n: '已闭环' },
    { v: 'void',       n: '已作废' }
  ];

  function sub(s) {
    if (!s) return '';
    return '共 ' + s.totalHazards + ' 条 · 未闭环 ' + s.openCount + ' · 逾期 ' + s.overdueCount + ' · 已闭环 ' + s.closedCount;
  }

  /* ---------------- 过滤 + 排序 ---------------- */
  function applyFilter(s, f, sort) {
    var list = s.hazards.slice();

    if (f.status && f.status !== 'all') {
      if (f.status === 'open') list = list.filter(function (h) { return h._open; });
      else if (f.status === 'overdue') list = list.filter(function (h) { return h._overdue; });
      else if (f.status === 'soon') list = list.filter(function (h) { return h._soon; });
      else if (f.status === 'delayed') list = list.filter(function (h) { return h._delayedTrack; });
      else list = list.filter(function (h) { return h.status === f.status; });
    }
    if (f.severity && f.severity !== 'all') list = list.filter(function (h) { return h.severity === f.severity; });
    if (f.type && f.type !== 'all') list = list.filter(function (h) { return h.type === f.type; });
    if (f.dept && f.dept !== 'all') list = list.filter(function (h) { return h.dept === f.dept; });
    if (f.q) {
      var q = String(f.q).toLowerCase();
      list = list.filter(function (h) {
        return (h.title + ' ' + h.code + ' ' + h.dept + ' ' + h.owner + ' ' + h.location).toLowerCase().indexOf(q) >= 0;
      });
    }

    // 排序：默认按综合优先级（逾期>临期>等级>截止），点表头可切换
    var key = (sort && sort.key) || 'priority';
    var dir = (sort && sort.dir) || 'asc';
    if (key === 'priority') {
      list = SD.metrics.sortByPriority(list, s.today);
      if (dir === 'desc') list = list.slice().reverse();
      return list;
    }
    var sevRank = { major: 0, large: 1, general: 2 };
    list = U.sortBy(list, function (a, b) {
      var va, vb;
      if (key === 'severity') { va = sevRank[a.severity]; vb = sevRank[b.severity]; }
      else { va = a[key]; vb = b[key]; }
      if (va == null) va = ''; if (vb == null) vb = '';
      if (va < vb) return -1; if (va > vb) return 1; return 0;
    });
    if (dir === 'desc') list = list.slice().reverse();
    return list;
  }

  /* ---------------- 编辑隐患 ----------------
     注意两条红线：
     1) originalDueDate（原始期限）永不改写 —— 改期限洗不掉逾期记录
     2) 一旦调整了当前期限，必须填写变更说明并写进流转记录（法定留痕） */
  function openEdit(ctx, h) {
    var s = ctx.summary;
    var fields = [
      /* 隐患编号：必填；新增时默认顺延填入下一个可用编号，编辑时带出原号；selfId 让唯一性校验排除自己 */
      Object.assign(SD.code.field('hazard'), { selfId: h.id }),
      { name: 'title', label: '隐患标题', type: 'text', required: true, full: true },
      { name: 'type', label: '隐患类型', type: 'select', options: SD.mock.DICT.hazardType },
      {
        name: 'severity', label: '等级（管理三级）', type: 'select',
        options: [
          { v: 'major', n: '重大（红）' }, { v: 'large', n: '较大（橙）' }, { v: 'general', n: '一般（黄）' }
        ]
      },
      { name: 'dept', label: '责任部门', type: 'text', required: true },
      { name: 'owner', label: '责任人', type: 'text' },
      { name: 'location', label: '发现区域 / 位置', type: 'text' },
      { name: 'source', label: '发现来源', type: 'select', options: SD.mock.DICT.hazardSource },
      { name: 'foundDate', label: '发现日期', type: 'date' },
      { name: 'dueDate', label: '当前整改期限', type: 'date', help: '原始期限 ' + (h.originalDueDate || h.dueDate) + ' 不变' },
      { name: 'measure', label: '整改措施', type: 'textarea', full: true, rows: 2 },
      /* 照片：登记时能加，编辑时也要能补拍 / 替换（整改后补一张闭环证据最常见） */
      {
        name: 'photos', label: '隐患照片', type: 'photos', full: true, max: 3,
        help: '最多 3 张，自动压到 1000px；存进隐患台账，点台账标题可看大图，出整改通知书时直接带上'
      },
      { name: 'note', label: '变更说明', type: 'text', full: true, placeholder: '调整期限时必填，写清为什么改' }
    ];

    SD.comp.formDialog.open({
      title: '编辑隐患 · ' + h.code, width: 620,
      fields: fields, values: h,
      hint: '原始期限不可修改，改期限只推「当前期限」',
      validate: function (v) {
        if (v.dueDate && v.dueDate !== h.dueDate && !String(v.note || '').trim()) {
          return '调整了整改期限，必须填写变更说明（留痕要求）';
        }
        return null;
      },
      onSubmit: function (v) {
        var patch = {
          code: v.code,
          title: v.title, type: v.type,
          typeCode: SD.mock.DICT.hazardType.indexOf(v.type) + 1,
          severity: v.severity,
          statutoryLevel: v.severity === 'major' ? 'major' : 'general',
          dept: v.dept, owner: v.owner || '', location: v.location || '',
          source: v.source, foundDate: v.foundDate, dueDate: v.dueDate,
          measure: v.measure || '',
          photos: v.photos || []
        };

        // 期限变化 → 追加一条流转记录，说明从哪天推到哪天、为什么
        if (v.dueDate && v.dueDate !== h.dueDate) {
          patch.flow = (h.flow || []).concat([{
            at: s.today + ' ' + new Date().toTimeString().slice(0, 5),
            by: '王安全', from: '—', to: '—',
            note: '编辑：整改期限由 ' + h.dueDate + ' 调整为 ' + v.dueDate +
                  '（原始期限 ' + (h.originalDueDate || h.dueDate) + ' 不变）。' + (v.note || '')
          }]);
        }
        return SD.api.updateHazard(h.id, patch).then(function () {
          U.toast('隐患已更新', 'ok');
          ctx.reload();
        });
      }
    });
  }

  /* ---------------- 作废隐患（不是删除） ---------------- */
  function openVoid(ctx, h) {
    SD.comp.formDialog.open({
      title: '作废隐患 · ' + h.code, width: 480,
      fields: [
        { name: 'reason', label: '作废原因', type: 'textarea', full: true, required: true, rows: 3,
          placeholder: '例：重复登记，与 FZYH-0000003 为同一处隐患' }
      ],
      hint: '作废后不计入未整改 / 逾期 / 待办，但台账记录与流转留痕永久保留',
      okText: '确认作废',
      onSubmit: function (v) {
        return SD.api.voidHazard(h.id, v.reason).then(function () {
          U.toast('隐患已作废（记录保留）', 'ok');
          ctx.reload();
        });
      }
    });
  }

  /* ---------------- 登记隐患弹窗 ---------------- */
  function openCreate(ctx, s) {
    var opts = function (arr, cur) {
      return arr.map(function (x) {
        return '<option value="' + U.esc(x) + '"' + (x === cur ? ' selected' : '') + '>' + U.esc(x) + '</option>';
      }).join('');
    };
    var depts = Array.from(new Set(s.hazards.map(function (h) { return h.dept; }).concat(['安环部'])));

    var body =
      '<div class="grid-form">' +
        /* 隐患编号：必填；默认顺延填入下一个可用编号（可手动修改），台账内不可重复 */
        '<div class="field full"><span class="req">隐患编号</span>' +
          '<input class="input" id="f_code" value="' + U.esc(SD.code.next('hazard')) + '"' +
            ' placeholder="' + U.esc(SD.code.sample('hazard')) + '">' +
          '<div class="t-3 t-sm" style="margin-top:4px">' +
            '默认顺延填入下一个可用编号，可手动修改；不可为空；隐患台账内不可重复</div>' +
        '</div>' +
        '<label class="field full"><span class="req">隐患标题</span>' +
          '<input class="input" id="f_title" placeholder="例：装配车间消防通道被物料占用" maxlength="60"></label>' +
        '<label class="field"><span class="req">隐患类型</span><select class="input" id="f_type">' +
          opts(SD.mock.DICT.hazardType, '消防') + '</select></label>' +
        '<label class="field"><span class="req">等级（管理三级）</span><select class="input" id="f_sev">' +
          '<option value="major">重大（红）</option><option value="large" selected>较大（橙）</option>' +
          '<option value="general">一般（黄）</option></select></label>' +
        '<label class="field"><span>法定口径</span>' +
          '<input class="input" id="f_stat" value="一般事故隐患" readonly style="background:var(--surface-2)"></label>' +
        '<label class="field"><span class="req">责任部门</span>' +
          '<input class="input" id="f_dept" list="f_dept_list" placeholder="如：生产一部"><datalist id="f_dept_list">' +
          depts.map(function (d) { return '<option value="' + U.esc(d) + '">'; }).join('') + '</datalist></label>' +
        '<label class="field"><span>责任人</span><input class="input" id="f_owner" placeholder="如：张伟"></label>' +
        '<label class="field"><span>发现区域 / 位置</span><input class="input" id="f_loc" placeholder="如：A 区装配线东侧"></label>' +
        '<label class="field"><span>发现来源</span><select class="input" id="f_src">' +
          opts(SD.mock.DICT.hazardSource, '日常巡检') + '</select></label>' +
        '<label class="field"><span>发现日期</span><input class="input" type="date" id="f_found" value="' + s.today + '"></label>' +
        '<label class="field"><span class="req">整改期限</span><input class="input" type="date" id="f_due"></label>' +
        '<label class="field full"><span>整改措施</span>' +
          '<textarea class="input" id="f_measure" rows="2" placeholder="写清怎么改，便于验收时对照"></textarea></label>' +
        /* 照片：占位容器，弹窗进 DOM 后由 photoPicker 挂载（控件内含按钮，不能用 label 包） */
        '<div class="field full"><span>隐患照片</span>' +
          '<div class="ph-slot" id="f_photos" data-max="3"></div>' +
          '<div class="t-3 t-sm" style="margin-top:4px">最多 3 张，自动压到 1000px；' +
            '存进隐患台账，出整改通知书时可直接带上</div>' +
        '</div>' +
      '</div>' +
      '<p class="t-3 t-sm" style="margin-top:2px">说明：法定口径按等级自动归类 —— 「重大」→ 重大事故隐患，「较大/一般」→ 一般事故隐患。</p>';

    var dlg = SD.comp.dialog.open({
      title: '登记隐患', width: 620, body: body, okText: '登记',
      onMount: function (modal) {
        var box = modal.querySelector('#f_photos');
        if (box && SD.comp.photoPicker) SD.comp.photoPicker.mount(box, { value: [], max: 3 });
      },
      onOk: function (modal) {
        var g = function (id) { var e = modal.querySelector('#' + id); return e ? e.value.trim() : ''; };
        var title = g('f_title'), due = g('f_due');
        var code = g('f_code');
        var codeErr = SD.code.check('hazard', code);     // 空 / 格式 / 同类型重复
        if (codeErr) return codeErr;
        if (!title) return '请填写隐患标题';
        if (!due) return '请选择整改期限';

        // 照片（可能一张都没选，给空数组即可）
        var phBox = modal.querySelector('#f_photos');
        var photos = (phBox && phBox._ph) ? phBox._ph.get() : [];

        var sev = g('f_sev');
        return SD.api.createHazard({
          code: code,
          title: title,
          type: g('f_type'),
          typeCode: SD.mock.DICT.hazardType.indexOf(g('f_type')) + 1,
          severity: sev,
          statutoryLevel: sev === 'major' ? 'major' : 'general',
          dept: g('f_dept') || '未指定',
          owner: g('f_owner'),
          location: g('f_loc'),
          source: g('f_src'),
          foundDate: g('f_found') || s.today,
          originalDueDate: due,
          dueDate: due,
          measure: g('f_measure'),
          photos: photos,
          note: '手工登记'
        }).then(function () {
          U.toast('隐患已登记', 'ok');
          ctx.reload();          // 重新取数并整体刷新
        });
      }
    });

    // 等级变化联动法定口径显示
    var sevEl = dlg.el.querySelector('#f_sev');
    var statEl = dlg.el.querySelector('#f_stat');
    if (sevEl && statEl) {
      sevEl.addEventListener('change', function () {
        statEl.value = sevEl.value === 'major' ? '重大事故隐患' : '一般事故隐患';
      });
    }
    // 默认期限：今天 + 7 天
    var dueEl = dlg.el.querySelector('#f_due');
    if (dueEl) dueEl.value = U.shift(s.today, 7);
  }

  /* ---------------- 状态流转弹窗 ---------------- */
  function openAdvance(ctx, h, to) {
    var NAME = SD.mock.nameOf(SD.mock.DICT.hazardStatus, to);
    var isDelay = (to === 'delayed');

    var body =
      '<p class="t-2 t-sm" style="margin-bottom:12px">' +
        '隐患：' + U.esc(h.code) + ' · ' + U.esc(h.title) + '<br>' +
        '当前状态：' + B().status(h.status) + '　→　目标状态：' + B().status(to) +
      '</p>' +
      (isDelay
        ? '<div class="grid-form">' +
            '<label class="field"><span class="req">延期后期限</span><input class="input" type="date" id="a_due" value="' + U.shift(h.dueDate || ctx.summary.today, 7) + '"></label>' +
            '<label class="field"><span class="req">批准人</span><input class="input" id="a_by" placeholder="如：安全总监 · 周建国"></label>' +
            '<label class="field full"><span class="req">延期原因</span><textarea class="input" id="a_reason" rows="2" placeholder="例：限位开关需原厂备件，采购周期约 12 个工作日"></textarea></label>' +
          '</div>' +
          '<p class="t-3 t-sm">延期只推进「当前期限」，原始期限 ' + U.esc(h.originalDueDate || h.dueDate) + ' 永久保留；批准后的延期不再计入逾期，但会列入「延期跟进」。</p>'
        : '<label class="field"><span>流转备注</span><textarea class="input" id="a_note" rows="2" placeholder="写清做了什么，便于后续追溯"></textarea></label>');

    SD.comp.dialog.open({
      title: '推进状态 → ' + NAME,
      width: isDelay ? 620 : 520,
      body: body, okText: '确认推进',
      onOk: function (modal) {
        var g = function (id) { var e = modal.querySelector('#' + id); return e ? e.value.trim() : ''; };
        var extra = { note: g('a_note') };
        if (isDelay) {
          if (!g('a_due')) return '请选择延期后期限';
          if (!g('a_reason')) return '请填写延期原因';
          if (!g('a_by')) return '请填写批准人';
          extra.dueDate = g('a_due');
          extra.delayReason = g('a_reason');
          extra.delayApprovedBy = g('a_by');
          extra.note = '申请延期：' + g('a_reason');
        }
        return SD.api.advanceHazard(h.id, to, extra).then(function () {
          U.toast('已推进到「' + NAME + '」', 'ok');
          ctx.reload();
        });
      }
    });
  }

  /* ---------------- 详情弹窗（含流转记录） ---------------- */
  function openDetail(ctx, h) {
    var flow = (h.flow || []).slice().reverse();
    var tl = flow.length
      ? '<div class="timeline">' + flow.map(function (f) {
          return '<div class="tl-item"><span class="tl-dot"></span><div class="tl-body">' +
            '<div class="tl-title">' + U.esc(f.from) + ' → ' + U.esc(f.to) + '</div>' +
            '<div class="tl-meta">' + U.esc(f.at) + ' · ' + U.esc(f.by) + '</div>' +
            (f.note ? '<div class="tl-note">' + U.esc(f.note) + '</div>' : '') +
          '</div></div>';
        }).join('') + '</div>'
      : '<p class="t-3 t-sm">暂无流转记录</p>';

    var body =
      '<div class="grid-form">' +
        '<label class="field full"><span>隐患标题</span><div class="b">' + U.esc(h.title) + '</div></label>' +
        '<label class="field"><span>编号</span><div>' + U.esc(h.code) + '</div></label>' +
        '<label class="field"><span>类型</span><div>' + U.esc(h.type) + '</div></label>' +
        '<label class="field"><span>等级（管理三级）</span><div>' + B().severity(h.severity) + '</div></label>' +
        '<label class="field"><span>法定口径</span><div>' + B().statutory(h.statutoryLevel) + '</div></label>' +
        '<label class="field"><span>责任部门</span><div>' + U.esc(h.dept) + '</div></label>' +
        '<label class="field"><span>责任人</span><div>' + U.esc(h.owner || '—') + '</div></label>' +
        '<label class="field"><span>发现日期</span><div>' + U.esc(h.foundDate || '—') + '</div></label>' +
        '<label class="field"><span>原始整改期限</span><div>' + U.esc(h.originalDueDate || '—') +
          (h.delayCount ? '（已延期 ' + h.delayCount + ' 次）' : '') + '</div></label>' +
        '<label class="field"><span>当前整改期限</span><div>' + U.esc(h.dueDate || '—') +
          (h._overdue ? ' ' + B().overdue(h._overdueDays) : (h._soon ? ' ' + B().soon(h._daysLeft) : '')) + '</div></label>' +
        '<label class="field"><span>当前状态</span><div>' + B().status(h.status) + '</div></label>' +
        '<label class="field"><span>发现来源</span><div>' + U.esc(h.source || '—') + '</div></label>' +
        '<label class="field full"><span>整改措施</span><div>' + U.esc(h.measure || '—') + '</div></label>' +
        (h.delayReason ? '<label class="field full"><span>延期原因</span><div>' + U.esc(h.delayReason) +
          '（批准人：' + U.esc(h.delayApprovedBy || '—') + '）</div></label>' : '') +
      '</div>' +
      '<div style="margin-top:6px"><div class="b t-sm" style="margin-bottom:8px">流转记录</div>' + tl + '</div>' +
      '<div style="margin-top:12px;display:flex;gap:8px">' +
        '<button class="btn sm primary" id="d_print">打印整改通知书</button>' +
        '<span class="t-3 t-sm" style="align-self:center">按企业现行通知书版式出 A4 纸质件</span>' +
      '</div>';

    var dlg = SD.comp.dialog.open({
      title: '隐患详情', width: 640, body: body,
      okText: '关闭', cancelText: '取消'
    });
    var pb = dlg.el.querySelector('#d_print');
    if (pb) pb.addEventListener('click', function () {
      SD.comp.printNotice.open(h, { ctx: ctx });
    });
  }

  /* ---------------- 操作菜单 ----------------
     菜单项按状态动态生成：可推进的状态在前面，后面是通知书 / 编辑 / 作废 / 详情
     （作废只给在办项：闭环是完成态，作废针对登记有误的在办项）
  ------------------------------------------------ */
  function advanceLabel(o) {
    if (o === 'verifying') return '提交验收';
    if (o === 'closed') return '验收闭环';
    if (o === 'fixing') return '开始整改';
    return SD.mock.nameOf(SD.mock.DICT.hazardStatus, o);
  }

  function opsItems(h) {
    var items = SD.metrics.nextOptions(h.status).map(function (o) {
      return { act: 'advance', to: o, text: advanceLabel(o), primary: true };
    });
    items.push({ act: 'notice', text: '整改通知书（打印/Word）' });
    items.push({ act: 'edit', text: '编辑' });
    if (h.status !== 'closed' && h.status !== 'void') {
      items.push({ act: 'void', text: '作废', danger: true });
    }
    items.push({ act: 'detail', text: '查看详情' });
    return items;
  }

  function doAct(ctx, h, it) {
    if (it.act === 'advance') openAdvance(ctx, h, it.to);
    else if (it.act === 'detail') openDetail(ctx, h);
    else if (it.act === 'edit') openEdit(ctx, h);
    else if (it.act === 'void') openVoid(ctx, h);
    else if (it.act === 'notice') SD.comp.printNotice.open(h, { ctx: ctx });
  }

  /* ---------------- 主渲染 ---------------- */
  function render(host, ctx) {
    var s = ctx.summary;
    var f = (ctx.state.filters.hazard = ctx.state.filters.hazard || {});
    if (!f.status) f.status = 'all';
    if (!f.severity) f.severity = 'all';
    if (!f.type) f.type = 'all';
    if (!f.dept) f.dept = 'all';
    var sort = (ctx.state.sort.hazard = ctx.state.sort.hazard || { key: 'priority', dir: 'asc' });

    U.clear(host);

    /* ---------- 筛选条 ---------- */
    var bar = U.h('<div class="filters"></div>');

    var cg = U.h('<div class="chip-group"></div>');
    STATUS_CHIPS.forEach(function (c) {
      var chip = U.h('<button class="chip' + (f.status === c.v ? ' on' : '') + '">' + U.esc(c.n) + '</button>');
      chip.addEventListener('click', function () {
        f.status = c.v;
        Array.prototype.forEach.call(cg.children, function (el, i) { el.classList.toggle('on', STATUS_CHIPS[i].v === c.v); });
        redraw();
      });
      cg.appendChild(chip);
    });
    bar.appendChild(cg);

    var spacer = U.h('<div class="spacer"></div>');
    bar.appendChild(spacer);

    // 等级筛选
    var sevSel = U.h('<select class="ctl-select"></select>');
    sevSel.innerHTML = '<option value="all">全部等级</option>' +
      SD.mock.DICT.severity.map(function (x) {
        return '<option value="' + x.v + '"' + (f.severity === x.v ? ' selected' : '') + '>' + x.n + '</option>';
      }).join('');
    sevSel.addEventListener('change', function () { f.severity = sevSel.value; redraw(); });
    var sevFg = U.h('<div class="fg"><label>等级</label></div>');
    sevFg.appendChild(sevSel);
    bar.appendChild(sevFg);

    // 类型筛选
    var typeSel = U.h('<select class="ctl-select"></select>');
    typeSel.innerHTML = '<option value="all">全部类型</option>' +
      SD.mock.DICT.hazardType.map(function (x) {
        return '<option value="' + U.esc(x) + '"' + (f.type === x ? ' selected' : '') + '>' + U.esc(x) + '</option>';
      }).join('');
    typeSel.addEventListener('change', function () { f.type = typeSel.value; redraw(); });
    var typeFg = U.h('<div class="fg"><label>类型</label></div>');
    typeFg.appendChild(typeSel);
    bar.appendChild(typeFg);

    // 部门筛选
    var depts = Array.from(new Set(s.hazards.map(function (h) { return h.dept; })));
    var deptSel = U.h('<select class="ctl-select"></select>');
    deptSel.innerHTML = '<option value="all">全部部门</option>' +
      depts.map(function (x) {
        return '<option value="' + U.esc(x) + '"' + (f.dept === x ? ' selected' : '') + '>' + U.esc(x) + '</option>';
      }).join('');
    deptSel.addEventListener('change', function () { f.dept = deptSel.value; redraw(); });
    var deptFg = U.h('<div class="fg"><label>部门</label></div>');
    deptFg.appendChild(deptSel);
    bar.appendChild(deptFg);

    // 搜索
    var q = U.h('<input class="input" placeholder="搜标题 / 编号 / 部门 / 责任人" style="width:190px" data-keep-focus="hazard">');
    q.value = f.q || '';
    q.addEventListener('input', U.debounce(function () { f.q = q.value; redraw(); }, 250));
    bar.appendChild(q);

    // 登记按钮
    var addBtn = U.h('<button class="btn primary">' + SD.icons.get('plus', 15) + '登记隐患</button>');
    addBtn.addEventListener('click', function () { openCreate(ctx, s); });
    bar.appendChild(addBtn);

    host.appendChild(bar);

    /* ---------- 列表容器 ----------
       搜索 / 排序 / 筛选只重绘这里，不重建筛选条（输入框不销毁，连续输入与输入法不受影响） */
    var listBox = U.h('<div class="js-list-box"></div>');
    host.appendChild(listBox);

    function redraw() {
    U.clear(listBox);
    /* 表格 */
    var list = applyFilter(s, f, sort);

    if (!list.length) {
      listBox.appendChild(SD.comp.state.build('empty', {
        title: s.hazards.length ? '没有符合条件的隐患' : '还没有隐患记录',
        desc: s.hazards.length ? '试着放宽筛选条件。' : '登记第一条隐患后，这里会按逾期、等级、截止时间自动排序。',
        action: s.hazards.length ? null : { text: '登记第一条隐患', onClick: function () { openCreate(ctx, s); } }
      }));
      return;
    }

    var columns = [
      {
        key: 'code', title: '编号', sortable: true,
        render: function (r) { return '<span class="t-sm num">' + U.esc(r.code) + '</span>'; }
      },
      {
        key: 'title', title: '隐患标题',
        render: function (r) {
          var n = (r.photos || []).length;
          return '<div class="cell-main js-hz-title' + (n ? ' link' : '') + '" data-id="' + r.id + '" ' +
              'title="' + (n ? '点击查看隐患照片（' + n + ' 张）' : '这条隐患还没有照片') + '">' +
            U.esc(r.title) +
            (n ? '<span class="hz-photo-tag">照片 ' + n + '</span>' : '') +
          '</div>' +
          '<div class="cell-sub">' + U.esc(r.location || '') + '</div>';
        }
      },
      { key: 'type', title: '类型', sortable: true, render: function (r) { return B().tag(r.type); } },
      {
        key: 'severity', title: '等级', sortable: true,
        render: function (r) {
          return '<span style="display:inline-flex;align-items:center;gap:6px">' +
            '<i class="lv-dot ' + (r.severity === 'major' ? 'major' : (r.severity === 'large' ? 'large' : 'general')) + '"></i>' +
            B().severity(r.severity) + '</span>' +
            '<div class="cell-sub">' + U.esc(r._statutoryName) + '</div>';
        }
      },
      { key: 'dept', title: '责任部门', sortable: true, render: function (r) { return U.esc(r.dept); } },
      { key: 'owner', title: '责任人', render: function (r) { return U.esc(r.owner || '—'); } },
      {
        key: 'dueDate', title: '整改期限', sortable: true,
        render: function (r) {
          var extra = '';
          if (r._overdue) extra = ' ' + B().overdue(r._overdueDays);
          else if (r._soon) extra = ' ' + B().soon(r._daysLeft);
          if (r._delayedTrack) extra += ' ' + B().delayed(r.delayCount);
          return '<span class="num">' + U.esc(r.dueDate || '—') + '</span><div style="margin-top:3px">' + extra + '</div>';
        }
      },
      { key: 'status', title: '状态', sortable: true, render: function (r) { return B().status(r.status); } },
      {
        key: '_ops', title: '操作', align: 'right',
        /* 操作收成下拉菜单：一行最多 5 个按钮会把表格撑爆，窄屏更没法看 */
        render: function (r) {
          return '<div class="cell-actions">' + SD.comp.dropdown.opsButton('ops', r.id) + '</div>';
        }
      }
    ];

    var table = SD.comp.table.build({
      columns: columns,
      rows: list,
      sort: sort.key === 'priority' ? null : sort,
      onSort: function (key, dir) {
        // 就地改（不能换成新对象：局部 redraw 闭包里的 sort 指向原引用）
        sort.key = key; sort.dir = dir;
        ctx.state.sort.hazard = sort;
        redraw();
      },
      rowClass: function (r) { return r._overdue ? 'row-danger' : (r._soon ? 'row-warn' : ''); },
      minWidth: 980
    });
    listBox.appendChild(table);

    /* ---------- 行内操作：点「操作 ▾」弹下拉菜单 ---------- */
    U.on(table, 'click', '[data-act="ops"]', function (e, el) {
      var id = el.dataset.id;
      var h = s.hazards.filter(function (x) { return x.id === id; })[0];
      if (!h) return;
      SD.comp.dropdown.open({
        anchor: el,
        items: opsItems(h),
        onPick: function (it) {
          var cur = SD.app.state.summary.hazards.filter(function (x) { return x.id === id; })[0] || h;
          doAct(ctx, cur, it);
        }
      });
    });

    /* ---------- 点隐患标题看照片 ----------
       照片在登记时随单上传（≤3 张），表格里只在标题后挂个张数角标，
       点标题才开大图，避免缩略图把标题列挤窄。 */
    U.on(table, 'click', '.js-hz-title', function (e, el) {
      // 从最新 summary 取，避免别处改过数据后拿到旧对象
      var h = SD.app.state.summary.hazards.filter(function (x) { return x.id === el.dataset.id; })[0];
      if (!h) return;
      var ph = h.photos || [];
      if (!ph.length) { U.toast('这条隐患还没有照片，登记隐患时可添加'); return; }
      SD.comp.lightbox.open(ph, 0, { title: h.code + ' ' + h.title });
    });

    }

    redraw();

    /* ---------- 口径说明 ---------- */
    host.appendChild(U.h(
      '<section class="card tight t-3 t-sm">' +
        '<b class="t-2">口径说明</b>　' +
        '等级为双字段：severity（重大/较大/一般 → 红/橙/黄）用于内部管理与排序，' +
        'statutoryLevel（重大事故隐患/一般事故隐患）用于对外报表，按安监总局令第 16 号两级口径自动归类。' +
        '逾期按「当前期限」判定，但原始期限 originalDueDate 永不改写 —— 改期限洗不掉逾期记录。' +
      '</section>'
    ));
  }

  return { name: '隐患管理', sub: sub, render: render, openCreate: openCreate };
})();
