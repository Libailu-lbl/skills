# 更新日志

本项目按「工作台版本」记录；日期为实际开发日期。

## v1.1.1 — 危险作业票按作业类型动态编号

**主题**：作业票编号不再用固定前缀，改为「FZ + 作业类型名前两字拼音首字母 + 7 位序号」。

### 新增
- `assets/js/pinyin.js`：汉字拼音首字母表 —— GB2312 一二级 **6763 字**按 A~Z 分组固化，约 24KB，
  运行时建一次 Map；支持拉丁字母原样转换，字表外字符返回空由上层兜底。零依赖、断网可用。
- `code.js` 动态前缀段：`permitNames / allocTail / tailMap / prefixOf / prefixOwner`；
  `patternOf / sample / padSeq / seqOf / next / check / field` 全部支持 `typeVal`。
- `tests/smoke_permitcode.js`（**52 项**）：八类前缀、各前缀独立顺延、单字/英文/纯符号、
  首字母撞车（`FZSX` / `FZSXT` / `FZSXZ`、`FZH` / `FZH2`）、旧号放行、跨类型提示、表单联动。

### 变更
- `config.js`：`permit` 规则改为 `{ prefix:'FZ', prefixFrom:'type', seqLen:7 }`。
- 前缀 = `FZ` + 类型名前两字首字母：动火 `FZDH`、受限空间 `FZSX`、盲板抽堵 `FZMB`、高处 `FZGC`、
  吊装 `FZDZ`、临时用电 `FZLS`、动土 `FZDT`、断路 `FZDL`；序号按前缀各自从 `0000001` 起。
- 校验形状放宽为 `FZ + 1~6 位大写字母 + 7 位数字`；新增「前缀属于另一个现存类型」的软提示
  （旧号 `FZZY-*`、类型改名后的旧前缀照常放行）。
- `formDialog.js`：`def(values)` 支持按当前值生成默认号；新增 `dependsOn` 联动
  （切作业类型自动换前缀，手改过的号不覆盖，编辑老记录不改号）；编号框失焦自动转大写。
- 示例数据 8 张作业票改为各类型 `FZ*-0000001`。

### 兼容
- 其它七类（隐患 / 巡检 / 培训 / 通知 / 人员 / 证书 / 设备）编号体系不变。
- 老号继续可存可读：`FZZY-0000001`（v1.1.0 通用号）、`WP-2026-041`（一代）、`FZ-0000001`（二代）。
- 展示 / 检索 / 统计 / 流转留痕均按 `id` 关联，换前缀不影响历史数据。

### 脱敏
- 示例品牌图 `mily-logo.png` 改名为 `logo.png`（文件内容仍是自绘占位图，仅去掉文件名里的品牌拼音）。

### 自检
- 示例版 **1355 项**（19 套）、空白版 **697 项**（9 套）、骨架 **19 项**，全绿。

## v1.1.0 — 台账 Excel 导入导出

**主题**：两个人员台账支持 .xlsx / .csv 批量导入导出；特种设备台账不再内置名单。

### 新增
- `components/xlsxReader.js`：浏览器端读 .xlsx —— 解 ZIP 中央目录、`DecompressionStream` 解 deflate、
  `DOMParser` 读 sheet、拼 `sharedStrings`、CSV 解析、Excel 日期序列号换算。零依赖、断网可用。
- `components/excelIO.js`：字段定义驱动的导入导出器 —— 表头别名映射、逐行校验（必填 / 日期 / 枚举 / 去重）、
  预览与错误清单、追加或覆盖两种写入、模板下载。
- `docs/excel-import-export.md`：字段与格式要求、校验规则、异常处理、CRUD 与展示的调整。
- `tests/smoke_excelio.js`（**89 项**）+ `tests/_xlsx_sample.xlsx`（真实 deflate 压缩样本）。

### 变更
- **特种设备人员台账数据来源改为导入**：删除 `assets/js/data/deviceSeed.js`，`buildDevicePersonnel()` 返回 `[]`；
  工具栏「载入内置名单」换成「导入 Excel」「导出 Excel」；空态文案改为引导导入。
- 特种作业人员台账同样新增导入 / 导出按钮，字段与别名独立配置。
- 日期解析支持：`2026-10-27` / `2026/10/27` / `2026.10.27` / `2026年10月27日` / Excel 序列号 /
  **只有年月（补该月最后一天）**。
- `smoke_device.js` 改为「走真实导入链路造 78 条」，**44 项**；`smoke_reports.js` 自备设备人员数据。

### 兼容
- 台账的增删改查、搜索 / 筛选 / 排序、指标卡、报表预警逻辑均未改动 —— 导入只是「批量新增」。
- 字典同时兼容 `SD.mock.DICT`（示例版）与 `SD.dict.DICT`（空白版）。

## v1.0.0 — 首个可复用版本

**定位**：把一套实际在用的「安全员工作台」整理成可克隆复用的 SKILL。

### 新增
- `SKILL.md`：搭建方法论（12 步流程、技术选型、可配置参数、使用示例、交付自检清单）
- `assets/skeleton/`：最小可运行骨架（1 个模块 + 今天要处理 + 双角色 + 清空专用密码 + 空闲锁 + 导出/导入）
- `examples/safety-desk/`：完整示例（9 个模块，48 个 JS 文件）
- `examples/safety-desk-blank/`：同架构的空白版
- `tests/`：17 + 7 套 jsdom 自检（1201 + 554 项）、静态服务、骨架自检
- `scripts/`：`run_all_tests.sh`（一键全量）、`print_probe.js`（真打印数页数）、`compare_xlsx.py`（出件逐格 diff）、`scaffold.sh`（从骨架生成新台）
- `references/`：架构、数据模型、配置、出件、安全、测试、**踩坑（20 条）**

### 脱敏
- 示例中的 78 人特种设备名单（姓名/工号/身份证/手机号）全部替换为生成的假数据，字段结构与日期保持原样（自检口径不变）
- 操作人姓名统一替换为「王安全」
- 公司标识替换为占位图（`assets/img/logo.png` 与 `brandLogo.js` 的 base64 同步替换）

### 自检
- 示例版 **1201 项**、空白版 **554 项**、骨架 **19 项**，全绿
- 真打印取证：交接班记录 1 页 A4 横向（297×210mm）
