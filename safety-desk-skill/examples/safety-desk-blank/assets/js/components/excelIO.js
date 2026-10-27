/* =========================================================
   components/excelIO.js — 台账 Excel 导入 / 导出 / 模板（2026-10-27 新增）
   ────────────────────────────────────────────────────────
   一套逻辑服务两个台账（特种设备人员 / 特种作业人员），靠传入的字段定义驱动：
     SD.comp.excelIO.openImport({ collection, idPrefix, keyField, fields, tip, ctx })
     SD.comp.excelIO.exportExcel({ collection, fields, sheetName, fileBase })
     SD.comp.excelIO.downloadTemplate({ fields, fileBase })

   字段定义（fields）每项：
     { name, label, aliases:[], required, type, dict, width, sample, help }
     type: 'text' | 'date' | 'dict'（字典单选） | 'status'（状态，可留空自动判定）

   导入流程：选文件 → 解析（xlsxReader）→ 找表头行 → 列名映射 → 逐行校验
            → 预览 + 错误清单 → 用户确认 → 追加/覆盖写入 → toast + 刷新
   ========================================================= */
window.SD = window.SD || {};
SD.comp = SD.comp || {};

SD.comp.excelIO = (function () {
  'use strict';

  var U = SD.utils;

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function compactDate() { return String(U.iso ? U.iso() : U.today()).replace(/-/g, ''); }

  /** 列名归一化：去空格/全角空格/间隔号/冒号/星号/括号，转小写 */
  function norm(s) {
    return String(s == null ? '' : s).replace(/[\s\u3000·・:：*（）()]/g, '').toLowerCase();
  }

  function isEmptyCell(v) { return String(v == null ? '' : v).trim() === ''; }
  function keyOf(rec, keyField) { return String((rec && rec[keyField]) || '').trim(); }

  /* ---------------- 字典 ---------------- */

  /** 字典表：示例版在 SD.mock.DICT，空白版在 SD.dict.DICT（本组件两版共用） */
  function dictOf() {
    if (SD.mock && SD.mock.DICT) return SD.mock.DICT;
    if (SD.dict && SD.dict.DICT) return SD.dict.DICT;
    return null;
  }

  function dictList(f) {
    if (!f.dict) return [];
    var d = dictOf();
    var arr = d ? d[f.dict] : null;
    return Array.isArray(arr) ? arr : [];
  }

  function dictMatch(f, raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s) return null;
    var list = dictList(f);
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      if (typeof it === 'string') {
        if (norm(it) === norm(s)) return { v: it, n: it };
      } else if (it && (norm(it.n) === norm(s) || norm(it.v) === norm(s))) {
        return { v: it.v, n: it.n };
      }
    }
    return null;
  }

  function dictText(f, v) {
    if (v == null || v === '') return '';
    var list = dictList(f);
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      if (typeof it === 'string') { if (it === v) return it; }
      else if (it && it.v === v) return it.n;
    }
    return String(v);
  }

  function dictHint(f) {
    var list = dictList(f);
    var names = list.map(function (it) { return typeof it === 'string' ? it : it.n; });
    return names.slice(0, 6).join(' / ') + (names.length > 6 ? ' 等' : '');
  }

  /* ---------------- 值转换 ---------------- */

  /** 多种日期写法 + Excel 序列号 → 'YYYY-MM-DD'；无法识别返回 '' */
  function toDate(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s) return '';

    /* Excel 把日期存成序列号（约 5 位数） */
    if (/^\d{5}(\.\d+)?$/.test(s)) {
      var n = Number(s);
      if (n > 10000 && n < 80000) {
        var d0 = SD.comp.xlsxReader.excelDate(n);
        if (d0) return d0;
      }
    }

    var m = /^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/.exec(s);
    if (m) {
      var y = +m[1], mo = +m[2], d = +m[3];
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return y + '-' + pad2(mo) + '-' + pad2(d);
      return '';
    }

    /* 只有年月（如 2026-12 / 2026年12月）→ 补成该月最后一天，与台账口径一致 */
    var m2 = /^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*月?$/.exec(s);
    if (m2) {
      var y2 = +m2[1], mo2 = +m2[2];
      if (mo2 >= 1 && mo2 <= 12) {
        var last = new Date(y2, mo2, 0).getDate();   // 下个月第 0 天 = 本月最后一天
        return y2 + '-' + pad2(mo2) + '-' + pad2(last);
      }
    }
    return '';
  }

  /** 按有效期推状态（导入时若“状态”列留空） */
  function statusFromDate(iso) {
    var d = U.parse(iso);
    if (!d) return 'valid';
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    d.setHours(0, 0, 0, 0);
    var days = Math.round((d - today) / 86400000);
    var notice = (SD.CONFIG.thresholds && SD.CONFIG.thresholds.certNoticeDays) || 90;
    if (days < 0) return 'expired';
    if (days <= notice) return 'pending_review';
    return 'valid';
  }

  /* ---------------- 表头识别 ---------------- */

  function buildAlias(fields) {
    var map = {};
    fields.forEach(function (f) {
      var names = [f.label].concat(f.aliases || []);
      names.forEach(function (n) { if (n) map[norm(n)] = f; });
    });
    return map;
  }

  function mapRow(cells, aliasMap) {
    var map = {}, hits = 0;
    (cells || []).forEach(function (c, i) {
      var f = aliasMap[norm(c)];
      if (f && !map[i]) { map[i] = f; hits++; }
    });
    return { map: map, hits: hits };
  }

  /** 前 8 行里挑命中列名最多的一行当表头（容忍标题行、空行） */
  function findHeader(rows, aliasMap) {
    var best = { idx: -1, hits: 0, map: {} };
    var n = Math.min(rows.length, 8);
    for (var i = 0; i < n; i++) {
      var r = mapRow(rows[i], aliasMap);
      if (r.hits > best.hits) best = { idx: i, hits: r.hits, map: r.map };
    }
    return best;
  }

  /* ---------------- 校验 ---------------- */

  function analyze(rows, opt) {
    var fields = opt.fields;
    var aliasMap = buildAlias(fields);
    var head = findHeader(rows, aliasMap);

    if (head.idx < 0 || head.hits < 2) {
      return { fatal: '没找到表头：请确认表格里有列名（如「姓名」「所属部门」），可先下载模板对照。' };
    }

    var have = {};
    Object.keys(head.map).forEach(function (ci) { have[head.map[ci].name] = true; });
    var missing = fields.filter(function (f) { return f.required && !have[f.name]; })
      .map(function (f) { return f.label; });
    if (missing.length) {
      return { fatal: '缺少必需列：' + missing.join('、') + '。可先下载模板对照列名。' };
    }

    var valid = [], errors = [], dup = 0, total = 0, seen = {};

    for (var i = head.idx + 1; i < rows.length; i++) {
      var row = rows[i] || [];
      var blank = true;
      for (var b = 0; b < row.length; b++) { if (!isEmptyCell(row[b])) { blank = false; break; } }
      if (blank) continue;
      total++;

      var rec = { photos: [] }, errs = [];
      var colIdx = Object.keys(head.map);

      for (var c = 0; c < colIdx.length; c++) {
        var ci = colIdx[c];
        var f = head.map[ci];
        var raw = row[ci];
        var s = String(raw == null ? '' : raw).trim();

        if (f.type === 'date') {
          if (!s) { if (f.required) errs.push(f.label + '为空'); continue; }
          var d = toDate(s);
          if (!d) { errs.push(f.label + '「' + s + '」不是有效日期'); continue; }
          rec[f.name] = d;
          continue;
        }

        if (f.type === 'dict' || f.type === 'status') {
          if (!s) {
            if (f.type === 'dict' && f.required) errs.push(f.label + '为空');
            else rec[f.name] = f.def || '';
            continue;
          }
          var m = dictMatch(f, s);
          if (!m) {
            errs.push(f.label + '「' + s + '」不在可选项内（' + dictHint(f) + '）');
            continue;
          }
          rec[f.name] = m.v;
          continue;
        }

        rec[f.name] = s;
        if (f.required && !s) errs.push(f.label + '为空');
      }

      /* 字段默认值：Excel 里没有这一列 / 该格留空时用 def 兜底（如证书类型默认 N1） */
      opt.fields.forEach(function (f) {
        if ((rec[f.name] == null || rec[f.name] === '') && f.def != null) rec[f.name] = f.def;
      });

      if (errs.length) { errors.push({ line: i + 1, msg: errs.join('；') }); continue; }

      var k = keyOf(rec, opt.keyField);
      if (k && seen[k]) { dup++; continue; }
      if (k) seen[k] = true;

      /* 状态留空 → 按有效期推（设备人员展示层也会实时重算，这里保证特种作业人员也有值） */
      if (!rec.status) rec.status = statusFromDate(rec[opt.dateField || 'validTo'] || rec.reviewDate);

      valid.push(rec);
    }

    return { head: head, headLine: head.idx + 1, total: total, valid: valid, errors: errors, dup: dup };
  }

  /* ---------------- 写入 ---------------- */

  function doImport(opt, res, mode) {
    var data = SD.store.data();
    var cur = (mode === 'replace') ? [] : (data[opt.collection] || []).slice();

    var keys = {};
    cur.forEach(function (x) { var k = keyOf(x, opt.keyField); if (k) keys[k] = true; });

    /* 编号留空时按编号规则自动顺延（TZSB-001 / TZZY-001） */
    var rule = (opt.codeRule && SD.CONFIG.codeRules) ? SD.CONFIG.codeRules[opt.codeRule] : null;
    var seq = 0;
    if (rule) {
      var re = new RegExp('^' + rule.prefix + '-(\\d+)$');
      cur.forEach(function (x) {
        var m = re.exec(String(x.code || ''));
        if (m) seq = Math.max(seq, parseInt(m[1], 10));
      });
    }

    var added = 0, skipped = 0;
    res.valid.forEach(function (r) {
      var k = keyOf(r, opt.keyField);
      if (k && keys[k]) { skipped++; return; }

      if (rule && !r.code) {
        seq++;
        var s = String(seq), pad = '';
        for (var i = s.length; i < (rule.seqLen || 3); i++) pad += '0';
        r.code = rule.prefix + '-' + pad + s;
      }

      r.id = U.uid(opt.idPrefix);
      r.photos = r.photos || [];
      cur.push(r);
      if (k) keys[k] = true;
      added++;
    });

    data[opt.collection] = cur;
    SD.store.setData(data);
    return { added: added, skipped: skipped, total: cur.length };
  }

  /* ---------------- 界面：导入 ---------------- */

  function paintResult(host, state, opt) {
    U.clear(host);

    if (state.fatal) {
      host.appendChild(U.h('<div class="xio-fatal">' + U.esc(state.fatal) + '</div>'));
      return;
    }
    if (!state.res) {
      host.appendChild(U.h('<p class="xio-idle">选择文件后会自动校验，确认无误再点「开始导入」。</p>'));
      return;
    }

    var r = state.res;
    var stat = '<div class="xio-stat">' +
      '<b class="ok">' + r.valid.length + '</b> 条可导入' +
      (r.dup ? ' · <b class="warn">' + r.dup + '</b> 条文件内重复已跳过' : '') +
      (r.errors.length ? ' · <b class="err">' + r.errors.length + '</b> 条有错误' : '') +
      '<span class="xio-sub">共读 ' + r.total + ' 行数据，表头在第 ' + r.headLine + ' 行</span>' +
      '</div>';
    host.appendChild(U.h(stat));

    if (r.errors.length) {
      var box = U.h('<div class="xio-errs"><div class="xio-err-h">以下行不会导入：</div></div>');
      r.errors.slice(0, 8).forEach(function (e) {
        box.appendChild(U.h('<div class="xio-err">第 ' + e.line + ' 行：' + U.esc(e.msg) + '</div>'));
      });
      if (r.errors.length > 8) {
        box.appendChild(U.h('<div class="xio-err-more">…还有 ' + (r.errors.length - 8) + ' 行有错误</div>'));
      }
      host.appendChild(box);
    }

    if (r.valid.length) {
      var cols = opt.fields.filter(function (f) {
        return r.valid.some(function (x) { return String(x[f.name] == null ? '' : x[f.name]) !== ''; });
      });
      var html = '<table class="xio-tb"><thead><tr>' +
        cols.map(function (f) { return '<th>' + U.esc(f.label) + '</th>'; }).join('') +
        '</tr></thead><tbody>';
      r.valid.slice(0, 5).forEach(function (x) {
        html += '<tr>' + cols.map(function (f) {
          var v = (f.type === 'dict' || f.type === 'status') ? dictText(f, x[f.name]) : x[f.name];
          return '<td>' + U.esc(v == null ? '' : v) + '</td>';
        }).join('') + '</tr>';
      });
      html += '</tbody></table>';
      if (r.valid.length > 5) html += '<div class="xio-err-more">仅预览前 5 条</div>';
      host.appendChild(U.h('<div class="xio-pv">' + html + '</div>'));
    }
  }

  function openImport(opt) {
    var state = { res: null, fatal: '', fileName: '', parsing: false, mode: 'append' };

    var body = U.h(
      '<div class="xio">' +
        (opt.tip ? '<p class="xio-tip">' + opt.tip + '</p>' : '') +
        '<div class="xio-row">' +
          '<button type="button" class="btn sm ghost js-pick">' + SD.icons.get('upload', 14) + '选择文件</button>' +
          '<span class="xio-name js-name">未选择文件</span>' +
          '<span class="spacer"></span>' +
          '<button type="button" class="btn sm ghost js-tpl">下载模板</button>' +
        '</div>' +
        '<input type="file" class="js-file" accept=".xlsx,.xlsm,.csv" hidden>' +
        '<div class="xio-mode">导入方式：' +
          '<label><input type="radio" name="xioMode" value="append" checked> 追加到现有台账（重复的跳过）</label>' +
          '<label><input type="radio" name="xioMode" value="replace"> 覆盖全部（先清空现有台账）</label>' +
        '</div>' +
        '<div class="xio-result js-result"></div>' +
      '</div>'
    );

    var fileInput = body.querySelector('.js-file');
    var nameEl = body.querySelector('.js-name');
    var resultEl = body.querySelector('.js-result');
    
    paintResult(resultEl, state, opt);

    body.querySelector('.js-pick').addEventListener('click', function () { fileInput.click(); });
    body.querySelector('.js-tpl').addEventListener('click', function () {
      downloadTemplate(opt);
      U.toast('模板已下载，填好后回到这里导入', 'ok');
    });

    Array.prototype.forEach.call(body.querySelectorAll('input[name="xioMode"]'), function (el) {
      el.addEventListener('change', function () {
        state.mode = el.value;
        paintResult(resultEl, state, opt);
      });
    });

    fileInput.addEventListener('change', function () {
      var f = fileInput.files && fileInput.files[0];
      if (!f) return;
      state.fileName = f.name;
      state.parsing = true;
      state.res = null;
      state.fatal = '';
      nameEl.textContent = f.name;
      resultEl.innerHTML = '<p class="xio-idle">正在解析…</p>';

      SD.comp.xlsxReader.readFile(f).then(function (out) {
        var rows = (out && out.rows) || [];
        if (!rows.length) {
          state.fatal = '文件里没有读到任何数据行。';
        } else {
          var res = analyze(rows, opt);
          if (res.fatal) state.fatal = res.fatal;
          else state.res = res;
        }
        state.parsing = false;
        paintResult(resultEl, state, opt);
      }).catch(function (err) {
        state.parsing = false;
        state.fatal = (err && err.message) || '解析失败';
        paintResult(resultEl, state, opt);
      });
    });

    var dlg = SD.comp.dialog.open({
      title: opt.title || '从 Excel 导入',
      width: 720,
      okText: '开始导入',
      body: body,
      onOk: function () {
        if (state.parsing) return '文件还在解析，请稍候';
        if (!state.res) return state.fatal || '请先选择要导入的 Excel 或 CSV 文件';
        if (!state.res.valid.length) {
          return '没有可导入的有效行' + (state.res.errors.length ? '（' + state.res.errors.length + ' 行有错误）' : '');
        }
        var out = doImport(opt, state.res, state.mode);
        var msg = '已导入 ' + out.added + ' 条' +
          (out.skipped ? '，跳过重复 ' + out.skipped + ' 条' : '') +
          '，台账现有 ' + out.total + ' 条';
        U.toast(msg, 'ok');
        if (opt.ctx && typeof opt.ctx.reload === 'function') opt.ctx.reload();
        return null;
      }
    });

    return dlg;
  }

  /* ---------------- 导出 / 模板 ---------------- */

  function cellOf(f, v, extra) {
    var isPick = (f.type === 'dict' || f.type === 'status');
    var text = isPick ? dictText(f, v) : v;
    return Object.assign({
      v: text == null ? '' : String(text),
      border: true, valign: 'center',
      align: (f.type === 'date' || isPick) ? 'center' : 'left'
    }, extra || {});
  }

  function headerRow(fields) {
    return fields.map(function (f) {
      return { v: f.label, bold: true, fill: 'F2F2F2', border: true, align: 'center', valign: 'center' };
    });
  }

  function exportExcel(opt) {
    var list = (SD.store.data()[opt.collection] || []);
    if (!list.length) { U.toast('台账是空的，没有可导出的数据', 'err'); return; }

    var rows = [headerRow(opt.fields)];
    list.forEach(function (r) {
      rows.push(opt.fields.map(function (f) { return cellOf(f, r[f.name]); }));
    });

    var sheet = {
      name: opt.sheetName || '台账',
      cols: opt.fields.map(function (f) { return { width: f.width || 16 }; }),
      rows: rows,
      /* 导出就是为了再导入/打印：横向 A4 + 缩放到一页宽 */
      page: { orientation: 'landscape', paperSize: 9, fitToWidth: 1, fitToHeight: 0 }
    };

    var blob = SD.comp.xlsxWriter.build([sheet]);
    var fn = (opt.fileBase || opt.sheetName || '台账') + '-' + compactDate() + '.xlsx';
    SD.comp.xlsxWriter.download(blob, fn);
    U.toast('已导出 ' + list.length + ' 条到 ' + fn, 'ok');
  }

  function downloadTemplate(opt) {
    var rows = [headerRow(opt.fields)];

    /* 一行示例：帮用户看清日期格式与字典取值；姓名标了「示例行」，忘删也能一眼认出 */
    var sample = {};
    opt.fields.forEach(function (f) {
      if (f.sample != null) { sample[f.name] = f.sample; return; }
      if (f.type === 'date') { sample[f.name] = U.today(); return; }
      if (f.type === 'dict' || f.type === 'status') {
        var list = dictList(f);
        var first = list[0];
        sample[f.name] = first == null ? '' : (typeof first === 'string' ? first : first.v);
        return;
      }
      sample[f.name] = '';
    });
    rows.push(opt.fields.map(function (f) { return cellOf(f, sample[f.name], { color: 'FF9AA3AF' }); }));

    var sheet = {
      name: opt.sheetName || '模板',
      cols: opt.fields.map(function (f) { return { width: f.width || 16 }; }),
      rows: rows
    };

    var blob = SD.comp.xlsxWriter.build([sheet]);
    var fn = (opt.fileBase || '台账') + '-导入模板.xlsx';
    SD.comp.xlsxWriter.download(blob, fn);
  }

  return {
    openImport: openImport,
    exportExcel: exportExcel,
    downloadTemplate: downloadTemplate,
    /* 测试入口 */
    _analyze: analyze,
    _doImport: doImport,
    _toDate: toDate,
    _statusFromDate: statusFromDate,
    _norm: norm
  };
})();
