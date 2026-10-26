/* =========================================================
   ocr.js — 证件图片文字识别（接公司 OCR 接口）+ 本地字段解析
   ────────────────────────────────────────────────────────
   为什么拆成两段：
     1) 识别（recognize）必须走公司的文字识别接口 —— 纯离线网页没有 OCR 能力；
        接口地址 / 请求方式 / 返回结构全部集中在 config.js 的 SD.CONFIG.ocr，
        换服务商只改配置，不改这里。
     2) 解析（parse）是纯本地规则：把识别出来的文字按「关键词 + 正则」拆成台账字段。
        这一步断网也能用，也方便单测（不需要真接口）。

   接口约定（默认 json 模式，可在 config 里改）：
     POST  {ocr.endpoint}
     Body  { "image": "<base64，不含 data: 前缀>" }        ← ocr.fieldName 可改名
     Head   { "Content-Type": "application/json" } + ocr.headers（如 Authorization）
     返回   { "text": "识别出的整段文字" }                   ← ocr.textPath 可改路径
           也兼容 { data: { text: "..." } } 与纯文本响应
     mode:'form' 时改用 multipart/form-data 上传文件（字段名 ocr.fieldName）

   ★ 不内置任何识别引擎：没配 endpoint 时 recognize 直接报错并说明怎么配，
     不做「点了没反应」的假按钮（见 specPersonnel 的识别按钮提示）。

   ★ 本机服务一键启动（2026-10-24 新增）：
     endpoint 指向 127.0.0.1 / localhost 时，页面可以先探活（health），
     没起就触发自定义协议 safetyocr://start 拉起 start_ocr_silent.bat，
     再轮询 /health 直到就绪（默认最多 25s）。协议一次性注册，见
     safety-desk_dev/install_ocr_protocol.bat。公司外网接口不走这套逻辑。
   ========================================================= */
window.SD = window.SD || {};
SD.comp = SD.comp || {};

SD.comp.ocr = (function () {
  var U = SD.utils;

  function conf() { return (SD.CONFIG && SD.CONFIG.ocr) || {}; }
  /** 是否已配好可用接口（按钮据此给不同提示） */
  function ready() { return !!String(conf().endpoint || '').trim(); }

  /** dataURL → 纯 base64 */
  function b64(dataUrl) {
    var s = String(dataUrl || '');
    var i = s.indexOf(',');
    return i >= 0 ? s.slice(i + 1) : s;
  }
  /** dataURL → Uint8Array（multipart 上传用） */
  function bytes(dataUrl) {
    var bin = atob(b64(dataUrl));
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }
  /** 按 'data.text' 这样的路径取值，取不到再用常见结构兜底 */
  function pickText(d, path) {
    if (d == null) return '';
    if (typeof d === 'string') return d;
    var cur = d, parts = String(path || 'text').split('.');
    for (var i = 0; i < parts.length; i++) {
      if (cur == null || typeof cur !== 'object') { cur = null; break; }
      cur = cur[parts[i]];
    }
    if (typeof cur === 'string') return cur;
    // 兜底：主流 OCR 常见返回结构
    if (typeof d.text === 'string') return d.text;
    if (d.data && typeof d.data.text === 'string') return d.data.text;
    if (d.result && typeof d.result.text === 'string') return d.result.text;
    if (Array.isArray(d.words_result)) {                        // 百度通用识别
      return d.words_result.map(function (w) { return w.words || ''; }).join('\n');
    }
    if (d.data && Array.isArray(d.data.text_lines)) {           // 腾讯「整页识别」
      return d.data.text_lines.map(function (x) { return x.text || ''; }).join('\n');
    }
    return '';
  }

  /**
   * 识别一张证件图（dataURL），返回整段文字
   * @param {string} dataUrl
   * @returns {Promise<string>}
   */
  function recognize(dataUrl) {
    var o = conf();
    var endpoint = String(o.endpoint || '').trim();
    if (!endpoint) {
      return Promise.reject(new Error(
        '未配置识别接口：请在 assets/js/config.js 的 SD.CONFIG.ocr.endpoint 填入公司文字识别接口地址'));
    }
    if (!dataUrl) return Promise.reject(new Error('没有可识别的图片'));

    var headers = Object.assign({}, o.headers || {});
    var body;
    if (o.mode === 'form') {
      var mime = (String(dataUrl).match(/^data:([^;]+);/) || [])[1] || 'image/jpeg';
      var fd = new FormData();
      fd.append(o.fieldName || 'image', new Blob([bytes(dataUrl)], { type: mime }), o.filename || 'cert.jpg');
      body = fd;                     // 不手动设 Content-Type，浏览器要自己带 boundary
    } else {
      headers['Content-Type'] = 'application/json';
      var payload = {};
      payload[o.fieldName || 'image'] = b64(dataUrl);
      if (o.extra && typeof o.extra === 'object') Object.assign(payload, o.extra);
      body = JSON.stringify(payload);
    }

    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, o.timeout || SD.CONFIG.timeout || 8000) : null;

    return fetch(endpoint, {
      method: o.method || 'POST',
      headers: headers,
      body: body,
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) {
      if (timer) clearTimeout(timer);
      if (!r.ok) throw new Error('识别接口返回 ' + r.status + '（检查地址 / 鉴权头）');
      var ct = (r.headers && r.headers.get && r.headers.get('content-type')) || '';
      return ct.indexOf('json') >= 0 ? r.json() : r.text();
    }).then(function (d) {
      var text = String(pickText(d, o.textPath) || '').trim();
      if (!text) throw new Error('识别接口没返回文字（检查返回结构或 ocr.textPath 配置）');
      return text;
    }, function (e) {
      if (timer) clearTimeout(timer);
      throw (e && e.name === 'AbortError') ? new Error('识别超时，请重试或缩短图片') : e;
    });
  }

  /* ---------------- 本机服务探活 / 一键启动 ----------------
     浏览器没法直接启动本地程序，所以走「自定义 URL 协议」：
       页面 → safetyocr://start → Windows 调 start_ocr_silent.bat → 服务起来
     协议由 safety-desk_dev/install_ocr_protocol.bat 一次性注册到 HKCU（不需管理员）。
     只有 endpoint 指向本机（127.0.0.1 / localhost）时才启用这套逻辑；
     公司接口（外网地址）不探活、不启动，行为与之前一致。 */

  /** endpoint 的源（协议+主机+端口），如 http://127.0.0.1:8123 */
  function origin() {
    var ep = String(conf().endpoint || '').trim();
    var m = ep.match(/^(https?:\/\/[^\/?#]+)/i);
    return m ? m[1] : '';
  }
  /** 是否本机服务（决定要不要显示「启动服务」按钮） */
  function isLocal() {
    return /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/i.test(origin());
  }

  /**
   * 探活：GET {origin}{healthPath}
   * @returns {Promise<{ok:boolean, engine?:string, pid?:number, reason?:string}>}
   *   永不 reject（探活失败就是没起，不是错误）
   */
  function health(timeout) {
    var o = origin();
    if (!o) return Promise.resolve({ ok: false, reason: 'no-endpoint' });
    var url = o + (conf().healthPath || '/health');
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeout || 2500) : null;
    return fetch(url, { method: 'GET', cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) {
        if (timer) clearTimeout(timer);
        return r.ok ? r.json() : { ok: false };
      })
      .then(function (d) {
        return (d && d.ok)
          ? { ok: true, engine: d.engine || '', pid: d.pid || 0 }
          : { ok: false, reason: 'not-running' };
      })
      .catch(function () {
        if (timer) clearTimeout(timer);
        return { ok: false, reason: 'unreachable' };
      });
  }

  /**
   * 触发自定义协议拉起本机服务。
   * ★ 必须尽量在**用户点击的同步栈**里调用（先点 → 立刻 launch → 再轮询），
   *   否则 Chrome 会把这个外部协议导航当成「无用户手势」静默拦截。
   * 用隐藏 <a> 的 click() 而不是 iframe.src：Chrome 对 iframe 加载外部协议基本不放行。
   * 协议没注册时浏览器只会报一条控制台错误，页面不受影响；轮询超时后会给可操作提示。
   */
  function launch() {
    var proto = String(conf().protocol || 'safetyocr').replace(/:\/\/$/, '');
    var url = proto + '://start';
    try {
      var a = document.createElement('a');
      a.href = url;
      a.setAttribute('aria-hidden', 'true');
      a.style.cssText = 'display:none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (e) { /* 环境禁用外部协议：轮询会给出提示 */ }
    return url;
  }

  /**
   * 一键启动本机识别服务：已在运行直接返回；否则拉协议 + 轮询 health 直到就绪
   * @param {object} [opts] { timeout: 毫秒, skipLaunch: 已由调用方在点击栈内 launch 过 }
   * @returns {Promise<{ok:true, already:boolean, ms?:number}>}
   */
  function startLocal(opts) {
    opts = opts || {};
    if (!isLocal()) {
      return Promise.reject(new Error('当前识别接口不是本机服务，无法在页面里启动，请检查 config.js 的 ocr.endpoint'));
    }
    var wait = opts.timeout || conf().startTimeout || 25000;
    var fired = !opts.skipLaunch;
    return health(opts.skipLaunch ? 800 : 1500).then(function (h) {
      if (h.ok) return { ok: true, already: true };
      if (fired) launch();
      var t0 = Date.now();
      return new Promise(function (resolve, reject) {
        (function tick() {
          health(1200).then(function (r) {
            if (r.ok) return resolve({ ok: true, already: false, ms: Date.now() - t0 });
            if (Date.now() - t0 > wait) {
              return reject(new Error(
                '识别服务没能自动启动。首次使用请先双击 safety-desk_dev/install_ocr_protocol.bat 注册一键启动；' +
                '或直接双击 safety-desk_dev/start_ocr.bat 手动启动后重试'));
            }
            setTimeout(tick, 700);
          });
        })();
      });
    });
  }

  /* ---------------- 本地解析（纯规则，断网可用） ---------------- */

  /** 全角转半角 + 去掉 OCR 常见噪声（零宽字符、多余空格） */
  function norm(t) {
    var s = String(t || '');
    s = s.replace(/[\u200b-\u200f\ufeff]/g, '');
    s = s.replace(/[\uff01-\uff5e]/g, function (ch) {            // ！-～ → 半角
      return String.fromCharCode(ch.charCodeAt(0) - 0xfee0);
    });
    s = s.replace(/\u3000/g, ' ');
    s = s.replace(/[ \t]+/g, ' ');
    return s;
  }
  /** 取出的一行值做清理：去掉尾部标点/多余空格 */
  function val(s) {
    return String(s || '').replace(/^[\s:：]+/, '').replace(/[\s,，;；。]+$/, '').trim();
  }
  function pad2(n) { n = String(n); return n.length < 2 ? '0' + n : n; }
  /** 拼成 YYYY-MM-DD（非法日期返回空） */
  function d2(y, m, d) {
    y = parseInt(y, 10); m = parseInt(m, 10); d = parseInt(d, 10);
    if (!(y > 1900 && y < 2200) || !(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return '';
    return y + '-' + pad2(m) + '-' + pad2(d);
  }

  /** 作业类别 → 台账字典值（模糊匹配：证书上写「低压电工作业」，台账选「电工作业」） */
  function mapCategory(raw) {
    var D = SD.dict || SD.mock;
    var list = (D && D.DICT && D.DICT.specialCategory) || [];
    var s = String(raw || '');
    if (!s) return '';
    if (list.indexOf(s) >= 0) return s;                       // 完全一致
    var KEYS = [
      ['电工作业',        ['电工', '低压', '高压', '电气', '电力']],
      ['焊接与热切割作业', ['焊接', '热切割', '熔化焊', '钎焊', '气焊', '气割']],
      ['高处作业',        ['高处', '登高', '架设', '架子工']],
      ['吊装作业',        ['吊装', '起重', '指挥', '司索']],
      ['制冷与空调作业',   ['制冷', '空调']],
      ['危险化学品安全作业', ['危险化学品', '危化', '化工', '光气', '氯碱']],
      ['冶金（有色）生产安全作业', ['冶金', '有色', '煤气', '炼钢', '炼铁']],
      ['石油天然气作业',   ['石油', '天然气', '钻井', '井下']],
      ['金属非金属矿山作业', ['矿山', '矿井', '尾矿']],
      ['烟花爆竹安全作业', ['烟花', '爆竹']]
    ];
    for (var i = 0; i < KEYS.length; i++) {
      if (list.indexOf(KEYS[i][0]) < 0) continue;
      for (var j = 0; j < KEYS[i][1].length; j++) {
        if (s.indexOf(KEYS[i][1][j]) >= 0) return KEYS[i][0];
      }
    }
    // 再退一步：字典里有哪一项被原文包含
    for (var k = 0; k < list.length; k++) {
      if (list[k] && list[k] !== '其他' && s.indexOf(list[k]) >= 0) return list[k];
    }
    return '';
  }

  /** OCR 常把「标签」和「值」切成两个文本块（姓名 / 张伟 各占一行）。
      这里先把「纯标签行 + 下一行值」合并成一行，后面的行内正则才认得出。 */
  var LABELS = ['姓名', '性别', '作业类别', '准操项目', '操作项目', '作业项目',
                '证书编号', '证号', '编号', '发证机关', '发证单位',
                '有效期限', '有效期', '复审日期', '复审', '出生日期', '身份证号', '住址'];
  function isLabelLine(s) {
    var t = String(s || '').replace(/[:：]\s*$/, '').trim();
    return LABELS.indexOf(t) >= 0;
  }
  function mergeLabelValue(t) {
    var lines = String(t || '').split(/\n/).map(function (s) { return s.trim(); })
      .filter(function (s) { return s; });
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var cur = lines[i];
      var nxt = lines[i + 1];
      if (isLabelLine(cur) && nxt && !isLabelLine(nxt)) {
        out.push(cur.replace(/[:：]\s*$/, '') + ' ' + nxt);
        i++;                                  // 值行已被吃掉
      } else {
        out.push(cur);
      }
    }
    return out.join('\n');
  }

  /** OCR 常在姓名中间插空格（「李　强」），也会把后续字段排在同一行；
      这里先按常见字段词切断，再去掉空格取 2~4 个汉字 */
  var NAME_STOP = ['性别', '民族', '出生', '住址', '文化', '身份', '作业', '准操', '证书', '证号', '发证', '有效', '复审'];
  function parseName(t) {
    var m = t.match(/姓\s*名[ \t:：]*([^\n\r]{0,24})/);
    if (!m) return '';
    var rest = m[1];
    NAME_STOP.forEach(function (w) {
      var i = rest.indexOf(w);
      if (i >= 0) rest = rest.slice(0, i);
    });
    var s = rest.replace(/\s+/g, '');
    var nm = s.match(/^[\u4e00-\u9fa5·]{2,4}/);
    return nm ? nm[0] : '';
  }

  /**
   * 解析识别文本 → 台账字段（只返回识别到的键，识别不到的键不出现）
   * 覆盖：姓名 / 证书编号 / 作业类别 / 操作项目 / 发证机关 / 有效期起止 / 复审日期
   * @param {string} text
   * @returns {object}
   */
  function parse(text) {
    var t = mergeLabelValue(norm(text));
    var out = {};

    // 姓名（证书：姓名 张三 / 姓 名：张三 / 李　强）
    var nm = parseName(t);
    if (nm) out.name = nm;

    var m;

    // 证书编号（证号 / 证书编号 / 编号，字母数字串）
    m = t.match(/(?:证\s*书?\s*编\s*号|证\s*号|编\s*号)[ \t:：]*([A-Za-z0-9][A-Za-z0-9\-\/]{5,23})/);
    if (m) out.certNo = val(m[1]).toUpperCase();

    // 操作项目 / 准操项目（特种作业操作证上写「准操项目」）
    m = t.match(/(?:准\s*操\s*项\s*目|作\s*业\s*项\s*目|操\s*作\s*项\s*目)[ \t:：]*([^\n\r]{2,24})/);
    if (m) out.operation = val(m[1]);

    // 作业类别
    m = t.match(/作\s*业\s*类\s*别[ \t:：]*([^\n\r]{2,20})/);
    var catRaw = m ? val(m[1]) : '';
    if (!catRaw) catRaw = out.operation || '';          // 没有类别行时用准操项目反推
    var cat = mapCategory(catRaw);
    if (cat) out.category = cat;

    // 发证机关
    m = t.match(/(?:发\s*证\s*机\s*关|发\s*证\s*单\s*位)[ \t:：]*([^\n\r]{4,30})/);
    if (m) out.issuer = val(m[1]);

    // 有效期：2020-01-01 至 2026-01-01 / 2020年1月1日至2026年1月1日 / 2020.1.1-2026.1.1
    m = t.match(/(\d{4})\s*[年\-\/\.]\s*(\d{1,2})\s*[月\-\/\.]\s*(\d{1,2})\s*日?\s*(?:至|到|—|–|-|~|～)\s*(\d{4})\s*[年\-\/\.]\s*(\d{1,2})\s*[月\-\/\.]\s*(\d{1,2})/);
    if (m) {
      var f = d2(m[1], m[2], m[3]), to = d2(m[4], m[5], m[6]);
      if (f) out.validFrom = f;
      if (to) out.validTo = to;
    }

    // 复审日期
    m = t.match(/复\s*审[^\d]{0,10}(\d{4})\s*[年\-\/\.]\s*(\d{1,2})\s*[月\-\/\.]\s*(\d{1,2})/);
    if (m) { var rd = d2(m[1], m[2], m[3]); if (rd) out.reviewDate = rd; }

    return out;
  }

  return {
    ready: ready, conf: conf, recognize: recognize, parse: parse, mapCategory: mapCategory,
    origin: origin, isLocal: isLocal, health: health, launch: launch, startLocal: startLocal
  };
})();
