# 安全员工作台 · SKILL

> 一套「断网可用、双击即开、能打印能导出」的单机业务工作台，连同**搭它的方法论**一起开源。
> 你可以直接用它当模板，改成隐患排查、设备点检、值班交接、证书台账……

<p>
<img alt="no build" src="https://img.shields.io/badge/build-none-brightgreen">
<img alt="no deps" src="https://img.shields.io/badge/runtime%20deps-0-blue">
<img alt="offline" src="https://img.shields.io/badge/offline-yes-success">
<img alt="tests" src="https://img.shields.io/badge/selftests-1755%20passed-brightgreen">
</p>

---

## 这是什么

一个**给现场用**的工作台：厂区电脑、车间平板、没有外网的办公机，双击 `index.html` 就能开始记录，关掉浏览器数据还在，需要的时候打印成 A4 单据、导出 Excel / Word。

仓库里同时提供三样东西：

| | 内容 | 适合谁 |
|---|---|---|
| **方法论** | [`SKILL.md`](SKILL.md) + [`references/`](references) | 想照着做的 AI / 开发者 |
| **最小骨架** | [`assets/skeleton/`](assets/skeleton) | 想 5 分钟起一个新工作台 |
| **完整示例** | [`examples/safety-desk/`](examples/safety-desk) | 想看 9 个模块怎么组织、出件怎么对表 |

---

## 核心特性

**运行时零依赖**
单文件级别的自足：没有框架、没有 CDN、没有外部字体、没有图表库。图标是内联 SVG，图表是手写 SVG，Excel/Word 是自己拼的 OOXML。断网、`file://` 双击都能跑。

**真正的「出件」能力**
- A4 打印：独立打印样式（`media="print"`），自动隐藏导航/按钮，`zoom` 缩放保证一页放下
- Excel：自写 `xlsxWriter.js`，支持合并单元格、列宽行高、逐边边框、内嵌图片、页面方向与页边距
- Word：自写 `docxWriter.js`，整改通知单这类公文直接出 `.docx`

**权限不是摆设**
默认受限（只能看/打印/导出）→ 六位密码解锁 → 30 分钟无操作自动退回受限；清空数据另需一道专用密码，输错不执行且明确提示。

**数据不会莫名消失**
单一数据源 + 首次自动写示例数据 + 导出/导入 JSON 备份 + 清空需二次验证；照片走 IndexedDB 外置，不挤爆 localStorage。

**改得动**
所有可调项集中在 `assets/js/config.js`；颜色在 CSS 变量里；模块之间单向依赖，加一个模块就是「加一个 view + 一条路由 + 一组断言」。

---

## 快速开始

### 1）跑起来看看（不需要装任何东西）

```bash
git clone <this-repo> && cd safety-desk-skill
# 直接双击 examples/safety-desk/index.html 也行
node tests/serve.js 8124 examples/safety-desk
# 浏览器打开 http://127.0.0.1:8124/index.html
```

初始是**受限模式**（能看能打印，不能改）。点右上角「受限模式」输入 `123456` 解锁为安全员。

### 2）用骨架起自己的

```bash
bash scripts/scaffold.sh my-desk "我的工作台"
node tests/serve.js 8132 my-desk
```

### 3）跑自检（可选，需要 Node）

```bash
cd tests && npm install && cd ..
bash scripts/run_all_tests.sh          # 两套示例全量：1755 项
node scripts/print_probe.js http://127.0.0.1:8124/index.html   # 真打印几页
```

---

## 目录结构

```
safety-desk-skill/
├── SKILL.md                    ★ 搭建方法论（12 步流程 + 可配置参数 + 示例）
├── README.md                   本文件
├── CHANGELOG.md
├── LICENSE                     MIT
├── docs/
│   ├── quickstart.md           从零到第一个模块
│   ├── customize.md            改品牌 / 加模块 / 改字段 / 换配色
│   └── faq.md                  打印机、Excel 打不开、数据丢失、部署
├── references/
│   ├── architecture.md         分层、命名空间、单向数据流、文件清单
│   ├── data-model.md           实体/字段/状态机设计模板
│   ├── config-reference.md     全部配置项与默认值
│   ├── print-and-export.md     打印 / Excel / Word 出件与校准方法
│   ├── security-model.md       角色、密码、空闲锁、门禁边界
│   ├── testing.md              jsdom 自检 + 真打印取证
│   └── pitfalls.md             ★ 20 条实测踩坑（先看这个）
├── assets/
│   └── skeleton/               ★ 最小可运行骨架（19 项自检全绿）
│       ├── index.html
│       └── assets/{css/app.css, js/{config,utils,store,auth,router,app}.js}
├── examples/
│   ├── safety-desk/            ★ 完整示例：9 模块 / 48 JS / 1201 项自检
│   ├── safety-desk-blank/      同一套代码的「空白版」（无示例数据，554 项自检）
│   └── README.md
├── tests/                      jsdom 自检套件 + 静态服务（npm install 后使用）
└── scripts/
    ├── run_all_tests.sh        一条命令跑完两套
    ├── print_probe.js          Chrome headless 真打印 → 数页数
    ├── compare_xlsx.py         导出件与原表逐格 diff
    └── scaffold.sh             从骨架生成新工作台
```

---

## 两套示例，什么区别

| | `examples/safety-desk` | `examples/safety-desk-blank` |
|---|---|---|
| 首屏 | 预置示例数据（隐患/巡检/培训/台账…） | 全空，从「登记第一条」开始 |
| 数据源 | 模拟数据，可切「真实接口」 | 固定本机存储 |
| 适合 | 给客户/同事看效果 | 真正拿去用 |
| 自检 | 1201 项 | 554 项 |

两套共用同一个架构，改逻辑时两边同步，自检也必须两边都跑。

---

## 自检覆盖了什么

1755 项断言，重点不在「页面渲染出来了」，而在**口径和出件**：

- 数量与合计（列表条数 = 状态合计 = 台账总数）
- 状态机流转（草稿 → 待审批 → 已批准 → 作业中 → 已完工，非法流转被拒）
- 单据编号（默认顺延、格式校验、同类唯一、老编号兼容）
- 权限门禁（受限态写操作全部被拦、密码错不放行、清空专用密码错不执行）
- 出件（Excel 行列位置、合并区、可见边框线条、行高列宽；打印件页码与内容完整）
- 空数据 / 跨月跨年 / 焦点保持 / 无 JS 报错

---

## 数据与隐私

- **数据只在本机浏览器里**（localStorage + IndexedDB），仓库不含任何真实业务数据
- 示例里的人名、工号、身份证号、手机号**全部是生成的假数据**；公司标识是占位图
- 部署成公网链接时请勿预填真实隐私数据；本项目的密码机制只防误触，**不是加密**

---

## 已知取舍

- 手机浏览器清理缓存会丢 localStorage → 请定期「导出备份」
- 打印精调依赖浏览器；Chrome/Edge 最稳，Firefox 的 `zoom` 会降级为 `transform`
- 不支持多人实时协作（要的话得接后端，架构里已留 `dataSource` 切换点）

---

## 许可证

[MIT](LICENSE) —— 随便用、随便改、商用也行，保留版权声明即可。
示例中的公司标识为占位图，请替换为你自己的。
