# 快速开始

> 目标：30 分钟从零到一个能用的模块。全部命令在仓库根目录执行。

---

## 0. 前置

- 浏览器（Chrome / Edge 推荐，打印最稳）
- 可选：Node 18+（只在跑自检、起本地服务时需要）

**不需要**：npm install 到生产目录、构建工具、后端。

---

## 1. 先看看完整示例（5 分钟）

```bash
node tests/serve.js 8124 examples/safety-desk
# 打开 http://127.0.0.1:8124/index.html
```

也可以直接双击 `examples/safety-desk/index.html`（`file://` 也能跑）。

看点：
1. 左侧导航分「常用」和「更多」（更多里还有「报表」小分组）
2. 右上角「受限模式」→ 输入 `123456` → 变成「安全员」，此时才能新增/编辑
3. 「报表 → 安全巡检交接班记录」→ 点「打印」→ 预览里没有任何按钮，只有一张 A4
4. 齿轮菜单 → 清空数据 → 必须输专用密码（默认 `888888`）

---

## 2. 用骨架起自己的（5 分钟）

```bash
bash scripts/scaffold.sh my-desk "班组点检台"
node tests/serve.js 8132 my-desk
```

`scaffold.sh` 会：
- 复制 `assets/skeleton/` → `my-desk/`
- 把 `config.js` 里的 `appName` / `storageKey` 换成你的

然后打开 `http://127.0.0.1:8132/index.html`：应该看到 4 条示例数据，其中 1 条标红（逾期）。

跑骨架自检：

```bash
cd tests && npm install && cd ..
node tests/smoke_skeleton.js http://127.0.0.1:8132/index.html
# 期望：结果：通过 19 / 失败 0
```

---

## 3. 加第一个业务模块（15 分钟）

以「设备点检」为例。

### ① 加数据集合 `assets/js/store.js`

```js
// defaults() 里
return { items: [...], checks: [] };      // ← 新增集合

// 新增方法（照 items 的写法抄）
function addCheck(o) {
  var it = { id: U.uid('ck'), device: o.device, due: o.due || U.today(),
             status: 'todo', createdAt: U.today(), note: o.note || '' };
  get().checks.unshift(it); save(); return it;
}
function checks() { return get().checks; }

// 导出
return { ..., checks: checks, addCheck: addCheck };
```

> **不要**为 check 单独开一个 localStorage key —— 导出/导入/清空都会散架。

### ② 加视图 `assets/js/views/check.js`

```js
SD.views = SD.views || {};
SD.views.check = (function () {
  var U = SD.utils;

  function render(host) {
    U.clear(host);
    var card = U.h('<section class="card"><div class="card-head"><h2>设备点检</h2></div>' +
      '<div class="card-body"><div class="todo-list"></div></div></section>');
    var box = card.querySelector('.todo-list');
    var list = SD.store.checks();

    if (!list.length) box.appendChild(U.h('<div class="empty">还没有点检记录</div>'));
    list.forEach(function (it) {
      var row = U.h('<div class="todo-item"><div class="title">' + U.esc(it.device) +
        '<div class="meta">截止 ' + U.esc(it.due) + '</div></div>' +
        '<button class="btn sm js-done" type="button">完成</button></div>');
      row.querySelector('.js-done').addEventListener('click', function () {
        SD.store.updateCheckStatus(it.id, 'done');
        SD.app.refreshAll();                  // ★ 只调统一入口，不调别的渲染函数
      });
      box.appendChild(row);
    });
    host.appendChild(card);
  }

  return { render: render };
})();
```

### ③ 挂路由 `assets/js/router.js`

```js
var ROUTES = [
  { id: 'today',  name: '今日',     icon: '◎' },
  { id: 'items',  name: '全部事项', icon: '☰' },
  { id: 'check',  name: '设备点检', icon: '▤' }   // ← 新增
];
```

### ④ 接进装配层 `assets/js/app.js` 的 `renderView()`

```js
if (SD.router.current() === 'check') {
  els.title.textContent = '设备点检';
  els.sub.textContent = '按设备逐台点检，逾期标红';
  SD.views.check.render(host);
  return;
}
```

### ⑤ 在 `index.html` 里按顺序加脚本

```html
<script src="assets/js/views/check.js"></script>   <!-- 必须在 app.js 之前 -->
```

### ⑥ 补自检 `tests/smoke_check.js`

最小 5 条：新增落库 / 刷新后还在 / 完成态切换 / 删除二次确认 / 无 JS 报错。

---

## 4. 常见后续动作

| 想做什么 | 改哪里 |
|---|---|
| 换配色 | `assets/css/app.css` 顶部 `:root` 变量 |
| 换名称/副标题 | 页面里点左上角，或 `config.js` 的 `appName/appSub` |
| 加筛选/搜索 | 抄 `examples/safety-desk/assets/js/components/table.js` 的用法 |
| 加单据编号 | 抄 `examples/safety-desk/assets/js/code.js`（前缀 + 位数 + 校验 + 顺延） |
| 加打印 | 见 `references/print-and-export.md` |
| 加 Excel 导出 | `xlsxWriter.build([{name, cols, rows, page}])` → `download(blob, name)` |
| 加照片 | 抄 `components/photoVault.js`（IndexedDB 外置）+ `photoPicker.js` |

---

## 5. 交付

```bash
# 交付物就是整个目录：index.html + assets/
# 现场用法：拷贝到电脑上，双击 index.html
```

要给别人用/手机上用，再部署成静态站点（任何静态托管都行），**注意部署后页面是公开可访问的，不要预填真实隐私数据**。
