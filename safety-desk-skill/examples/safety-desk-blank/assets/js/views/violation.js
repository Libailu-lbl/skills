/* =========================================================
   views/violation.js — 安全违章考核单（★ 2026-11-04 新增，模块 ⑩）
   ────────────────────────────────────────────────────────
   · 一张单 = 一次现场违章：申请人登记 → 记违章员工 / 工号 / 部门 / 部门负责人 / 违章内容
   · 考核情况（★ 2026-11-05）：处罚 / 保证书 / 其它，可多选；勾「其它」后手写补充说明
   · 支持现场照片（最多 6 张）：编辑表单里插入，**列表点「编号」即可看大图**
   · 编号按 FZKH-001（`config.codeRules.violation`，3 位、不带年份、同类型内唯一）
   · 列表**默认展示全年**（今年 01-01 ~ 12-31），可切年份、也可自定起止日期做区间筛选
   · 年份 / 区间只是**视图过滤**：不写库、不改数据，导航摘要与其它模块口径不受影响
   ========================================================= */
window.SD = window.SD || {};
SD.views = SD.views || {};

SD.views.violation = (function () {
  var U = SD.utils;

  /* ---------------- 考核情况（★ 2026-11-05） ----------------
     三个固定选项，可多选；「其它」需要手写补充。
     存的是 { picks: ['处罚','其它'], other: '口头教育' } —— picks 与 other 分开，
     这样「其它」里写的内容不会被当成选项参与统计。 */
  var ASSESS_OPTIONS = ['处罚', '保证书', '其它'];
  var OTHER_OPT = '其它';

  /** 归一成 {picks:[], other:''}；兼容老的纯数组写法与 undefined */
  function assessOf(v) {
    if (!v) return { picks: [], other: '' };
    if (Array.isArray(v)) return { picks: v.map(String), other: '' };
    return {
      picks: Array.isArray(v.picks) ? v.picks.map(String) : [],
      other: String(v.other == null ? '' : v.other)
    };
  }

  /** 用于搜索与 title 的纯文本，如「处罚 其它：口头教育」 */
  function assessText(v) {
    var a = assessOf(v);
    return a.picks.map(function (p) {
      return (p === OTHER_OPT && a.other) ? (p + '：' + a.other) : p;
    }).join(' ');
  }

  /** 列表展示：每个选项一个小标签；「其它」带出手写内容 */
  function assessHtml(v) {
    var a = assessOf(v);
    if (!a.picks.length) return '<span class="t-3">—</span>';
    return '<div class="tags tags-gap">' + a.picks.map(function (p) {
      var txt = (p === OTHER_OPT && a.other) ? (p + '：' + a.other) : p;
      var cls = p === '处罚' ? 'b-danger' : (p === '保证书' ? 'b-info' : 'b-mute');
      var short = txt.length > 16 ? txt.slice(0, 16) + '…' : txt;
      return '<span class="tag ' + cls + '" title="' + U.esc(txt) + '">' + U.esc(short) + '</span>';
    }).join('') + '</div>';
  }

  /* ---------------- 字段定义（新增 / 编辑共用） ----------------
     与 data/schema.md 的 §9.6 violations 一节一一对应。 */
  var FIELDS = [
    SD.code.field('violation'),           /* 考核单编号：默认顺延填入，可手改 */
    { name: 'date', label: '违章日期', type: 'date', required: true,
      def: function () { return U.today(); },
      help: '按这一天的月份 / 年份归口，列表的「全年 / 时间范围」筛选就看它' },
    { name: 'applicant', label: '申请人', type: 'text', required: true,
      placeholder: '例：王安全' },
    { name: 'employee', label: '违章员工', type: 'text', required: true,
      placeholder: '例：王志强' },
    { name: 'empNo', label: '工号', type: 'text', required: true,
      placeholder: '例：MJ1023' },
    { name: 'dept', label: '部门', type: 'text', required: true,
      placeholder: '例：发泡车间' },
    { name: 'leader', label: '部门负责人', type: 'text', required: true,
      placeholder: '例：孙浩' },
    { name: 'content', label: '违章内容', type: 'textarea', required: true, full: true, rows: 3,
      placeholder: '写清违章时间、地点、具体行为，以及违反的规定 / 条款' },
    /* 考核情况（★ 2026-11-05 新增）：处罚 / 保证书 / 其它，可多选；勾「其它」后手写补充。
       值结构 { picks: ['处罚','其它'], other: '口头教育 + 停工培训半天' }，
       picks 与 other 分开存，所以「其它」里写什么都不会被当成新选项。 */
    {
      name: 'assessment', label: '考核情况', type: 'checks', full: true,
      options: ASSESS_OPTIONS, otherText: OTHER_OPT,
      otherPlaceholder: '例：口头教育 + 停工培训半天（勾「其它」后在这里写明）',
      def: function () { return { picks: [], other: '' }; },
      help: '可多选：处罚 / 保证书 / 其它；勾「其它」后需写明具体考核方式（不填则保存时提示）'
    },
    {
      name: 'photos', label: '现场照片', type: 'photos', full: true, max: 6,
      help: '最多 6 张，可一次多选；自动压到 1000px，存进考核单。台账里点「编号」就能看大图'
    },
    { name: 'remark', label: '备注', type: 'textarea', full: true, rows: 2,
      placeholder: '处理跟进、整改情况等（可空）' }
  ];

  /** options 支持函数（打开弹窗时才求值）；编号字段编辑时带 selfId 排除自己 */
  function resolve(fields, t) {
    return fields.map(function (f) {
      var g = (typeof f.options === 'function') ? Object.assign({}, f, { options: f.options() }) : f;
      if (g.type === 'code') g = Object.assign({}, g, { selfId: t ? t.id : null });
      return g;
    });
  }

  function sub(s) {
    if (!s) return '';
    var arr = s.violations || [];
    if (!arr.length) return '按 FZKH-001 编号；默认展示全年，可按时间范围筛选';
    var last = arr.slice().sort(function (a, b) { return String(b.date) > String(a.date) ? 1 : -1; })[0];
    return '共 ' + arr.length + ' 条 · 最近 ' + (last.date || '—') + ' ' + (last.employee || '');
  }

  /* ---------------- 日期 / 区间口径 ---------------- */
  function curYear(s) {
    return SD.comp.yearBar.yearOf(s && s.today) || String(new Date().getFullYear());
  }

  /** 一条记录的日期（'YYYY-MM-DD'）；缺 date 的老数据回退 createdAt，都没有返回 '' */
  function dayOf(r) {
    var d = String((r && r.date) || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    var c = String((r && r.createdAt) || '').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(c) ? c : '';
  }

  function isDay(v) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v == null ? '' : v)); }

  /** 区间过滤：from ≤ 日期 ≤ to；没有日期的记录不因区间被藏起来（字符串比较即日期比较） */
  function inRange(r, from, to) {
    var d = dayOf(r);
    if (!d) return true;
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  }

  function yearRange(y) { return { from: y + '-01-01', to: y + '-12-31' }; }

  /* ---------------- 新增 / 编辑 / 删除 ---------------- */
  function openForm(ctx, t) {
    if (!SD.auth.can('data.write')) {
      U.toast('受限模式：录入需要安全员权限（点右上角解锁）', 'err');
      return;
    }
    var isEdit = !!t;
    SD.comp.formDialog.open({
      title: isEdit ? '编辑安全违章考核单' : '新增安全违章考核单',
      width: 640,
      fields: resolve(FIELDS, t),
      values: t || {},
      onSubmit: function (v) {
        var now = U.today() + ' ' + new Date().toTimeString().slice(0, 5);
        var payload = {
          code: v.code,
          date: v.date,
          applicant: v.applicant || '',
          employee: v.employee || '',
          empNo: v.empNo || '',
          dept: v.dept || '',
          leader: v.leader || '',
          content: v.content || '',
          assessment: assessOf(v.assessment),
          photos: v.photos || [],
          remark: v.remark || '',
          updatedAt: now
        };
        return (isEdit
          ? SD.api.updateViolation(t.id, payload)
          : SD.api.createViolation(Object.assign({ createdAt: now }, payload))
        ).then(function () {
          U.toast(isEdit ? '考核单已更新' : '考核单已新增', 'ok');
          ctx.reload();
        });
      }
    });
  }

  function remove(ctx, r) {
    if (!SD.auth.can('data.write')) {
      U.toast('受限模式：删除需要安全员权限（点右上角解锁）', 'err');
      return;
    }
    SD.comp.dialog.confirm({
      title: '删除违章考核单',
      message: '将删除 ' + r.code + '（' + r.employee + ' · ' + r.date + '）。删除后不可恢复。',
      okText: '确认删除', danger: true,
      onOk: function () {
        return SD.api.removeViolation(r.id).then(function () {
          U.toast('已删除', 'ok');
          ctx.reload();
        });
      }
    });
  }

  /* ---------------- 主渲染 ---------------- */
  function render(host, ctx) {
    var s = ctx.summary;
    var all = s.violations || [];
    var f = (ctx.state.filters.violation = ctx.state.filters.violation || {});
    if (f.q == null) f.q = '';

    var CY = curYear(s);
    if (!SD.comp.yearBar.yearOf(f.year)) f.year = CY;
    /* 区间默认 = 所选年的**全年**（这就是「默认展示全年」）；脏值 / 缺失一律回全年 */
    var yr = yearRange(f.year);
    if (!isDay(f.from)) f.from = yr.from;
    if (!isDay(f.to)) f.to = yr.to;
    if (f.to < f.from) f.to = f.from;

    var sort = (ctx.state.sort.violation = ctx.state.sort.violation || { key: 'date', dir: 'desc' });

    U.clear(host);

    /* ---------- 筛选条：年份 + 时间范围 + 搜索 + 新增 ---------- */
    var bar = U.h('<div class="filters"></div>');

    bar.appendChild(SD.comp.yearBar.build({
      value: f.year, cur: CY,
      years: SD.comp.yearBar.yearsOf(all, ['date'], CY),
      tip: '按违章日期归年；切年份会把时间范围重置为该年全年',
      onChange: function (y) {
        var r = yearRange(y);
        f.year = y; f.from = r.from; f.to = r.to;
        ctx.refresh();
      }
    }));

    var rangeFg = U.h('<div class="fg js-vk-range"><label>时间范围</label></div>');
    var fromIn = U.h('<input class="input" type="date" style="width:150px" title="起始日期">');
    fromIn.value = f.from;
    var toIn = U.h('<input class="input" type="date" style="width:150px" title="结束日期">');
    toIn.value = f.to;
    rangeFg.appendChild(fromIn);
    rangeFg.appendChild(U.h('<span class="t-3">~</span>'));
    rangeFg.appendChild(toIn);

    fromIn.addEventListener('change', function () {
      if (!isDay(fromIn.value)) { fromIn.value = f.from; return; }
      /* 起止颠倒不静默改数：还原输入并提示，免得「改一下结束日期，年份也跟着跳走」 */
      if (fromIn.value > f.to) {
        fromIn.value = f.from;
        U.toast('起始日期不能晚于结束日期（' + f.to + '）', 'err');
        return;
      }
      f.from = fromIn.value;
      var y = SD.comp.yearBar.yearOf(f.from);
      if (y) f.year = y;                          // 年份跟着起始日期走，两者永远一致
      ctx.refresh();
    });
    toIn.addEventListener('change', function () {
      if (!isDay(toIn.value)) { toIn.value = f.to; return; }
      if (toIn.value < f.from) {
        toIn.value = f.to;
        U.toast('结束日期不能早于起始日期（' + f.from + '）', 'err');
        return;
      }
      f.to = toIn.value;
      ctx.refresh();
    });
    bar.appendChild(rangeFg);

    var fullYear = (f.from === f.year + '-01-01' && f.to === f.year + '-12-31');
    if (!fullYear) {
      var backBtn = U.h('<button type="button" class="btn sm ghost js-vk-year" title="回到 ' + f.year + ' 年全年">全年</button>');
      backBtn.addEventListener('click', function () {
        var r = yearRange(f.year);
        f.from = r.from; f.to = r.to;
        ctx.refresh();
      });
      bar.appendChild(backBtn);
    }

    bar.appendChild(U.h('<span class="spacer"></span>'));

    var q = U.h('<input class="input" placeholder="搜编号 / 员工 / 工号 / 部门 / 内容 / 考核情况" style="width:230px" data-keep-focus="violation">');
    q.value = f.q || '';
    q.addEventListener('input', U.debounce(function () { f.q = q.value; redraw(); }, 250));
    bar.appendChild(q);

    var addBtn = U.h('<button class="btn primary">' + SD.icons.get('plus', 15) + '新增考核单</button>');
    addBtn.addEventListener('click', function () { openForm(ctx, null); });
    bar.appendChild(addBtn);

    host.appendChild(bar);

    /* ---------- 列表 ---------- */
    var card = U.h('<section class="card"><div class="card-head">' +
      '<div><h3>安全违章考核单</h3><div class="sub js-vk-sub"></div></div></div>' +
      '<div class="js-vk-body"></div></section>');
    var body = card.querySelector('.js-vk-body');
    var subEl = card.querySelector('.js-vk-sub');
    host.appendChild(card);

    function redraw() {
      U.clear(body);

      var inRangeList = all.filter(function (r) { return inRange(r, f.from, f.to); });
      var list = inRangeList.slice();
      if (f.q) {
        var kw = String(f.q).toLowerCase();
        list = list.filter(function (r) {
          return (r.code + ' ' + r.employee + ' ' + r.empNo + ' ' + r.dept + ' ' +
                  r.leader + ' ' + r.applicant + ' ' + r.content + ' ' + assessText(r.assessment))
            .toLowerCase().indexOf(kw) >= 0;
        });
      }
      var key = (sort && sort.key) || 'date';
      var dir = (sort && sort.dir) || 'desc';
      list = U.sortBy(list, function (a, b) {
        var va = a[key], vb = b[key];
        if (va == null) va = ''; if (vb == null) vb = '';
        if (va < vb) return -1; if (va > vb) return 1; return 0;
      });
      if (dir === 'desc') list = list.slice().reverse();

      subEl.textContent = f.from + ' ~ ' + f.to + ' 共 ' + inRangeList.length + ' 条' +
        (all.length !== inRangeList.length ? ' · 全部 ' + all.length + ' 条' : '') +
        (f.q ? '（含关键词「' + f.q + '」）' : '');

      if (!list.length) {
        if (!all.length) {
          body.appendChild(SD.comp.state.build('empty', {
            title: '还没有违章考核单',
            desc: '点右上角「新增考核单」登记第一条：编号自动顺延（FZKH-001 起），可上传现场照片。',
            action: { text: '新增考核单', onClick: function () { openForm(ctx, null); } }
          }));
        } else if (f.q) {
          body.appendChild(SD.comp.state.build('empty', {
            title: '没有匹配的考核单',
            desc: '没有匹配「' + f.q + '」的记录，换个关键词或清空搜索。',
            action: null
          }));
        } else {
          body.appendChild(SD.comp.state.build('empty', {
            title: f.from + ' ~ ' + f.to + ' 没有考核单',
            desc: '这段时间没有违章记录。可以放宽时间范围，或回到本年全年。',
            action: fullYear ? null : {
              text: '看 ' + f.year + ' 年全年', icon: 'calendar',
              onClick: function () {
                var r = yearRange(f.year);
                f.from = r.from; f.to = r.to;
                ctx.refresh();
              }
            }
          }));
        }
        return;
      }

      body.appendChild(SD.comp.table.build({
        columns: [
          {
            key: 'code', title: '编号', sortable: true,
            render: function (r) {
              var n = (r.photos || []).length;
              return '<span class="cell-main js-vk-code num' + (n ? ' link' : '') + '" data-id="' + r.id + '" ' +
                  'title="' + (n ? '点击查看现场照片（' + n + ' 张）' : '这张考核单还没有现场照片') + '">' +
                  U.esc(r.code || '—') +
                  (n ? '<span class="hz-photo-tag">照片 ' + n + '</span>' : '') +
                '</span>';
            }
          },
          {
            key: 'date', title: '违章日期', sortable: true,
            render: function (r) { return '<span class="num">' + U.esc(dayOf(r) || '—') + '</span>'; }
          },
          {
            key: 'employee', title: '违章员工', sortable: true,
            render: function (r) {
              return U.esc(r.employee || '—') +
                (r.empNo ? '<div class="cell-sub">工号 ' + U.esc(r.empNo) + '</div>' : '');
            }
          },
          {
            key: 'dept', title: '部门', sortable: true,
            render: function (r) {
              return U.esc(r.dept || '—') +
                (r.leader ? '<div class="cell-sub">负责人 ' + U.esc(r.leader) + '</div>' : '');
            }
          },
          {
            key: 'content', title: '违章内容',
            render: function (r) {
              var t = String(r.content || '');
              var short = t.length > 42 ? t.slice(0, 42) + '…' : t;
              return '<div class="cell-main" title="' + U.esc(t) + '">' + U.esc(short || '—') + '</div>' +
                (r.remark ? '<div class="cell-sub">备注：' + U.esc(String(r.remark).slice(0, 30)) + '</div>' : '');
            }
          },
          {
            /* 考核情况（★ 2026-11-05）：处罚 / 保证书 / 其它，多选时并列成多个标签 */
            key: 'assessment', title: '考核情况',
            render: function (r) { return assessHtml(r.assessment); }
          },
          { key: 'applicant', title: '申请人', sortable: true, render: function (r) { return U.esc(r.applicant || '—'); } },
          {
            key: '_ops', title: '操作', align: 'right',
            render: function (r) { return '<div class="cell-actions">' + SD.comp.dropdown.opsButton('vops', r.id) + '</div>'; }
          }
        ],
        rows: list,
        sort: sort,
        onSort: function (k, d) { sort.key = k; sort.dir = d; redraw(); },
        minWidth: 1100
      }));

      /* 点编号 → 看现场照片（与隐患标题 / 培训名称同一套交互） */
      U.on(body, 'click', '.js-vk-code', function (e, el) {
        var r = all.filter(function (x) { return x.id === el.dataset.id; })[0];
        if (!r) return;
        var ph = r.photos || [];
        if (!ph.length) { U.toast('这张考核单还没有现场照片，编辑时可以补传'); return; }
        SD.comp.lightbox.open(ph, 0, { title: r.code + ' ' + (r.employee || '') });
      });

      /* 行内「操作 ▾」 */
      U.on(body, 'click', '[data-act="vops"]', function (e, el) {
        var id = el.dataset.id;
        var r = all.filter(function (x) { return x.id === id; })[0];
        if (!r) return;
        SD.comp.dropdown.open({
          anchor: el,
          items: [
            { act: 'open', text: '查看照片' },
            { act: 'edit', text: '编辑' },
            { act: 'del', text: '删除', danger: true }
          ],
          onPick: function (it) {
            if (it.act === 'open') {
              var ph = r.photos || [];
              if (!ph.length) { U.toast('这张考核单还没有现场照片，编辑时可以补传'); return; }
              SD.comp.lightbox.open(ph, 0, { title: r.code + ' ' + (r.employee || '') });
            } else if (it.act === 'edit') openForm(ctx, r);
            else if (it.act === 'del') remove(ctx, r);
          }
        });
      });
    }

    redraw();
  }

  /* ASSESS_OPTIONS / assessOf / assessText 对外暴露，供自检与将来导出复用 */
  return {
    name: '安全违章考核单', sub: sub, render: render, FIELDS: FIELDS,
    ASSESS_OPTIONS: ASSESS_OPTIONS, assessOf: assessOf, assessText: assessText, assessHtml: assessHtml
  };
})();
