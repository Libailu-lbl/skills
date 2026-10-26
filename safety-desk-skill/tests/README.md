# 自检套件

用 **jsdom** 在 Node 里跑真实页面（起一个本地静态服务，加载完整的 `index.html` + 全部 `<script>`），
所以测的是「真页面」，不是 mock 出来的假对象。

## 一次性准备

```bash
cd tests && npm install     # jsdom + fake-indexeddb
```

## 一条命令跑完

```bash
bash scripts/run_all_tests.sh              # 默认端口 8126 / 8127
bash scripts/run_all_tests.sh 9126 9127    # 端口被占用时换一组
```

脚本会自己起两个静态服务、跑完自动关掉。

## 单跑

```bash
node tests/serve.js 8126 examples/safety-desk                 # 终端 A
node tests/smoke_shift.js http://127.0.0.1:8126/index.html    # 终端 B
```

## 套件清单

### 示例版（`examples/safety-desk`，共 1201 项）

| 套件 | 项数 | 覆盖 |
|---|---|---|
| `smoke.js` | 67 | 页面骨架、导航、持久化、无 JS 报错 |
| `smoke_code.js` | 102 | 单据编号：八类前缀/年份/位数、示例格式、表单预填、校验 |
| `smoke_crud.js` | 152 | 隐患 CRUD、状态流转、必填拦截、删除确认 |
| `smoke_device.js` | 39 | 特种设备人员台账：78 人、日期规范化、搜索筛选排序、编号顺延 |
| `smoke_ops.js` | 37 | 「操作 ▾」下拉统一（逐板块校验） |
| `smoke_photo.js` | 69 | 照片水印：两行文案、四档字号、压扁、绘制位置、空值降级 |
| `smoke_photos.js` | 116 | 照片写入/看大图/作业票打印含证件照/Word 缩放 |
| `smoke_print.js` | 133 | 整改通知书：版式、边框、分页、独立打印样式 |
| `smoke_reports.js` | 64 | 日报/周报聚合口径与导出 |
| `smoke_security.js` | 57 | 清空专用密码、30 分钟空闲锁、签名位 |
| `smoke_settings.js` | 25 | 工作台名称自定义、侧栏快捷入口 |
| `smoke_shift.js` | 153 | 交接班记录：19 行、打印留空、Excel 行位/合并/边框、角色门禁 |
| `smoke_special.js` | 33 | 特种作业导航层级、权限门禁、作业票流转 |
| `smoke_training.js` | 34 | 培训照片与证书 |
| `smoke_trend.js` | 25 | 各部门趋势：12 个月窗口、兜底口径自洽 |
| `smoke_vault.js` | 29 | 不压缩 + IndexedDB 外置 + 上传护栏 |
| `smoke_ocr.js` | 66 | 证件识别解析器 + 接口兜底 + 界面端到端 |

### 空白版（`examples/safety-desk-blank`，共 554 项）

`smoke_blank`(136) / `smoke_shift`(153) / `smoke_security`(57) / `smoke_device`(44) / `smoke_photo`(69) / `smoke_ocr`(66) / `smoke_vault`(29)

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
node tests/build_print_fixture.js http://127.0.0.1:8126/index.html ./_print_test.html
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
