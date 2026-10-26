/* =========================================================
   components/peoplePicker.js — 人员标签输入（零依赖）
   ────────────────────────────────────────────
   为什么要有它：危险作业票要记「作业人员」，可能是一个人也可能是一组人。
   用一个文本框顿号分隔最省事，但没法校验、没法去重、也没法逐个删；
   做成标签（chip）输入：打完名字回车/点「添加」生成一个 chip，可单独删。

   用法：
     SD.comp.peoplePicker.mount(boxEl, {
       value: ['张三','李四'],          // 初值
       max: 8,                          // 上限（默认 8）
       suggest: function () { return ['张三','李四']; }   // 可选，datalist 联想
     });
     boxEl._pp.get();   // → ['张三','李四']

   与 photoPicker 同一套路：容器挂实例，取值走实例，formDialog 的 people 字段靠它。
   ========================================================= */
window.SD = window.SD || {};
SD.comp = SD.comp || {};

SD.comp.peoplePicker = (function () {
  var U = SD.utils;
  var seq = 0;

  function mount(box, opts) {
    opts = opts || {};
    var max = opts.max || 8;
    var list = (opts.value || []).slice();
    var dlId = 'pp_suggest_' + (++seq);

    box.innerHTML =
      '<div class="pp-chips"></div>' +
      '<div class="pp-row">' +
        '<input class="input pp-input" list="' + dlId + '" placeholder="输入姓名，回车或点「添加」">' +
        '<button type="button" class="btn sm ghost pp-add">添加</button>' +
      '</div>' +
      '<datalist id="' + dlId + '"></datalist>' +
      '<div class="t-3 t-sm pp-hint"></div>';

    var chipsBox = box.querySelector('.pp-chips');
    var input = box.querySelector('.pp-input');
    var hint = box.querySelector('.pp-hint');
    var dl = box.querySelector('datalist');

    // 联想：默认取特种作业人员台账里的姓名，方便选人不用手打
    var names = [];
    try {
      if (typeof opts.suggest === 'function') names = opts.suggest() || [];
      else if (SD.app && SD.app.state && SD.app.state.summary) {
        names = (SD.app.state.summary.specialPersonnel || []).map(function (p) { return p.name; });
      }
    } catch (err) { names = []; }
    dl.innerHTML = names.map(function (n) {
      return '<option value="' + U.esc(n) + '"></option>';
    }).join('');

    function paint() {
      chipsBox.innerHTML = list.length
        ? list.map(function (n, i) {
            return '<span class="pp-chip">' + U.esc(n) +
              '<button type="button" class="pp-x" data-i="' + i + '" aria-label="移除">&times;</button></span>';
          }).join('')
        : '<span class="t-3 t-sm">还没添加作业人员</span>';
      hint.textContent = list.length >= max
        ? '已达上限 ' + max + ' 人'
        : '已添加 ' + list.length + ' / ' + max + ' 人';
      var full = list.length >= max;
      input.disabled = full;
      box.querySelector('.pp-add').disabled = full;
    }

    function add() {
      var v = String(input.value || '').trim().replace(/[,，、;；]\s*$/, '');
      if (!v) return;
      if (list.length >= max) { U.toast('最多 ' + max + ' 人', 'err'); return; }
      if (list.indexOf(v) >= 0) { U.toast('「' + v + '」已在名单里', 'err'); return; }
      list.push(v);
      input.value = '';
      paint();
      input.focus();
    }

    box.querySelector('.pp-add').addEventListener('click', add);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ',' || e.key === '，') { e.preventDefault(); add(); }
    });
    // 一次性粘贴「张三、李四、王五」也能直接拆开
    input.addEventListener('paste', function (e) {
      var t = (e.clipboardData || window.clipboardData);
      var txt = t ? String(t.getData('text') || '') : '';
      if (!/[,，、;；\n]/.test(txt)) return;
      e.preventDefault();
      txt.split(/[,，、;；\n]/).forEach(function (n) {
        n = String(n || '').trim();
        if (!n || list.length >= max || list.indexOf(n) >= 0) return;
        list.push(n);
      });
      input.value = '';
      paint();
    });

    U.on(chipsBox, 'click', '.pp-x', function (e, btn) {
      list.splice(Number(btn.dataset.i), 1);
      paint();
    });

    paint();
    box._pp = { get: function () { return list.slice(); }, add: add };
    return box._pp;
  }

  return { mount: mount };
})();
