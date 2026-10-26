# 架构

> 目标：48 个 JS 文件也不乱、不循环依赖、加模块不牵一发。
> 一句话：**分层 + 单向 + 一个刷新入口。**

---

## 一、总体分层

```
┌─────────────────────────────────────────────────────────┐
│ router.js / app.js            装配层：路由、刷新、交互    │
├─────────────────────────────────────────────────────────┤
│ views/*.js                    视图层：只渲染，不互相调用  │
├─────────────────────────────────────────────────────────┤
│ components/*.js               控件层：表格/弹窗/图表/导出 │
├─────────────────────────────────────────────────────────┤
│ metrics.js / report.js / code.js   计算层：纯函数        │
├─────────────────────────────────────────────────────────┤
│ dataSource.js / store.js / auth.js 数据与权限层          │
├─────────────────────────────────────────────────────────┤
│ config.js / utils.js          基础层（无业务依赖）        │
└─────────────────────────────────────────────────────────┘
        依赖只能「向下」，不能回头
```

**依赖方向**（加载顺序也是这个顺序）：

```
config → utils → auth → icons → store → code → dataSource → metrics
      → components(…) → report → views(…) → router → app
```

违反方向的典型错误：`store.js` 里 `require`/引用 `metrics.js`（数据层去算指标）→ 立刻形成环。

---

## 二、命名空间约定

全部挂在 `window.SD` 下，按用途分二级：

```js
window.SD = {
  CONFIG:   {...},        // config.js
  utils:    {...},        // utils.js        U
  store:    {...},        // store.js
  auth:     {...},        // auth.js
  code:     {...},        // code.js
  api:      {...},        // dataSource.js
  metrics:  {...},        // metrics.js
  report:   {...},        // report.js
  comp:     {             // components/
    dialog, table, formDialog, dropdown, statCard, chart,
    badge, listItem, stateView, photoPicker, photoVault,
    photoWatermark, docxWriter, xlsxWriter, ocr, lightbox,
    printNotice, printPhotos, peoplePicker, icons
  },
  views:    { overview, todo, hazard, inspection, training, … },
  router:   {...},
  app:      {...},
  deviceSeed: [...],      // data/deviceSeed.js
  BRAND_LOGO: {...}       // brandLogo.js
};
```

好处：
- 不用打包器，`file://` 直接跑
- 调试时 `SD.store.items()` 随手可查
- 没有命名冲突（都在 `SD` 下）

---

## 三、文件清单（完整示例）

```
assets/js/
├── config.js              ★ 唯一配置入口
├── utils.js               h/esc/日期/弹窗/toast/下载
├── auth.js                角色、登录密码、清空专用密码
├── store.js               localStorage 读写 + 导出/导入/清空
├── code.js                单据编号：规则解析、校验、默认顺延
├── dataSource.js          数据访问（mock/real 切换，CRUD 统一形状）
├── metrics.js             计算层：汇总、趋势、预警、待办合并
├── report.js              日报/周报聚合（纯函数）
├── router.js              hash 路由 + 导航渲染
├── app.js                 ★ 装配层：refreshAll / 交互 / 空闲锁
├── brandLogo.js           打印件与 Excel 用的公司标识（base64）
├── components/
│   ├── icons.js           内联 SVG 图标库
│   ├── stateView.js       加载中 / 空 / 失败 + 重试
│   ├── table.js           列表：搜索、筛选、排序、分页、行操作
│   ├── dialog.js          弹窗基座（返回字符串 = 校验失败）
│   ├── formDialog.js      表单弹窗（字段定义 → 校验 → 提交）
│   ├── dropdown.js        「操作 ▾」下拉
│   ├── statCard.js        指标卡
│   ├── chart.js           内联 SVG 图表（折线/柱状/环形）
│   ├── listItem.js        快捷入口条目
│   ├── badge.js           状态徽标
│   ├── photoPicker.js     选图/预览/压缩开关
│   ├── photoVault.js      ★ IndexedDB 大图仓（原图外置）
│   ├── photoWatermark.js  canvas 水印（型号·地点 / 日期时间）
│   ├── lightbox.js        看大图（键盘切换）
│   ├── peoplePicker.js    人员多选
│   ├── ocr.js             证件文字解析（本地规则 + 可选接口）
│   ├── docxWriter.js      自写 .docx
│   ├── xlsxWriter.js      ★ 自写 .xlsx
│   ├── printNotice.js     整改通知书打印预览
│   └── printPhotos.js     作业票（带照片）单页打印
├── data/deviceSeed.js     内置人员名单（示例已脱敏）
└── views/                 每个路由一个文件
    ├── overview.js        概览：指标卡 + 今天要处理 + 趋势
    ├── todo.js            待办（跨模块汇总）
    ├── hazard.js          隐患台账（含流转、通知书）
    ├── inspection.js      巡检任务
    ├── training.js        培训与证书
    ├── dashboard.js       数据看板
    ├── notice.js          通知公告
    ├── special.js         特种作业落地页（入口卡）
    ├── specPersonnel.js   特种作业人员台账
    ├── devicePersonnel.js 特种设备人员台账
    ├── specPermit.js      危险作业票
    ├── shiftLog.js        ★ 安全巡检交接班记录（打印/Excel 双出件）
    ├── reportCommon.js    日报/周报共用骨架
    ├── dailyReport.js     日报
    └── weeklyReport.js    周报
```

---

## 四、数据流：只有一条路

```
用户操作
   ↓
事件处理（view 内部）
   ↓
store / api 改数据（落 localStorage）
   ↓
SD.app.refreshAll()          ← 唯一刷新入口
   ↓
compute() 算指标 → renderNav() → renderView() → syncRole()
   ↓
各渲染函数各自读最新数据、各自写自己的 DOM（互不调用）
```

### 为什么必须这样

曾经踩过的坑：日历渲染函数末尾调了「当天列表渲染」，列表渲染里又调了「日历渲染」→ 栈溢出，页面白屏。
语法完全正确，静态检查也发现不了。

### 写代码时的三条纪律

1. **渲染函数里不许出现另一个渲染函数的名字**
2. **事件处理里不许直接拼 DOM 局部更新**（除非是「只重绘列表」这类显式优化的局部刷新）
3. **跨模块联动一律走 `refreshAll()`**

### 局部刷新的例外

搜索框输入时整页重绘会丢焦点。做法：
- 列表容器单独一个 `listBox`
- 输入事件 → 更新 `state.filters.q` → 只重绘 `listBox.innerHTML`
- 输入框本身不重建（并把 `data-keep-focus` 标记的控件焦点还原）

---

## 五、路由与权限

```js
{ id:'special', name:'特种作业', group:'primary', perm:'special.view',
  children:[{ id:'specPersonnel', name:'特种作业人员' }, …] }
```

- `group: primary` → 左侧「常用」常驻；`secondary` → 收进「更多」
- `subGroup: 'reports'` → 在「更多」里再分一个「报表」小组
- `perm` → 无权限时导航显示锁 + 点进去渲染「无权限」占位页（**门禁在 app.refreshAll 里统一做**，不在每个 view 里判断）

---

## 六、接入真实后端的位置

只需要动 `dataSource.js`：

```js
var CRUD = {
  hazards: crud('hazards', '/hazards', { idPrefix:'FZ' }),
  // …
};
function crud(key, path, opt) {
  return {
    list:   function () { return http('GET', path); },
    create: function (o) { return http('POST', path, o); },
    update: function (id, patch) { return http('PATCH', path + '/' + id, patch); },
    remove: function (id) { return http('DELETE', path + '/' + id); }
  };
}
```

`http()` 里用 `CONFIG.baseURL` + `CONFIG.getToken()`。视图层、指标层、出件层**一行都不用改**。
字段契约见 `examples/safety-desk/data/schema.md`。
