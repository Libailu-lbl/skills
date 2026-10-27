/* =========================================================
   components/formDialog.js — 通用表单弹窗（字段定义驱动）
   ────────────────────────────────────────────────────────
   为什么要抽这个组件：
     巡检 / 培训 / 证书 / 通知 / 隐患编辑 五处都要「弹窗填表 + 校验 + 提交」，
     如果每处手写一遍 HTML 与取值逻辑，字段一改就要改五遍。
     这里统一成「给一份字段定义 → 出表单 → 出校验 → 出值对象」。

   字段定义（field）：
     {
       name      : string   必填，取值键名
       label     : string   显示名
       type      : text | textarea | date | number | select | switch | photos | people | code
       options   : array    select 用，['A','B'] 或 [{v,n}]
       required  : bool     必填（空值拦截；photos 用「至少一张」判定）
       full      : bool     独占一行（默认两列布局；photos / people 建议给 full）
       def       : any|fn   默认值（函数则在打开时求值）
       max       : number   photos 最多张数（默认 3）/ people 最多人数（默认 8）
       placeholder / min / max / step / rows / help / readonly
     }

   photos 类型说明：
     渲染成占位容器，弹窗进 DOM 后由 photoPicker 挂载真实控件，
     取值走容器上的 _ph 实例 → 返回 dataURL 字符串数组。

   people 类型说明（作业人员这类「一组人」）：
     同样渲染占位容器，进 DOM 后由 peoplePicker 挂载标签输入控件，
     取值走容器上的 _pp 实例 → 返回姓名字符串数组。

   code 类型说明（单据编号，2026-10-24 起默认顺延填入、可手动修改）：
     渲染成一个输入框，新增时**预填下一个可用编号**（SD.code.next 顺延生成，
     撞号自动跳），用户可以直接用，也可以改成任何符合规则的编号。
     · codeType : 单据类型（hazard / inspection / training / certificate /
                   notice / special / permit），决定校验正则与顺延规则
     · selfId   : 编辑时传当前记录 id，唯一性校验会排除自己
     · dependsOn: 编号随哪个字段变（作业票填 'type'）。打开时按当前值预填；
                  该字段一改，只要编号还是「自动值 / 空」就跟着换前缀，
                  用户手改过的号不覆盖；编辑老记录不改号
     · 校验     : 内置走 SD.code.check —— 空 / 格式 / 同类重复（作业票额外查
                  「前缀是不是别的作业类型的号」）三类错误
     规则表在 config.js 的 SD.CONFIG.codeRules，改前缀改位数只改那一处。

   用法：
     SD.comp.formDialog.open({
       title: '新增巡检任务',
       fields: FIELDS,
       values: existingRecord,      // 编辑时传入，缺省即新增
       validate: function (v) { return v.endDate < v.startDate ? '结束日期不能早于开始日期' : null; },
       onSubmit: function (v) { return SD.api.createInspection(v).then(...); }
     });
   ========================================================= */
window.SD = window.SD || {};
SD.comp = SD.comp || {};

SD.comp.formDialog = (function () {
  var U = SD.utils;

  /** 取字段初始值：优先用传入的 values，其次 def（可为函数，入参是当前值对象）。
      编号字段新增时没有传入值，走 def → SD.code.next 顺延生成下一个可用编号；
      作业票的编号 def 还要看「作业类型」，所以把 values 传进去。 */
  function initial(field, values) {
    var v = (values && values[field.name] != null) ? values[field.name] : null;
    if (v == null) v = (typeof field.def === 'function') ? field.def(values || {}) : field.def;
    return v == null ? '' : v;
  }

  /** 归一化 select 的 options：支持 ['A'] 与 [{v,n}] 两种写法 */
  function normOptions(list) {
    return (list || []).map(function (o) {
      return (o && typeof o === 'object') ? { v: o.v, n: o.n } : { v: o, n: o };
    });
  }

  function controlHtml(field, values) {
    var id = 'ff_' + field.name;
    var v = initial(field, values);
    var ph = field.placeholder ? ' placeholder="' + U.esc(field.placeholder) + '"' : '';
    var ro = field.readonly ? ' readonly' : '';

    if (field.type === 'select') {
      var opts = normOptions(field.options).map(function (o) {
        return '<option value="' + U.esc(o.v) + '"' + (String(o.v) === String(v) ? ' selected' : '') + '>' +
          U.esc(o.n) + '</option>';
      }).join('');
      return '<select class="input" id="' + id + '"' + ro + '>' + opts + '</select>';
    }
    if (field.type === 'textarea') {
      return '<textarea class="input" id="' + id + '" rows="' + (field.rows || 3) + '"' + ph + ro + '>' +
        U.esc(v) + '</textarea>';
    }
    if (field.type === 'switch') {
      // 用 span 而非 label：外层已是 label，嵌套 label 属非法 HTML
      return '<span class="switch-line"><input type="checkbox" id="' + id + '"' + (v ? ' checked' : '') + '>' +
        '<span class="t-2 t-sm">' + U.esc(field.switchText || '') + '</span></span>';
    }
    if (field.type === 'photos') {
      // 占位容器：真实控件要等弹窗进 DOM 后由 photoPicker 挂载（见 open 的 onMount）
      return '<div class="ph-slot" id="' + id + '" data-max="' + (field.max || 3) + '"></div>';
    }
    if (field.type === 'people') {
      return '<div class="pp-slot" id="' + id + '" data-max="' + (field.max || 8) + '"></div>';
    }
    if (field.type === 'code') {
      // 编号：输入框预填下一个可用编号（SD.code.next），用户可手动修改
      var ty2 = field.codeType || field.name;
      var smp2 = (SD.code ? SD.code.sample(ty2) : '');
      return '<input class="input" type="text" id="' + id + '" value="' + U.esc(v) + '"' +
        (smp2 ? ' placeholder="' + U.esc(smp2) + '"' : '') + ro + '>';
    }
    if (field.type === 'number') {
      return '<input class="input" type="number" id="' + id + '" value="' + U.esc(v) + '"' + ph + ro +
        (field.min != null ? ' min="' + field.min + '"' : '') +
        (field.max != null ? ' max="' + field.max + '"' : '') +
        (field.step != null ? ' step="' + field.step + '"' : '') + '>';
    }
    var t = field.type === 'date' ? 'date' : 'text';
    return '<input class="input" type="' + t + '" id="' + id + '" value="' + U.esc(v) + '"' + ph + ro + '>';
  }

  function buildBody(fields, values) {
    return '<div class="grid-form">' + fields.map(function (f) {
      var ctl = controlHtml(f, values);
      var help = f.help ? '<div class="t-3 t-sm" style="margin-top:4px">' + U.esc(f.help) + '</div>' : '';
      // photos / people 控件内部有按钮和 input，放进 <label> 会被当成 labelable 控件，
      // 点空白处会误触发「添加」，所以这两项改用 div 包；
      // code 同理（曾是「输入框 + 默认按钮」组合，按钮放进 label 点按钮会连带触发 label 行为）
      var tag = (f.type === 'photos' || f.type === 'people' || f.type === 'code') ? 'div' : 'label';
      return '<' + tag + ' class="field' + (f.full ? ' full' : '') + '">' +
        '<span' + (f.required ? ' class="req"' : '') + '>' + U.esc(f.label) + '</span>' +
        ctl + help + '</' + tag + '>';
    }).join('') + '</div>';
  }

  /** 从 DOM 读回值对象（按字段类型转换） */
  function readValues(modal, fields, fallback) {
    var out = {};
    fields.forEach(function (f) {
      var el = modal.querySelector('#ff_' + f.name);
      if (!el) return;
      if (f.type === 'switch') { out[f.name] = !!el.checked; return; }
      if (f.type === 'photos') {
        // 照片走控件实例；没挂上（如测试环境）则退回原值，避免把已有照片清空
        out[f.name] = (el._ph ? el._ph.get() : ((fallback && fallback[f.name]) || []));
        return;
      }
      if (f.type === 'people') {
        out[f.name] = (el._pp ? el._pp.get() : ((fallback && fallback[f.name]) || []));
        return;
      }
      var v = String(el.value || '').trim();
      if (f.type === 'number') { out[f.name] = v === '' ? null : Number(v); return; }
      out[f.name] = v;
    });
    return out;
  }

  /** 内置校验：必填 / 数字 / 日期格式。返回错误文案或 null */
  function validate(fields, values, extra) {
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i], v = values[f.name];
      var empty = (v == null) || (String(v).trim() === '');
      // 照片 / 人员是数组，「至少一张 / 至少一人」才算填了
      if (f.type === 'photos' || f.type === 'people') empty = !Array.isArray(v) || v.length === 0;
      if (f.required && empty) return '「' + f.label + '」不能为空';
      if (empty) continue;
      // 编号：空 / 格式 / 同类型重复，统一交给 SD.code.check（七类单据同一套判定）
      if (f.type === 'code' && SD.code) {
        var cm = SD.code.check(f.codeType || f.name, v, {
          id: f.selfId,
          /* 动态前缀（作业票）要拿「当前选的作业类型」算应得前缀 */
          typeVal: f.dependsOn ? values[f.dependsOn] : null
        });
        if (cm) return cm;
        continue;
      }
      if (f.type === 'number') {
        if (isNaN(Number(v))) return '「' + f.label + '」请填数字';
        if (f.min != null && Number(v) < f.min) return '「' + f.label + '」不能小于 ' + f.min;
        if (f.max != null && Number(v) > f.max) return '「' + f.label + '」不能大于 ' + f.max;
      }
      if (f.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) {
        return '「' + f.label + '」日期格式应为 YYYY-MM-DD';
      }
    }
    if (typeof extra === 'function') {
      var msg = extra(values);
      if (msg) return msg;
    }
    return null;
  }

  /**
   * @param {object} o {title, fields, values, okText, width, hint, validate, onSubmit}
   * @returns {{close:function, el:HTMLElement}}
   */
  function open(o) {
    o = o || {};
    var fields = o.fields || [];
    return SD.comp.dialog.open({
      title: o.title || '编辑',
      width: o.width || 620,
      body: buildBody(fields, o.values),
      hint: o.hint,
      okText: o.okText || '保存',
      onMount: function (modal) {
        // photos / people 字段：进 DOM 后才能挂载真实控件，初值取编辑对象
        fields.forEach(function (f) {
          var box = modal.querySelector('#ff_' + f.name);
          if (!box) return;
          if (f.type === 'photos' && SD.comp.photoPicker) {
            SD.comp.photoPicker.mount(box, {
              value: (o.values && o.values[f.name]) || [],
              max: f.max || 3
            });
          } else if (f.type === 'people' && SD.comp.peoplePicker) {
            SD.comp.peoplePicker.mount(box, {
              value: (o.values && o.values[f.name]) || [],
              max: f.max || 8
            });
          }
        });
        /* 编号跟着另一个字段走（作业票：编号随「作业类型」变前缀）
           · 只改「还是自动值 / 空」的输入框，用户手改过的号不覆盖
           · 编辑老记录时不动它，避免一打开就被改成新前缀 */
        fields.forEach(function (f) {
          if (f.type !== 'code') return;
          var me = modal.querySelector('#ff_' + f.name);
          if (!me) return;
          /* 失焦归一：编号一律大写去空格（手打小写 fzdz-xxx 也能存成 FZDZ-xxx） */
          me.addEventListener('blur', function () {
            var uv = String(me.value || '').trim().toUpperCase();
            if (uv !== me.value) me.value = uv;
          });
          if (!f.dependsOn) return;
          /* 编辑已有记录时不再联动：老票的号是既成事实，切类型不静默改号
             （真要不符，保存时 check 会提示应换哪个前缀，由人决定） */
          if (o.values && o.values[f.name] != null) return;
          var depEl = modal.querySelector('#ff_' + f.dependsOn);
          if (!depEl || me.readOnly) return;
          var last = me.value;
          depEl.addEventListener('change', function () {
            var vals = readValues(modal, fields, o.values);
            var nv = (typeof f.def === 'function') ? f.def(vals) : f.def;
            if (!nv) return;
            if (me.value === last || me.value === '') {
              me.value = nv;
              last = nv;
            }
          });
        });
        if (typeof o.onMount === 'function') o.onMount(modal);
      },
      onOk: function (modal) {
        var values = readValues(modal, fields, o.values);
        var err = validate(fields, values, o.validate);
        if (err) return err;
        if (typeof o.onSubmit !== 'function') return null;
        return o.onSubmit(values);   // 期望返回 Promise；dialog 会显示「处理中…」
      }
    });
  }

  return { open: open, readValues: readValues, validate: validate };
})();
