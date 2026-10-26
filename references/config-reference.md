# 配置参考

> 所有可调项的默认值都在 `assets/js/config.js`（骨架）或 `examples/safety-desk/assets/js/config.js`（完整版）。

---

## 基础

| 键 | 默认 | 说明 |
|---|---|---|
| `appName` | `我的工作台` | 左上角名称，同时写进浏览器标签 |
| `appSub` | `单文件 · 离线可用` | 名称下的小字 |
| `storageKey` | `wb_my_desk_v1` | ⚠️ **同域名多工作台必须不同**，否则数据串 |
| `operator` | `我` | 写进流转记录的「操作人」 |
| `weekStart` | `1` | 一周起算日：1=周一（国内习惯），0=周日 |
| `sample` | `true` | 首次打开是否预置示例数据（交付给现场时建议 `false`） |

---

## thresholds — 口径阈值

| 键 | 默认 | 说明 |
|---|---|---|
| `soonDays` | `3` | 距截止 ≤N 天 = 临期（橙色） |
| `certWarnDays` | `30` | 证书 ≤N 天 = 预警（橙） |
| `certNoticeDays` | `90` | 证书 ≤N 天 = 提醒（黄）；>N 不提示 |

> 这些会存进本机 settings，页面上改过就以本机为准；代码里的值是「出厂默认」。

---

## security — 安全控制

| 键 | 默认 | 说明 |
|---|---|---|
| `idleLockMin` | `30` | 连续无操作 N 分钟 → 自动退回受限；**0 = 关闭** |
| `defaultPurgePin` | `'888888'` | 清空数据专用密码的出厂值（改过后以本机摘要为准） |

登录密码的出厂值不在这里，在 `auth.js` 的 `DEFAULT_PIN`（示例为 `123456`；骨架为 `123456`）。
**建议首次使用就改掉**，改的地方是「齿轮 → 密码设置 / 修改」。

---

## codeRules — 单据编号

```js
codeRules: {
  hazard:      { prefix:'FZYH', label:'隐患编号', withYear:false, seqLen:7 },  // FZYH-0000001
  inspection:  { prefix:'FZXJ', label:'巡检编号', withYear:true,  seqLen:3 },  // FZXJ-2026-001
  certificate: { prefix:'ZGZS', label:'证书编号', withYear:false, seqLen:3 }   // ZGZS-001
}
```

| 字段 | 说明 |
|---|---|
| `prefix` | 前缀（大写字母） |
| `label` | 表单字段名 + 错误提示用语 |
| `withYear` | `true` = `前缀-年-序号`；`false` = `前缀-序号` |
| `seqLen` | 序号位数（7 → `0000001`），也用于校验 |
| `seqMin` / `seqMax` | 可选：放宽位数区间（兼容历史短号/长号） |
| `allowNoYear` | 可选：额外允许「无年份」的历史写法 |
| `allowLegacy` | 默认 `true`；`false` = 只认新号，老号直接拒 |
| `pattern` | 可选：显式正则，给了就不按上面几项自动拼 |

---

## photo — 照片

| 键 | 默认 | 说明 |
|---|---|---|
| `compress` | `false` | **默认不压缩**（保留手机原图，现场取证要看清细节） |
| `maxW` | `1000` | 仅 `compress:true` 时生效 |
| `maxBytes` | `26214400` | 单张上限 25MB，超出直接拒收并提示 |

> 不压缩意味着单张 3~6MB，**必须配合 `photoVault`（IndexedDB）外置**，否则 localStorage 立刻爆。
> 不要为了省空间去改这里 —— 改 `compress:true` 会丢掉现场细节。

---

## watermark — 培训照片水印

| 键 | 默认 | 说明 |
|---|---|---|
| `phone` | `''` | 手机型号；留空则该行只显示地点 |
| `place` | `江苏省南通市` | 地点 |
| `dateFormat` | `YYYY-MM-DD HH:mm` | 第二行格式；时间可留空（留空则只画日期） |

排版：左下角两行，第一行「型号 · 地点」，第二行「日期 时间」比第一行小一档。

---

## shiftLog — 交接班记录（照原表固定项）

| 键 | 默认 | 说明 |
|---|---|---|
| `plant` | `缝制中心` | 厂区（表格里**固定印刷**） |
| `dept` | `安全环保部` | 部门（固定印刷） |
| `shifts` | 白/中/夜 | 班次下拉选项 |

巡检人员不在这里配：使用者手填，**打印与导出时一律留空**（留 38mm 签名位）。

---

## ocr — 证件图片识别（可选）

| 键 | 默认 | 说明 |
|---|---|---|
| `endpoint` | 本机服务或公司接口 | 留空 = 未配置，按钮明确提示去哪里配（不做假功能） |
| `mode` | `'json'` | `json`（base64 JSON）/ `form`（multipart 上传） |
| `fieldName` | `'image'` | 图片字段名 |
| `headers` | `{}` | 鉴权头，如 `{ Authorization: 'Bearer xxx' }` |
| `textPath` | `'text'` | 返回 JSON 里文字所在路径，如 `data.text` |
| `timeout` | `15000` | 识别比普通接口慢，单独给超时 |
| `protocol` | `'safetyocr'` | 本机服务一键启动的自定义协议 |
| `healthPath` | `'/health'` | 探活路径 |

---

## 数据源

| 键 | 默认 | 说明 |
|---|---|---|
| `source` | `'mock'` | `mock` = 本机示例数据；`real` = 走 `baseURL` |
| `baseURL` | `'/api'` | 真实接口基址 |
| `getToken` | 读 `localStorage.sd_token` | 鉴权钩子，改这里即可接单点登录 |
| `timeout` | `8000` | 普通请求超时 |
| `mock.latency` | `[180, 520]` | 模拟延迟区间，用来看「加载中」 |
| `mock.fault` | `false` | `true` = 所有请求失败，用来看「加载失败 + 重试」 |

---

## 打印相关（不在 config.js，在 CSS）

| 位置 | 作用 |
|---|---|
| `assets/css/print.css` | 屏幕上的「纸张」版式（预览层） |
| `assets/css/print-only.css` | **`media="print"` 独立打印样式**：隐藏导航/按钮、`@page` 纸张与页边距 |
| `components.css` 里 `.sl-paper-table` | 交接班记录的纸面明细样式（列宽/行高/边框） |
| `shiftLog.js` 顶部 `COLW` / `PAGE_W` | 列宽（字符单位）与可印区尺寸 |

改打印机/纸张时只改这些，不要去改业务代码。
