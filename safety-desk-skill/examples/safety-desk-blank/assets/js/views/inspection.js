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
    /* 隐患类型 ★ 2026-11-10 新增：给「这次巡检发现的隐患」归类。
       用途只有一处 —— 数据看板「隐患类型分布」按它出图（按有照片的巡检任务数统计）。
       非必填：正常无异常的巡检不该被逼着编一个类型；没填的归「未分类」，
       仍然计入（因为照片已经在），保证类型分布合计 = 有隐患照片的任务数。
       ★ 2026-11-11 修：options 前置一个空值项。formDialog 的 select 在「值不匹配任何
         option」时，浏览器会默认选中第一项 → 老记录（没填类型）一打开编辑就显示「消防」，
         点保存还真的写回去，类型分布就被污染了。加空项即可从根上避免。 */
    {
      name: 'hazardType', label: '隐患类型', type: 'select',
      options: function () { return [{ v: '', n: '未分类' }].concat(SD.dict.DICT.hazardType); },
      help: '本次巡检发现的隐患属于哪一类；没发现隐患可留空。选了才会进数据看板「隐患类型分布」'
    },
    /* 隐患条数 ★ 2026-11-11 新增：**看板「隐患条数」的唯一口径**。
       以前这个数字只能从「标记完成」弹窗填，且编辑表单压根不提交它 —— 同一个数
       存在顶层与 record 两个位置，看板两个都不读，于是「巡检有隐患、看板看不见」。
       现在：表单与标记完成两个入口都能填，写入时顶层为准并同步 record 镜像。 */
    {
      name: 'hazardCount', label: '隐患条数', type: 'number', min: 0, step: 1, def: 0,
      help: '本次巡检发现几处隐患，按「条」计（与照片张数无关）。这是数据看板「隐患条数」' +
            '的唯一来源；填了条数却没拍照片，也照样计数'
    },
    /* 隐患等级 ★ 2026-11-11 新增：与隐患台账同一套管理三级（重大 / 较大 / 一般）。
       非必填 —— 没发现隐患的巡检不该被迫定级；没选的归「未定级」。
       ★ options 必须带空值项，否则未填会被浏览器回填成第一项「重大」。 */
    {
      name: 'hazardLevel', label: '隐患等级', type: 'select', def: '',
      options: function () { return [{ v: '', n: '未定级' }].concat(SD.dict.DICT.severity); },
      help: '一条任务只填一个等级；不选则整条计入「未定级」，看板等级分布里显示为灰色'
    },
    /* 隐患照片 ★ 2026-11-10 更名：原「巡查照片」→「隐患照片」。
       更名的原因：巡检拍下来的照片本质就是隐患现场证据，数据看板要按部门
       汇总「隐患照片张数」作为隐患计数口径，叫「巡查照片」会跟统计口径脱节。

       ⚠️ 存储键仍是 photos，**不要改**：
         存量巡检记录、导入的备份、跨机迁移指纹里都是 photos；
         改键名要额外做数据迁移与兼容读取，收益为零。
         显示名改这一处、统计口径在 metrics.inspectionPhotos 里统一。

       登记 / 编辑时上传，列表里点「区域」即可看大图（与隐患标题同一套交互）
       ★ 2026-10-30 起单次最多 18 张（原 6 张）；存储走 photoVault（原图外置到 IndexedDB），
         所以放宽张数不会把 localStorage 撑爆，列表与打印只读引用 */
    {
      name: 'photos', label: '隐患照片', type: 'photos', full: true, max: 18,
      help: '最多 18 张，可一次性多选；原图保存（大图自动外置，不压缩）。' +
            '张数会计入数据看板「各部门隐患照片」统计；与「隐患条数」不是同一口径（那个记条数）'
    },
    /* 整改期限 ★ 2026-11-12 新增（用户要求）：
       问题**应改完**的日期 —— 与下面「整改日期」（实际改完的那天）是两件事。
       有了它才能算「逾期未整改」与「整改及时率」，此前看板这两个指标只能看隐患台账。
       ⚠️ 非必填、**不设默认值**：留空 = 未设期限，看板单独计一格、不判逾期也不判按期。
         如果给默认值（比如今天），新表单人人有期限，"未设期限"这一格就永远不出现。 */
    {
      name: 'fixDueDate', label: '整改期限', type: 'date',
      help: '要求整改完成的日期（留空 = 未设期限，不参与逾期判定）'
    },
    /* 整改日期 ★ 2026-11-11 新增（用户要求）：
       隐患整改**完成**的日期。与「计划日期」不是一回事 —— 计划日期是打算哪天巡检，
       整改日期是问题什么时候改完的，两者没有先后约束（可以同一天，也可以隔几天）。 */
    {
      name: 'fixDate', label: '整改日期', type: 'date',
      help: '隐患整改完成的日期（没整改动作可留空）'
    },
    /* 整改照片 ★ 2026-11-11 新增（用户要求）：
       整改完成后补拍的现场照片。
       ⚠️ 与上面的「隐患照片」**分开存**（`photos` = 发现问题时 / `fixPhotos` = 整改后），
         因为两者是一条证据链的两端：整改前用来证明问题存在，整改后用来证明已经闭环。
         混在一个数组里就分不清前后，也无法各自计数。
       ⚠️ **不计入**数据看板「隐患照片」口径（`metrics.inspectionPhotos` 只读 `photos`），
         否则同一件事的照片会被数两遍，KPI 就虚高了。 */
    {
      name: 'fixPhotos', label: '整改照片', type: 'photos', full: true, max: 18,
      help: '整改完成后的现场照片（整改后），最多 18 张，原图保存。' +
            '与「隐患照片」（整改前）分开存，不计入看板「隐患照片」统计'
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

  /* ---------------- 分部门问题明细（★ 2026-11-12）----------------
     一张巡检单可登记多个部门各自的问题。设计上刻意做成「可选模式」：
       · 单部门（默认，也是全部老记录）：表单与 v1.3.5 完全一样，一个字段都不动
       · 多部门：点「按部门拆分」后把 7 个标量字段整块隐藏，改用行编辑器
     这样老用户的习惯不变、老记录的编辑路径不变，回归面也最小。

     为什么隐藏而不是删字段：`#ff_*` 是 formDialog 的取值契约，
     行内一旦出现同名 id，主表单的照片/条数就会串行；而且隐藏后
     readValues 仍能拿到值，改回单部门时不会丢。 */
  var MULTI_FIELDS = ['dept', 'hazardType', 'hazardCount', 'hazardLevel', 'photos', 'fixDueDate', 'fixDate', 'fixPhotos'];
  var LV_RANK = { major: 3, large: 2, general: 1 };

  /** 把一个标量表单值转成一条明细行（点「按部门拆分」时的第 1 行） */
  function seedRow(v) {
    return {
      dept: v.dept || '',
      content: '',
      type: v.hazardType || '',
      level: v.hazardLevel || '',
      count: Math.max(0, Number(v.hazardCount) || 0),
      photos: v.photos || [],
      fixDueDate: v.fixDueDate || '',
      fixDate: v.fixDate || '',
      fixPhotos: v.fixPhotos || []
    };
  }

  /** 明细行 → 整单汇总（顶层字段降级为镜像，统计仍只读行） */
  function summarizeRows(rows) {
    var sum = 0, level = '', dept = '', type = '', fixDate = '', fixDueDate = '';
    var photos = [], fixPhotos = [];
    rows.forEach(function (r) {
      if (!dept && r.dept) dept = r.dept;
      if (!type && r.type) type = r.type;
      if (!fixDate && r.fixDate) fixDate = r.fixDate;
      /* 期限取**最早**（最紧的那条决定整单），与「等级取最高」「部门取第一个」都不同。
         注意：这只是展示用镜像，逾期与及时率一律逐行判定 —— 最早那行可能早就按期改完了，
         拿它反推整单"已过期"会判错。 */
      if (r.fixDueDate && (!fixDueDate || r.fixDueDate < fixDueDate)) fixDueDate = r.fixDueDate;
      sum += r.count;
      if ((LV_RANK[r.level] || 0) > (LV_RANK[level] || 0)) level = r.level;
      photos = photos.concat(r.photos);
      fixPhotos = fixPhotos.concat(r.fixPhotos);
    });
    return {
      dept: dept, hazardType: type, hazardCount: sum, hazardLevel: level,
      photos: photos, fixDueDate: fixDueDate, fixDate: fixDate, fixPhotos: fixPhotos
    };
  }

  /** 明细行 → 执行记录里的「现场情况」（比一句「无异常项」有信息量） */
  function findingsOf(rows) {
    var parts = rows.filter(function (r) { return r.content; }).map(function (r) {
      return (r.dept ? r.dept + '：' : '') + r.content;
    });
    return parts.length ? parts.join('；') : '现场正常，无异常项';
  }

  /** 历史部门名（做 datalist 建议，省得每次手打还打错字） */
  function deptOptions() {
    var seen = {}, out = [];
    ((SD.app.state.summary && SD.app.state.summary.inspections) || []).forEach(function (r) {
      SD.metrics.hazardRowsOf(r).forEach(function (p) {
        var d = String(p.dept || '').trim();
        if (d && !seen[d]) { seen[d] = 1; out.push(d); }
      });
    });
    return out;
  }

  /* ---------------- 新增 / 编辑巡检任务 ---------------- */
  function openForm(ctx, t) {
    var isEdit = !!t;
    var hzN = isEdit ? SD.metrics.hazardCountOf(t) : 0;
    var fieldList = resolveFields(t);
    var editor = null;        // 多部门模式下的行编辑器
    var multiMode = false;
    var host = null, splitBar = null;

    var dlg = SD.comp.formDialog.open({
      title: isEdit ? '编辑巡检任务' : '新增巡检任务',
      width: 720,
      fields: fieldList,
      /* ★ 2026-11-11：老记录的条数可能只存在 record.hazardCount 里，
         这里必须把读出来的值注入表单 —— 否则输入框显示 0，用户只改个备注点保存，
         顶层 hazardCount 就被写成 0，历史条数被抹掉（数据损坏级）。 */
      values: isEdit ? Object.assign({}, t, { hazardCount: hzN }) : {},
      hint: isEdit ? '' : '新增后自动计入本周完成率分母',
      okText: isEdit ? '保存' : '新增',
      /* 表单级校验：单部门模式条数必须是整数；多部门模式交给行编辑器逐行校验 */
      validate: function (v) {
        if (multiMode && editor) return editor.validate() || undefined;
        if (v.hazardCount != null && v.hazardCount !== '' && Number(v.hazardCount) !== Math.floor(Number(v.hazardCount))) {
          return '「隐患条数」请填整数';
        }
      },
      onMount: function (modal) {
        var ht = modal.querySelector('#ff_hazardType');
        var anchor = ht && ht.closest ? ht.closest('.field') : null;
        host = U.h('<div class="field full"></div>');
        if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(host, anchor);
        else (modal.querySelector('.grid-form') || modal).appendChild(host);

        function fieldOf(name) {
          var el = modal.querySelector('#ff_' + name);
          return el && el.closest ? el.closest('.field') : null;
        }

        function hideScalars(on) {
          MULTI_FIELDS.forEach(function (n) {
            var f = fieldOf(n);
            if (f) f.style.display = on ? 'none' : '';
          });
        }

        function showSplitBar() {
          splitBar = U.h('<div class="pr-splitbar">' +
            '<button type="button" class="btn sm ghost js-split">' +
              SD.icons.get('plus', 14) + '按部门拆分（一单记录多个部门）</button>' +
            '<span class="t-3 t-sm">一趟巡检走了几个部门、各有各的问题时才用；' +
            '单个部门照常填下面的「隐患条数 / 照片」即可</span></div>');
          host.innerHTML = '';
          host.appendChild(splitBar);
          splitBar.querySelector('.js-split').addEventListener('click', function () {
            /* 用**当前表单值**（不是 t）灌第 1 行，否则用户刚改的条数会丢 */
            var cur = SD.comp.formDialog.readValues(modal, fieldList, t);
            enterMulti([seedRow(cur)]);
          });
        }

        function enterMulti(rows) {
          multiMode = true;
          editor = null;
          host.innerHTML = '';
          var backBtn = U.h('<button type="button" class="btn sm ghost js-unsplit" ' +
            'title="回到单部门表单：整单的条数 / 等级 / 照片 / 整改由明细自动汇总">取消拆分</button>');
          backBtn.addEventListener('click', exitMulti);
          /* 组件内部若抛错，dialog 的 onMount 异常会被静默吞掉（表现是按钮没反应），
             所以这里兜一层并明确告知 */
          try {
            editor = SD.comp.problemRows.mount(host, {
              value: rows, depts: deptOptions(), actions: [backBtn]
            });
          } catch (err) {
            multiMode = false;
            showSplitBar();
            U.toast('明细录入区加载失败，已退回单部门模式', 'err');
            return;
          }
          hideScalars(true);
        }

        /* 取消拆分：把第 1 行回填到标量字段（不让已填的内容凭空消失），再恢复原表单 */
        function exitMulti() {
          var rows = editor ? editor.get() : [];
          if (rows.length) {
            var s = summarizeRows(rows);
            var setV = function (id, val) {
              var el = modal.querySelector('#ff_' + id);
              if (el) el.value = val == null ? '' : val;
            };
            setV('dept', s.dept); setV('hazardType', s.hazardType);
            setV('hazardCount', s.hazardCount); setV('hazardLevel', s.hazardLevel);
            setV('fixDueDate', s.fixDueDate);
            setV('fixDate', s.fixDate);
            var ph = modal.querySelector('#ff_photos');
            if (ph && ph._ph) ph._ph.set(s.photos || []);
            var fp = modal.querySelector('#ff_fixPhotos');
            if (fp && fp._ph) fp._ph.set(s.fixPhotos || []);
          }
          multiMode = false;
          editor = null;
          hideScalars(false);
          showSplitBar();
        }

        /* 已有明细的记录（多部门单）打开即进多部门模式；老记录仍走单部门表单 */
        var existRows = (isEdit && SD.metrics.hazardRowsOf(t)) || [];
        var hasProblems = !!(isEdit && t.problems && t.problems.length);
        if (hasProblems) enterMulti(existRows);
        else showSplitBar();
      },
      onSubmit: function (v) {
        var status = v.status || 'planned';
        var rows = (multiMode && editor) ? editor.get() : null;
        var payload;

        if (rows) {
          var s = summarizeRows(rows);
          payload = {
            code: v.code,
            planName: v.planName, type: v.type, area: v.area,
            dept: s.dept, executor: v.executor,
            scheduledDate: v.scheduledDate, remark: v.remark || '',
            hazardType: s.hazardType,
            hazardCount: s.hazardCount,
            hazardLevel: s.hazardLevel,
            fixDueDate: s.fixDueDate,
            fixDate: s.fixDate,
            fixPhotos: s.fixPhotos,
            status: status,
            photos: s.photos,
            /* ★ 唯一真值；顶层 7 个字段只是镜像 */
            problems: rows
          };
          if (status === 'done') {
            payload.completedAt = (isEdit && t.completedAt) || SD.utils.today();
            payload.record = {
              findings: findingsOf(rows),
              hazardCount: s.hazardCount,
              signedBy: payload.executor,
              signedAt: payload.completedAt
            };
          }
        } else {
          payload = {
            code: v.code,
            planName: v.planName, type: v.type, area: v.area,
            dept: v.dept || '', executor: v.executor,
            scheduledDate: v.scheduledDate, remark: v.remark || '',
            hazardType: v.hazardType || '',
            /* ★ 2026-11-11 新增：隐患条数 / 隐患等级（看板口径的两个来源） */
            hazardCount: Number(v.hazardCount) || 0,
            hazardLevel: v.hazardLevel || '',
            /* ★ 2026-11-11 新增：整改期限 / 整改照片 / 整改日期（与隐患照片 photos 分开存） */
            fixDueDate: v.fixDueDate || '',
            fixDate: v.fixDate || '',
            fixPhotos: v.fixPhotos || [],
            status: status,
            photos: v.photos || [],
            /* ★ 2026-11-12：必须显式写空数组。crud.update 是浅合并，
               不写这个键，多部门单改回单部门后旧明细会残留并被继续统计 */
            problems: []
          };
        }

        /* 状态联动字段理齐，避免展示自相矛盾：
           · 已完成：补完成时间；没有执行记录就落一条默认记录（现场情况可再补）
           · 离开「已完成」：清掉完成时间与执行记录
           · 离开「已改期」：清掉改期目标与原因（改期信息只对已改期状态有意义） */
        if (status === 'done') {
          payload.completedAt = payload.completedAt || (isEdit && t.completedAt) || SD.utils.today();
          if (!payload.record) {
            if (!(isEdit && t.record)) {
              payload.record = {
                findings: '现场正常，无异常项', hazardCount: payload.hazardCount,
                signedBy: payload.executor, signedAt: payload.completedAt
              };
            } else {
              /* 已有执行记录时也不能让 record 里的镜像停在旧值（否则两处数字漂移） */
              payload.record = Object.assign({}, t.record, { hazardCount: payload.hazardCount });
            }
          }
        } else {
          payload.completedAt = null;
          payload.record = null;
          if (status !== 'rescheduled') { payload.rescheduleTo = null; payload.reason = ''; }
        }

        var req = isEdit
          ? SD.api.updateInspection(t.id, payload)
          : SD.api.createInspection(Object.assign({
              completedAt: null, rescheduleTo: null, reason: '',
              fixDueDate: '', fixDate: '', fixPhotos: [], problems: []
            }, payload));
        return req.then(function () {
          U.toast(isEdit ? '巡检任务已更新' : '巡检任务已新增', 'ok');
          ctx.reload();
        });
      }
    });
    return dlg;
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
    /* ★ 2026-11-11：这里是**主路径**（列表「操作 ▾ → 标记完成」），
       隐患条数与等级必须都能在这里填 —— 只放在编辑表单里的话，
       实际使用中等级会长期是「未定级」，看板那张等级图等于白做。
       条数初值取已有值（原来写死 0，重复标记完成会把填过的条数冲掉）。

       ★ 2026-11-12：多部门单的条数/等级是**明细汇总**，这里不再给输入框 ——
         若还渲染 #i_hz，onOk 里那句 parseInt 校验必然拿到空串报错，弹窗永远关不掉。 */
    var isMulti = !!(t.problems && t.problems.length);
    var lvOpts = [{ v: '', n: '未定级' }].concat(SD.dict.DICT.severity).map(function (o) {
      return '<option value="' + U.esc(o.v) + '"' + (String(o.v) === String(t.hazardLevel || '') ? ' selected' : '') + '>' +
        U.esc(o.n) + '</option>';
    }).join('');

    var body =
      '<p class="t-2 t-sm" style="margin-bottom:12px">' + U.esc(t.planName) + ' · ' + U.esc(t.area) +
      ' · 计划 ' + U.esc(t.scheduledDate) + '</p>' +
      '<div class="grid-form">' +
        '<label class="field full"><span>现场情况 / 发现</span>' +
          '<textarea class="input" id="i_findings" rows="3" placeholder="例：消防通道畅通，灭火器材完好；发现 1 处通道被占用，已登记隐患">现场正常，无异常项</textarea></label>' +
        (isMulti
          ? '<label class="field full"><span>隐患条数</span><div>' +
              SD.metrics.hazardCountOf(t) + ' 条 · ' + SD.metrics.hazardRowsOf(t).length +
              ' 个部门（按明细汇总；要改条数请到「编辑」里改对应部门）</div></label>'
          : '<label class="field"><span>隐患条数</span><input class="input" type="number" id="i_hz" min="0" step="1" value="' +
              SD.metrics.hazardCountOf(t) + '"></label>' +
            '<label class="field"><span>隐患等级</span><select class="input" id="i_hzlv">' + lvOpts + '</select></label>') +
        '<label class="field"><span>现场签字人</span><input class="input" id="i_by" value="' + U.esc(t.executor || '') + '"></label>' +
      '</div>';

    SD.comp.dialog.open({
      title: '标记完成 · 填写执行记录', width: 560, body: body, okText: '完成并保存记录',
      onOk: function (modal) {
        var g = function (id) { var e = modal.querySelector('#' + id); return e ? e.value.trim() : ''; };
        var payload = {
          findings: g('i_findings') || '现场正常，无异常项',
          signedBy: g('i_by')
        };
        if (!isMulti) {
          var n = parseInt(g('i_hz'), 10);
          if (isNaN(n) || n < 0) return '隐患条数请填非负整数';
          payload.hazardCount = n;
          payload.hazardLevel = g('i_hzlv');
        }
        /* 多部门时不传 hazardCount / hazardLevel：
           dataSource 的 == null 守卫会保留既有值，明细才是真值 */
        return SD.api.completeInspection(t.id, payload).then(function () {
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
    var isMulti = !!(t.problems && t.problems.length);
    var rows = SD.metrics.hazardRowsOf(t);

    /* ★ 2026-11-12：多部门单的隐患明细（每条问题的部门 / 等级 / 条数 / 内容 / 整改）
       老记录没有 problems，这里不渲染，保持原样 —— 现有断言与用户习惯都不受影响 */
    var detailBlock = '';
    /* 部门数按**去重**算：3 行可能只有 2 个部门（同一部门登记多条问题），
       用 rows.length 会把它说成 3 个部门 —— 页面上就是个错数字。 */
    var deptSeen = {};
    rows.forEach(function (p) { deptSeen[p.dept || '未指定部门'] = 1; });
    var deptN = Object.keys(deptSeen).length;
    if (isMulti) {
      detailBlock = '<label class="field full"><span>分部门明细</span><div class="pr-detail">' +
        rows.map(function (p, i) {
          var fs = SD.metrics.rowFixStatusOf(p);
          var od = SD.metrics.rowOverdueOf(p);      // 逐行判定，不读顶层镜像
          var fsTxt = fs === 'done' ? ('已整改' + (p.fixDate ? '（' + p.fixDate + '）' : ''))
            : (fs === 'doing' ? '整改中' : '未整改');
          return '<div class="pr-d-item">' +
            '<div class="pr-d-head">' +
              '<b>' + U.esc(p.dept || '未指定部门') + '</b>' +
              '<span class="pr-d-tag">' + U.esc(p.level ? SD.dict.nameOf(SD.dict.DICT.severity, p.level) : '未定级') + '</span>' +
              '<span class="pr-d-tag">' + p.count + ' 条</span>' +
              '<span class="pr-d-tag ' + (fs === 'done' ? 'is-ok' : (fs === 'doing' ? 'is-warn' : '')) + '">' + U.esc(fsTxt) + '</span>' +
              (p.fixDueDate
                ? '<span class="pr-d-tag' + (od.overdue ? ' is-warn' : '') + '">' +
                    (od.overdue ? '逾期 ' + od.days + ' 天' : '期限 ' + U.esc(p.fixDueDate)) + '</span>'
                : '') +
              (p.photos.length ? '<button type="button" class="btn sm ghost js-pr-ph" data-i="' + i + '" data-k="p">' +
                '照片 ' + p.photos.length + '</button>' : '') +
              (p.fixPhotos.length ? '<button type="button" class="btn sm ghost js-pr-ph" data-i="' + i + '" data-k="f">' +
                '整改照片 ' + p.fixPhotos.length + '</button>' : '') +
            '</div>' +
            (p.content ? '<div class="t-3 t-sm pr-d-text">' + U.esc(p.content) + '</div>' : '') +
            (p.type ? '<div class="t-3 t-sm">隐患类型：' + U.esc(p.type) + '</div>' : '') +
          '</div>';
        }).join('') + '</div></label>';
    }

    var body =
      '<div class="grid-form">' +
        '<label class="field full"><span>计划名称</span><div class="b">' + U.esc(t.planName) + '</div></label>' +
        '<label class="field"><span>巡检类型</span><div>' + U.esc(t.type) + '</div></label>' +
        '<label class="field"><span>区域</span><div>' + U.esc(t.area) + '</div></label>' +
        '<label class="field"><span>执行人</span><div>' + U.esc(t.executor) + '</div></label>' +
        '<label class="field"><span>完成日期</span><div>' + U.esc(t.completedAt || '—') + '</div></label>' +
        '<label class="field full"><span>现场情况 / 发现</span><div>' + U.esc(r.findings || '—') + '</div></label>' +
        detailBlock +
        (isMulti
          ? '<label class="field"><span>隐患条数</span><div><b>' + SD.metrics.hazardCountOf(t) + ' 条</b> · ' +
              deptN + ' 个部门（按明细汇总）</div></label>'
          : '<label class="field"><span>隐患条数</span><div>' + SD.metrics.hazardCountOf(t) + ' 条</div></label>' +
            '<label class="field"><span>隐患等级</span><div>' +
              U.esc(t.hazardLevel ? SD.dict.nameOf(SD.dict.DICT.severity, t.hazardLevel) : '未定级') + '</div></label>') +
        '<label class="field"><span>现场签字</span><div>' + U.esc(r.signedBy || '—') + '　' + U.esc(r.signedAt || '') + '</div></label>' +
        '<label class="field full"><span>隐患照片</span><div>' +
          (t.photos && t.photos.length
            ? '<button type="button" class="btn sm js-insp-ph" data-id="' + t.id + '">查看 ' + t.photos.length + ' 张照片</button>'
            : '<span class="t-3">—（登记 / 编辑巡检时可添加）</span>') +
        '</div></label>' +
        /* ★ 2026-11-12：整改期限。多部门单**不显示整单镜像** —— 顶层取的是「最早期限」，
           可能整单看着过期而逐行都没逾期，显示出来就是误导；逐行判定见上方分部门明细。 */
        '<label class="field"><span>整改期限</span><div>' +
          (isMulti
            ? '<span class="t-3">按明细逐行判定（见上方分部门明细）</span>'
            : (t.fixDueDate
                ? U.esc(t.fixDueDate) + (SD.metrics.rowOverdueOf(rows[0]).overdue
                    ? '（逾期 ' + SD.metrics.rowOverdueOf(rows[0]).days + ' 天）' : '')
                : '<span class="t-3">未设期限（不参与逾期判定）</span>')) +
        '</div></label>' +
        /* ★ 2026-11-11：整改两件套也进执行记录（整改是在执行之后发生的，放这里最顺） */
        '<label class="field"><span>整改日期</span><div>' + U.esc(t.fixDate || '—') + '</div></label>' +
        '<label class="field full"><span>整改照片</span><div>' +
          (t.fixPhotos && t.fixPhotos.length
            ? '<button type="button" class="btn sm js-insp-fix" data-id="' + t.id + '">查看 ' + t.fixPhotos.length + ' 张整改照片</button>'
            : '<span class="t-3">—（编辑巡检时可添加）</span>') +
        '</div></label>' +
      '</div>';
    var recDlg = SD.comp.dialog.open({ title: '执行记录', width: 560, body: body, okText: '关闭' });
    /* 分部门明细里逐行看照片（整改前 / 整改后各自一个入口） */
    U.on(recDlg.el, 'click', '.js-pr-ph', function (e, el) {
      var p = rows[Number(el.dataset.i)];
      if (!p) return;
      var ph = el.dataset.k === 'f' ? p.fixPhotos : p.photos;
      if (ph && ph.length) {
        SD.comp.lightbox.open(ph, 0, {
          title: t.code + ' ' + (p.dept || '未指定部门') + (el.dataset.k === 'f' ? ' · 整改照片' : '')
        });
      }
    });
    /* 弹窗内点「查看照片」→ 同样开大图 */
    U.on(recDlg.el, 'click', '.js-insp-ph', function (e, el) {
      var cur = SD.app.state.summary.inspections.filter(function (x) { return x.id === el.dataset.id; })[0] || t;
      var ph = cur.photos || [];
      if (ph.length) SD.comp.lightbox.open(ph, 0, { title: cur.code + ' ' + cur.area });
    });
    /* 整改照片（整改后）单独一个入口，标题写清是「整改照片」，免得和整改前的混看 */
    U.on(recDlg.el, 'click', '.js-insp-fix', function (e, el) {
      var cur = SD.app.state.summary.inspections.filter(function (x) { return x.id === el.dataset.id; })[0] || t;
      var ph = cur.fixPhotos || [];
      if (ph.length) SD.comp.lightbox.open(ph, 0, { title: cur.code + ' ' + cur.area + ' · 整改照片' });
    });
  }

  /* ---------------- 过滤 + 排序 ----------------
     范围筛选（本周/全部/按状态）→ 年份 → 关键词搜索 → 排序（默认计划日期升序，点表头切换）

     ★ 2026-11-04：列表默认只看**当年**（年份下拉可切年 / 回到今年），归年按 scheduledDate。
     例外：「本周」视图**不套年份**——跨年那一周（如 12-29~01-04）硬套年份会把上一年那几天
     砍掉，与「本周完成率」指标卡对不上；在「本周」下改年份会自动切到「全部」，让选择真的生效。 */
  var STATUS_RANK = { planned: 0, rescheduled: 1, done: 2, cancelled: 3 };
  var YEAR_FIELDS = ['scheduledDate'];

  function curYear(s) {
    return SD.comp.yearBar.yearOf(s && s.today) || String(new Date().getFullYear());
  }

  function inYear(t, y, cur) {
    return SD.comp.yearBar.yearOfRecord(t, YEAR_FIELDS, cur) === y;
  }

  /** 搜索串：把分部门明细里的部门 / 问题内容 / 类型一并并入，
      否则「一单三个部门」时搜第二个部门名搜不出来，等于白登记 */
  function searchTextOf(t) {
    var s = [t.planName, t.code, t.area, t.dept, t.executor, t.type, t.hazardType].join(' ');
    SD.metrics.hazardRowsOf(t).forEach(function (r) {
      s += ' ' + (r.dept || '') + ' ' + (r.content || '') + ' ' + (r.type || '');
    });
    return s.toLowerCase();
  }

  function applyFilter(s, f, sort) {
    var list = s.inspections.slice();

    if (f.range === 'week') {
      var w = s.inspectionWeek;
      list = list.filter(function (t) { return t.scheduledDate >= w.weekStart && t.scheduledDate <= w.weekEnd; });
    } else {
      /* 年份过滤（「本周」以外才生效，见上面的说明） */
      var cy = curYear(s);
      var y = SD.comp.yearBar.yearOf(f.year) || cy;
      list = list.filter(function (t) { return inYear(t, y, cy); });
      if (f.range !== 'all') list = list.filter(function (t) { return t.status === f.range; });
    }
    if (f.q) {
      var q = String(f.q).toLowerCase();
      list = list.filter(function (t) { return searchTextOf(t).indexOf(q) >= 0; });
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
    /* 年份：首次进入 / 刷新页面 / 脏值 一律回「当年」（不落本地存储） */
    var CY = curYear(s);
    if (!SD.comp.yearBar.yearOf(f.year)) f.year = CY;
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

    /* ---------- 巡检口径汇总条（★ 2026-11-11 新增） ----------
       与数据看板「安全巡检（隐患与整改）」段**读同一份** summary.inspectionStats，
       所以两页的「巡检记录 / 隐患条数 / 整改状态」数值必然相等 —— 用户要求的口径统一就落在这里。
       刻意不用指标卡（.stat）：上面四张是「本周」口径，这条是「全部记录」口径，
       混在卡片里会让人以为同一周期。文字里写明「不限本周 / 年份」。 */
    var st = s.inspectionStats || {
      records: 0, hazardCount: 0, fix: { none: 0, doing: 0, done: 0 }, fixRate: null
    };
    var sumBar = U.h(
      '<div class="t-3 t-sm js-insp-sum" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 10px">' +
        '<span>全部记录（不限本周 / 年份）<b class="t-2">' + st.records + '</b> 项 · ' +
        '发现隐患 <b class="t-2">' + st.hazardCount + '</b> 条 · ' +
        '未整改 ' + st.fix.none + ' · 整改中 ' + st.fix.doing + ' · 已整改 ' + st.fix.done +
        '（整改率 ' + (st.fixRate == null ? '—' : U.pct(st.fixRate, 1, 0)) + '）</span>' +
        '<span style="flex:1 1 auto"></span>' +
        '<button class="btn sm ghost js-go-dash" type="button" title="看板里的「安全巡检」段与本条同源同值">去数据看板</button>' +
      '</div>'
    );
    sumBar.querySelector('.js-go-dash').addEventListener('click', function () { SD.router.go('dashboard'); });
    host.appendChild(sumBar);

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

    /* 年份（默认当年）：挂在 chip 组后面。
       在「本周」视图下改年份 → 自动切到「全部」，否则选了也不生效（本周就那一周）。 */
    var yearRows = s.inspections.filter(function (t) { return inYear(t, f.year, CY); });
    bar.insertBefore(SD.comp.yearBar.build({
      value: f.year, cur: CY,
      years: SD.comp.yearBar.yearsOf(s.inspections, YEAR_FIELDS, CY),
      count: yearRows.length, total: s.inspections.length,
      tip: '按计划日期归年；「本周」视图不受年份限制',
      onChange: function (y) {
        f.year = y;
        if (f.range === 'week') f.range = 'all';
        ctx.refresh();
      }
    }), bar.querySelector('.spacer'));

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
      if (noData) {
        listBox.appendChild(SD.comp.state.build('empty', {
          title: '还没有安全巡检任务',
          desc: '新增第一条巡检后，这里会按计划日期排序并计入本周完成率。',
          action: { text: '新增第一条巡检', onClick: function () { openForm(ctx, null); } }
        }));
      } else if (f.range !== 'week' && !yearRows.length) {
        /* 有数据、但这个年份一条都没有 → 说清是哪一年空着，并给回今年的出口 */
        listBox.appendChild(SD.comp.state.build('empty', {
          title: f.year + ' 年还没有巡检任务',
          desc: '这个年份没有排过巡检计划。用年份下拉切到其它年份，或直接回到今年。',
          action: f.year === CY ? null : {
            text: '回到今年', icon: 'calendar',
            onClick: function () { f.year = CY; ctx.refresh(); }
          }
        }));
      } else {
        listBox.appendChild(SD.comp.state.build('empty', {
          title: '没有符合条件的巡检任务',
          desc: f.q ? '没有匹配「' + f.q + '」的巡检，换个关键词或清空搜索。' : '换个筛选条件看看。',
          action: null
        }));
      }
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
      /* 区域：与「类型」一样单独一列；有照片时区域名可点，点开看隐患照片大图 */
      {
        key: 'area', title: '区域',
        render: function (r) {
          /* ★ 2026-11-12：多部门单的照片分散在各行，角标取「整单照片」，
             另加一个「N 个部门」提示 —— 否则一行写着「照片 3」，打开大图却看不出是哪两个部门的 */
          var n = SD.metrics.problemPhotosOf(r).length;
          var dN = SD.metrics.hazardRowsOf(r).length;
          return '<div class="cell-main js-insp-area' + (n ? ' link' : '') + '" data-id="' + r.id + '" ' +
              'title="' + (n ? '点击查看隐患照片（' + n + ' 张）' : '这条巡检还没有隐患照片') + '">' +
            U.esc(r.area || '—') +
            (n ? '<span class="hz-photo-tag">照片 ' + n + '</span>' : '') +
            (dN > 1 ? '<span class="hz-photo-tag">' + dN + ' 个部门</span>' : '') +
          '</div>';
        }
      },
      {
        key: 'dept', title: '部门', sortable: true,
        render: function (r) {
          var ds = [];
          SD.metrics.hazardRowsOf(r).forEach(function (p) {
            var d = String(p.dept || '').trim();
            if (d && ds.indexOf(d) < 0) ds.push(d);
          });
          if (ds.length > 1) {
            return '<span title="' + U.esc(ds.join(' / ')) + '">' +
              U.esc(ds[0]) + ' 等 ' + ds.length + ' 个部门</span>';
          }
          return U.esc(r.dept || ds[0] || '—');
        }
      },
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

    /* ---------- 点「区域」看隐患照片 ----------
       照片在新增 / 编辑表单里上传（≤18 张），与隐患标题、培训名称、作业票作业类型
       同一套交互；无照片时点名没反应（title 已说明）。 */
    U.on(table, 'click', '.js-insp-area', function (e, el) {
      var cur = SD.app.state.summary.inspections.filter(function (x) { return x.id === el.dataset.id; })[0];
      if (!cur) return;
      var ph = SD.metrics.problemPhotosOf(cur);
      if (!ph.length) { U.toast('这条巡检还没有隐患照片，新增 / 编辑巡检时可添加'); return; }
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
      '列表支持关键词搜索与点表头排序。<br>' +
      '<b class="t-2">照片与整改</b>　「隐患照片」是整改前的问题现场，「整改照片」是整改后的结果，两者分开存、各自最多 18 张；' +
      '看板「隐患照片 / 各部门隐患照片」只统计前者，整改照片不计入，避免同一件事被数两遍。' +
      '「整改日期」记整改完成的那天，与「计划日期」相互独立。<br>' +
      '<b class="t-2">整改期限</b>　「整改期限」是<b>要求改完</b>的那天，「整改日期」是<b>实际改完</b>的那天，两者不是一回事：' +
      '期限早于实际完成日 = 超期整改；只填期限、没填日期 = 逾期未整改（期限已过时）。' +
      '<b>留空 = 未设期限</b>，看板单独计一格，既不判逾期也不判按期 —— 没约定过时限却被算成"按期"，是编数。<br>' +
      '<b class="t-2">分部门登记</b>　一趟巡检走了几个部门、各有各的问题时，点表单里的「按部门拆分」，' +
      '每个部门一行（部门 / 问题内容 / 等级 / 条数 / 照片 / 整改）。一张单仍是<b>一条</b>记录、一个编号；' +
      '看板按明细行汇总：<b>各部门相加恒等于整单</b>。只涉及一个部门时不用拆分，照常填「隐患条数 / 照片」即可。' +
      '</section>'
    ));
  }

  /* FIELDS 对外暴露：字段定义是这份表单的契约，冒烟测试与后续模块（如字段级校验）
     都靠它核对，别再从 DOM 里反推。 */
  return { name: '安全巡检', sub: sub, render: render, FIELDS: FIELDS };
})();
