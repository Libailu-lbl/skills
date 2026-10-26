# 打印与导出（最容易翻车的地方）

> 一句话：**出件不是「看起来像」，是「和基线逐格一致，且真打印一页」**。
> 下面的每条都是踩过的坑换来的，照做能省两天。

---

## 一、打印：两个样式文件，职责必须分开

| 文件 | 何时生效 | 放什么 |
|---|---|---|
| `print.css` | **屏幕**（预览层用） | 纸张尺寸、字体、表格线——就是你在预览里看到的样子 |
| `print-only.css` | **只在打印时**（`<link media="print">`） | 隐藏一切非纸张元素、`@page` 纸张与页边距、分页规则 |

```html
<link rel="stylesheet" href="assets/css/print.css">
<link rel="stylesheet" href="assets/css/print-only.css" media="print">
```

**为什么必须分开**：早期把 `@media print` 混写在 `print.css` 里，结果屏幕样式一改就误伤打印，反之亦然；
分开后「屏幕上长什么样」和「打出来什么样」可以各自独立调试。

---

## 二、坑 1：打印出来是空白（遮罩被自己隐藏了）

`print-only.css` 的典型写法是「只保留出件遮罩，其它全隐藏」：

```css
body > *:not(.pn-overlay):not(.pp-overlay) { display: none !important; }
```

**如果你新加了一种出件遮罩（比如交接班的 `.sl-overlay`），忘了加进保留名单，打印就是一片空白。**
更隐蔽的是：屏幕预览里看得见，一点打印全没了。

```css
/* ✅ 三种出件遮罩都保留 */
body > *:not(.pn-overlay):not(.pp-overlay):not(.sl-overlay) { display: none !important; }
```

顺带：遮罩内的工具条、提示条、按钮也要一起隐藏（`.pn-toolbar, .sl-pn-tip, .btn`）。

---

## 三、坑 2：预览一页，真打印两页 —— `transform` vs `zoom`

| 方式 | 改画面 | 改布局 | 打印分页 |
|---|---|---|---|
| `transform: scale(.8)` | ✅ | ❌ | **按原尺寸算** → 会多出一页 |
| `zoom: 0.8` | ✅ | ✅ | 按缩放后算 → 与预览一致 |

**结论：打印缩放必须用 `zoom`**（Chrome/Edge 支持；Firefox 不支持则降级为 `transform`，至少要保证预览正确）。

判断 `zoom` 是否生效**不能用 `scrollHeight`** —— Chrome 里加了 `zoom` 后 `scrollHeight` 仍报未缩放值，会永远判成"不支持"。用 `getBoundingClientRect()`：

```js
function zoomWorks(el) {
  var old = el.style.zoom;
  el.style.zoom = '';
  var w1 = el.getBoundingClientRect().width;
  el.style.zoom = '0.5';
  var w2 = el.getBoundingClientRect().width;
  el.style.zoom = old;
  return w1 > 0 && Math.abs(w2 - w1 * 0.5) < 1.5;
}
```

---

## 四、坑 3：`<thead>` 会把表头搬到最上面

浏览器**总是把 `<thead>` 渲染在表格顶部**，与源码顺序无关。
如果你只想让「表头」每页重复，却把「公司标识 + 标题 + 抬头」留在 `<tbody>`，结果就是：表头跑到了最上面，标题掉到表头下面。

**正确做法**：把「标识 + 标题 + 抬头 + 表头」**一起放进 `<thead>`**。
副作用正好是想要的：内容超一页时，标题和表头每页都重复（纸质单据的标准做法）。

---

## 五、坑 4：行高设了不生效

`tr { height: 24pt }` 只是**最小值**。真正决定高度的是：

```
行高 = max(height, 行盒 + 上下内边距)
行盒 = font-size × line-height
```

所以要把 24pt 压到 18pt，必须**同时压内边距**：

```css
.sl-paper-table td { padding: .5mm .6mm; }   /* 原来是 1.4mm，压不动 */
.sl-paper-table tr.c-r-item { height: 18pt; }
.sl-paper-table { line-height: 1.3; }        /* 别继承全局的 1.55，否则行盒就 22.7px 了 */
```

---

## 六、横向铺满 + 纵向压行高（凑一页的正确姿势）

**错误姿势**：纸张做得很宽，然后整体缩到 80% 塞进一页 → 宽度只用了 78%，字也被一起缩小，纸上大片留白。

**正确姿势**：

1. **先算可印区**：A4 横向 297×210mm，页边距左右 18mm / 上下 19mm → 可印区 **261×172mm**
2. **纸张宽度 = 可印区 − 1mm**（260mm，留 1mm 防亚像素换页）
3. **纵向压行高**，直到整表自然高度 < 172mm（本项目：明细行 18pt + 竖向 padding 0.5mm → 166.8mm）
4. **默认不缩放**（100%），字保持 11pt 原大；只有在内容确实超了才等比缩小，且**不低于 75%**（再小就看不清了）
5. 超太多就**不缩、按原大分页**（表头每页重复）—— 宁可分页，也不要把字缩成蚂蚁

```js
var s = Math.min(PAGE_W / w, PAGE_H / h, 1);
if (s >= 0.995) s = 1;                      // 装得下 → 不缩，横向铺满
else if (s >= 0.75) s = Math.floor(s * 0.985 * 100) / 100;   // 略超 → 等比缩一页
else s = 1;                                 // 超太多 → 不缩，分页
```

---

## 七、Excel：自写 `xlsxWriter.js`

### 能力

```js
var blob = SD.comp.xlsxWriter.build([{
  name: '交接班记录',
  cols: [{ width: 4.41 }, { width: 9 }, { width: 78 }],   // 字符单位，照 Excel 的列宽
  rows: [
    [{ v:'标题', bold:true, size:16, align:'center', mergeAcross:4, h:27 }],
    [{ v:'序号', border:true, align:'center' }, { v:'内容', border:true, wrap:true }],
    [{ v:1, border:{l:'m',r:'t',t:'t',b:'t'}, font:'宋体' }]
  ],
  page: { orientation:'landscape', paperSize:9, fitToWidth:1, fitToHeight:1,
          margins:{ left:.7, right:.7, top:.75, bottom:.75, header:.3, footer:.3 } },
  image: { data: base64Png, w:165, h:30, col:0, row:0, colOff:6350, rowOff:85725 }
}]);
SD.comp.xlsxWriter.download(blob, '交接班记录-2026-10-25-白班.xlsx');
```

### 单元格属性

| 属性 | 说明 |
|---|---|
| `v` | 值（字符串/数字） |
| `bold` / `size` / `color` / `font` | 字体（`font` 是字体名，如 `'宋体'`） |
| `fill` | 底色 `'F2F2F2'` |
| `align` / `valign` | `left/center/right` · `top/middle/bottom` |
| `wrap` | 自动换行（长文本必须开） |
| `border` | `true` = 四边细线；`{l,r,t,b}` 逐边，`'m'` medium / `'t'` thin |
| `mergeAcross` / `mergeDown` | 向右 / 向下合并格数 |
| `col` | **显式列位（0 起）**，被合并吃掉时用来钉位置 |
| `h` | 行高（写在行首格或写 `{cells:[…], h}` 都认） |

### 五个必踩的坑

1. **合并会吃掉后面的格位**：`[{mergeAcross:2}, {v:'班次'}, {v:'日期'}]` → 后两格都落到被合并的 B、C 上，内容凭空消失。
   → 被合并掉的列补 `{v:'', border:true}` 占位，或给后续格显式写 `col: 3` / `col: 4`
2. **列位递进必须从 -1 起**：`c = -1; c++ → 0`。写成 `c = 0; c++ → 1` 会让所有不带 `col` 的行整体右移一格
3. **样式索引 0 会被省略**：`s="0"` 不写进 XML，而你的第一个样式恰好是 0 号 → 第一格（常常就是标题）丢样式。**0 号留给默认样式**，实际样式从 1 号起
4. **`pane` 的 `state` 只能写 `frozen/split/frozenSplit`**，写 `visible` 会让严格解析器判「工作表损坏」
5. **图片要凑齐六个部件**，缺一个就「文件损坏」：
   `xl/media/image1.png`、`xl/drawings/drawing1.xml`、`xl/drawings/_rels/drawing1.xml.rels`、
   `xl/worksheets/_rels/sheet1.xml.rels`、`[Content_Types].xml` 里登记 png + drawing、worksheet 末尾 `<drawing r:id="rId1"/>`

### 出件必须真机校对

不要用截图目测。导出真 `.xlsx`，用 openpyxl 逐格 diff（脚本：`scripts/compare_xlsx.py`）：

```bash
python scripts/compare_xlsx.py 原表.xlsx 导出件.xlsx
```

比什么：

| 项 | 判据 |
|---|---|
| 合并区 | 完全一致 |
| 列宽 / 行高 | 完全一致（明细行允许「不小于基线」防截断） |
| **可见边框线条** | 相邻两格任一边有线即该线可见 —— **按线条比，不要按每格 flag 比**，否则会有几十处假差异 |
| 字号 / 字体 | 一致（纸质单据多为宋体 11pt） |
| 页面 | 方向、纸张、页边距、fitToPage |

---

## 八、Word：自写 `docxWriter.js`

`.docx` = zip + XML。最小要素：`[Content_Types].xml`、`_rels/.rels`、`word/document.xml`、`word/styles.xml`。

三个容易出错的地方：

1. **`sectPr`（页面设置）必须放在 body 的最后一个段落里**，不能单独成节点
2. 表格宽度、缩进用 `dxa`（1/20 磅）：`w:tblInd w:w="270" w:type="dxa"`
3. 页边距用 `twips`（1/1440 英寸）：上 20.4mm ≈ 1157、左右 24.8mm ≈ 1406

---

## 九、验证清单（每次改出件都要过）

1. `node scripts/print_probe.js <url>` → **页数 = 1**、`/MediaBox` = 297×210mm
2. 预览里**没有**按钮/导航/工具条
3. 从 PDF 抽文字：抬头、每一行、表尾注都在（`pypdf` 的 `extract_text`）
4. 导出 `.xlsx` → `compare_xlsx.py` 全绿 → 用 Excel/WPS 真打开一次（不能只看脚本）
5. 打印预览与真打印**页数一致**（不一致就是 `transform` 没换 `zoom`）
