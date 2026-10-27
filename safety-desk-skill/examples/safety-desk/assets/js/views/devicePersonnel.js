/* =========================================================
   views/devicePersonnel.js — 特种设备人员台账（2026-10-24 新增）
   ────────────────────────────────────────────────────────
   · 版面与「特种作业人员台账」一致：指标卡 + 状态 chips + 搜索 + 可排序表格 + 行内操作
   · 数据来源（2026-10-27 起）：**以导入的 Excel / CSV 为准**，不再内置名单；
     台账为空时可用「导入 Excel」批量建档（可下载模板），也可逐条新增
   · 字段：编号 / 姓名 / 工号 / 部门 / 岗位 / 证书类型 / 证件编号 / 证书有效期至 / 联系方式 / 备注
   · 设备证只记「有效期至」（原表没有起算日与复审日），状态按剩余天数实时判定：
     已过期（红） / 90 天内待复审（橙） / 有效
   ========================================================= */
window.SD = window.SD || {};
SD.views = SD.views || {};

SD.views.devicePersonnel = (function () {
  var U = SD.utils;

  var CHIPS = [
    { v: 'all',            n: '全部' },
    { v: 'valid',          n: '有效' },
    { v: 'pending_review', n: '待复审' },
    { v: 'expired',        n: '已过期' },
    { v: 'suspended',      n: '停用' }
  ];

  /* ---------- Excel 导入 / 导出配置（SD.comp.excelIO 用） ---------- */
  var XIO = {
    collection: 'devicePersonnel',
    idPrefix: 'DP',
    codeRule: 'device',            /* 编号留空时按 TZSB-001 顺延 */
    keyField: 'idNo',              /* 判重字段：证件编号 */
    dateField: 'validTo',
    title: '导入特种设备人员台账',
    fileBase: '特种设备人员台账',
    sheetName: '特种设备人员',
    tip: '支持 .xlsx / .csv，首行为表头。必填 <b>姓名 / 所属部门 / 证件编号 / 证书有效期至</b>；' +
      '「证件编号」重复的行会跳过。日期可写 2026-10-27、2026/10/27、2026年10月27日 或 Excel 日期格式。',
    fields: [
      { name: 'code',     label: '编号',         aliases: ['人员编号', '设备人员编号'], type: 'text', width: 12 },
      { name: 'name',     label: '姓名',         aliases: ['人员姓名', '员工姓名'], required: true, type: 'text', width: 12, sample: '张三' },
      { name: 'empNo',    label: '工号',         aliases: ['员工编号', '职工号'], type: 'text', width: 10 },
      { name: 'dept',     label: '所属部门',     aliases: ['部门'], required: true, type: 'text', width: 16, sample: '仓储物流部' },
      { name: 'post',     label: '岗位',         aliases: ['职位'], type: 'text', width: 14 },
      { name: 'certType', label: '证书类型',     aliases: ['证书类别', '作业种类'], type: 'text', width: 12, def: 'N1', sample: 'N1' },
      { name: 'idNo',     label: '证件编号',     aliases: ['身份证号', '身份证号码', '证书编号', '证件号'], required: true, type: 'text', width: 22 },
      { name: 'validTo',  label: '证书有效期至', aliases: ['有效期至', '有效期', '到期日', '证书有效期'], required: true, type: 'date', width: 14 },
      { name: 'phone',    label: '联系方式',     aliases: ['电话', '手机号', '联系电话'], type: 'text', width: 14 },
      { name: 'note',     label: '备注',         aliases: ['说明'], type: 'text', width: 18 },
      { name: 'status',   label: '证书状态',     aliases: ['状态', '资质状态'], type: 'status', dict: 'specialStatus', width: 10 }
    ]
  };

  function sub(s) {
    if (!s) return '';
    var p = s.devicePersonnelSummary || { total: 0, pending_review: 0, expired: 0, suspended: 0 };
    return '在册 ' + p.total + ' 人 · 待复审 ' + p.pending_review + ' · 已过期 ' + p.expired + ' · 停用 ' + p.suspended;
  }

  var FIELDS = [
    SD.code.field('device'),              /* 人员编号：新增时默认顺延填入 TZSB-001，可手改 */
    { name: 'name',  label: '姓名',   type: 'text', required: true },
    { name: 'empNo', label: '工号',   type: 'text', placeholder: '例：06359（有前导零，按文本存）' },
    { name: 'dept',  label: '所属部门', type: 'text', required: true, placeholder: '例：仓储物流部' },
    { name: 'post',  label: '岗位',   type: 'text', placeholder: '例：叉车班 / 发泡仓 / 设备' },
    {
      name: 'certType', label: '证书类型', type: 'text', required: true, def: 'N1',
      placeholder: '例：N1', help: 'N1 = 叉车司机（厂内机动车辆）；其他设备证按证书上的代号填'
    },
    {
      name: 'idNo', label: '证件编号', type: 'text', required: true,
      help: '身份证号或证书编号，按证书原件填（含 X 结尾的要带 X）'
    },
    {
      name: 'validTo', label: '证书有效期至', type: 'date', required: true,
      help: '到期前须完成复审换证；临期与过期预警都按这个日期算'
    },
    { name: 'phone', label: '联系方式', type: 'text', placeholder: '手机号或内线' },
    { name: 'note',  label: '备注',     type: 'text', placeholder: '例：仓储班长 / 高压' },
    { name: 'status', label: '证书状态', type: 'select', required: true, options: function () { return SD.mock.DICT.specialStatus; }, def: 'valid' },
    {
      name: 'photos', label: '证书照片', type: 'photos', full: true, max: 3,
      help: '最多 3 张（证件正反面 / 人像）；台账里点「姓名」可看大图'
    }
  ];

  function resolve(r) {
    return FIELDS.map(function (f) {
      var g = (typeof f.options === 'function') ? Object.assign({}, f, { options: f.options() }) : f;
      if (g.type === 'code') g = Object.assign({}, g, { selfId: r ? r.id : null });
      return g;
    });
  }

  function openForm(ctx, r) {
    var isEdit = !!r;
    SD.comp.formDialog.open({
      title: isEdit ? '编辑特种设备人员' : '新增特种设备人员',
      width: 640,
      fields: resolve(r),
      values: r || {},
      onSubmit: function (v) {
        var payload = {
          code: v.code, name: v.name, empNo: v.empNo || '', dept: v.dept, post: v.post || '',
          certType: v.certType, idNo: v.idNo, validTo: v.validTo,
          phone: v.phone || '', note: v.note || '', status: v.status || 'valid',
          photos: v.photos || []
        };
        return (isEdit ? SD.api.updateDevicePersonnel(r.id, payload) : SD.api.createDevicePersonnel(payload))
          .then(function () { U.toast(isEdit ? '已更新' : '已新增特种设备人员', 'ok'); ctx.reload(); });
      }
    });
  }

  function remove(ctx, r) {
    SD.comp.dialog.confirm({
      title: '删除人员记录',
      message: '将删除「' + r.name + '」的特种设备作业证记录（' + r.certType + ' · ' + r.validTo + '）。',
      okText: '确认删除', danger: true,
      onOk: function () {
        return SD.api.removeDevicePersonnel(r.id).then(function () { U.toast('已删除', 'ok'); ctx.reload(); });
      }
    });
  }

  function render(host, ctx) {
    var s = ctx.summary;
    if (!SD.auth.can('special.view')) return;
    U.clear(host);

    var f = (ctx.state.filters.devicePersonnel = ctx.state.filters.devicePersonnel || {});
    if (!f.status) f.status = 'all';
    if (f.q == null) f.q = '';
    var sort = (ctx.state.sort.devicePersonnel = ctx.state.sort.devicePersonnel || { key: '_daysLeft', dir: 'asc' });

    /* ---------- 指标卡 ---------- */
    var p = s.devicePersonnelSummary || { total: 0, valid: 0, pending_review: 0, expired: 0, suspended: 0 };
    var box = U.h('<div class="grid cols-4"></div>');
    SD.comp.statCard.renderAll(box, [
      { label: '有效', value: p.valid, unit: '人', icon: 'check', tone: 'green' },
      { label: '待复审', value: p.pending_review, unit: '人', icon: 'clock', tone: 'orange',
        onClick: function () { f.status = 'pending_review'; ctx.refresh(); } },
      { label: '已过期', value: p.expired, unit: '人', icon: 'alertCircle', tone: 'red',
        onClick: function () { f.status = 'expired'; ctx.refresh(); } },
      { label: '停用', value: p.suspended, unit: '人', icon: 'x', tone: 'mute' }
    ]);
    host.appendChild(box);

    /* ---------- 筛选 + 搜索 + 新增 ---------- */
    var bar = U.h('<div class="filters"><div class="chip-group"></div><div class="spacer"></div></div>');
    var cg = bar.querySelector('.chip-group');
    CHIPS.forEach(function (k) {
      var n = k.v === 'all' ? (s.devicePersonnel || []).length : (p[k.v] || 0);
      var chip = U.h('<button class="chip' + (f.status === k.v ? ' on' : '') + '">' + U.esc(k.n) + ' ' + n + '</button>');
      chip.addEventListener('click', function () {
        f.status = k.v;
        Array.prototype.forEach.call(cg.children, function (el, i) { el.classList.toggle('on', CHIPS[i].v === k.v); });
        redraw();
      });
      cg.appendChild(chip);
    });
    var spacer = bar.querySelector('.spacer');
    var q = U.h('<input class="input" placeholder="搜姓名 / 工号 / 编号 / 部门 / 岗位" style="width:210px" data-keep-focus="device">');
    q.value = f.q || '';
    q.addEventListener('input', U.debounce(function () { f.q = q.value; redraw(); }, 250));
    spacer.appendChild(q);
    /* Excel 导入 / 导出（2026-10-27：台账数据来源改为导入，内置名单已移除） */
    var impBtn = U.h('<button class="btn sm ghost" title="从 .xlsx / .csv 批量导入台账">' +
      SD.icons.get('upload', 14) + '导入 Excel</button>');
    impBtn.addEventListener('click', function () {
      SD.comp.excelIO.openImport({
        collection: XIO.collection, idPrefix: XIO.idPrefix, codeRule: XIO.codeRule,
        keyField: XIO.keyField, dateField: XIO.dateField,
        title: XIO.title, fileBase: XIO.fileBase, sheetName: XIO.sheetName,
        tip: XIO.tip, fields: XIO.fields, ctx: ctx
      });
    });
    spacer.appendChild(impBtn);

    var expBtn = U.h('<button class="btn sm ghost" title="把整份台账导出为 Excel">' +
      SD.icons.get('download', 14) + '导出 Excel</button>');
    expBtn.addEventListener('click', function () {
      SD.comp.excelIO.exportExcel({
        collection: XIO.collection, fields: XIO.fields,
        sheetName: XIO.sheetName, fileBase: XIO.fileBase
      });
    });
    spacer.appendChild(expBtn);

    var addBtn = U.h('<button class="btn sm primary">' + SD.icons.get('plus', 14) + '新增设备人员</button>');
    addBtn.addEventListener('click', function () { openForm(ctx, null); });
    spacer.appendChild(addBtn);
    host.appendChild(bar);

    /* ---------- 表格（只建一次容器，搜索/排序只重绘 body） ---------- */
    var card = U.h('<section class="card"><div class="card-head">' +
      '<div><h3>特种设备人员台账</h3><div class="sub">叉车等特种设备作业证；按证书剩余天数升序，最急的在最上面</div></div></div>' +
      '<div class="js-body"></div></section>');
    var body = card.querySelector('.js-body');
    host.appendChild(card);

    function redraw() {
      U.clear(body);
      var all = s.devicePersonnel || [];
      var list = all.filter(function (x) { return f.status === 'all' || x.status === f.status; });
      if (f.q) {
        var kw = String(f.q).toLowerCase();
        list = list.filter(function (x) {
          return [x.name, x.code, x.empNo, x.dept, x.post, x.certType, x.idNo, x.note]
            .join(' ').toLowerCase().indexOf(kw) >= 0;
        });
      }
      var SRANK = { expired: 0, pending_review: 1, valid: 2, suspended: 3 };
      var key = (sort && sort.key) || '_daysLeft';
      var dir = (sort && sort.dir) || 'asc';
      list = U.sortBy(list, function (a, b) {
        var va, vb;
        if (key === 'status') { va = SRANK[a.status]; vb = SRANK[b.status]; }
        else if (key === '_daysLeft') { va = (a._daysLeft == null ? 9999 : a._daysLeft); vb = (b._daysLeft == null ? 9999 : b._daysLeft); }
        else { va = a[key]; vb = b[key]; }
        if (va == null) va = ''; if (vb == null) vb = '';
        if (va < vb) return -1; if (va > vb) return 1; return 0;
      });
      if (dir === 'desc') list = list.slice().reverse();

      if (!list.length) {
        body.appendChild(SD.comp.state.build('empty', {
          title: all.length ? '这一类没有记录' : '还没有特种设备人员台账',
          desc: all.length
            ? (f.q ? '没有匹配「' + f.q + '」的人员，换个关键词或清空搜索。' : '换个筛选条件看看。')
            : '点上方「导入 Excel」把现有名单批量导进来（可先下载模板），也可以逐条新增；导入后按证书有效期自动预警。',
          action: all.length ? null : { text: '导入 Excel', onClick: function () { impBtn.click(); } }
        }));
        return;
      }

      body.appendChild(SD.comp.table.build({
        columns: [
          {
            key: 'name', title: '姓名', sortable: true,
            render: function (r) {
              var n = (r.photos || []).length;
              return '<span class="b js-dpname" data-id="' + r.id + '" ' +
                  'title="' + (n ? '点击查看证书照片（' + n + ' 张）' : '还没上传证书照片') + '">' +
                U.esc(r.name) + '</span>' +
                '<div class="cell-sub">' + (r.empNo ? '工号 ' + U.esc(r.empNo) : '') + '</div>';
            }
          },
          { key: 'dept', title: '部门', sortable: true, render: function (r) { return U.esc(r.dept); } },
          { key: 'post', title: '岗位', sortable: true, render: function (r) { return U.esc(r.post || '—'); } },
          { key: 'certType', title: '证书类型', sortable: true, render: function (r) { return '<span class="num">' + U.esc(r.certType) + '</span>'; } },
          {
            key: 'idNo', title: '证件编号', sortable: true,
            render: function (r) {
              var t = r.note ? (' title="备注：' + U.esc(r.note) + '"') : '';
              return '<span class="num t-sm"' + t + '>' + U.esc(r.idNo) + '</span>';
            }
          },
          { key: 'phone', title: '联系方式', sortable: true, render: function (r) { return '<span class="num">' + U.esc(r.phone || '—') + '</span>'; } },
          { key: 'validTo', title: '有效期至', sortable: true, render: function (r) { return '<span class="num">' + U.esc(r.validTo) + '</span>'; } },
          {
            key: 'status', title: '证书状态', sortable: true,
            render: function (r) {
              var d = r._daysLeft;
              var tag = '';
              if (d != null) {
                var over = d < 0;
                tag = '<span class="days-tag' + (over ? ' danger' : '') + '">' +
                  (over ? '过期 ' + (-d) + ' 天' : '剩 ' + d + ' 天') + '</span>';
              }
              return '<span class="badge ' + r._statusCls + '">' + r._statusName + '</span>' + tag;
            }
          },
          {
            key: '_ops', title: '操作', align: 'right',
            render: function (r) {
              return '<div class="cell-actions">' + SD.comp.dropdown.opsButton('dops', r.id) + '</div>';
            }
          }
        ],
        rows: list, minWidth: 980,
        sort: { key: sort.key, dir: sort.dir },
        onSort: function (k, d) { sort.key = k; sort.dir = d; redraw(); },
        rowClass: function (r) { return r._daysLeft != null && r._daysLeft < 0 ? 'row-danger' : ''; }
      }));

      /* 点姓名 → 看证书照片 */
      U.on(body, 'click', '.js-dpname', function (e, el) {
        var r = (SD.app.state.summary.devicePersonnel || []).filter(function (x) { return x.id === el.dataset.id; })[0];
        if (!r) return;
        if (!(r.photos || []).length) { U.toast('「' + r.name + '」还没上传证书照片，可在编辑里添加'); return; }
        SD.comp.lightbox.open(r.photos, 0, { title: r.name + ' · ' + r.certType });
      });

      /* 行内「操作 ▾」 */
      U.on(body, 'click', '[data-act="dops"]', function (e, el) {
        var id = el.dataset.id;
        var r = all.filter(function (x) { return x.id === id; })[0];
        if (!r) return;
        SD.comp.dropdown.open({
          anchor: el,
          items: [
            { act: 'edit', text: '编辑' },
            { act: 'del', text: '删除', danger: true }
          ],
          onPick: function (it) {
            var cur = (SD.app.state.summary.devicePersonnel || []).filter(function (x) { return x.id === id; })[0] || r;
            if (it.act === 'edit') openForm(ctx, cur);
            else if (it.act === 'del') remove(ctx, cur);
          }
        });
      });
    }

    redraw();
  }

  return { name: '特种设备人员', sub: sub, render: render, XIO: XIO };
})();
