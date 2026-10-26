# 常见问题

## 一、打开与使用

**Q：双击 index.html 打不开/白屏？**
1. 看控制台报错（F12）。最常见的是「某个 js 没加载」——检查 `index.html` 里的 `<script>` 路径与顺序
2. 必须是 `file://` 下没有 `type="module"` 的脚本（本项目刻意不用 ES module）
3. 若用了 `fetch('data.json')` 这类读本地文件，`file://` 会被拦 → 改成内联数据或走本地服务

**Q：数据存哪儿了？换电脑怎么办？**
存浏览器 localStorage（照片在 IndexedDB）。换电脑/换浏览器：**齿轮 → 导出备份** 得到 `.json`，新机器上 **导入恢复**。
清浏览器缓存会一起清掉，所以建议每月导一次。

**Q：同一个域名下开了两个工作台，数据串了？**
`config.js` 的 `storageKey` 撞了。每个工作台必须不同（如 `wb_check_v1` / `wb_ledger_v1`）。

**Q：手机能用吗？**
能。窄屏是单列布局，按钮 44px、输入框 16px。用手机浏览器打开后「添加到主屏幕」，就像一个 App。

---

## 二、权限

**Q：忘了密码怎么办？**
没有找回入口（本机前端没有可信的「找回」通道）。只能清站点数据：浏览器设置 → 清除该站点的数据，会**连业务数据一起清掉**，所以先导出备份。
（示例项目里默认密码是 `123456`，专用密码 `888888`，请在首次使用时改掉。）

**Q：为什么我改不了数据？**
默认是「受限模式」。点右上角角色徽标输入六位密码解锁。30 分钟不操作会自动退回受限。

**Q：清空数据为什么还要再输一次密码？**
清空不可撤销。专用密码（默认 `888888`）与登录密码**分开存**，避免「借别人的登录态一键删库」。

---

## 三、打印

**Q：打印出来是空白/只有页眉？**
`print-only.css` 里的「只保留出件遮罩」规则把你的遮罩也隐藏了。打开 `assets/css/print-only.css`，把遮罩类名加进保留名单：

```css
body > *:not(.pn-overlay):not(.pp-overlay):not(.sl-overlay) { display: none !important; }
```

**Q：预览是一页，真打印变成两页？**
缩放用了 `transform: scale()`（只改画面、不改布局，分页仍按原尺寸算）。改用 `zoom`（改布局尺寸），并在浏览器不支持时降级。见 `references/print-and-export.md`。

**Q：表格最上方的标题跑到 logo 上面去了？**
浏览器**总是把 `<thead>` 渲染在表格最上面**。把「标识 + 标题 + 抬头 + 表头」一起放进 `<thead>`（顺便实现每页重复表头）。

**Q：打印被裁掉右边一列？**
纸张宽度超过可印区。A4 横向可印区 = 297 − 左右页边距；把纸张宽度设成「可印区 − 1mm」，再靠 `zoom` 微调，别用超宽纸 + 强行缩放。

**Q：字体不对/变成宋体？**
本项目打印样式专门指定了宋体（对齐纸质单据习惯）。想换：改 `components.css` 里 `.sl-paper-table` 的 `font-family`。

---

## 四、Excel / Word

**Q：导出的 .xlsx 用 Excel 打开提示「文件损坏」？**
常见三个原因：
1. `<sheetView>` 里的 `pane` 写了非法的 `state`（合法值只有 `frozen/split/frozenSplit`）
2. `<drawing>` 的 rels / Content_Types 没登记全（缺一个就会被判损坏）
3. 样式索引 0 被当成「默认」省略，但你的第一个样式恰好是 0 号 → 丢样式（不报错但格式全乱）

排查：把 zip 解开，`xl/worksheets/sheet1.xml` 和 `[Content_Types].xml` 贴到 XML 校验器里看。

**Q：合并单元格之后，后面的格子内容消失了？**
合并会「吃掉」右边/下边的格位。要么给被吃掉的格子补 `{v:'', border:true}` 占位，要么给后续格子显式指定列位 `col: 3`。见 `references/print-and-export.md`。

**Q：行高设了没用？**
`tr` 的 `height` 只是最小值；真正决定高度的是「行盒 + 上下内边距」。要压行高必须同时压 `padding`。

**Q：导出的 Word 打开乱版？**
`.docx` 是 zip + XML，`sectPr`（页面设置）必须放在 body 最后一个段落里；表格宽度要用 `dxa`（1/20 磅）。

---

## 五、开发与自检

**Q：`node smoke_xxx.js` 报 `ECONNREFUSED`？**
没起静态服务，或服务被上一个终端关掉了。先 `node tests/serve.js 8126 examples/safety-desk`。

**Q：为什么不能用 `python -m http.server`？**
jsdom 会并发拉 30 来个 `<script>`，Python 简易服务在并发下偶发重置连接，导致自检随机失败。用 `tests/serve.js`（Node http，稳）。

**Q：jsdom 里量不到高度/宽度？**
jsdom 不做布局，`offsetHeight` 恒为 0。跟尺寸、打印、分页相关的一律用 **Chrome headless** 验证：`node scripts/print_probe.js`。

**Q：改了样式，自检全绿但页面还是不对？**
自检只能证明「逻辑与 DOM 结构对」，证明不了「看起来对」。样式/打印改动必须截图或真打印看一眼。

---

## 六、部署

**Q：怎么给别人用？**
把 `index.html` + `assets/` 上传到任意静态托管（GitHub Pages / 内网 nginx / 对象存储），拿到链接即可。
部署后是**公网可访问**的，页面里不要预填真实人名、身份证、手机号。

**Q：能接后端吗？**
能。`dataSource.js` 已经留了 `source: 'mock' | 'real'` 与 `baseURL/getToken` 钩子，把 CRUD 换成 `fetch` 即可，界面与视图层不用改。

**Q：多人同时用同一个链接？**
不行 —— 数据在各人自己的浏览器里。要多人共享必须接后端。
