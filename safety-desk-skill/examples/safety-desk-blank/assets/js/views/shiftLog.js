/* =========================================================
   views/shiftLog.js — 安全巡检与交接班记录（2026-10-25 新增）
   ────────────────────────────────────────────────────────
   版式来源：《现场安全巡检与交接班记录.xlsx》——逐格复刻
     · 纸张 A4 **横向** + 常规页边距（2026-10-25 定，与保存页一致），A2:E2 通栏标题，
       A3:C3 厂区/部门/巡检人员（留空手签）/班次，D3:E3 日期
     · 表头：序号 / 检查项 / 检查内容 / 检查情况 / 备注（当班工作情况及其它情况）
     · 19 个检查项，其中「作业场所安全管理」跨 9 行、「消防安全设备设施」跨 4 行
     · 备注列纵向合并（原表 E5:E23），整张表只有一处大备注
     · 表尾：注：检查情况正常打“√”，异常打“×”并如实记录异常情况。

   按用户要求做的取舍（2026-10-25）：
     · 厂区、部门**固定**（值在 config.js 的 SD.CONFIG.shiftLog，改一处即全站生效）
     · 班次、日期、检查情况都是**下拉/日期控件**，不让人手打错
     · 巡查人员**可手动填写**，但打印与导出 Excel 时**一律留空**（留位手签）
     · 备注是「每日事件」的**编号条目列表**，可加、可改、可删，打印时按 1、2、3 罗列

   一条记录 = 某天 + 某班次（同一天同一班次只会有一份，保存时自动覆盖）
   ========================================================= */
window.SD = window.SD || {};
SD.views = SD.views || {};

SD.views.shiftLog = (function () {
  var U = SD.utils;

  /* ---------- 19 个检查项（g=检查项分组，t=检查内容） ---------- */
  var ITEMS = [
    { g: '建筑',             t: '是否渗漏，门窗是否完好' },
    { g: '危化品区',         t: '危化品有无外溢、罐区是否有报警' },
    { g: '发泡区域',         t: '泡头、泡尾是否采取温控、是否单独存放、熟化中的海绵是否单独存放、温控' },
    { g: '作业场所安全管理', t: '新入厂人员未经三级安全培训或考试不合格者，不准参加生产或单独操作' },
    { g: '作业场所安全管理', t: '不准穿无头无跟鞋、赤脚、赤膊、领带、围巾、长发外露' },
    { g: '作业场所安全管理', t: '作业人员劳保用品穿戴符合标准' },
    { g: '作业场所安全管理', t: '工器具是否按规定摆放整齐' },
    { g: '作业场所安全管理', t: '是否出现违章作业现象' },
    { g: '作业场所安全管理', t: '地面、工作面清洁干净，无油污、无积水' },
    { g: '作业场所安全管理', t: '消防通道、安全出口是否通畅' },
    { g: '作业场所安全管理', t: '供应商、服务商施工现场防护措施、警示标志、劳防用品是否到位' },
    { g: '作业场所安全管理', t: '现场施工特种作业证开具情况（包括设备、IT、外协单位施工等）' },
    { g: '特种设备',         t: '压力容器等特种设备及压力表、安全阀等安全附件按规定抽查抽测，保证齐全完好。' },
    { g: '电   气',           t: '防火措施齐全，电气线路、刀闸、开关等整齐无老化，无乱接、乱拉临时线路现象' },
    { g: '消防安全设备设施', t: '灭火器设置合理，状态完好' },
    { g: '消防安全设备设施', t: '消火栓供水通畅，水压充足，阀门试开正常' },
    { g: '消防安全设备设施', t: '消防水带数量充足，完好' },
    { g: '消防安全设备设施', t: '应急照明、疏散指示灯、安全出口灯设置合理，状态完好' },
    { g: '其   它',           t: '其它需要检查的临时项目内容。' }
  ];

  /* 检查情况：原表是手打 √ / ×，这里做成下拉，避免打出「√√」「V」之类 */
  var CHECKS = [
    { v: '',    n: '— 未检', mark: '',  short: '—' },
    { v: 'ok',  n: '√ 正常', mark: '√', short: '√' },
    { v: 'bad', n: '× 异常', mark: '×', short: '×' }
  ];

  /* 列宽：直接照抄原表 Excel 的列宽（字符数 4.41 / 9 / 69.75 / 5.66 / 34.08）——
     **打印件与导出 Excel 用这份**，跟原表一模一样。
     ★ 2026-11-04 按用户要求微调：序号列 4.41 → 6.5（「序号」两字打印预览时
       刚好一横排、不再挤在窄列里），备注列 34.08 → 40（加宽一点）。
     界面版另外一份：检查情况列放宽到能整整齐齐放下「√ 正常」四个字
     （原表 5.66 个字符宽只够一个「√」，界面上把文字挤没了才做的调整）。
     两份都是从 COLW 派生出来的，改一处不会让界面和出件对不上。 */
  var COLW = [6.5, 9, 78, 5.66, 40];
  var COLW_UI = [6.5, 9, 82, 11, 40];   /* 界面：检查情况列按文字宽度放宽 */
  /* 「检查内容」列从原表的 69.75 加宽到 78：最长的一条（压力容器…）要 74 个字符单位，
     69.75 放不下会折成两行，原表行高又锁死 20.5pt → 第二行直接被切掉。
     加宽后最长的一条一行正好放下，19 行全部维持 20.5pt，不用加高。 */
  function colPct(list) {
    var t = 0;
    list.forEach(function (w) { t += w; });
    return list.map(function (w) { return (w / t * 100).toFixed(2) + '%'; });
  }
  function colGroupHtml(list) {
    return '<colgroup>' + colPct(list || COLW).map(function (w) {
      return '<col style="width:' + w + '">';
    }).join('') + '</colgroup>';
  }

  /* 巡检人员后面空出来给手签的位置：10 个全角字宽 ≈ 38.8mm（11pt 下 1 个全角 = 3.88mm），
     与打印件里 .c-blank 的 38mm 对齐，两处签字的空档一样宽 */
  var INSP_BLANK = '　　　　　　　　　　';

  /* 出件尺寸（px）：照原表 logo 锚定的 A1:C1 区域比例（258x47 → 165x30） */
  var LOGO_W = 165, LOGO_H = 30;
  function logoImg(cls) {
    if (!window.SD || !SD.BRAND_LOGO) return '';
    return '<img class="' + (cls || 'sl-logo') + '" src="' + SD.BRAND_LOGO.file + '" alt="">';
  }

  /* 左上角公司标识（第 1 行，原表这一行就是空着放图的） */
  function logoRowHtml(rowCls, cellCls, imgCls) {
    return '<tr class="sl-r-logo ' + (rowCls || '') + '"><td class="' + (cellCls || 'sl-logo-cell') +
      '" colspan="5">' + logoImg(imgCls) + '</td></tr>';
  }

  /* ---------- 边框：逐边照抄原表 ----------
     原表的边框**不是四面全框**（这也是之前保存页"和原表不一样"的原因）：
       · 外框（A 列左缘、E 列右缘、表头上下缘、末行下缘）= medium 加粗
       · 内线 = thin
       · 「检查内容」列（C）**没有左右竖线**，只有横线
       · 抬头行（第 3 行）只有 A:C 有下边框；标题行、表尾行无框
     'm' = medium，'t' = thin，0 = 不画。 */
  var FONT = '宋体';        /* 原表正文字体（导出件与打印件都用它） */
  var MED = 'm', TH = 't';
  function bd(l, r, t, b) { return { l: l, r: r, t: t, b: b }; }

  /** 第 i 个检查项（0 起）所在行的五格边框图 */
  function itemBorders(i, gStart, span) {
    var isLast = (i === ITEMS.length - 1);
    var isNewG = (i === gStart);
    var isGEnd = (i - gStart === span - 1);
    return [
      bd(MED, 0, 0, isLast ? MED : TH),                                    /* A 序号：左外框 + 下内线 */
      bd(MED, MED, isNewG ? TH : 0, isGEnd ? (isLast ? MED : TH) : 0),     /* B 检查项：左右线，合并首行带上线、末行带下内线 */
      bd(0, 0, 0, isLast ? MED : TH),                                      /* C 检查内容：只有横线，没有竖线 */
      bd(MED, MED, 0, isLast ? MED : TH),                                  /* D 检查情况 */
      bd(MED, MED, i === 0 ? MED : 0, isLast ? MED : 0)                    /* E 备注：合并区首行带上线、末行带下外框 */
    ];
  }

  function cfg() {
    return SD.CONFIG.shiftLog || { plant: '缝制中心', dept: '安全环保部', shifts: [{ v: 'day', n: '白班' }] };
  }
  function shifts() { return cfg().shifts || [{ v: 'day', n: '白班' }]; }
  function shiftName(v) {
    var hit = shifts().filter(function (x) { return x.v === v; })[0];
    return hit ? hit.n : (v || '—');
  }
  function checkOf(v) {
    return CHECKS.filter(function (x) { return x.v === (v || ''); })[0] || CHECKS[0];
  }

  /** 受限用户：只读（不能改任何字段，也不能保存/删除） */
  function readOnly() { return !SD.auth.can('data.write'); }

  function blankRec(date, shift) {
    return {
      date: date, shift: shift, inspector: '',
      checks: ITEMS.map(function () { return ''; }),
      events: []
    };
  }

  function findRec(logs, date, shift) {
    return (logs || []).filter(function (x) { return x.date === date && x.shift === shift; })[0] || null;
  }

  /** 把一条存储记录整理成渲染用的对象（补齐 19 项，老数据缺项不炸） */
  function normalize(rec, date, shift) {
    var o = blankRec(date, shift);
    if (!rec) return o;
    o.id = rec.id;
    o.inspector = rec.inspector || '';
    o.updatedAt = rec.updatedAt || rec.createdAt || '';
    var c = rec.checks || [];
    o.checks = ITEMS.map(function (_, i) { return c[i] || ''; });
    o.events = (rec.events || []).filter(function (x) { return x != null; }).map(function (x) { return String(x); });
    return o;
  }

  /* ---------- 月份视图（★ 2026-11-04 起：交接班记录列表按月展示，默认当月） ----------
     归月口径：取记录 `date` 所在月（'YYYY-MM'）。`date` 缺失的旧数据回退 `updatedAt`，
     再没有就归入「当月」，避免记录从月视图里整个消失。
     月份只是**列表的视图过滤**：不写库、不改数据、不影响顶部日期/班次编辑区，
     也不影响打印与导出（打印/导出仍按当前编辑的那一天出件）。 */
  function monthOf(dateStr) {
    var m = String(dateStr == null ? '' : dateStr).slice(0, 7);
    var hit = /^(\d{4})-(\d{2})$/.exec(m);
    if (!hit) return '';
    var mo = Number(hit[2]);
    /* 「2019-13」这种脏值也要判无效：<input type="month"> 认不了，列表会莫名空掉 */
    return (mo >= 1 && mo <= 12) ? m : '';
  }

  /** 一条记录归哪个月（见上面的口径说明） */
  function monthOfRec(r, fallback) {
    return monthOf(r && r.date) || monthOf(r && r.updatedAt) || fallback;
  }

  /** '2026-11' → '2026年11月' */
  function fmtMonth(m) {
    if (!m) return '';
    return m.slice(0, 4) + '年' + Number(m.slice(5, 7)) + '月';
  }

  /** 月份加减，跨年自动处理：('2026-01', -1) → '2025-12' */
  function shiftMonth(m, delta) {
    var y = Number(m.slice(0, 4));
    var mo = Number(m.slice(5, 7)) + delta;
    y += Math.floor((mo - 1) / 12);
    mo = ((mo - 1) % 12 + 12) % 12 + 1;
    return y + '-' + (mo < 10 ? '0' : '') + mo;
  }

  function statOf(rec) {
    var bad = (rec.checks || []).filter(function (x) { return x === 'bad'; }).length;
    var ok = (rec.checks || []).filter(function (x) { return x === 'ok'; }).length;
    return { ok: ok, bad: bad, done: ok + bad };
  }

  function sub(s) {
    if (!s) return '';
    var logs = s.shiftLogs || [];
    if (!logs.length) return '按原表版式；同一天同一班次只保留一份，保存即覆盖';
    var last = logs.slice().sort(function (a, b) { return String(b.date) > String(a.date) ? 1 : -1; })[0];
    return '共 ' + logs.length + ' 份 · 最近 ' + (last.date || '') + ' ' + shiftName(last.shift);
  }

  /* ---------------- 渲染 ---------------- */
  /* ★ 每日安全记录 → 备注事件 的映射（2026-11-03）
     放在 IIFE 顶层，方便测试与复用；importEventsFromDaily 在 render 内调用它。 */
  /** 把「每日安全记录」的二维数组整理成指定日期的事件文本数组 */
  function dailyEventsFor(rows, date) {
    if (!Array.isArray(rows) || !rows.length) return [];
    /* 表头行：第 2 行（A2=日期 B2=星期 C2=班次 D2=主要工作 E2=完成情况 F2=备注）；
       数据从第 3 行起。列按 0 基：A=0 B=1 C=2 D=3 E=4 F=5。 */
    var out = [];
    var curDay = '';            // 当前遍历到的日期（'YYYY-MM-DD'）
    var inTarget = false;       // 是否落在目标日期这一天里
    var today = date;           // 目标日期（如 '2026-11-01'）

    rows.forEach(function (r, idx) {
      if (!Array.isArray(r)) return;
      /* A 列有值 → 可能是日期（序列号字符串或日期串），切换「当前日」。
         注意：真实表里「日期行」本身也带一条工作内容（D 列），
         所以先判断并更新 curDay，再往下统一取 D/E/F，不在这里 return。 */
      var a = String(r[0] == null ? '' : r[0]).trim();
      if (a && a !== '日期') {
        var d = normalizeDailyDate(a);
        if (d) { curDay = d; inTarget = (d === today); }
        else { inTarget = false; return; }   // A 列有值但不是日期 → 结束一天，未命中
      }
      /* 落在目标日期内才取 D/E/F */
      if (!inTarget) return;
      var work = String(r[3] == null ? '' : r[3]).trim();
      if (!work) return;                       // 主要工作为空的行跳过
      var done = String(r[4] == null ? '' : r[4]).trim();
      var note = String(r[5] == null ? '' : r[5]).trim();
      out.push(composeDailyEvent(work, done, note));
    });

    return out;
  }

  /** 日期列值 → 'YYYY-MM-DD'；序列号走 excelDate，已是日期串则原样 */
  function normalizeDailyDate(v) {
    var s = String(v).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(s)) {
      var p = s.split('/');
      return p[0] + '-' + (p[1].length < 2 ? '0' + p[1] : p[1]) + '-' + (p[2].length < 2 ? '0' + p[2] : p[2]);
    }
    if (/^\d+$/.test(s) && SD.comp.xlsxReader.excelDate) {
      return SD.comp.xlsxReader.excelDate(Number(s));
    }
    return '';
  }

  /** 拼一条事件：主要工作（完成情况）＋备注 */
  function composeDailyEvent(work, done, note) {
    var t = work;
    if (done && done !== '进行中') t += '（' + done + '）';
    if (note) t += ' — ' + note;
    return t;
  }

  function render(host, ctx) {
    var s = ctx.state.summary || {};
    var logs = s.shiftLogs || [];
    var ro = readOnly();

    var CUR_MONTH = monthOf(U.today());

    var f = ctx.state.filters.shift;
    if (!f || !f.date) {
      f = ctx.state.filters.shift = {
        date: U.today(),
        shift: (shifts()[0] || {}).v || 'day',
        month: CUR_MONTH
      };
    }
    /* 月份：首次进入 / 刷新页面 / 脏值 一律回「当月」（★ 2026-11-04）
       —— 记住刷新前的月份会让用户下次打开看不到当月的记录，违背「默认当月」。 */
    if (!monthOf(f.month)) f.month = CUR_MONTH;

    var cur = normalize(findRec(logs, f.date, f.shift), f.date, f.shift);

    /* ---------- 顶部工具条 ---------- */
    var bar = U.h('<div class="filters sl-toolbar"></div>');
    var tip = U.h('<span class="sl-status"></span>');

    if (ro) {
      bar.appendChild(U.h('<span class="badge badge-warn" title="当前为受限用户，只能查看与打印">' +
        SD.icons.get('lock', 13) + ' 只读</span>'));
    }

    var dateIn = U.h('<input class="input" type="date" style="width:150px" data-keep-focus="shiftDate" title="记录日期">');
    dateIn.value = f.date;
    dateIn.addEventListener('change', function () {
      if (!dateIn.value) return;
      f.date = dateIn.value;
      ctx.refresh();
    });
    bar.appendChild(U.h('<label class="sl-fld"><span>日期</span></label>'));
    bar.appendChild(dateIn);

    var shiftSel = U.h('<select class="input ctl-select" style="width:110px" title="班次"></select>');
    shifts().forEach(function (x) {
      var o = U.h('<option></option>');
      o.value = x.v; o.textContent = x.n;
      shiftSel.appendChild(o);
    });
    shiftSel.value = f.shift;
    shiftSel.addEventListener('change', function () {
      f.shift = shiftSel.value;
      ctx.refresh();
    });
    bar.appendChild(U.h('<label class="sl-fld"><span>班次</span></label>'));
    bar.appendChild(shiftSel);

    bar.appendChild(U.h('<span class="sl-legend">检查情况　<b class="sl-lg-ok">√</b> 正常' +
      '　<b class="sl-lg-bad">×</b> 异常　<b class="sl-lg-none">—</b> 未检</span>'));

    /* 一键钩选：19 项一个个点太累，整表一次搞定（受限用户没有） */
    if (!ro) {
      var allOkBtn = U.h('<button class="btn sm ghost js-sl-allok" title="一键把 19 个检查项全部勾成「√ 正常」">' +
        SD.icons.get('check', 13) + '全部 √ 正常</button>');
      allOkBtn.addEventListener('click', function () { setAll('ok'); });
      bar.appendChild(allOkBtn);

      var clrBtn = U.h('<button class="btn sm ghost js-sl-clr" title="一键清空所有检查情况">清空勾选</button>');
      clrBtn.addEventListener('click', function () { setAll(''); });
      bar.appendChild(clrBtn);
    }

    function setAll(v) {
      cur.checks = ITEMS.map(function () { return v; });
      paintSheet();
      paintStatus();
      U.toast(v === 'ok' ? '19 项已全部勾为「√ 正常」' : '已清空所有检查情况', 'ok');
    }

    bar.appendChild(U.h('<span class="spacer"></span>'));

    var printBtn = U.h('<button class="btn ghost" title="按 A4 横向排版打印，常规页边距，自动缩放到一页（巡查人员留空待手签）">' +
      SD.icons.get('printer', 14) + '打印</button>');
    printBtn.addEventListener('click', function () { openPrint(cur); });
    bar.appendChild(printBtn);

    var xlsBtn = U.h('<button class="btn ghost js-sl-xls" title="导出当日白班、夜班两张表（各一个 sheet，可直接双面打印）">' +
      SD.icons.get('download', 14) + '导出 Excel（白夜班）</button>');
    xlsBtn.addEventListener('click', function () { exportXlsx(cur); });
    bar.appendChild(xlsBtn);

    /* ★ 2026-11-10：受限模式**不允许导出交接班记录**（含交接班原始表，可直接带走数据）。
       工具栏按钮渲染成禁用态 + 旁边一行小字说明 —— 光禁用不给原因，手机上会让人以为坏了；
       光提示不禁用，又得点一次才知道不行。两个一起做。
       打印仍然保留：打印是纸质留痕，不产生可编辑的数据文件。
       真正的拦截在 exportXlsx 函数入口，这里只是视觉与提示。 */
    if (ro) {
      xlsBtn.disabled = true;
      xlsBtn.classList.add('is-locked');
      xlsBtn.setAttribute('title', '受限模式：导出交接班记录需要安全员权限');
      xlsBtn.setAttribute('aria-disabled', 'true');
      bar.appendChild(U.h('<span class="t-3 t-sm js-sl-lock-note">受限模式：可查看与打印，导出已锁定</span>'));
    }

    if (!ro) {
      var saveBtn = U.h('<button class="btn primary" title="保存这一天的记录（同一天同一班次会覆盖）">' +
        SD.icons.get('check', 14) + (cur.id ? '保存修改' : '保存记录') + '</button>');
      saveBtn.addEventListener('click', function () { save(cur); });
      bar.appendChild(saveBtn);
    }
    host.appendChild(bar);

    /* ---------- 纸张本体 ---------- */
    var paper = U.h('<div class="sl-paper"><table class="sl-table">' +
      colGroupHtml(COLW_UI) + '<tbody></tbody></table></div>');
    var tbody = paper.querySelector('tbody');
    host.appendChild(paper);

    /* 状态行：这份记录是新的还是已存在的 */
    var statusBox = U.h('<div class="sl-statusline"></div>');
    host.appendChild(statusBox);

    function paintStatus() {
      U.clear(statusBox);
      var st = statOf(cur);
      var bits = [];
      bits.push(cur.id ? ('本日该班次已有记录' + (cur.updatedAt ? '（更新于 ' + cur.updatedAt + '）' : '') + '，保存将覆盖')
                       : '本日该班次还没有记录，填完点「保存记录」');
      bits.push('已检查 ' + st.done + ' / ' + ITEMS.length + ' 项');
      if (st.bad) bits.push('异常 ' + st.bad + ' 项');
      statusBox.appendChild(U.h('<span class="t-2 t-sm">' + U.esc(bits.join('　·　')) + '</span>'));
      if (st.bad) statusBox.appendChild(U.h('<span class="badge badge-danger" style="margin-left:8px">待整改</span>'));
    }

    function paintSheet() {
      U.clear(tbody);

      /* 第 1 行：左上角公司标识（原表这一行空着放图，高 30pt） */
      tbody.appendChild(U.h(logoRowHtml()));

      /* 标题（对应 A2:E2） */
      var tr = U.h('<tr><td class="sl-title" colspan="5">现场安全巡检与交接班记录</td></tr>');
      tbody.appendChild(tr);

      /* 抬头（对应 A3:C3 / D3:E3）—— 班次按用户要求并进厂区那个格子，
         D:E 合并留给日期（原表 D3/E3 本来就没框） */
      var meta = U.h('<tr>' +
        '<td class="sl-meta" colspan="3">厂区：<b>' + U.esc(cfg().plant) + '</b>　　部门：<b>' + U.esc(cfg().dept) + '</b>' +
          '　　巡检人员：<input class="sl-inline js-sl-insp" maxlength="12" placeholder="可留空手签" style="width:110px"' +
          (ro ? ' disabled' : '') + '>　　班次：<span class="js-sl-shift"></span></td>' +
        '<td class="sl-meta" colspan="2">日期：<span class="js-sl-date"></span></td></tr>');
      meta.querySelector('.js-sl-insp').value = cur.inspector || '';
      meta.querySelector('.js-sl-shift').textContent = shiftName(cur.shift);
      meta.querySelector('.js-sl-date').textContent = cur.date;
      tbody.appendChild(meta);

      /* 表头（对应第 4 行） */
      tbody.appendChild(U.h('<tr class="sl-head">' +
        '<th>序号</th><th>检查项</th><th>检查内容</th><th>检查情况</th>' +
        '<th>备   注<span class="sl-th-sub">（当班工作情况及其它情况）</span></th></tr>'));

      /* 19 行明细：检查项分组用 rowspan，备注整列 rowspan（原表 E5:E23 合并） */
      var spanLeft = 0, lastName = '';
      ITEMS.forEach(function (it, i) {
        var tr2 = document.createElement('tr');
        tr2.className = 'sl-row' + (cur.checks[i] === 'bad' ? ' is-bad' : '');
        tr2.setAttribute('data-i', String(i));

        tr2.appendChild(U.h('<td class="sl-no">' + (i + 1) + '</td>'));

        if (it.g !== lastName) {
          spanLeft = ITEMS.filter(function (x) { return x.g === it.g; }).length;
          lastName = it.g;
          tr2.appendChild(U.h('<td class="sl-group" rowspan="' + spanLeft + '">' + U.esc(it.g) + '</td>'));
        }

        tr2.appendChild(U.h('<td class="sl-item">' + U.esc(it.t) + '</td>'));

        var sel = U.h('<select class="sl-check' + (cur.checks[i] === 'bad' ? ' is-bad' : '') + '"' +
          (ro ? ' disabled' : '') + ' aria-label="第 ' + (i + 1) + ' 项检查情况"></select>');
        CHECKS.forEach(function (c) {
          var o = U.h('<option></option>');
          /* 界面用完整文案（√ 正常 / × 异常 / — 未检），出件才用单字符 √ / × */
          o.value = c.v; o.textContent = c.n;
          sel.appendChild(o);
        });
        sel.title = '检查情况：√ 正常 / × 异常 / — 未检';
        sel.value = cur.checks[i] || '';
        sel.addEventListener('change', function () {
          cur.checks[i] = sel.value;
          tr2.className = 'sl-row' + (sel.value === 'bad' ? ' is-bad' : '');
          sel.className = 'sl-check' + (sel.value === 'bad' ? ' is-bad' : '');
          paintStatus();
        });
        tr2.appendChild(U.h('<td class="sl-check-cell"></td>')).appendChild(sel);

        /* 备注只挂第一行，纵向跨越全部明细行 */
        if (i === 0) {
          var noteTd = U.h('<td class="sl-note" rowspan="' + ITEMS.length + '"></td>');
          noteTd.appendChild(buildEvents());
          tr2.appendChild(noteTd);
        }

        tbody.appendChild(tr2);
      });

      /* 表尾 */
      tbody.appendChild(U.h('<tr><td class="sl-foot" colspan="5">' +
        '注：检查情况正常打“√”，异常打“×”并如实记录异常情况。</td></tr>'));

      var insp = tbody.querySelector('.js-sl-insp');
      insp.addEventListener('input', U.debounce(function () { cur.inspector = insp.value; }, 120));
    }

    /* 备注事件列表（编号条目，可增删改） */
    function buildEvents() {
      var box = U.h('<div class="sl-ev-box"></div>');
      var list = U.h('<div class="sl-ev-list"></div>');
      box.appendChild(list);

      function paintList() {
        U.clear(list);
        if (!cur.events.length) {
          list.appendChild(U.h('<div class="sl-ev-empty">' + (ro ? '本班次暂无事件记录'
            : '暂无事件。点「＋ 添加一条」或直接写一条后按回车，按 1、2、3 编号逐条列出当班事件。') + '</div>'));
          return;
        }
        cur.events.forEach(function (txt, i) {
          var row = U.h('<div class="sl-ev"><span class="sl-ev-no">' + (i + 1) + '.</span></div>');
          var inp = U.h('<input class="input sl-ev-inp" maxlength="120" placeholder="如：3 号门消防通道被物料占用，已通知当班组长清理"' + (ro ? ' disabled' : '') + '>');
          inp.value = txt;
          inp.addEventListener('input', U.debounce(function () { cur.events[i] = inp.value; }, 120));
          /* 回车 = 自动新起一条（编号顺延到下一行），写当班事件时不用去点按钮 */
          inp.addEventListener('keydown', function (e) {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            cur.events[i] = inp.value;
            var v = String(inp.value || '').trim();
            if (!v) { U.toast('先写这条，再回车换下一行', 'err'); return; }
            cur.events.splice(i + 1, 0, '');
            paintList();
            var next = list.querySelectorAll('.sl-ev-inp')[i + 1];
            if (next) next.focus();
          });
          row.appendChild(inp);
          if (!ro) {
            if (i === 0) row.appendChild(U.h('<span class="sl-ev-space"></span>'));
            var del = U.h('<button class="sl-ev-del" title="删除第 ' + (i + 1) + ' 条" aria-label="删除第 ' + (i + 1) + ' 条">×</button>');
            del.addEventListener('click', function () {
              cur.events.splice(i, 1);
              paintList();
            });
            row.appendChild(del);
          }
          list.appendChild(row);
        });
      }

      if (!ro) {
        var tool = U.h('<div class="sl-ev-tool"></div>');

        var add = U.h('<button class="btn sm ghost sl-ev-add">＋ 添加一条</button>');
        add.addEventListener('click', function () {
          cur.events.push('');
          paintList();
          var last = list.querySelectorAll('.sl-ev-inp');
          if (last.length) last[last.length - 1].focus();
        });
        tool.appendChild(add);

        /* 从「每日安全记录」表格导入当天的备注事件（★ 2026-11-03）
           参照《每日安全记录.xlsx》「每日简记」表：A 列日期只在每天第一行出现，
           B 星期 / C 班次 / D 主要工作 / E 完成情况 / F 备注；
           导入时把「所选日期」这一天的所有行按 D/E/F 拼成事件，逐条填入备注。 */
        var imp = U.h('<button class="btn sm ghost sl-ev-import" title="从「每日安全记录.xlsx」导入所选日期当天的备注事件">' +
          SD.icons.get('upload', 13) + '从每日记录导入</button>');
        var fileIn = U.h('<input type="file" accept=".xlsx,.xls,.csv" style="display:none">');
        imp.addEventListener('click', function () { fileIn.click(); });
        fileIn.addEventListener('change', function () {
          importEventsFromDaily(fileIn.files && fileIn.files[0]);
          fileIn.value = '';
        });
        tool.appendChild(imp);
        tool.appendChild(fileIn);

        box.appendChild(tool);
      }

      paintList();
      return box;
    }

    /** 从每日安全记录表格导入当天事件（见 buildEvents 里 imp 按钮的说明） */
    function importEventsFromDaily(file) {
      if (!file) return;
      if (!SD.comp.xlsxReader) { U.toast('读取 Excel 组件未就绪', 'err'); return; }
      U.toast('正在读取表格…');
      SD.comp.xlsxReader.readFile(file).then(function (res) {
        var rows = (res && res.rows) || [];
        var events = dailyEventsFor(rows, cur.date);
        if (!events.length) {
          U.toast('没在表格里找到 ' + cur.date + ' 的记录，或当天「主要工作」为空', 'err');
          return;
        }
        /* 追加还是覆盖？默认追加到现有事件末尾，避免误删已手写的内容；
           每次导入的行在文件内去重、且与已有事件去重后再追加 */
        var have = {};
        cur.events.forEach(function (x) { var k = String(x || '').trim(); if (k) have[k] = true; });
        var added = 0;
        events.forEach(function (t) {
          if (have[t]) return;
          cur.events.push(t);
          have[t] = true;
          added++;
        });
        paintList();
        U.toast(added ? ('已导入 ' + added + ' 条事件（当天共 ' + events.length + ' 条，重复已跳过）') : '当天内容与现有备注一致，没有新增');
      }, function (e) {
        U.toast('导入失败：' + (e && e.message ? e.message : e), 'err');
      });
    }

    paintSheet();
    paintStatus();

    /* ---------- 历史记录（★ 2026-11-04 起按月展示：默认当月，可切月 / 上下月 / 回到本月） ---------- */
    var monthList = logs.filter(function (r) { return monthOfRec(r, CUR_MONTH) === f.month; });

    function goMonth(m) {
      if (!monthOf(m) || m === f.month) return;
      f.month = m;
      ctx.refresh();          // 整页重绘：月份条 / 计数 / 列表都跟着走
    }

    var headSub = fmtMonth(f.month) + ' 共 ' + monthList.length + ' 条' +
      (logs.length !== monthList.length ? ' · 全部 ' + logs.length + ' 条' : '') +
      '；同一天同一班次只保留一份，可点「打开」补录';

    var card = U.h('<section class="card sl-history">' +
      '<div class="card-head">' +
        '<div><h3>交接班记录</h3><div class="sub">' + U.esc(headSub) + '</div></div>' +
        '<div class="sl-monthbar">' +
          '<div class="month-nav">' +
            '<button type="button" class="btn sm ghost js-m-prev" title="上一月" aria-label="上一月">‹</button>' +
            '<input type="month" class="input js-m-input" value="' + U.esc(f.month) + '" aria-label="选择月份">' +
            '<button type="button" class="btn sm ghost js-m-next" title="下一月" aria-label="下一月">›</button>' +
            (f.month === CUR_MONTH ? '' : '<button type="button" class="btn sm ghost js-m-now">回到本月</button>') +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="js-body"></div></section>');
    var hbody = card.querySelector('.js-body');
    host.appendChild(card);

    card.querySelector('.js-m-prev').addEventListener('click', function () { goMonth(shiftMonth(f.month, -1)); });
    card.querySelector('.js-m-next').addEventListener('click', function () { goMonth(shiftMonth(f.month, 1)); });
    var mInput = card.querySelector('.js-m-input');
    mInput.addEventListener('change', function () { goMonth(mInput.value); });
    var mNow = card.querySelector('.js-m-now');
    if (mNow) mNow.addEventListener('click', function () { goMonth(CUR_MONTH); });

    var sorted = monthList.slice().sort(function (a, b) {
      if (a.date === b.date) return shiftName(a.shift) > shiftName(b.shift) ? 1 : -1;
      return String(b.date) > String(a.date) ? 1 : -1;
    });

    if (!logs.length) {
      hbody.appendChild(SD.comp.state.build('empty', {
        title: '还没有交接班记录',
        desc: ro ? '切换日期后点开当天的记录即可查看。' : '上方表格填好后点「保存记录」，这里就会按月列出来。'
      }));
    } else if (!monthList.length) {
      /* 有记录、但这个月没有 → 说清是哪个月空着，并给「回到本月」的出口 */
      hbody.appendChild(SD.comp.state.build('empty', {
        title: fmtMonth(f.month) + '还没有交接班记录',
        desc: '这个月没有记录。用上面的月份选择器切到其它月份查看，或直接回到本月。',
        action: f.month === CUR_MONTH ? null : {
          text: '回到本月', icon: 'calendar', onClick: function () { goMonth(CUR_MONTH); }
        }
      }));
    } else {
      hbody.appendChild(SD.comp.table.build({
        columns: [
          { key: 'date', title: '日期', sortable: false, render: function (r) { return '<span class="num">' + U.esc(r.date) + '</span>'; } },
          { key: 'shift', title: '班次', render: function (r) { return U.esc(shiftName(r.shift)); } },
          { key: 'done', title: '已检查', align: 'center', render: function (r) { var t = statOf(r); return '<span class="num">' + t.done + ' / ' + ITEMS.length + '</span>'; } },
          {
            key: 'bad', title: '异常', align: 'center',
            render: function (r) {
              var t = statOf(r);
              return t.bad ? '<span class="badge badge-danger">' + t.bad + ' 项</span>' : '<span class="t-3">—</span>';
            }
          },
          { key: 'events', title: '备注事件', align: 'center', render: function (r) { return '<span class="num">' + (r.events || []).length + ' 条</span>'; } },
          { key: 'inspector', title: '巡查人员', render: function (r) { return r.inspector ? U.esc(r.inspector) : '<span class="t-3">（空）</span>'; } },
          {
            key: '_ops', title: '操作', align: 'right',
            render: function (r) {
              return '<div class="cell-actions">' +
                '<button class="btn sm ghost" data-act="slopen" data-id="' + r.id + '">打开</button>' +
                SD.comp.dropdown.opsButton('slops', r.id) + '</div>';
            }
          }
        ],
        rows: sorted, minWidth: 860
      }));

      U.on(hbody, 'click', '[data-act="slopen"]', function (e, el) {
        var r = logs.filter(function (x) { return x.id === el.dataset.id; })[0];
        if (!r) return;
        f.date = r.date; f.shift = r.shift;
        ctx.refresh();
        window.scrollTo && window.scrollTo({ top: 0, behavior: 'smooth' });
      });

      U.on(hbody, 'click', '[data-act="slops"]', function (e, el) {
        var id = el.dataset.id;
        var r = logs.filter(function (x) { return x.id === id; })[0];
        if (!r) return;
        SD.comp.dropdown.open({
          anchor: el,
          items: [
            { act: 'open', text: '打开' },
            { act: 'print', text: '打印这一份' },
            /* ★ 2026-11-10：受限模式下导出与删除都锁定（只留查看与打印）。
               导出在 exportXlsx 入口还有一道守卫，这里禁用是为了不让人白点。 */
            { act: 'xls', text: ro ? '导出 Excel（受限模式不可用）' : '导出 Excel', disabled: ro },
            { act: 'del', text: ro ? '删除（受限模式不可用）' : '删除', danger: true, disabled: ro }
          ],
          onPick: function (it) {
            if (it.act === 'open') { f.date = r.date; f.shift = r.shift; ctx.refresh(); }
            else if (it.act === 'print') openPrint(normalize(r, r.date, r.shift));
            else if (it.act === 'xls') exportXlsx(normalize(r, r.date, r.shift));
            else if (it.act === 'del') remove(ctx, r);
          }
        });
      });
    }
  }

  /* ---------------- 保存 ---------------- */
  function save(cur) {
    if (readOnly()) { U.toast('受限模式：保存需要安全员权限（点右上角解锁）', 'err'); return; }
    if (!cur.date) { U.toast('请先选日期', 'err'); return; }
    if (!cur.shift) { U.toast('请先选班次', 'err'); return; }

    var payload = {
      date: cur.date,
      shift: cur.shift,
      inspector: cur.inspector || '',
      checks: cur.checks.slice(),
      events: cur.events.map(function (x) { return String(x || '').trim(); }).filter(function (x) { return !!x; }),
      updatedAt: U.today() + ' ' + new Date().toTimeString().slice(0, 5)
    };

    var p = cur.id ? SD.api.updateShiftLog(cur.id, payload) : SD.api.createShiftLog(payload);
    p.then(function () {
      /* 保存的这一天不在当前查看的月份里 → 把列表切到那份记录所在的月，
         免得出现「保存成功，列表里却看不见」（★ 2026-11-04 按月展示后新增） */
      var fl = (SD.app && SD.app.state && SD.app.state.filters) ? SD.app.state.filters.shift : null;
      var sm = monthOf(payload.date);
      if (fl && sm) fl.month = sm;
      U.toast(cur.id ? '已保存（覆盖本班次记录）' : '已保存本班次记录', 'ok');
      SD.app.reload();
    }, function (e) {
      U.toast('保存失败：' + (e && e.message ? e.message : e), 'err');
    });
  }

  function remove(ctx, r) {
    if (readOnly()) { U.toast('受限模式：删除需要安全员权限', 'err'); return; }
    SD.comp.dialog.confirm({
      title: '删除交接班记录',
      message: '将删除 ' + r.date + ' ' + shiftName(r.shift) + ' 这份记录（含 ' + (r.events || []).length + ' 条备注事件）。删除后不可恢复。',
      okText: '确认删除', danger: true,
      onOk: function () {
        return SD.api.removeShiftLog(r.id).then(function () {
          U.toast('已删除', 'ok');
          ctx.reload();
        });
      }
    });
  }

  /* ---------------- 打印出件（A4 横向 + 常规页边距，自动缩放到一页） ---------------- */
  /** 打印/导出时巡查人员一律留空（留位手签） */
  function printInspector() { return ''; }

  function sheetRowsHtml(rec, forPaper) {
    var out = [];
    var lastG = '', span = 0;
    ITEMS.forEach(function (it, i) {
      var mk = checkOf(rec.checks[i]).mark;
      var cell = mk ? '<span class="sl-mark' + (mk === '×' ? ' sl-mark-bad' : '') + '">' + mk + '</span>' : '';
      out.push('<tr class="c-r-item' + (i === ITEMS.length - 1 ? ' is-last' : '') + '">' +
        '<td class="c-no">' + (i + 1) + '</td>' +
        (it.g !== lastG
          ? (function () {
              lastG = it.g;
              span = ITEMS.filter(function (x) { return x.g === it.g; }).length;
              return '<td class="c-group" rowspan="' + span + '">' + U.esc(it.g) + '</td>';
            })()
          : '') +
        '<td class="c-item">' + U.esc(it.t) + '</td>' +
        '<td class="c-check">' + cell + '</td>' +
        (i === 0 ? '<td class="c-note" rowspan="' + ITEMS.length + '">' + eventsHtml(rec) + '</td>' : '') +
      '</tr>');
    });
    return out.join('');
  }

  function eventsHtml(rec) {
    var evs = (rec.events || []).map(function (x) { return String(x || '').trim(); }).filter(function (x) { return !!x; });
    if (!evs.length) return '<div class="sl-note-lines">' + new Array(6).join('<div class="sl-note-line"></div>') + '</div>';
    return '<div class="sl-note-lines">' + evs.map(function (t, i) {
      return '<div class="sl-note-line"><span class="sl-note-no">' + (i + 1) + '、</span>' + U.esc(t) + '</div>';
    }).join('') + '</div>';
  }

  function paperHtml(rec) {
    /* ★ 标识 / 标题 / 抬头 / 表头 **全部放进 <thead>**：
       · 浏览器总是把 thead 渲染到表格最上面（与源码顺序无关），
         只把表头放进 thead 会让「序号/检查项…」跑到 logo 和标题上面去；
       · 一起放进 thead 后顺序正确，且内容超过一页时**标题与表头会在每页顶部重复**，
         正是这种交接班表单想要的效果。 */
    return '<table class="sl-paper-table">' + colGroupHtml() +
      '<thead>' +
      logoRowHtml('c-r-logo', 'c-logo-cell', 'c-logo') +
      '<tr class="c-r-title"><td class="c-title" colspan="5">现场安全巡检与交接班记录</td></tr>' +
      '<tr class="c-r-meta">' +
        '<td class="c-meta c-meta-main" colspan="3">厂区：<b>' + U.esc(cfg().plant) + '</b>　　部门：<b>' + U.esc(cfg().dept) + '</b>' +
          '　　巡检人员：<span class="c-blank">' + U.esc(printInspector(rec)) + '</span>　　班次：' + U.esc(shiftName(rec.shift)) + '</td>' +
        '<td class="c-meta" colspan="2">日期：' + U.esc(rec.date) + '</td>' +
      '</tr>' +
      '<tr class="c-r-head c-head">' +
        '<th class="c-no">序号</th><th class="c-group">检查项</th><th class="c-item">检查内容</th>' +
        '<th class="c-check">检查情况</th>' +
        '<th class="c-note">备   注<span class="c-sub">（当班工作情况及其它情况）</span></th></tr>' +
      '</thead>' +
      '<tbody>' +
      sheetRowsHtml(rec) +
      '<tr class="c-r-foot"><td class="c-foot" colspan="5">　　　　注：检查情况正常打“√”，异常打“×”并如实记录异常情况。</td></tr>' +
      '</tbody></table>';
  }

  /* ★ 2026-10-25：打印页自动缩放到「刚好一页 A4 横向」——版式与保存页（Excel）一致
     A4 横向 297×210mm，常规页边距（左右 0.7in≈18mm、上下 0.75in≈19mm）
     → 可印区 261×172mm。按纸张实际渲染出来的尺寸算缩放比（只缩不放），
     算完把外层容器收成缩放后的尺寸，预览和真打印走同一套样式，不会溢出到第二页。 */
  var MMPX = 96 / 25.4;                       /* 1mm ≈ 3.7795px */
  var PAGE_W = 261 * MMPX, PAGE_H = 172 * MMPX;   /* A4 横向可印区（常规页边距 18/19mm） */
  /* ★ 自动缩放的最低比例：缩到 75% 还装不下，就**不再缩**，按原大分页。
     理由：50% 时 11pt 只剩 5.5pt，打印出来看不清；与其又小又断，不如按原大排满宽度、
     老老实实分页（表头每页重复）。75% → 8.25pt，是还能看清的下限。 */
  var SHRINK_FLOOR = 0.75;

  function openPrint(rec) {
    var pageStyle = document.createElement('style');
    pageStyle.id = 'slPageStyle';
    /* 常规页边距：左右 18mm（0.7in）、上下 19mm（0.75in），与保存页 Excel 的「普通」预设一致 */
    pageStyle.textContent = '@media print{@page{size:A4 landscape;margin:19mm 18mm}}';
    document.head.appendChild(pageStyle);

    var mask = U.h('<div class="pn-overlay sl-overlay">' +
      '<div class="pn-toolbar">' +
        '<span class="pn-tb-title">安全巡检与交接班记录</span>' +
        '<span class="sl-pn-tip js-sl-tip">巡查人员按惯例留空手签；A4 横向 + 常规页边距，横向铺满可印区、纵向压缩行距，刚好一页</span>' +
        '<span class="pn-spacer"></span>' +
        '<button class="btn primary js-sl-print">' + SD.icons.get('printer', 14) + '打印</button>' +
        '<button class="btn ghost js-sl-close">关闭</button>' +
      '</div>' +
      /* ★ 这里**不能**再带 .pn-sheet：那个类是通知书用的 A4 纵向纸张
         （print.css 里 width:210mm / padding:20.4mm 24.8mm / min-height:297mm），
         而 print.css 在 components.css 之后加载、优先级相同 → 会把 .sl-sheet 的
         248mm 宽 / 0 内边距 / 160mm 最小高整个盖掉，
         结果纸张变成 210×325mm（窄一半、高一倍）→ 表格被挤、文字折行、一页装不下。 */
      '<div class="pn-wrap"><div class="sl-fit">' +
        '<div class="sl-sheet">' + paperHtml(rec) + '</div>' +
      '</div></div>' +
    '</div>');

    /** 浏览器是否真的支持 zoom（会影响布局，从而影响打印分页）
        ★ 不能用 scrollHeight 判断：Chrome 里给元素加 zoom 后 scrollHeight **仍报未缩放值**，
          拿它做判据会永远判成"不支持"，一路退回 transform —— 而 transform 只改画面、
          不改布局，打印时仍按原尺寸分页 → 预览一页、真打印两三页、文字还被挤小。
          正确做法：量 getBoundingClientRect()，它是会被 zoom 影响的。 */
    function zoomWorks(sample) {
      if (sample.__zoomOk != null) return sample.__zoomOk;
      var old = sample.style.zoom;
      sample.style.zoom = '';
      var w1 = sample.getBoundingClientRect().width;
      sample.style.zoom = '0.5';
      var w2 = sample.getBoundingClientRect().width;
      sample.style.zoom = old;
      sample.__zoomOk = (w1 > 0 && Math.abs(w2 - w1 * 0.5) < 1.5);
      return sample.__zoomOk;
    }

    /** 量实际尺寸 → 算缩放比 → 应用（量不到就原样，绝不瞎缩）
        ★ 2026-10-25（十二）：纸张本身已按「横向铺满可印区 + 行高压缩」设计好，
          正常内容量时 s = 1 → **一点都不缩放**，横向吃满 260mm、字保持 11pt 原大；
          只有备注特别多、纵向真的超了，才整体等比缩小（最小 50%），且缩小只作为兜底。
        · zoom 改的是**布局尺寸**：打印分页按缩放后的高度算 → 预览与真打印同一页；
        · 浏览器不支持 zoom 时退回 transform（只影响画面，预览仍正确）。 */
    function fitToPage() {
      var sheet = mask.querySelector('.sl-sheet');
      if (!sheet) return;
      sheet.style.zoom = '';
      sheet.style.transform = '';
      var box = sheet.getBoundingClientRect();
      var w = box.width || 0, h = box.height || 0;
      if (!w || !h) return;
      var s = Math.min(PAGE_W / w, PAGE_H / h, 1);
      /* 三种情形：装得下 → 不缩（铺满宽度）；略超 → 等比缩一页；超太多 → 不缩，按原大分页 */
      var mode = 'fit';
      if (s >= 0.995) {
        s = 1;
      } else if (s >= SHRINK_FLOOR) {
        mode = 'shrink';
        s = Math.max(SHRINK_FLOOR, Math.floor(s * 0.985 * 100) / 100);   /* 1.5% 余量防亚像素换页 */
        if (zoomWorks(sheet)) {
          sheet.style.zoom = String(s);
        } else {
          sheet.style.transformOrigin = 'top left';
          sheet.style.transform = 'scale(' + s + ')';
        }
      } else {
        mode = 'paginate';
        s = 1;
      }
      var tip = mask.querySelector('.js-sl-tip');
      if (tip) {
        tip.textContent = '巡查人员按惯例留空手签；A4 横向 + 常规页边距（左右 18mm / 上下 19mm），' +
          (mode === 'shrink'
            ? '内容偏多，已整体缩放到 ' + Math.round(s * 100) + '% 保证一页 A4 打全；'
            : mode === 'paginate'
              ? '备注过多，按原大 100% 分页打印（不缩小，保证看得清），表头每页重复；'
              : '横向铺满可印区、纵向压缩行距，刚好一页（未缩放，100%）；') +
          '表头与标题每页重复';
      }
    }

    function close() {
      window.removeEventListener('resize', fitToPage);
      if (mask.parentNode) mask.parentNode.removeChild(mask);
      if (pageStyle.parentNode) pageStyle.parentNode.removeChild(pageStyle);
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }

    mask.querySelector('.js-sl-close').addEventListener('click', close);
    mask.querySelector('.js-sl-print').addEventListener('click', function () {
      try { window.print(); } catch (e) { U.toast('当前环境不支持直接打印，可改用「导出 Excel」', 'err'); }
    });
    mask.addEventListener('click', function (e) { if (e.target === mask) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(mask);
    /* 挂到文档后再量：没布局拿不到真实尺寸 */
    fitToPage();
    window.addEventListener('resize', fitToPage);
    setTimeout(fitToPage, 60);       /* 字体异步加载完再量一次，避免算小 */
  }

  /* ---------------- 导出 Excel（与屏幕同版式） ---------------- */
  /** 把某一天某一班次的记录构造成一张「交接班记录」sheet（导出用）。
      rec 为 normalize 后的记录对象；sheetName 是这张 sheet 的标签名（如「11-01 白班」）。
      ★ 2026-11-03：从 exportXlsx 里抽出来，让「白班 + 夜班」两张表各调一次。 */
  /** 把某一班次的记录构造成「一张交接班表」的行数组（不含 sheet 外壳）。
      ★ 2026-11-03 从 buildSheet 里抽出：白班 + 夜班两张表放同一 sheet 时，
      concat 两个 buildRows 即可，xlsxWriter 会按数组下标自动重排行号与合并引用。 */
  function buildRows(rec) {
    var head = ['序号', '检查项', '检查内容', '检查情况', '备   注\n（当班工作情况及其它情况）'];
    var rows = [];
    /* 行高直接照抄原表：第 1 行 30pt（空行放左上角标识）/ 标题 27 / 抬头 22 / 表头 30.5 /
       明细 20.5 / 表尾 17.5（单位 pt）。标题行与厂区行按用户要求**不画边框、居中**排列。 */
    rows.push([{ v: '', h: 30 }]);                       /* 第 1 行：左上角公司标识 */
    rows.push([{ v: '现场安全巡检与交接班记录', font: FONT, bold: true, size: 16, align: 'center', valign: 'center', mergeAcross: 4, h: 27 }]);
    rows.push([
      /* 班次并进厂区这个格子（A3:C3）；D3:E3 合并留给日期。
         两个格子都必须显式写 col，否则会按顺序落到被合并掉的列上被一口吃掉。 */
      { v: '厂区：' + cfg().plant + '　　部门：' + cfg().dept + '　　巡检人员：' + INSP_BLANK +
             '　　班次：' + shiftName(rec.shift), font: FONT, col: 0, align: 'center', valign: 'center', mergeAcross: 2, h: 22, border: bd(0, 0, 0, MED) },
      { v: '日期：' + rec.date, font: FONT, col: 3, align: 'center', valign: 'center', mergeAcross: 1, h: 22 }
    ]);
    /* 表头（第 4 行）逐边边框照原表：A 左/上/下 medium，B 四边 medium，
       C 只有上下线（没有竖线），D 四边 medium，E 四边 medium */
    var HB = [bd(MED, 0, MED, MED), bd(MED, MED, MED, MED), bd(0, 0, MED, MED),
              bd(MED, MED, MED, MED), bd(MED, MED, MED, MED)];
    rows.push(head.map(function (h, ci) {
      /* 原表表头就是宋体 11pt 加粗、**没有底纹**，照抄 */
      return { v: h, col: ci, font: FONT, bold: true, align: 'center', valign: 'center', border: HB[ci], wrap: true, h: 30.5 };
    }));

    /* 明细行行高：24pt —— 与保存页那份文件一致（比原表 20.5pt 高一点，现场好写字）。
       列宽已加宽到 78，最长的一条一行放得下，不会因为行高固定而被截断。 */
    var ROW_ITEM = 24;
    function itemHeight(t) {
      var w = 0;
      for (var k = 0; k < t.length; k++) w += t.charCodeAt(k) > 255 ? 2 : 1;
      var lines = Math.max(1, Math.ceil(w / (COLW[2] - 1)));
      return Math.max(ROW_ITEM, lines * 18);
    }

    var evs = (rec.events || []).map(function (x) { return String(x || '').trim(); }).filter(function (x) { return !!x; });
    var lastG = '', span = 0, gStart = 0;
    ITEMS.forEach(function (it, i) {
      var isNewG = it.g !== lastG;
      if (isNewG) {
        lastG = it.g; gStart = i; span = ITEMS.filter(function (x) { return x.g === it.g; }).length;
      }
      var h = itemHeight(it.t);
      var BB = itemBorders(i, gStart, span);   /* 五格逐边边框（照原表） */

      var cells = [];
      cells.push({ v: i + 1, col: 0, font: FONT, border: BB[0], align: 'center', valign: 'center', h: h });
      cells.push(isNewG
        ? { v: it.g, col: 1, font: FONT, border: BB[1], align: 'center', valign: 'center', wrap: true, mergeDown: span - 1 }
        : { v: '', col: 1, border: (i - gStart === span - 1) ? BB[1] : bd(MED, MED, 0, 0) });
      cells.push({ v: it.t, col: 2, font: FONT, border: BB[2], align: 'left', valign: 'center', wrap: true });
      cells.push({ v: checkOf(rec.checks[i]).mark, col: 3, font: FONT, border: BB[3], align: 'center', valign: 'center' });
      cells.push(i === 0
        /* 备注：一条一行，编号 1、2、3…；wrap 打开，不然 Excel 里会挤成一行（原表也是整格合并） */
        ? {
            v: evs.length ? evs.map(function (t, k) { return (k + 1) + '、' + t; }).join('\n') : '',
            col: 4, font: FONT, border: BB[4], align: 'left', valign: 'top', wrap: true, mergeDown: ITEMS.length - 1
          }
        /* 末行的占位格也要带下外框，不然整张表右下角缺一条线（原表 E23 有 medium 下框） */
        : { v: '', col: 4, border: (i === ITEMS.length - 1) ? BB[4] : bd(MED, MED, 0, 0) });
      rows.push(cells);
    });
    rows.push([{ v: '    注：检查情况正常打“√”，异常打“×”并如实记录异常情况。', font: FONT, align: 'left', valign: 'center', mergeAcross: 4, size: 11, h: 17.5 }]);

    return rows;
  }

  /** 把某一天某一班次的记录构造成一张「交接班记录」sheet（导出用）。
      rec 为 normalize 后的记录对象；sheetName 是这张 sheet 的标签名（如「11-01 白班」）。 */
  function buildSheet(rec, sheetName) {
    var rows = buildRows(rec);
    return {
      name: sheetName,
      /* 列宽：照原表并微调（序号 6.5 / 检查项 9 / 检查内容 78 / 检查情况 5.66 / 备注 40） */
      cols: COLW.map(function (w) { return { width: w }; }),
      rows: rows,
      /* 出件就是为了打印：A4 **横向** + **常规页边距**（Excel「普通」预设 0.7/0.75 英寸）
         + 缩放到一页，内容一条都不会漏到第二页 */
      page: {
        orientation: 'landscape', paperSize: 9, fitToWidth: 1, fitToHeight: 1,
        margins: { left: 0.7, right: 0.7, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 }
      },
      /* 左上角公司标识（钉在第 1 行 A1，尺寸照原表） */
      image: window.SD && SD.BRAND_LOGO
        ? { data: SD.BRAND_LOGO.base64, w: LOGO_W, h: LOGO_H, col: 0, row: 0, colOff: 6350, rowOff: 85725 }
        : null
    };
  }

  /** 导出 Excel：当日「白班 + 夜班」两张表各出一个 sheet（★ 2026-11-04 修正）
      每个 sheet 各自 fitToPage 缩放到恰好一页 —— 白班 sheet 第 1 页、夜班 sheet 第 2 页，
      双击打印选「双面打印」即正面白班、反面夜班。
      ★ 为什么不用「一个 sheet + 行分页符」：fitToPage（缩成一页）与 rowBreaks（行分页）
        在 OOXML 里互斥——设了 fitToPage 会把两张表 48 行硬缩成一页、分页符失效；
        不设 fitToPage 则每张 24 行的表本身就超一页可印高度、会裂成 2~3 页。
        所以「一页一张表 + 双面打印」只能靠两个 sheet 各 fitToPage 一页实现。
      某个班次当天还没记录时，仍导一张空表（检查项照旧、勾选/备注留空、巡检人员留手签位）。 */
  function exportXlsx(rec) {
    /* ★ 2026-11-10：受限模式不允许导出交接班记录。
       守卫放在**函数入口**而不是只禁按钮 —— 工具栏按钮、行操作菜单的「导出 Excel」、
       以及以后新增的任何入口都会走到这里，一处堵住最可靠（按钮禁用只是视觉提示）。 */
    if (!SD.auth.can('data.write')) {
      U.toast('受限模式：导出交接班记录需要安全员权限。点右上角「受限模式」输入六位密码解锁。', 'err');
      return;
    }
    var logs = (SD.app && SD.app.state && SD.app.state.summary)
      ? (SD.app.state.summary.shiftLogs || []): [];

    var date = rec.date;
    var dayRec = normalize(findRec(logs, date, 'day'), date, 'day');
    var nightRec = normalize(findRec(logs, date, 'night'), date, 'night');

    var sheets = [
      buildSheet(dayRec, date + ' 白班'),
      buildSheet(nightRec, date + ' 夜班')
    ];

    try {
      var blob = SD.comp.xlsxWriter.build(sheets);
      SD.comp.xlsxWriter.download(blob, '安全巡检交接班记录-' + date + '-白夜班.xlsx');
      U.toast('已导出当日白班、夜班两张表（两个 sheet，各一页，可双面打印）', 'ok');
    } catch (e) {
      U.toast('导出失败：' + (e && e.message ? e.message : e), 'err');
    }
  }

  return {
    name: '安全巡检交接班记录', sub: sub, render: render, ITEMS: ITEMS, CHECKS: CHECKS,
    /* 导入辅助（测试入口，便于冒烟校验「每日安全记录 → 备注事件」的映射） */
    _dailyEventsFor: dailyEventsFor,
    _normalizeDailyDate: normalizeDailyDate,
    _composeDailyEvent: composeDailyEvent
  };
})();
