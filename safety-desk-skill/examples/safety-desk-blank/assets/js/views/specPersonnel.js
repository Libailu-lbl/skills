/* =========================================================
   views/specPersonnel.js — 特种作业人员台账（模块 8·a）
   ────────────────────────────────────────────────────────
   · 字段见 data/schema.md 第 8 节（specialPersonnel）
   · 资质四态：有效 / 待复审 / 已过期 / 停用（停用不计入预警但台账保留）
   · 按有效期复用证书预警口径（certLevel）：已过期(红) / ≤30(橙) / ≤90(黄)
   · 增 / 改 / 删 与培训证书模块一致，共用 formDialog
   ========================================================= */
window.SD = window.SD || {};
SD.views = SD.views || {};

SD.views.specPersonnel = (function () {
  var U = SD.utils;

  var CHIPS = [
    { v: 'all',          n: '全部' },
    { v: 'valid',        n: '有效' },
    { v: 'pending_review', n: '待复审' },
    { v: 'expired',      n: '已过期' },
    { v: 'suspended',    n: '停用' }
  ];

  function sub(s) {
    if (!s) return '';
    var p = s.specialPersonnelSummary;
    return '在册 ' + p.total + ' 人 · 待复审 ' + p.pending_review + ' · 已过期 ' + p.expired + ' · 停用 ' + p.suspended;
  }

  var FIELDS = [
    SD.code.field('special'),             /* 人员编号：必填，手动填写 */
    { name: 'name', label: '姓名', type: 'text', required: true },
    { name: 'dept', label: '所属部门', type: 'text', required: true, placeholder: '例：生产一部' },
    { name: 'category', label: '作业类别', type: 'select', required: true, options: function () { return SD.dict.DICT.specialCategory; } },
    { name: 'operation', label: '操作项目', type: 'text', required: true, placeholder: '例：低压电工作业' },
    { name: 'certNo', label: '证书编号', type: 'text', required: true },
    { name: 'issuer', label: '发证机关', type: 'text', placeholder: '例：市应急管理局' },
    { name: 'validFrom', label: '有效期起', type: 'date', required: true },
    { name: 'validTo', label: '有效期止', type: 'date', required: true, help: '预警与复审判定依据' },
    { name: 'reviewDate', label: '复审日期', type: 'date', required: true, help: '到期前须完成复审换证' },
    { name: 'status', label: '资质状态', type: 'select', required: true, options: function () { return SD.dict.DICT.specialStatus; }, def: 'valid' },
    {
      name: 'photos', label: '证件照', type: 'photos', full: true, max: 3,
      help: '最多 3 张（证件正反面 / 人像）；台账里点「姓名」可看大图，' +
            '作业票照片打印时会自动把证件照排在第一张'
    }
  ];

  function resolve(r) {
    return FIELDS.map(function (f) {
      var g = (typeof f.options === 'function') ? Object.assign({}, f, { options: f.options() }) : f;
      if (g.type === 'code') g = Object.assign({}, g, { selfId: r ? r.id : null });
      return g;
    });
  }

  /* ---------------- 证件图片识别（可选增强，2026-10-24） ----------------
     点「识别图片」→ 取表单里的第一张证件照 → 交给公司 OCR 接口 → 本地解析 → 直接填表。
     识别引擎必须来自接口（纯离线页面没有 OCR），地址在 config.js 的 SD.CONFIG.ocr；
     没配接口时点击会给明确指引，不做「点了没反应」的假按钮。
     解析规则在 components/ocr.js（本地纯规则、断网可用）。 */

  /* 识别结果 → 表单字段（顺序即填写顺序）；第二项是控件类型 */
  var OCR_FIELDS = [
    ['name', 'text'], ['dept', 'text'], ['category', 'select'], ['operation', 'text'],
    ['certNo', 'text'], ['issuer', 'text'], ['validFrom', 'date'], ['validTo', 'date'],
    ['reviewDate', 'date']
  ];

  /** 把解析结果写进表单：只写识别到的键；select 先确认选项存在（防写入非法值） */
  function fillForm(modal, got) {
    var filled = 0;
    OCR_FIELDS.forEach(function (it) {
      var key = it[0], v = got[key];
      if (v == null || v === '') return;
      var el = modal.querySelector('#ff_' + key);
      if (!el) return;
      if (it[1] === 'select') {
        var hit = Array.prototype.some.call(el.options, function (o) { return o.value === v; });
        if (!hit) return;
      }
      el.value = v;
      filled++;
    });
    return filled;
  }

  /** 弹窗顶部挂一条识别工具条（含本机服务状态 + 一键启动） */
  function mountOcrBar(modal) {
    var body = modal.querySelector('.modal-body');
    if (!body) return;
    var bar = U.h(
      '<div class="ocr-bar">' +
        '<button type="button" class="btn sm js-ocr">' + SD.icons.get('search', 14) + ' 识别图片</button>' +
        '<span class="ocr-state js-ocr-state" data-state="checking"><i class="dot"></i><span class="txt">检测识别服务…</span></span>' +
        '<button type="button" class="btn ghost sm js-ocr-start" hidden>启动服务</button>' +
        '<span class="ocr-tip js-ocr-tip">读「证件照」里的第一张，自动填入下方各项（识别后请核对）</span>' +
      '</div>'
    );
    body.insertBefore(bar, body.firstChild);

    var btn = bar.querySelector('.js-ocr');
    var startBtn = bar.querySelector('.js-ocr-start');
    var stateEl = bar.querySelector('.js-ocr-state');
    var stateTxt = stateEl.querySelector('.txt');
    var tip = bar.querySelector('.js-ocr-tip');
    var btnHtml = btn.innerHTML;

    function setState(kind, text, showStart) {
      stateEl.dataset.state = kind;
      stateTxt.textContent = text;
      startBtn.hidden = !showStart;
    }

    /* 探活：本机服务显示在线 / 未启动；公司外网接口不探活，只显示「公司识别接口」 */
    function refreshState() {
      if (!SD.comp.ocr.ready()) { setState('off', '未配置识别接口', false); return Promise.resolve(false); }
      if (!SD.comp.ocr.isLocal()) { setState('remote', '公司识别接口', false); return Promise.resolve(true); }
      setState('checking', '检测识别服务…', false);
      return SD.comp.ocr.health().then(function (h) {
        if (h.ok) { setState('on', '识别服务在线', false); return true; }
        setState('off', '识别服务未启动', true);
        return false;
      });
    }

    /* 确认识别服务可用：本机没起就地拉起（一键启动）；公司接口直接放行
       ★ 协议必须在**点击的同步栈**里触发，否则 Chrome 会静默拦截外部协议 */
    function ensureService() {
      if (!SD.comp.ocr.isLocal()) return Promise.resolve();

      function waiting() {
        setState('starting', '正在启动识别服务…', false);
        tip.textContent = '正在拉起本机识别服务（浏览器若弹「打开…」确认，选“打开”即可）…';
        return SD.comp.ocr.startLocal({ skipLaunch: true }).then(function (r) {
          setState('on', '识别服务在线', false);
          tip.textContent = r.already
            ? '识别服务已就绪，继续识别…'
            : '识别服务已启动（' + (Math.round((r.ms || 0) / 100) / 10) + 's），继续识别…';
        }, function (e) {
          setState('off', '识别服务未启动', true);
          throw e;
        });
      }

      // 已知未启动：立刻拉协议（同步），再轮询
      if (stateEl.dataset.state === 'off') {
        SD.comp.ocr.launch();
        return waiting();
      }
      return SD.comp.ocr.health().then(function (h) {
        if (h.ok) { setState('on', '识别服务在线', false); return; }
        SD.comp.ocr.launch();
        return waiting();
      });
    }

    btn.addEventListener('click', function () {
      // 1) 先要有一张证件照
      var box = modal.querySelector('#ff_photos');
      var ph = box && box._ph;
      var list = (ph && ph.get()) || [];
      if (!list.length) {
        U.toast('请先在「证件照」里添加一张证件图片，再点识别', 'err');
        if (box && box.scrollIntoView) box.scrollIntoView({ block: 'center' });
        return;
      }
      // 2) 再要配好识别接口
      if (!SD.comp.ocr.ready()) {
        U.toast('未配置识别接口：请在 assets/js/config.js 的 SD.CONFIG.ocr.endpoint 填入公司 OCR 地址', 'err');
        tip.textContent = '识别接口未配置（config.js → SD.CONFIG.ocr.endpoint），配好后这里就能一键识别';
        return;
      }
      // 3) 本机服务没起就先拉起来 → 识别 → 解析 → 直接填表
      btn.disabled = true;
      btn.innerHTML = '识别中…';
      tip.textContent = '正在准备识别服务…';
      ensureService().then(function () {
        tip.textContent = '正在识别证件照…';
        return SD.comp.ocr.recognize(list[0]);
      }).then(function (text) {
        var got = SD.comp.ocr.parse(text);
        var n = fillForm(modal, got);
        if (n) {
          U.toast('已识别并填入 ' + n + ' 项，请逐项核对', 'ok');
          tip.textContent = '已填入 ' + n + ' 项：' + Object.keys(got).join(' / ') + '（均可手工修改）';
        } else {
          U.toast('识别到文字，但没匹配到台账字段', 'err');
          tip.textContent = '没匹配到字段：可能是图片不清晰或版式不同，可换一张正面清晰照再试';
        }
      }, function (e) {
        U.toast((e && e.message) || '识别失败', 'err');
        tip.textContent = '识别失败：' + ((e && e.message) || '未知错误');
      }).then(function () {
        btn.disabled = false;
        btn.innerHTML = btnHtml;
      });
    });

    /* 「启动服务」按钮：只拉起服务，不强制识别（想先确认服务在跑时用） */
    startBtn.addEventListener('click', function () {
      startBtn.disabled = true;
      startBtn.textContent = '启动中…';
      setState('starting', '正在启动识别服务…', false);
      tip.textContent = '正在拉起本机识别服务（浏览器若弹「打开…」确认，选“打开”即可）…';
      // 先在点击同步栈里拉协议，再轮询（顺序不能反，反了 Chrome 会拦）
      SD.comp.ocr.launch();
      SD.comp.ocr.startLocal({ skipLaunch: true }).then(function (r) {
        U.toast(r.already ? '识别服务已在运行' : '识别服务已启动', 'ok');
        setState('on', '识别服务在线', false);
        tip.textContent = '识别服务已就绪，点「识别图片」开始识别';
      }, function (e) {
        U.toast((e && e.message) || '启动失败', 'err');
        setState('off', '识别服务未启动', true);
        tip.textContent = (e && e.message) || '启动失败';
      }).then(function () {
        startBtn.disabled = false;
        startBtn.textContent = '启动服务';
      });
    });

    refreshState();
  }

  function openForm(ctx, r) {
    var isEdit = !!r;
    SD.comp.formDialog.open({
      title: isEdit ? '编辑人员资质' : '新增特种作业人员',
      width: 640,
      fields: resolve(r),
      values: r || {},
      validate: function (v) {
        if (v.validTo && v.validFrom && v.validTo < v.validFrom) return '有效期止不能早于有效期起';
        if (v.reviewDate && v.validTo && v.reviewDate > v.validTo) return '复审日期不能晚于有效期止';
        return null;
      },
      onMount: function (modal) {
        // 证件图片识别工具条（识别结果直接填入下列字段）
        mountOcrBar(modal);
      },
      onSubmit: function (v) {
        var payload = {
          code: v.code,
          name: v.name, dept: v.dept, category: v.category, operation: v.operation,
          certNo: v.certNo, issuer: v.issuer || '', validFrom: v.validFrom,
          validTo: v.validTo, reviewDate: v.reviewDate, status: v.status || 'valid',
          photos: v.photos || []
        };
        return (isEdit ? SD.api.updateSpecialPersonnel(r.id, payload) : SD.api.createSpecialPersonnel(payload))
          .then(function () { U.toast(isEdit ? '已更新' : '已新增特种作业人员', 'ok'); ctx.reload(); });
      }
    });
  }

  function remove(ctx, r) {
    SD.comp.dialog.confirm({
      title: '删除人员记录',
      message: '将删除「' + r.name + '」的特种作业资质「' + r.operation + '」（' + r.certNo + '）。',
      okText: '确认删除', danger: true,
      onOk: function () {
        return SD.api.removeSpecialPersonnel(r.id).then(function () { U.toast('已删除', 'ok'); ctx.reload(); });
      }
    });
  }

  function render(host, ctx) {
    var s = ctx.summary;
    if (!SD.auth.can('special.view')) return;
    U.clear(host);

    var f = (ctx.state.filters.specPersonnel = ctx.state.filters.specPersonnel || {});
    if (!f.status) f.status = 'all';
    if (f.q == null) f.q = '';
    var sort = (ctx.state.sort.specPersonnel = ctx.state.sort.specPersonnel || { key: '_daysLeft', dir: 'asc' });

    /* ---------- 指标卡 ---------- */
    var p = s.specialPersonnelSummary;
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
      var n = k.v === 'all' ? s.specialPersonnel.length : (p[k.v] || 0);
      var chip = U.h('<button class="chip' + (f.status === k.v ? ' on' : '') + '">' + U.esc(k.n) + ' ' + n + '</button>');
      chip.addEventListener('click', function () {
        f.status = k.v;
        Array.prototype.forEach.call(cg.children, function (el, i) { el.classList.toggle('on', CHIPS[i].v === k.v); });
        redraw();
      });
      cg.appendChild(chip);
    });
    var spacer = bar.querySelector('.spacer');
    // 搜索（姓名 / 编号 / 证书号 / 部门 / 类别 / 项目）
    var q = U.h('<input class="input" placeholder="搜姓名 / 编号 / 证书号" style="width:190px" data-keep-focus="personnel">');
    q.value = f.q || '';
    q.addEventListener('input', U.debounce(function () { f.q = q.value; redraw(); }, 250));
    spacer.appendChild(q);
    var addBtn = U.h('<button class="btn sm primary">' + SD.icons.get('plus', 14) + '新增人员</button>');
    addBtn.addEventListener('click', function () { openForm(ctx, null); });
    spacer.appendChild(addBtn);
    host.appendChild(bar);

    /* ---------- 表格 ---------- */
    /* 列表容器（card）只建一次；搜索 / 排序 / 筛选只重绘 body，不重建筛选条 ——
       否则输入框会被销毁重建，连续打字与输入法都会被打断。 */
    var card = U.h('<section class="card"><div class="card-head">' +
      '<div><h3>特种作业人员台账</h3><div class="sub">按资质剩余天数升序，最急的在最上面</div></div></div>' +
      '<div class="js-body"></div></section>');
    var body = card.querySelector('.js-body');
    host.appendChild(card);

    function redraw() {
    U.clear(body);
    var list = s.specialPersonnel.filter(function (x) { return f.status === 'all' || x.status === f.status; });
    if (f.q) {
      var kw = String(f.q).toLowerCase();
      list = list.filter(function (x) {
        return (x.name + ' ' + x.code + ' ' + x.certNo + ' ' + x.dept + ' ' + x.category + ' ' + x.operation)
          .toLowerCase().indexOf(kw) >= 0;
      });
    }
    // 排序：默认按资质剩余天数升序（最急的在最上面）；点表头可切换
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
        title: s.specialPersonnel.length ? '这一类没有记录' : '还没有特种作业人员台账',
        desc: s.specialPersonnel.length
          ? (f.q ? '没有匹配「' + f.q + '」的人员，换个关键词或清空搜索。' : '换个筛选条件看看。')
          : '新增第一位特种作业人员后，这里会按资质有效期自动预警。',
        action: s.specialPersonnel.length ? null : { text: '新增第一位', onClick: function () { openForm(ctx, null); } }
      }));
    } else {
      body.appendChild(SD.comp.table.build({
        columns: [
          {
            /* 证件照不再单列：姓名保持普通样式（不变色、不加角标），直接点姓名看大图 */
            key: 'name', title: '姓名', sortable: true,
            render: function (r) {
              var n = (r.photos || []).length;
              return '<span class="b js-pname" data-id="' + r.id + '" ' +
                  'title="' + (n ? '点击查看证件照（' + n + ' 张）' : '还没上传证件照') + '">' +
                U.esc(r.name) +
              '</span>';
            }
          },
          { key: 'dept', title: '部门', sortable: true, render: function (r) { return U.esc(r.dept); } },
          { key: 'category', title: '作业类别', sortable: true, render: function (r) { return U.esc(r.category); } },
          { key: 'operation', title: '操作项目', sortable: true, render: function (r) { return U.esc(r.operation); } },
          {
            /* 发证机关不再单列：放在证书编号的悬停提示里，需要核对时还能查到 */
            key: 'certNo', title: '证书编号', sortable: true,
            render: function (r) {
              var t = r.issuer ? (' title="发证机关：' + U.esc(r.issuer) + '"') : '';
              return '<span class="num t-sm"' + t + '>' + U.esc(r.certNo) + '</span>';
            }
          },
          { key: 'validTo', title: '有效期止', sortable: true, render: function (r) { return '<span class="num">' + U.esc(r.validTo) + '</span>'; } },
          {
            /* 剩余天数不再单列：作为角标跟在资质状态后面（过期标红） */
            key: 'status', title: '资质状态', sortable: true,
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
              return '<div class="cell-actions">' + SD.comp.dropdown.opsButton('sops', r.id) + '</div>';
            }
          }
        ],
        rows: list, minWidth: 880,
        sort: { key: sort.key, dir: sort.dir },
        onSort: function (k, d) { sort.key = k; sort.dir = d; redraw(); },
        rowClass: function (r) { return r._daysLeft != null && r._daysLeft < 0 ? 'row-danger' : ''; }
      }));
      /* 点姓名 → 看证件照大图（数据取最新 summary，防别处改过拿到旧对象） */
      U.on(body, 'click', '.js-pname', function (e, el) {
        var r = SD.app.state.summary.specialPersonnel.filter(function (x) { return x.id === el.dataset.id; })[0];
        if (!r) return;
        if (!(r.photos || []).length) { U.toast('「' + r.name + '」还没上传证件照，可在编辑里添加'); return; }
        SD.comp.lightbox.open(r.photos, 0, { title: r.name + ' · ' + r.operation });
      });
      /* 行内「操作 ▾」下拉 */
      U.on(body, 'click', '[data-act="sops"]', function (e, el) {
        var id = el.dataset.id;
        var r = s.specialPersonnel.filter(function (x) { return x.id === id; })[0];
        if (!r) return;
        SD.comp.dropdown.open({
          anchor: el,
          items: [
            { act: 'edit', text: '编辑' },
            { act: 'del', text: '删除', danger: true }
          ],
          onPick: function (it) {
            var cur = SD.app.state.summary.specialPersonnel.filter(function (x) { return x.id === id; })[0] || r;
            if (it.act === 'edit') openForm(ctx, cur);
            else if (it.act === 'del') remove(ctx, cur);
          }
        });
      });
    }
    }

    redraw();
  }

  return { name: '特种作业人员', sub: sub, render: render };
})();
