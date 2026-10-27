---
name: safety-desk-workbench
description: 搭建「离线优先的个人业务工作台」HTML 应用的完整方法论与可运行骨架。适用于需要多模块台账 + 打印/Excel/Word 出件 + 角色权限 + 断网可用的单机工作台（如安全员工作台、巡检记录、值班表、检测台账）。包含分层架构、单向数据流、零外链实现、出件排版校准、jsdom + 真打印双层自检流程，以及 20+ 条实测踩坑。
---

# 安全员工作台 · 搭建 SKILL

> 一个「双击 index.html 就能用、断网不崩、能打印能导出、别人克隆就能改」的业务工作台，是怎么一步步做出来的。
> 本 SKILL 提炼自一套 49 个 JS 文件、1355 项自检全绿的实际项目（`examples/safety-desk`）。

---

## 一、什么时候用这个 SKILL

**适用**：需要「一个人 / 一个小团队在单机上长期记录 + 定期出纸质件」的场景。

- ✅ 台账类：安全隐患台账、特种设备人员台账、证书台账、设备点检
- ✅ 记录类：巡检记录、交接班记录、值班日志、培训签到
- ✅ 需要出件：打印 A4 单据、导出 Excel、导出 Word 通知单
- ✅ 内网 / 断网环境：厂区电脑、车间平板、无外网的办公机
- ✅ 数据敏感不能上云：只要不接后端，数据就只在本机浏览器里

**不适用**：

- ❌ 多人协作、需要实时同步 → 要用后端 / 云数据库
- ❌ 需要手机 App 通知推送 → 浏览器通知不可靠
- ❌ 需要复杂账号体系与审计 → 前端门禁不是安全边界
- ❌ 数据量特别大（几万条以上）→ localStorage 有 5MB 级限制

---

## 二、30 秒了解它长什么样

```
┌──────────┬────────────────────────────────────────────┐
│ 品牌区    │  页面标题            [日期] [角色] [⚙]      │
├──────────┼────────────────────────────────────────────┤
│ 安全概览  │  ┌── 关键指标卡 ──┬── 关键指标卡 ──┐        │
│ 待办任务  │  └────────────────┴────────────────┘        │
│ 隐患管理  │  ┌── 今天要处理（逾期标红 + 一键处理）────┐  │
│ 安全巡检  │  └──────────────────────────────────────┘  │
│ 安全培训  │  ┌── 台账列表（搜索 / 筛选 / 排序）───────┐  │
│ 特种作业▸ │  │  行 … 行 … 行 …                       │  │
│ 更多 ▾    │  └──────────────────────────────────────┘  │
└──────────┴────────────────────────────────────────────┘
        ↑ 侧栏常驻，<768px 收成顶部横条（移动端可加桌面）
```

三种「出件」：**A4 打印**（独立打印样式，按钮/导航全部隐藏）、**Excel**（自写 OOXML，无第三方库）、**Word**（自写 docx）。

---

## 三、技术选型（以及为什么不选别的）

| 决策 | 选择 | 为什么 |
|---|---|---|
| 框架 | **不用**（原生 JS，ES5 风格） | 断网可用、`file://` 双击即开、十年后还能改。React/Vue 需要构建或 CDN，一旦 CDN 挂了整站白屏 |
| 模块化 | **全局命名空间 `window.SD`** + 按序 `<script>` | 没有 ES module，才能 `file://` 直接跑（module 有 CORS 限制） |
| 构建 | **不构建** | 改一行刷新即见，现场维护不需要装 node |
| 状态 | 内存对象 + localStorage，**单一数据源** | 页面刷新不丢、导出即备份 |
| 样式 | 手写 CSS + CSS 变量 | 无外部字体/图标库；图标全部内联 SVG |
| 图表 | **内联 SVG 手写** | 图表库体积大且要外链；业务图表就折线/柱状/环形三种 |
| Excel | **读写都自写**：写 `xlsxWriter.js`，读 `xlsxReader.js` | SheetJS 500KB+ 且要外链；写只是拼 OOXML + ZIP，读只需 ZIP 目录 + `DecompressionStream` + `DOMParser`，约 300 行 |
| Word | **自写 `docxWriter.js`** | 同上；纯前端造 .docx 就是拼 XML + ZIP |
| 测试 | **jsdom + fake-indexeddb** + Chrome headless 真打印 | 逻辑用 jsdom 秒级验证；打印/分页/字体只有真浏览器说了算 |

> ⚠️ 唯一允许的「外部依赖」是**可选的本地 OCR 服务**（`config.ocr.endpoint`），
> 且必须做「未配置就明确提示、不做假功能」的降级，不能因此让主流程崩。

---

## 四、制作流程：12 步

> 每一步都对应本仓库里可查的产物；照顺序走，不要跳步。
> 详细展开见 `docs/quickstart.md`。

### 第 0 步 · 定边界（写下来，别只在脑子里）

先回答四个问题，答案决定后面所有设计：

1. **谁用**？（一个人 / 一个班组的同一台电脑 / 多人各自本机）
2. **记什么**？（列表 → 字段 → 主键 → 状态机）
3. **出什么件**？（A4 打印 / Excel / Word；有没有「必须和公司原表逐格一致」的要求）
4. **在哪用**？（桌面浏览器 / 平板 / 断网 / 要不要 `file://`）

> 有「必须和公司原表一格不差」的出件要求时，**把原始 .xlsx 拿到手，用 openpyxl 逐格 dump**（列宽、行高、合并区、逐边边框、字体字号、页面设置）。
> 不要凭截图目测——目测一定差几毫米，而打印是按毫米算的。

### 第 1 步 · 复制骨架

```bash
bash scripts/scaffold.sh my-desk "我的工作台"     # 复制 assets/skeleton → my-desk/ 并改名
node tests/serve.js 8132 my-desk                 # 起本地服务
node tests/smoke_skeleton.js http://127.0.0.1:8132/index.html   # 19 项自检应全绿
```

骨架已经具备：路由 + 导航、`refreshAll` 统一刷新、示例数据、受限/安全员双角色、六位密码、清空专用密码、30 分钟空闲锁、导出/导入 JSON、移动端适配。

### 第 2 步 · 定数据模型

先写 `references/data-model.md` 里的表，再写代码：

```
实体 → 字段（名/类型/必填/默认/枚举）→ 主键 → 状态机 → 与其它实体的关系
```

**关键约定**：所有集合都放一个对象里（`store.data().hazards`），不要每个实体一个 localStorage key —— 备份/恢复/清空会变得很难写。

### 第 3 步 · 铺分层目录

```
assets/js/
├── config.js          全局配置（唯一「可调参数」入口）
├── utils.js           纯工具（无状态）
├── auth.js            角色与密码
├── store.js           localStorage 读写 + 导出/导入/清空
├── pinyin.js          汉字拼音首字母表（动态编号前缀用，离线字表）
├── code.js            单据编号规则
├── dataSource.js      数据访问层（mock / real 可切换）
├── metrics.js         计算层（纯函数，只读数据）
├── router.js          路由 + 导航
├── app.js             装配层（refreshAll 唯一入口）
├── components/        通用控件（弹窗/表格/图表/导出器…）
├── data/              静态种子数据
└── views/             每页一个文件，只渲染不互相调用
```

**依赖方向必须单向**（下一个模块只能依赖上面的）：
`config → utils → store/auth → dataSource → metrics → components → views → router/app`

### 第 4 步 · 写「一条链路」跑通

不要一次写完 10 个模块。先让**一个模块**从「点新增 → 校验 → 落库 → 列表刷新 → 刷新后还在」整条链路跑通，再复制这个模式。

顺序：`store.add()` → `app.refreshAll()` → `views/xxx.render()`。

### 第 5 步 · 加「今天要处理」置顶区

这是这类工作台的灵魂（用户打开就想知道「现在该干什么」）：

- 逾期（红）→ 今天到期（橙）→ N 天内到期
- 每条一个「一键处理」按钮
- **昨天没做完的自动滚到今天，不要凭空消失**（按截止日排序，不按创建日）

### 第 6 步 · 加搜索 / 筛选 / 排序 / 分页

表格统一走 `components/table.js`，不要在 10 个视图里各写一遍 `<table>`。
搜索框要注意：**输入时不要整页重绘**（会丢焦点），只重绘列表区域（见 `references/pitfalls.md` 第 7 条）。

### 第 7 步 · 加权限与安全控制

- 默认**受限**：能看、能打印、能导出，不能改
- 六位登录密码解锁（只对本次打开有效 → sessionStorage）
- **清空数据 = 专用密码**（与登录密码分开存）
- **30 分钟无操作自动退回受限**
- 写操作再加一道兜底拦截（防止有人绕过按钮直接调 API）

详见 `references/security-model.md`。

### 第 8 步 · 做出件（最容易翻车的一步）

| 出件 | 用什么 | 关键 |
|---|---|---|
| A4 打印 | `print.css`（屏幕版式）+ **`print-only.css`（`media="print"` 独立）** | 隐藏一切非纸张元素；`@page` 定纸张与页边距；`zoom` 缩放而不是 `transform` |
| Excel | `components/xlsxWriter.js` | 合并/列宽/行高/逐边边框/图片/页面设置；行高写在行首格上也要认 |
| Excel 导入 | `components/xlsxReader.js` | 解 ZIP 中央目录 → `DecompressionStream('deflate-raw')` → `DOMParser` 读 sheet；`sharedStrings` 富文本要把多个 `<t>` 拼起来；日期是序列号 |
| 台账批量导入 | `components/excelIO.js` | 字段定义驱动：表头别名映射、逐行校验、文件内去重、追加/覆盖、模板下载 |
| Word | `components/docxWriter.js` | 页边距、表格缩进、照片等比缩放 |

**铁律**：先拿原始表格 dump 成「参考基线」，再写代码，最后用 openpyxl 把**导出件和基线逐格 diff**（列宽 / 行高 / 合并区 / 可见边框线条 / 字号），差一处改一处。详见 `references/print-and-export.md`。

### 第 9 步 · 照片（如果有）

- 默认**不压缩**（现场照片要能看清细节），单张 25MB 上限
- 大图必须**外置到 IndexedDB**（`photoVault.js`），否则 localStorage 立刻爆
- 内存里只留 `vault:xxx` 引用，渲染时再水合
- 下载时加水印：canvas 绘制两行（型号·地点 / 日期 时间），左下角

### 第 10 步 · 写自检（先写测试再交付）

一套业务对应一个 `smoke_xxx.js`，用 jsdom 跑：

```bash
node tests/serve.js 8126 examples/safety-desk     # 必须用 node 服务，不要 python -m http.server
node tests/smoke_shift.js http://127.0.0.1:8126/index.html
```

**要测的不是「渲染出来了」，而是「口径对不对」**：数量、合计、状态流转、编号顺延、权限拦截、出件内容。

### 第 11 步 · 真打印取证（唯一可信的验证）

jsdom 不解析 `@page`、不分页。打印相关改动必须用真 Chrome：

```bash
node scripts/print_probe.js http://127.0.0.1:8126/index.html   # 打印成 PDF 并数页数
```

判据：**页数 = 1**、`/MediaBox` 尺寸对、PDF 抽文字不缺项。

### 第 12 步 · 交付与迭代

- 交付 `index.html` 所在目录 + 一句「双击就能用」
- 需要分享/手机用时再部署成链接（部署后**不要预填真实隐私数据**）
- 迭代原则：一次只加 1 个模块；**不换 storage key、不删老字段**，保证老数据能继续读

---

## 五、核心技术与依赖

**运行时**：无。零外链、零构建，双击 `index.html`（或任意静态服务器）。

**自研组件（都在 `examples/safety-desk/assets/js/components/`）**：

| 组件 | 作用 | 为什么自己写 |
|---|---|---|
| `xlsxWriter.js` | 生成真 .xlsx | 免 SheetJS；支持合并、列宽行高、逐边边框、内嵌图片、页面设置、竖排文字 |
| `docxWriter.js` | 生成真 .docx | 免 docx 库；通知单/报告类出件 |
| `chart.js` | 折线/柱状/环形（内联 SVG） | 免图表库；断网可用 |
| `photoVault.js` | IndexedDB 大图仓 | localStorage 存不下原图 |
| `photoWatermark.js` | canvas 水印 | 型号·地点 / 日期时间两行 |
| `printNotice.js` / `printPhotos.js` | 打印预览层 | 预览即成品 |
| `table.js` / `dropdown.js` / `dialog.js` | 列表、操作下拉、弹窗 | 统一交互，避免每页重写 |

**开发期依赖（只在跑测试时需要，不进生产）**：

```bash
cd tests && npm install        # jsdom + fake-indexeddb
```

**可选**：本地 OCR 服务（Python `rapidocr-onnxruntime`），只在「识别证件图片」功能里用到，未配置则按钮明确提示。

---

## 六、可配置参数速查

全部集中在 `assets/js/config.js`，改这里不用动业务代码。完整表见 `references/config-reference.md`。

```js
SD.CONFIG = {
  appName: '我的工作台',            // 左上角名称（也可在页面里点着改）
  appSub: '单文件 · 离线可用',
  storageKey: 'wb_my_desk_v1',     // ⚠️ 同域名多工作台必须各不相同
  operator: '我',                   // 写进流转记录的操作人

  thresholds: { soonDays: 3 },      // 距截止 ≤N 天 = 临期

  security: {
    idleLockMin: 30,                // 无操作 N 分钟自动退回受限（0 = 关闭）
    defaultPurgePin: '888888'       // 清空专用密码（与登录密码分开）
  },

  sample: true,                     // 首次打开是否预置示例数据
};
```

真实项目里另外还有（见 `references/config-reference.md`）：`codeRules`（单据编号前缀/位数，含 `prefixFrom` 动态前缀）、`ocr`（识别接口）、`watermark`（水印默认值）、`photo`（压缩开关/单张上限）、`shiftLog`（固定厂区/部门/班次）。

---

## 七、使用示例

### 示例 1：只改配置，30 秒换一个场景

把「我的工作台」改成「班组点检台」：

```js
// config.js
appName: '班组点检台',
appSub: '每日设备点检',
storageKey: 'wb_team_check_v1',     // ← 必须改，否则和别的台串数据
thresholds: { soonDays: 1 },
operator: '张班长'
```

### 示例 2：加一个业务模块（以「值班表」为例）

1. `store.js` 加集合：`data.shifts = []`、`addShift/removeShift`
2. `views/shift.js`：只负责渲染列表 + 绑定事件
3. `router.js` 加一条：`{ id:'shift', name:'值班表', icon:'▤' }`
4. `app.js` 的 `renderView()` 加分支：`if (id === 'shift') renderShift(host)`
5. `tests/smoke_shift2.js` 补 5 条断言（新增、落库、刷新后还在、删除确认、无 JS 报错）

### 示例 3：把出件对到公司原表

```bash
# 1) 把原表逐格 dump 成基线
python - <<'PY'
import openpyxl
ws = openpyxl.load_workbook('原表.xlsx').active
print('列宽', {k: v.width for k, v in ws.column_dimensions.items()})
print('行高', {k: v.height for k, v in ws.row_dimensions.items()})
print('合并', sorted(str(x) for x in ws.merged_cells.ranges))
for r in range(1, ws.max_row + 1):
    print(r, [ws.cell(row=r, column=c).border.left.style for c in range(1, 6)])
PY

# 2) 按基线写出件（xlsxWriter / print CSS）
# 3) 导出真件，逐格 diff
python scripts/compare_xlsx.py 原表.xlsx 导出件.xlsx
```

判据：合并区、列宽、行高、**可见边框线条**、字号、页面方向与页边距，全部一致（细节见 `references/print-and-export.md`）。

---

## 八、交付前的自检清单（一条不过就别交付）

1. 双击 `index.html` 能打开（`file://` 下不报 CORS 错）
2. 首次打开有示例数据，不是空白页
3. 「今天要处理」在首屏，逾期红色、能一键处理
4. 手机宽度（375px）下不横向滚动、按钮 ≥44px、输入框 ≥16px
5. 刷新页面数据还在；导出 JSON → 清空 → 导入 → 数据回来
6. 受限态点「新增/编辑/删除」被拦下并提示
7. 清空数据：输错专用密码不执行、有明确提示
8. 打印预览里没有任何按钮/导航；真打印 **1 页**、无截断
9. 导出 Excel 用 Excel/WPS 能打开，不报「文件损坏」
10. 断网（或拔网线）后刷新，功能全在
11. 自检脚本全绿（示例版 + 空白版）
12. 没有把真实人名/身份证/手机号写进示例数据

---

## 九、参考资料索引

| 文件 | 内容 |
|---|---|
| `docs/quickstart.md` | 从脚手架到第一个模块的完整命令流程 |
| `docs/customize.md` | 改品牌、加模块、改字段、换配色 |
| `docs/faq.md` | 常见问题（打印机、Excel 打不开、数据丢失、部署） |
| `references/architecture.md` | 分层、命名空间、单向数据流、文件清单 |
| `references/data-model.md` | 实体/字段/状态机设计模板 |
| `references/config-reference.md` | 全部配置项与默认值 |
| `references/print-and-export.md` | 打印/Excel/Word 出件口径与校准方法 |
| `references/security-model.md` | 角色、密码、空闲锁、门禁边界 |
| `references/testing.md` | jsdom 自检 + 真打印取证的写法与坑 |
| `references/pitfalls.md` | **20 条实测踩坑**（先看这个，能省两天） |
| `assets/skeleton/` | 可运行的最小骨架（19 项自检全绿） |
| `examples/safety-desk/` | 完整示例：49 个 JS、9 个模块、1355 项自检 |

---

## 十、一句话总结

> **零外链、单一数据源、单向调用、出件逐格对基线、改动一律真打印验证。**
> 这五条做到，工作台就能在厂区里活很多年。
