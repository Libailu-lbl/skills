/* =========================================================
   components/problemRows.js — 分部门问题明细行编辑器（★ 2026-11-12 新增）
   ────────────────────────────────────────────────────────
   为什么要有它：
     巡检单原来是「一个部门 + 一个条数 + 一个等级 + 一组照片」的扁平结构，
     一条单只能表达一个部门的隐患。现场实际是：一趟巡检走几个车间，
     每个车间各有各的问题，回来要分开登记、看板还要分部门汇总。

   ⚠️ 为什么不用 formDialog：
     formDialog 是「字段驱动」的，类型枚举里没有数组/重复行，
     每个控件 id 固定 `#ff_<name>`，readValues 用 querySelector 只取第一个元素，
     照片也只按字段名挂一个实例 —— 天然装不下「N 行、每行一套控件」。
     改它要动 controlHtml / readValues / validate / onMount 四处，
     十种既有字段全得回归，风险远大于收益。所以这里做成独立组件，
     由 inspection.js 通过 formDialog 的表单级 onMount 挂进表单体。

   ⚠️ 三条硬约束（踩过就别再犯）：
     1. 行内**绝不能用 `ff_*` 作 id**。formDialog.readValues 用
        `querySelector('#ff_' + name)` 取值，行内一旦出现第二个 #ff_photos，
        主表单的照片就会串到这行来。一律用 `data-role` + class。
     2. `onChange` 只能刷新汇总行文本，**绝不重绘行容器**：
        photoPicker 的状态在闭包里、没有 destroy，重绘一次已选照片全丢。
     3. 删除要二次确认，但**不要开 dialog**：dialog 的 ESC 处理是模块级单变量，
        嵌套时按 ESC 会误关父弹窗（父表单一关，未保存的录入就没了）。
        这里改成「再点一次删除」的按钮态，简单且零副作用。

   用法：
     var ed = SD.comp.problemRows.mount(host, { value: t.problems, depts: [...] });
     ed.get()       // → [{id, dept, content, type, level, count, photos, fixDueDate, fixDate, fixPhotos}]
     ed.validate()  // → '第 2 行：…' 或 null
     ed.set(list)   // 整体替换（打开编辑时用）
   ========================================================= */
window.SD = window.SD || {};
SD.comp = SD.comp || {};

SD.comp.problemRows = (function () {
  var U = SD.utils;
  var seq = 0;                       // 实例序号：保证 datalist id 全局唯一

  function esc(v) { return U.esc(v == null ? '' : String(v)); }

  function levelOpts(cur) {
    var list = [{ v: '', n: '未定级' }].concat(SD.dict.DICT.severity || []);
    return list.map(function (o) {
      return '<option value="' + esc(o.v) + '"' +
        (String(o.v) === String(cur || '') ? ' selected' : '') + '>' + esc(o.n) + '</option>';
    }).join('');
  }

  /* hazardType 是纯字符串数组（不是 {v,n}），这里单独拼；首项空值 = 未分类。
     空值项必须有 —— 否则未填的行会被浏览器默认选中第一项「消防」，
     看板类型分布就被污染了（formDialog 那边踩过同一个坑）。 */
  function typeOpts(cur) {
    var list = [''].concat(SD.dict.DICT.hazardType || []);
    return list.map(function (v) {
      var n = v || '未分类';
      return '<option value="' + esc(v) + '"' +
        (String(v) === String(cur || '') ? ' selected' : '') + '>' + esc(n) + '</option>';
    }).join('');
  }

  function rowHtml(uid, v) {
    return '' +
      '<div class="pr-row-head">' +
        '<span class="pr-idx">问题</span>' +
        '<span class="pr-spacer"></span>' +
        '<button type="button" class="btn sm ghost pr-del" data-act="del">删除</button>' +
      '</div>' +
      '<div class="grid-form">' +
        '<label class="field"><span class="req">责任部门</span>' +
          '<input class="input" data-role="dept" list="' + uid + '_depts" autocomplete="off" ' +
          'placeholder="例：生产一部" value="' + esc(v.dept) + '"></label>' +
        '<label class="field"><span>隐患类型</span>' +
          '<select class="input" data-role="type">' + typeOpts(v.type) + '</select></label>' +
        '<label class="field"><span>隐患等级</span>' +
          '<select class="input" data-role="level">' + levelOpts(v.level) + '</select></label>' +
        '<label class="field"><span>隐患条数</span>' +
          '<input class="input" type="number" min="0" step="1" data-role="count" ' +
          'value="' + (v.count == null ? 1 : Number(v.count) || 0) + '"></label>' +
        '<label class="field full"><span>问题内容</span>' +
          '<textarea class="input" rows="2" data-role="content" ' +
          'placeholder="例：配电箱门无法闭合，线路外露">' + esc(v.content) + '</textarea></label>' +
        '<label class="field"><span>整改期限</span>' +
          '<input class="input" type="date" data-role="fixDue" value="' + esc(v.fixDueDate) + '"></label>' +
        '<label class="field"><span>整改日期</span>' +
          '<input class="input" type="date" data-role="fixDate" value="' + esc(v.fixDate) + '"></label>' +
        '<div class="field full"><span>隐患照片</span>' +
          '<div class="ph-slot" data-role="photos" data-max="18"></div></div>' +
        '<div class="field full"><span>整改照片</span>' +
          '<div class="ph-slot" data-role="fixPhotos" data-max="18"></div></div>' +
      '</div>';
  }

  function mount(host, o) {
    o = o || {};
    if (!host) return null;
    host.innerHTML = '';
    var uid = 'pr' + (++seq);

    var wrap = U.h(
      '<div class="pr-wrap">' +
        '<div class="pr-head">' +
          '<b class="pr-title">分部门问题明细</b>' +
          '<span class="t-3 t-sm pr-sum">尚无明细</span>' +
          '<span class="pr-spacer"></span>' +
          '<span class="pr-actions"></span>' +
          '<button type="button" class="btn sm ghost" data-act="add">' +
            SD.icons.get('plus', 14) + '再加一个部门</button>' +
        '</div>' +
        '<div class="pr-rows"></div>' +
        '<datalist id="' + uid + '_depts">' + (o.depts || []).map(function (d) {
          return '<option value="' + esc(d) + '"></option>';
        }).join('') + '</datalist>' +
      '</div>'
    );
    host.appendChild(wrap);

    /* 外部附加动作（巡检表单用它放「取消拆分」）：固定在头部，
       否则明细一多，按钮就被挤到几屏之后，等于没有 */
    var actBox = wrap.querySelector('.pr-actions');
    (o.actions || []).forEach(function (n) { if (n) actBox.appendChild(n); });

    var rowsBox = wrap.querySelector('.pr-rows');
    var sumBox = wrap.querySelector('.pr-sum');
    var rows = [];

    function get() {
      return rows.map(function (r) {
        var q = function (role) { return r.el.querySelector('[data-role="' + role + '"]'); };
        var countEl = q('count');
        return {
          id: r.id,
          dept: String(q('dept').value || '').trim(),
          content: String(q('content').value || '').trim(),
          type: q('type').value || '',
          level: q('level').value || '',
          count: Math.max(0, Math.floor(Number(countEl.value) || 0)),
          photos: r.ph.get(),
          /* ★ 2026-11-12：键名必须与 metrics.normRow 一致，否则期限存进去读不出来 */
          fixDueDate: q('fixDue').value || '',
          fixDate: q('fixDate').value || '',
          fixPhotos: r.fixPh.get()
        };
      });
    }

    function renumber() {
      rows.forEach(function (r, i) {
        var idx = r.el.querySelector('.pr-idx');
        if (idx) idx.textContent = '问题 ' + (i + 1);
      });
    }

    /* 只刷汇总文本，不动任何输入控件（见文件头约束 2） */
    function refresh() {
      var list = get();
      if (!list.length) {
        sumBox.textContent = '尚无明细（整单按下方「隐患条数」统计）';
        if (typeof o.onChange === 'function') o.onChange();
        return;
      }
      var depts = {}, sum = 0, fix = { none: 0, doing: 0, done: 0 };
      list.forEach(function (r) {
        if (r.dept) depts[r.dept] = 1;
        sum += r.count;
        var st = r.fixDate ? 'done' : (r.fixPhotos.length ? 'doing' : 'none');
        fix[st] += r.count;
      });
      sumBox.textContent = Object.keys(depts).length + ' 个部门 · ' + sum + ' 条 · ' +
        '未整改 ' + fix.none + ' / 整改中 ' + fix.doing + ' / 已整改 ' + fix.done;
      if (typeof o.onChange === 'function') o.onChange();
    }

    function addRow(v) {
      v = v || {};
      /* ⚠️ 不能写 U.h(rowHtml(...))：rowHtml 有两个顶层节点（头部 + 表单网格），
         而 U.h 只返回 firstElementChild，网格会被整块丢掉（照片位取不到 → 挂载炸）。
         这里先建容器再 innerHTML，保住全部节点。 */
      var el = document.createElement('div');
      el.className = 'pr-row';
      el.innerHTML = rowHtml(uid, v);
      rowsBox.appendChild(el);
      var row = {
        id: v.id || (uid + 'r' + (rows.length + 1) + '_' + Math.random().toString(36).slice(2, 6)),
        el: el,
        ph: null, fixPh: null, armT: null
      };
      row.ph = SD.comp.photoPicker.mount(el.querySelector('[data-role="photos"]'), {
        value: v.photos || [], max: 18, onChange: refresh
      });
      row.fixPh = SD.comp.photoPicker.mount(el.querySelector('[data-role="fixPhotos"]'), {
        value: v.fixPhotos || [], max: 18, onChange: refresh
      });
      rows.push(row);
      renumber();
      refresh();
      return row;
    }

    function delRow(row) {
      if (row.armT) { clearTimeout(row.armT); row.armT = null; }
      var i = rows.indexOf(row);
      if (i >= 0) rows.splice(i, 1);
      if (row.el.parentNode) row.el.parentNode.removeChild(row.el);
      renumber();
      refresh();
    }

    wrap.addEventListener('click', function (e) {
      var add = e.target.closest('[data-act="add"]');
      if (add) { addRow({}); return; }

      var del = e.target.closest('[data-act="del"]');
      if (!del) return;
      var row = null;
      rows.forEach(function (r) { if (r.el === del.closest('.pr-row')) row = r; });
      if (!row) return;

      /* 二次确认（不开弹窗，见文件头约束 3）；3 秒内不点就恢复 */
      if (del.getAttribute('data-armed') !== '1') {
        del.setAttribute('data-armed', '1');
        del.setAttribute('data-orig', del.textContent);
        del.textContent = '再点一次删除';
        row.armT = setTimeout(function () {
          del.removeAttribute('data-armed');
          del.textContent = del.getAttribute('data-orig') || '删除';
          row.armT = null;
        }, 3000);
        return;
      }
      delRow(row);
    });

    wrap.addEventListener('input', refresh);
    wrap.addEventListener('change', refresh);

    function validate() {
      for (var i = 0; i < rows.length; i++) {
        var tag = '第 ' + (i + 1) + ' 行';
        var countEl = rows[i].el.querySelector('[data-role="count"]');
        var raw = String(countEl.value == null ? '' : countEl.value).trim();
        if (raw !== '' && !/^\d+$/.test(raw)) return tag + '「隐患条数」请填非负整数';
        var dept = String(rows[i].el.querySelector('[data-role="dept"]').value || '').trim();
        /* 有条数就必须说明是哪个部门，否则这条会落进「未指定部门」，等于白拆。
           问题内容不强制：老记录的条数有、内容没有，强制会把人堵在保存按钮前。 */
        if (Math.floor(Number(raw) || 0) > 0 && !dept) {
          return tag + '请填「责任部门」（有条数就必须说明是哪个部门）';
        }
      }
      return null;
    }

    function set(list) {
      rows.slice().forEach(function (r) {
        if (r.armT) clearTimeout(r.armT);
        if (r.el.parentNode) r.el.parentNode.removeChild(r.el);
      });
      rows.length = 0;
      (list || []).forEach(function (v) { addRow(v); });
      renumber();
      refresh();
    }

    set(o.value || []);

    return {
      el: wrap,
      get: get,
      set: set,
      validate: validate,
      count: function () { return rows.length; }
    };
  }

  return { mount: mount };
})();
