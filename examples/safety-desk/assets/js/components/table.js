/* =========================================================
   table.js — 可复用表格
   ────────────────────────────────────────────────────────
   · 列定义驱动：{key,title,sortable,align,render(row)}
   · 排序只负责「发信号」，真正的重排由视图的 refreshAll 完成
     （严禁表格内部直接改数据后自己重绘，避免调用链成环）
   · 空数据/加载中/失败由调用方用 state.render 处理，表格只管有数据的情况
   ========================================================= */
window.SD = window.SD || {};
SD.comp = SD.comp || {};

SD.comp.table = (function () {
  var U = SD.utils;

  /**
   * @param {object} o
   *   columns  列定义数组
   *   rows     数据行
   *   sort     {key, dir:'asc'|'desc'}
   *   onSort   function(key, dir)
   *   rowClass function(row) → class 字符串
   *   onRowClick function(row)
   *   minWidth 表格最小宽度（默认 720）
   */
  function build(o) {
    o = o || {};
    var cols = o.columns || [];
    var rows = o.rows || [];
    var sort = o.sort || null;

    var wrap = U.h('<div class="table-wrap"><div class="table-scroll"></div></div>');
    var scroll = wrap.querySelector('.table-scroll');

    var table = U.h('<table class="tbl" style="min-width:' + (o.minWidth || 720) + 'px"></table>');

    /* 表头 */
    var thead = U.h('<thead><tr></tr></thead>');
    var trh = thead.querySelector('tr');
    cols.forEach(function (c) {
      var sk = c.sortKey || c.key;                 // 复合列按 sortKey 排序
      var isSorted = sort && sort.key === sk;
      var arrow = isSorted ? (sort.dir === 'asc' ? '▲' : '▼') : '';
      var th = U.h(
        '<th' + (c.sortable ? ' class="sortable"' : '') +
        (c.align ? ' style="text-align:' + c.align + '"' : '') + '>' +
        U.esc(c.title || '') +
        (c.sortable ? '<span class="arrow' + (isSorted ? ' on' : '') + '">' + arrow + '</span>' : '') +
        '</th>'
      );
      if (c.sortable && typeof o.onSort === 'function') {
        th.addEventListener('click', function () {
          var dir = (isSorted && sort.dir === 'asc') ? 'desc' : 'asc';
          o.onSort(sk, dir);
        });
      }
      trh.appendChild(th);
    });
    table.appendChild(thead);

    /* 表体 */
    var tbody = U.h('<tbody></tbody>');
    rows.forEach(function (row) {
      var cls = (typeof o.rowClass === 'function') ? (o.rowClass(row) || '') : '';
      var tr = U.h('<tr' + (cls ? ' class="' + cls + '"' : '') + '></tr>');
      cols.forEach(function (c) {
        var html = '';
        if (typeof c.render === 'function') html = c.render(row);
        else if (c.key) html = U.esc(row[c.key] == null ? '—' : row[c.key]);
        var td = U.h('<td' + (c.align ? ' style="text-align:' + c.align + '"' : '') + '>' + html + '</td>');
        tr.appendChild(td);
      });
      if (typeof o.onRowClick === 'function') {
        tr.style.cursor = 'pointer';
        tr.addEventListener('click', function (e) {
          // 行内按钮自行处理，不触发整行点击
          if (e.target && e.target.closest && e.target.closest('button')) return;
          o.onRowClick(row);
        });
      }
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    scroll.appendChild(table);
    return wrap;
  }

  /** 表格头部工具条（标题 + 计数 + 右侧操作槽） */
  function toolbar(o) {
    o = o || {};
    var el = U.h(
      '<div class="section-head">' +
        '<div><h2>' + U.esc(o.title || '') + '</h2>' +
        (o.sub ? '<div class="sub">' + U.esc(o.sub) + '</div>' : '') + '</div>' +
        '<div class="actions"></div>' +
      '</div>'
    );
    var box = el.querySelector('.actions');
    (o.actions || []).forEach(function (a) {
      var b = U.h('<button class="btn ' + (a.cls || 'ghost') + '">' +
        (a.icon ? SD.icons.get(a.icon, 15) : '') + U.esc(a.text) + '</button>');
      if (typeof a.onClick === 'function') b.addEventListener('click', a.onClick);
      box.appendChild(b);
    });
    return el;
  }

  return { build: build, toolbar: toolbar };
})();
