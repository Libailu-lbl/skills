# 定制指南

> 90% 的定制只动两个文件：`config.js`（参数）和 `app.css` 的 `:root`（颜色）。
> 剩下 10% 是「加模块」，照 `docs/quickstart.md` 第 3 步抄。

---

## 一、换品牌（1 分钟）

### 名称 / 副标题

两种方式，效果一样：

1. **页面上改**：点左上角图标或文字 → 弹「工作台外观」→ 改图标/名称/副标题（存在本机 settings 里，跟着导出备份走）
2. **代码里改默认值**：`config.js` 的 `appName` / `appSub`

### 图标

- 内置图标库：`components/icons.js` 里挑一个名字（如 `shield` / `clipboard`）
- 上传自己的图片：外观弹窗里选图片 → 转成 dataURL 存在本机
- 打印件左上角的公司标识：替换 `assets/img/mily-logo.png`，**并同步 `assets/js/brandLogo.js` 里的 base64**（导出 Excel 时嵌的就是这份 base64）

```bash
# 换 base64（替换 png 后执行）
python - <<'PY'
import base64, io
b = base64.b64encode(open('assets/img/logo.png','rb').read()).decode()
lines = [b[i:i+96] for i in range(0, len(b), 96)]
body = ' +\n'.join("  '%s'" % l for l in lines)
p = 'assets/js/brandLogo.js'
s = io.open(p, encoding='utf-8').read().split('  base64:')[0]
io.open(p, 'w', encoding='utf-8', newline='\n').write(s + '  base64:\n' + body + '\n};\n')
PY
```

### 配色

`assets/css/app.css` 顶部：

```css
:root{
  --primary:#0f766e;        /* 主色：按钮、选中态、徽标 */
  --primary-soft:#e6f4f1;   /* 主色浅底 */
  --red:#c62828;            /* 逾期 / 危险 */
  --amber:#b45309;          /* 临期 */
  --radius:14px;            /* 卡片圆角 */
}
```

> 国内习惯：**支出/逾期/异常用红，收入/正常用绿**，别照搬欧美的红涨绿跌。

---

## 二、改字段（5 分钟）

以「隐患」加一个「风险等级」为例：

1. **表单**：`views/hazard.js` 里的字段定义数组加一项
   ```js
   { name:'riskLevel', label:'风险等级', type:'select', required:true,
     options:[{v:'low',n:'低'},{v:'mid',n:'中'},{v:'high',n:'高'}] }
   ```
2. **列表**：`components/table.js` 的列定义加一列（`key:'riskLevel', render: ...`）
3. **统计**：`metrics.js` 里如果要按等级统计，加一个聚合函数
4. **老数据兼容**：读数据时给默认值
   ```js
   (d.hazards||[]).forEach(function(h){ if(!h.riskLevel) h.riskLevel='mid'; });
   ```
5. **自检**：加 2 条断言（必填拦截 / 保存后能回显）

> 铁律：**只加字段，不改名、不删字段**。改名等于让所有老备份失效。

---

## 三、改单据编号（2 分钟）

`config.js` → `codeRules`：

```js
codeRules: {
  hazard: { prefix:'FZYH', label:'隐患编号', withYear:false, seqLen:7 },  // FZYH-0000001
  notice: { prefix:'FZTG', label:'通知编号', withYear:true,  seqLen:3 }   // FZTG-2026-001
}
```

| 字段 | 含义 |
|---|---|
| `prefix` | 前缀（大写字母） |
| `label` | 表单上的字段名 + 报错提示用语 |
| `withYear` | `true` = 前缀-年-序号；`false` = 前缀-序号 |
| `seqLen` | 序号位数（7 → `0000001`），同时作为校验位数 |
| `seqMin/Max` | 可选，放宽位数区间（兼容历史短号/长号） |
| `allowLegacy` | 默认 `true`，放行换号前的老格式；`false` = 只认新号 |

新增表单会**默认顺延填入下一个可用编号**（可手改、可清空手填），保存时校验「非空 + 格式 + 同类唯一」。

---

## 四、加一个模块（15 分钟）

见 `docs/quickstart.md` 第 3 步的六小步。要点复述：

1. `store.js` 加集合（放同一个对象里，别开新 key）
2. `views/xxx.js` 只渲染 + 绑事件
3. `router.js` 加一条路由
4. `app.js` 的 `renderView()` 加分支
5. `index.html` 按顺序加 `<script>`
6. 补 `tests/smoke_xxx.js`

**判断该不该独立成模块**：如果一个页面需要独立的路由、独立的集合、独立的一份打印，就该独立；否则做成现有页面的一个区块。

---

## 五、加打印 / 导出

### 打印一张 A4

1. 新建 `components/printXxx.js`，生成一个 `.pn-overlay`（预览层）+ `.pn-sheet`（纸）
2. 打印时注入 `@page`：
   ```js
   var st = document.createElement('style');
   st.textContent = '@media print{@page{size:A4 portrait;margin:12mm}}';
   document.head.appendChild(st);   // 关闭预览时记得移除
   ```
3. 在 `print-only.css` 的保留名单里加上你的遮罩类名（否则打印出来是空白 —— 这是最常见的坑）
4. 真打印验证：`node scripts/print_probe.js <url>`

### 导出 Excel

```js
var blob = SD.comp.xlsxWriter.build([{
  name: '台账',
  cols: [{ width: 6 }, { width: 20 }, { width: 40 }],
  rows: [
    [{ v:'序号', bold:true, align:'center', border:true }],
    [{ v:1, border:true }, { v:'内容', border:true, wrap:true }]
  ],
  page: { orientation:'landscape', fitToWidth:1, fitToHeight:1 }
}]);
SD.comp.xlsxWriter.download(blob, '台账.xlsx');
```

细节（合并、逐边边框、内嵌图片）见 `references/print-and-export.md`。

---

## 六、加照片

```js
// 表单里
SD.comp.photoPicker.mount(el, { max: 9, onChange: function (list) { photos = list; } });

// 存：原图外置到 IndexedDB，本地只留引用
await SD.comp.photoVault.put(id, dataUrl);   // 返回 'vault:xxx'
```

- 单张上限 25MB（`config.photo.maxBytes`）
- 默认不压缩（`config.photo.compress = false`）；照片多时 localStorage 会爆，必须走 vault
- 水印见 `components/photoWatermark.js`（两行：型号·地点 / 日期时间，左下角）

---

## 七、加权限点

`auth.js` 的 `can(perm)`：

```js
var PERMS = {
  safety_officer: ['data.read','data.write','special.view','settings.write'],
  restricted:     ['data.read']
};
```

- 路由上声明 `perm:'special.view'` → 无权限时导航显示锁、点进去是「无权限」占位页
- 按钮级：`if (!SD.auth.can('data.write')) 拦下`
- 兜底：全局捕获点击，受限态拦 `.btn.primary / [data-act=del]` 一类

> 这只防误触，不是安全边界。真系统请把判定放后端。
