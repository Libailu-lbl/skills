# 自检套件

用 **jsdom** 在 Node 里跑真实页面（起一个本地静态服务，加载完整的 `index.html` + 全部 `<script>`），
所以测的是「真页面」，不是 mock 出来的假对象。

## 一次性准备

```bash
cd tests && npm install     # jsdom + fake-indexeddb
```

## 一条命令跑完

```bash
bash scripts/run_all_tests.sh              # 默认端口 8127
bash scripts/run_all_tests.sh 9127         # 端口被占用时换一个
```

脚本会自己起一个静态服务、跑完自动关掉。

## 单跑

```bash
node tests/serve.js 8124 examples/safety-desk-blank           # 终端 A
node tests/smoke_shift.js http://127.0.0.1:8124/index.html    # 终端 B
```

## 套件清单

### 可运行示例（`examples/safety-desk-blank`，共 1317 项 / 18 套）

| 套件 | 项数 | 覆盖 |
|---|---|---|
| `smoke_blank.js` | 162 | 空白版首屏：空态、导航（常用区 4 项 + 报表组 5 项）、登记第一条、作废留痕、操作项删除（确认框/编号释放/重复删除报错）、持久化、无 JS 报错 |
| `smoke_nav.js` | 91 | 导航下拉：特种作业/更多/报表三处、点击展开、同级互斥、箭头与 aria、子树高亮、换页自动展开、同页保留；报表组 5 项且末位为隐患整改通知书；常用功能统计全部 15 项、只展示前 6、三级排序、并列落选注明、空数据默认顺序、受限剔除、统计弹窗 |
| `smoke_keyworks.js` | 71 | 安全重要工作看板：概览页原「今天要处理」下线、四列结构与标题、空态、新增走表单、逾期红字与统计、推进三级状态机、点卡片编辑、编辑弹窗删除 + 二次确认、关键词/优先级/仅看逾期/重置、筛选跨重绘保留、落库 keyWorks 与备份携带、受限拦截 |
| `smoke_inspection_photos.js` | 114 | 巡检「隐患照片」更名（表单/列表/执行记录）与看板照片口径：存储键仍为 photos、上限 18 张、KPI 首卡改为「隐患照片」、按部门汇总含未指定部门、各部门相加等于总张数、无照片任务不计数、改期/取消仍计入、空态与口径说明 |
| `smoke_permitcode.js` | 52 | 作业票动态编号：拼音字表、八类前缀、各前缀独立顺延、撞车兜底、跨类型提示 |
| `smoke_device.js` | 44 | 特种设备人员台账：日期规范化、搜索筛选排序、编号顺延 |
| `smoke_excelio.js` | 89 | 台账 Excel 导入导出：模板、别名映射、逐行校验、追加/覆盖 |
| `smoke_shift.js` | 167 | 交接班记录：19 行、打印留空、白夜班同 Excel、按月查看、列宽、角色门禁 |
| `smoke_shift_import.js` | 15 / 22 | 备注「从每日记录导入」：日期归一、事件拼接、只取当天；传业务表格路径再验真实数据（22 项） |
| `smoke_shift_month.js` | 42 | 交接班按月：默认当月、切月/回到本月、空月空态、保存跨月自动切月 |
| `smoke_security.js` | 70 | 清空专用密码、30 分钟空闲锁、签名位 |
| `smoke_photo.js` | 69 | 照片水印：两行文案、四档字号、压扁、绘制位置、空值降级 |
| `smoke_ocr.js` | 66 | 证件识别解析器 + 接口兜底 + 界面端到端 |
| `smoke_vault.js` | 29 | 不压缩 + IndexedDB 外置 + 上传护栏 |
| `smoke_monthview.js` | 42 | 作业票月视图 + 巡查照片上限 18 张 |
| `smoke_yearview.js` | 47 | 隐患 / 巡检 / 培训 / 通知「默认当年 + 年份下拉」 |
| `smoke_violation.js` | 76 | 安全违章考核单：编号 FZKH-001、默认全年、点编号看照片、**考核情况多选 + 其它手填**、增改删、受限拦截 |
| `smoke_export_gate.js` | 71 | 受限模式「所有导出一并收紧」：`data.export` 能力点、下载落点（xlsx/docx）双拦、函数入口（台账/模板/照片弹窗）、顶栏导出备份先验密码、日报周报与交接班按钮置灰 + 绕过被拦、通知书与照片页锁 Word 留打印、培训下载项禁用、`[data-export]` 全局兜底、解锁后全部恢复 |

> 原先只跑「示例数据版」的 11 套（smoke / smoke_code / smoke_crud / smoke_ops / smoke_photos /
> smoke_print / smoke_reports / smoke_settings / smoke_special / smoke_training / smoke_trend）
> 随示例数据版一起移除（2026-11-05）。这些覆盖里有相当一部分已被上表的空白版套件接住。

### 骨架（`assets/skeleton`，19 项）

```bash
node tests/serve.js 8132 assets/skeleton
node tests/smoke_skeleton.js http://127.0.0.1:8132/index.html
```

### 其他

- `unit_rot.js` —— 照片旋转判定单测（jsdom 无 canvas，只能这样验）
- `build_print_fixture.js` —— 把「打印那一刻的 DOM」导出成独立 HTML，供真打印取证

## 真打印取证

```bash
# 1) 生成出件专用页
node tests/build_print_fixture.js http://127.0.0.1:8124/index.html ./_print_test.html
# 2) 用 Chrome 打印成 PDF 并数页数
node scripts/print_probe.js ./_print_test.html ./out.pdf
```

判据：**1 页**、`/MediaBox` = A4 横向或纵向、首页文字不缺项。

> 取证页里的 CSS 会被改写成**源站绝对地址**（`http://127.0.0.1:8126/assets/css/…`），
> 所以打印那一步静态服务必须还开着；关了就会样式 404、打出两页（这个坑踩过一次）。

## 写法约定

- 开头先 `SD.auth.set('safety_officer')`（默认受限，否则写操作全被拦）
- 用 `ok(name, cond, extra)` 记录，最后打印 `结果：通过 N / 失败 M`
- 断言「口径」而不是「像素」：条数、合计、编号、状态、权限、出件内容
- 修 bug 时先补一条能复现的断言，再改代码

详见 `references/testing.md`。
