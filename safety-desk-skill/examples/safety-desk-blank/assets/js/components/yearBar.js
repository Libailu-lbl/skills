/* =========================================================
   components/yearBar.js — 「按年查看」控件（★ 2026-11-04 新增）
   ────────────────────────────────────────────────────────
   隐患管理 / 安全巡检 / 安全培训 / 通知公告四个列表页共用：
   列表默认只显示**当年**的记录，可用年份下拉切到其它年份，非当年时
   右侧出现「回到今年」。

   ★ 为什么必须有年份下拉（不能只做「默认当年」了事）：
     只过滤不给切换 → 往年的记录在界面上**彻底看不到**，等于把历史数据藏了。
     所以「默认当年」+「可切任意有数据的年份」是一套的。

   ★ 归年口径（各页只在 YEAR_FIELDS 里列字段名，规则统一在这里）：
     按字段顺序取第一个能解析出年份的值；全都取不到就归入**当年**
     （宁可归错年也别让记录从年视图里消失）。

   ★ 年份只是**列表的视图过滤**：不写库、不改数据、不影响 metrics
     与导航摘要；刷新页面即回当年（年份只存在内存的 filters 里）。

   对外 API（SD.comp.yearBar）：
     yearOf(v)                       → '2026' | ''
     yearOfRecord(rec, fields, cur)   → 归年（见上）
     yearsOf(rows, fields, cur)       → ['2026','2025',…]（倒序，含当年）
     build({ value, cur, years, count, total, onChange, label, tip })
                                     → <div class="fg year-fg">…</div>
   ========================================================= */
window.SD = window.SD || {};
SD.comp = SD.comp || {};

SD.comp.yearBar = (function () {
  var U = SD.utils;

  /** 'YYYY-MM-DD' / 'YYYY/MM/DD' / 'YYYY-MM' / 'YYYY' → 'YYYY'；取不到返回 '' */
  function yearOf(v) {
    var s = String(v == null ? '' : v).trim();
    var hit = /^(\d{4})(?:[-\/.]|$)/.exec(s);
    if (!hit) return '';
    var y = Number(hit[1]);
    return (y >= 1970 && y <= 2999) ? hit[1] : '';
  }

  /** 一条记录归哪一年：按 fields 顺序取第一个能解析出年份的字段，全空则 fallback */
  function yearOfRecord(rec, fields, fallback) {
    var fs = fields || [];
    for (var i = 0; i < fs.length; i++) {
      var y = yearOf(rec && rec[fs[i]]);
      if (y) return y;
    }
    return fallback;
  }

  /** 数据里出现过的年份（含当年），倒序，可直接喂给 build 的 years */
  function yearsOf(rows, fields, cur) {
    var set = {};
    if (cur) set[cur] = 1;
    (rows || []).forEach(function (r) {
      var y = yearOfRecord(r, fields, '');
      if (y) set[y] = 1;
    });
    return Object.keys(set).sort(function (a, b) { return String(b) > String(a) ? 1 : -1; });
  }

  /**
   * 渲染「年份」控件
   * @param {object} o
   *   value    当前所选年 'YYYY'
   *   cur      今年 'YYYY'（不等时显示「回到今年」）
   *   years    可选年份数组（一般传 yearsOf 的结果）
   *   count    当年条数（传了才显示计数）
   *   total    全部条数（与 count 不同才补「· 全部 N 条」）
   *   onChange 选中/回到今年时回调，入参是年份
   *   label    标签文案，默认「年份」，传 false 不要标签
   *   tip      下拉的 title 提示（说明归年口径）
   */
  function build(o) {
    o = o || {};
    var cur = o.cur || '';
    var val = yearOf(o.value) || cur;
    var years = (o.years || []).slice();

    /* 当年与所选年一定在选项里：数据里可能一年都没有，靠这两项兜住 */
    [cur, val].forEach(function (y) {
      if (y && years.indexOf(y) < 0) years.push(y);
    });
    years.sort(function (a, b) { return String(b) > String(a) ? 1 : -1; });

    var box = U.h('<div class="fg year-fg"></div>');
    if (o.label !== false) box.appendChild(U.h('<label>' + U.esc(o.label || '年份') + '</label>'));

    var sel = U.h('<select class="ctl-select js-year-sel" title="' +
      U.esc(o.tip || '按年份查看，默认当年') + '"></select>');
    sel.innerHTML = years.map(function (y) {
      return '<option value="' + U.esc(y) + '"' + (y === val ? ' selected' : '') + '>' + U.esc(y) + ' 年</option>';
    }).join('');
    sel.addEventListener('change', function () {
      if (typeof o.onChange === 'function') o.onChange(sel.value);
    });
    box.appendChild(sel);

    /* 非当年才给「回到今年」——当年时藏起来，省一个按钮的位置 */
    if (val !== cur && cur) {
      var now = U.h('<button type="button" class="btn sm ghost js-year-now" title="回到今年（' +
        U.esc(cur) + ' 年）">回到今年</button>');
      now.addEventListener('click', function () {
        if (typeof o.onChange === 'function') o.onChange(cur);
      });
      box.appendChild(now);
    }

    if (o.count != null) {
      var txt = val + ' 年 共 ' + o.count + ' 条' +
        (o.total != null && o.total !== o.count ? ' · 全部 ' + o.total + ' 条' : '');
      box.appendChild(U.h('<span class="t-3 t-sm year-count">' + U.esc(txt) + '</span>'));
    }
    return box;
  }

  return { yearOf: yearOf, yearOfRecord: yearOfRecord, yearsOf: yearsOf, build: build };
})();
