/* =========================================================
   config.js — 全局配置
   这里集中了所有「可切换 / 可调」的开关与阈值：
     · source    : 数据源（mock 模拟 / real 真实接口）
     · baseURL   : 真实接口基址，接后端时只改这里
     · getToken  : 鉴权钩子，接后端时替换实现
    · thresholds: 口径阈值（临期天数、证书预警档位）
    · weekStart : 一周起算日（1=周一，国内习惯）
    · codeRules : ★ 单据编号规则（前缀 / 序号位数 / 校验正则），见下方注释
   注意：本文件不依赖任何其它模块，必须最先加载。
   ========================================================= */
window.SD = window.SD || {};

SD.CONFIG = {
  /* ---------- 数据源 ---------- */
  source: 'mock',                 // 'mock' | 'real'
  baseURL: '/api',                // 真实接口基址，后面统一拼 "/hazards" 之类
  getToken: function () {         // 鉴权钩子：真实环境改成从 cookie/单点登录取
    try { return localStorage.getItem('sd_token') || ''; } catch (e) { return ''; }
  },

  /* ---------- 模拟数据源行为 ---------- */
  mock: {
    latency: [180, 520],          // 随机延迟区间(ms)，用来演示「加载中」
    fault: false                  // true = 所有请求失败，用来演示「加载失败」
  },

  /* ---------- 安全控制（2026-10-25 新增） ---------- */
  security: {
    /* 连续 N 分钟没有任何操作（鼠标/键盘/触摸/滚动）→ 自动退回「受限模式」。
       · 只在安全员状态下生效；受限本来就没权限，不用再锁
       · 0 或负数 = 关闭自动锁定
       · 想临时改短做演示：把 30 改成 0.5（=30 秒）即可，见 app.js 的 startIdleWatch() */
    idleLockMin: 30
  },

  /* ---------- 口径阈值（页面设置里可改，改后存 localStorage） ---------- */
  thresholds: {
    soonDays: 3,        // 距整改期限 ≤N 天 = 临期
    certWarnDays: 30,   // 证书 ≤N 天 = 预警（橙）
    certNoticeDays: 90  // 证书 ≤N 天 = 提醒（黄）；>N 不提示
  },

  /* ---------- 单据编号规则（★ 可自行修改） ----------
     ★ 2026-10-24 起：七类单据**按类型各用各的**编号体系（2026-10-22 的
       「七类统一 FZ-0000001」只试用一天，按用户要求拆分）：
       · hazard      隐患编号     FZYH-0000001   无年份 · 序号 7 位
       · inspection  巡检编号     FZXJ-2026-001  带年份 · 序号 3 位
       · training    培训编号     FZPX-2026-001  带年份 · 序号 3 位
       · certificate 证书编号     ZGZS-001       ★ 2026-10-25 按用户口径确定：无年份 · 序号 3 位
       · notice      通知编号     FZTG-2026-001  带年份 · 序号 3 位
       · permit      作业票编号   FZ+类型首字母-0000001  ★ 2026-10-28 起按作业类型动态生成
                                  （吊装作业 → FZDZ-0000001、动火作业 → FZDH-0000001）
       · special     人员编号     TZZY-001       无年份 · 序号 3 位
       编号由用户掌控：新增表单**默认顺延填入下一个可用编号**（可手动改，
       清空手填也行），保存时校验「非空 + 格式 + 同类型唯一」，不再自动补号；
       各类型序号池仍彼此独立（隐患 FZYH-0000001 与作业票 FZDZ-0000001 互不影响）。
       存量老编号（HZ-2026-001 / CT-001 / FZ-0000001 / 旧作业票 FZZY-0000001 这类）
       仍可原样保存，属兼容放行（2026-10-25 前的证书号 FZ-0000001 也在这条里，换号前不会报错），
       建议在日常维护中逐步换成新号（改号只影响展示与检索，不影响统计）。

     每个规则的字段：
       prefix      前缀，如 'FZYH'；作业票填固定部分 'FZ'（后面按类型动态接）
       prefixFrom  可选：动态前缀取自记录里的哪个字段（作业票填 'type'）。
                   配了它就不再是固定前缀，改为「prefix + 类型名首字母」，见 code.js
       label       表单上的字段名与错误提示用语
       withYear    true=「前缀-年-序号」，false=「前缀-序号」
       seqLen      序号位数（7 → 0000001；3 → 001），同时作为校验的位数
       seqMin/Max  可选：放宽序号位数区间，用来兼容历史短/长序号
       allowNoYear 可选：额外允许「无年份」的历史写法
       allowLegacy 可选：默认 true，放行 HZ-2026-001 / FZ-0000001 这类老编号；置 false 则只认新号
       pattern     可选：显式正则字符串，给了就不按上面几项自动拼 */

  /* 作业票动态前缀的规则细节（写在 code.js 的注释里，这里只留摘要）：
     · 前缀 = FZ + 作业类型前两个汉字的拼音首字母（吊装作业 → DZ → FZDZ）
     · 单字类型只取 1 位（焊 → H → FZH）；无汉字（LOTO）取字母；取不到 → QT
     · 首字母撞车（受限空间 / 射线探伤 / 水下 都是 SX）：字典里先登记者占 FZSX，
       后来者依次延长取第 3、第 4 位（FZSXT / FZSXZ），整名仍相同再加序号（FZSX2）
     · 改作业类型名 → 前缀随之变，旧号仍能存（不属于现存类型即放行） */
  codeRules: {
    hazard:      { prefix: 'FZYH', label: '隐患编号',   withYear: false, seqLen: 7 },
    inspection:  { prefix: 'FZXJ', label: '巡检编号',   withYear: true,  seqLen: 3 },
    training:    { prefix: 'FZPX', label: '培训编号',   withYear: true,  seqLen: 3 },
    certificate: { prefix: 'ZGZS', label: '证书编号',   withYear: false, seqLen: 3 },
    notice:      { prefix: 'FZTG', label: '通知编号',   withYear: true,  seqLen: 3 },
    special:     { prefix: 'TZZY', label: '人员编号',   withYear: false, seqLen: 3 },
    permit:      { prefix: 'FZ', prefixFrom: 'type', label: '作业票编号', withYear: false, seqLen: 7 },
    device:      { prefix: 'TZSB', label: '设备人员编号', withYear: false, seqLen: 3 }
  },

  /* ---------- 周口径 ---------- */
  weekStart: 1,                   // 1=周一（国内习惯）；0=周日

  /* ---------- 证件图片文字识别（可选增强，2026-10-24） ----------
     纯离线页面没有 OCR 能力，「特种作业人员台账 → 编辑 → 识别图片」按钮
     会把证件照 POST 给公司自己的文字识别接口，拿回文字后本地拆成字段填表。
     · endpoint 留空 = 未配置：按钮仍显示，但点击会明确提示去哪里配（不做假功能）
     · 换了服务商只改这一块，解析规则在 components/ocr.js（本地纯规则，断网可用）
     接口约定（默认 json 模式）：
       POST {endpoint}
       Body  { "image": "<base64，不含 data: 前缀>" }     ← fieldName 可改字段名
       Head  Content-Type: application/json + headers    ← 鉴权头写 headers（如 Authorization）
       返回  { "text": "识别出的整段文字" }                ← 其它结构改 textPath，常见结构有兜底
       也支持 mode:'form'：改走 multipart/form-data 上传文件 */
  ocr: {
    // 本机离线识别服务：先运行 python safety-desk_dev/local_ocr_server.py
    // （拿不到公司接口时用它；公司接口就绪后把这里换成接口地址，其余不用改）
    endpoint: 'http://127.0.0.1:8123/ocr',
    mode: 'json',                 // 'json'（base64 JSON）| 'form'（multipart 上传）
    method: 'POST',
    fieldName: 'image',           // 图片字段名（json 的 key / form 的表单名）
    filename: 'cert.jpg',
    headers: {},                  // 例：{ Authorization: 'Bearer xxxxx' }
    textPath: 'text',             // 返回 JSON 里文字所在路径，如 'data.text'
    extra: null,                  // 需要额外参数时填对象（会并入 json body）
    timeout: 15000,               // 识别比普通接口慢，单独给 15s

    // 本机服务一键启动：页面「启动服务」按钮 → 自定义协议 → start_ocr_silent.bat
    // 一次性注册：双击 safety-desk_dev/install_ocr_protocol.bat（写 HKCU，不需管理员）
    // 换成公司外网接口后这段自动不生效（只对本机 endpoint 起作用）
    protocol: 'safetyocr',
    healthPath: '/health',
    startTimeout: 25000
  },

  /* ---------- 培训照片水印默认值（下载时可在弹窗里改，改过会记住） ----------
     水印两行：第一行「手机型号 · 地点」，第二行「日期 时间」，固定左下角。 */
  watermark: {
    phone: '',                    // 手机型号，例：'HUAWEI Mate 60 Pro'；留空则该行只显示地点
    place: '江苏省南通市',         // 地点，例：'江苏省南通市 · 厂区 3 号门'
    dateFormat: 'YYYY-MM-DD HH:mm'  // 第二行格式；时间默认取培训日期 + 当前时刻，可手改
  },

  /* ---------- 本地持久化 ---------- */
  storageKey: 'sd_safety_desk_v1',


  /* ---------- 照片上传（2026-10-24：默认不压缩，保留手机原图） ----------
     不压缩意味着单张 3~6MB，localStorage 存不下 —— 大图会自动外置到
     IndexedDB（components/photoVault.js），所以不要为了容量去改这里。
     compress 改回 true 就退回「压到 1000px / JPEG 0.82」的老行为。 */
  photo: {
    compress: false,              // false = 原图（默认）｜true = 压缩到 maxW
    maxW: 1000,                   // 仅压缩模式生效
    maxBytes: 26214400            // 单张上限 25MB，超过直接拒收并提示
  },
  /* ---------- 安全巡检与交接班记录（2026-10-25） ----------
     表格版式照抄《现场安全巡检与交接班记录.xlsx》：
       · plant / dept 是原表里**固定印刷**的内容，改这里即可换厂区、部门
       · shifts 是「班次」下拉的选项
     巡查人员不在这里配：它由使用者手填，打印与导出时一律留空（留位手签）。 */
  shiftLog: {
    plant: '缝制中心',
    dept: '安全环保部',
    shifts: [
      { v: 'day',    n: '白班' },
      { v: 'middle', n: '中班' },
      { v: 'night',  n: '夜班' }
    ]
  },

  /* ---------- 请求超时(ms) ---------- */
  timeout: 8000
};
