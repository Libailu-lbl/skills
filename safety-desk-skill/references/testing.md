# 自检体系（jsdom + 真打印）

> 这个项目「一天改十次也不怕」的原因不是代码写得好，而是**每次改完 10 秒内知道有没有打坏东西**。

---

## 一、两层验证，各管一段

| 层 | 工具 | 管什么 | 不管什么 |
|---|---|---|---|
| 逻辑 / DOM | **jsdom**（Node） | 数据口径、状态流转、权限、编号、导出内容、无 JS 报错 | 布局、打印分页、字体、真实渲染 |
| 出件 / 版式 | **Chrome headless** | 打印几页、纸张尺寸、PDF 里的文字、截图 | 业务逻辑 |

**关键认知：jsdom 里 `offsetHeight` 恒为 0**（不做布局）。所以「打印是不是一页」永远只能靠真浏览器。

---

## 二、跑起来

```bash
cd tests && npm install && cd ..        # 一次性
bash scripts/run_all_tests.sh           # 两套示例全量（1755 项）
```

单跑一个：

```bash
node tests/serve.js 8126 examples/safety-desk          # 终端 A
node tests/smoke_shift.js http://127.0.0.1:8126/index.html   # 终端 B
```

**为什么不用 `python -m http.server`**：jsdom 会并发拉 30 来个 `<script>`，Python 简易服务并发下偶发 `Could not load script`，造成随机失败。`tests/serve.js` 用 Node http，稳。

---

## 三、一个套件的骨架

```js
const { JSDOM, VirtualConsole } = require('jsdom');
const wait = ms => new Promise(r => setTimeout(r, ms));

let P = 0, F = 0;
const ok = (name, cond, extra) => {
  if (cond) { P++; console.log('  OK   ' + name); }
  else { F++; console.log('  FAIL ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : '')); }
};

(async () => {
  const errs = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errs.push(e.message));

  const dom = await JSDOM.fromURL(process.argv[2] || 'http://127.0.0.1:8126/index.html', {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    beforeParse(win) {
      // 补齐 jsdom 缺的浏览器能力
      win.matchMedia = q => ({ matches: false, media: q, addListener(){}, removeListener(){},
                               addEventListener(){}, removeEventListener(){} });
      win.scrollTo = () => {};
      win.URL.createObjectURL = () => 'blob:stub';
      win.URL.revokeObjectURL = () => {};
    },
    virtualConsole: vc
  });

  const win = dom.window, doc = win.document, SD = win.SD;
  for (let i = 0; i < 120 && !(SD && SD.app && SD.app.state); i++) await wait(120);

  SD.auth.set('safety_officer');       // 默认是受限，测试先解锁
  SD.app.refreshAll();

  ok('示例数据条数', SD.store.items().length === 4, SD.store.items().length);
  ok('无 JS 报错', errs.length === 0, errs.join(' | '));

  console.log('\n结果：通过 ' + P + ' / 失败 ' + F);
  process.exit(F ? 1 : 0);
})();
```

### 三条纪律

1. **先解锁**：默认受限，不解锁所有写操作会被拦 → 断言全红（这个坑踩过，一晚上）
2. **测口径不测像素**：断言「19 行 × 18pt、合计=总数、编号顺延到 X」，不要断言「按钮在左边」
3. **每个改动都补一条断言**：修 bug 时先写能复现的断言，再改代码

---

## 四、三种汇总格式（历史遗留）

套件写多了会出现不同风格，`run_all_tests.sh` 都兼容：

```
结果：通过 67 / 失败 0
结果：39 通过 / 0 失败
通过 133 项，失败 0 项
```

解析逻辑：分别用 `通过 [0-9]+` 和 `[0-9]+ 通过` 两种模式抓。

---

## 五、假 IndexedDB（照片相关）

```bash
npm i fake-indexeddb
```

```js
require('fake-indexeddb/auto');   // 在 require jsdom 之前
```

否则 `photoVault` 相关套件会全挂（浏览器有 IndexedDB，jsdom 没有）。

---

## 六、真打印取证

```bash
node scripts/print_probe.js http://127.0.0.1:8126/index.html
```

内部做两件事：

1. 生成「打印那一刻的 DOM」成独立 HTML（在 jsdom 里点开打印预览 → 把 `.sl-overlay` 抠出来）
2. 调 Chrome：`--headless=new --print-to-pdf=out.pdf --no-pdf-header-footer`

判据：

```python
import re
d = open('out.pdf','rb').read()
print('页数:', re.search(rb'/Count\s+(\d+)', d).group(1).decode())        # 必须是 1
print('纸张:', re.findall(rb'/MediaBox\s*\[[^\]]*\]', d)[0])              # 297×210mm → 841.92×594.96pt
```

再抽文字核对没截断：

```python
from pypdf import PdfReader
t = PdfReader('out.pdf').pages[0].extract_text()
assert '现场安全巡检与交接班记录' in t and '检查情况正常打' in t
```

**注意**：
- Chrome 参数要按顺序，`--headless=new` 必须在 `--print-to-pdf` 之前；`--virtual-time-budget=4000` 给它时间跑完 JS
- 取证页里的 `assets/...` 会被改写成**源站绝对地址**，所以打印时静态服务要开着 —— 否则样式 404，工具条不被隐藏，就会「多出一页」

---

## 七、测试覆盖什么（示例项目 1755 项）

| 类别 | 例子 |
|---|---|
| 数量与合计 | 列表条数 = 状态合计 = 台账总数；各部门合计 = 全厂新增 |
| 状态流转 | 草稿→待审批→已批准→作业中→已完工；非法流转被拒 |
| 编号 | 默认顺延、格式校验、同类唯一、老编号兼容 |
| 权限 | 默认受限、错密码不放行、受限态写操作被拦、清空密码错不执行 |
| 出件 | Excel 行列位置、合并区、可见边框、行高列宽、页面设置；打印页数与内容 |
| 兼容 | 空数据不崩、跨月跨年、老快照缺字段能补、焦点保持 |
| 干净 | 全程无 `jsdomError` / `console.error` |

---

## 八、CI（可选）

```yaml
# .github/workflows/test.yml
name: test
on: [push, pull_request]
jobs:
  smoke:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: cd tests && npm install && cd ..
      - run: bash scripts/run_all_tests.sh 8126 8127
```

Chrome 真打印那一步在 CI 里需要额外装 Chrome，可以只放在本地；CI 跑逻辑套件即可。
