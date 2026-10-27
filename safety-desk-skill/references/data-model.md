# 数据模型

> 先写这张表，再写代码。模型定了，后面 80% 的争议就没了。

---

## 一、设计模板

每个实体填七项：

| 项 | 说明 | 例子 |
|---|---|---|
| 名称 / 集合键 | `store.data().<key>` | `hazards` |
| 主键 | 单据编号 or `id` | `code`（FZYH-0000001） |
| 字段 | 名 / 类型 / 必填 / 默认 / 枚举 | `severity: enum(major/large/general)` |
| 状态机 | 状态 + 允许的流转 | 待整改 → 整改中 → 待验收 → 已闭环 |
| 与其它实体 | 引用关系 | `hazard.ownerId → specialPersonnel.id` |
| 派生字段 | 前端算，不落库 | `daysLeft`、`isOverdue`、`statusSum` |
| 出件映射 | 哪些字段进打印/Excel | 通知书用 code/desc/owner/limit |

**三条硬规则**

1. **所有集合放同一个对象里**（`{hazards, inspections, …}`），不要一实体一 key —— 否则导出/导入/清空要写 N 遍
2. **状态只增不改名**（`void` 用「作废」而不是物理删除，留痕）
3. **派生字段不落库**（`是否逾期` 每次按今天算，存下来就会过期）

---

## 二、示例项目的实体（可作参考）

### hazard — 隐患（核心）

```js
{
  code: 'FZYH-0000001',        // 主键，单据编号
  desc: '东侧消防通道堆料',      // 描述
  type: '消防',                 // 枚举：消防/电气/机械/高处作业/有限空间/危化品/职业健康/特种设备/作业环境/其他
  severity: 'major',            // 重大 / 较大 / 一般
  statutoryLevel: 'general',    // 重大事故隐患 / 一般事故隐患（法定口径）
  source: '日常巡检',            // 日常巡检 / 专项检查 / 员工上报 / 上级督查 / 第三方检测
  dept: '生产一部',              // 责任部门
  owner: '张三',                 // 责任人
  foundDate: '2026-10-20',      // 发现日期
  limitDate: '2026-10-27',      // 整改期限
  status: 'pending',            // 状态机 ↓
  measure: '立即清理并划禁放区',   // 整改措施
  photos: [],                   // 照片引用（vault:xxx 或 dataURL）
  flow: [                       // 流转留痕（谁、何时、从哪到哪、备注）
    { at:'2026-10-20 09:12', by:'王安全', from:'—', to:'待整改', note:'巡检发现' }
  ],
  riskLevel: 'mid'              // 可选：自定义扩展字段（老数据读时补默认值）
}
```

**状态机**

```
待整改 pending ─┬→ 整改中 fixing ─→ 待验收 verifying ─→ 已闭环 closed
                ├→ 已延期 delayed → 待验收
                └→ 已作废 void（登记有误，留痕不删）
```

**派生字段**（不落库，`metrics.js` 现算）
`daysLeft = limitDate - today`、`isOverdue = daysLeft < 0`、`isSoon = 0 ≤ daysLeft ≤ thresholds.soonDays`

### inspection — 巡检任务

```js
{ code:'FZXJ-2026-001', planName, type:'日常巡检/综合巡查/节假日检查', area, dept,
  executor, planDate, status:'planned|done|rescheduled|cancelled', note }
```

### training — 培训计划 / certificate — 证书

```js
// training
{ code:'FZPX-2026-001', name, type:'三级教育/专项培训/应急演练', target, trainer,
  startDate, status }
// certificate
{ code:'ZGZS-001', holder, certType:'N1', validFrom, validTo, status:'valid|pending_review|expired|suspended' }
```

### specialPersonnel — 特种作业人员 / devicePersonnel — 特种设备人员

```js
{ code:'TZZY-001' / 'TZSB-001', name, empNo, dept, post, certType,
  idNo, validTo, phone, note, status }   // status 由 validTo 与今天比出来（有效/待复审/已过期/停用）
```

### workPermits — 危险作业票

```js
{ code:'FZDZ-0000001', type:'动火/受限空间/高处/吊装/临时用电/盲板抽堵/断路/动土',
  location, dept, applicant, leader, workers:[], startAt, endAt, photos:[],
  status:'draft|pending|approved|working|done|cancelled',
  flow:[…], approvedBy }
```

### shiftLogs — 安全巡检交接班记录（打印/Excel 双出件）

```js
{ date:'2026-10-25', shift:'day|middle|night',
  checks:['ok','bad','',…],     // 19 项，与表格行一一对应（顺序即行号）
  events:['事件一','事件二'],     // 每日事件，编号自动 1、2、3…
  inspector:'',                 // 手填，但**打印/导出时一律留空**
  updatedAt }
```

> 「一条记录 = 日期 + 班次」，同一天同一班次保存即覆盖，不做多条。

---

## 三、主键与编号

| 方式 | 适用 | 注意 |
|---|---|---|
| 单据编号当主键 | 需要人读、纸质归档 | 必须「非空 + 格式 + 同类唯一」三校验 |
| `id`（`uid()`） | 纯内部记录 | 不要展示给用户 |

编号规则集中在 `config.js → codeRules`，新增表单**默认顺延填入**（可手改、可清空手填），换号前的老编号走兼容放行（`allowLegacy`）。

危险作业票用**动态前缀**（`prefixFrom:'type'`）：`FZ` + 作业类型名前两字拼音首字母 + 7 位序号
（吊装作业 `FZDZ-0000001`）。首字母表在 `assets/js/pinyin.js`，序号按前缀各自顺延；
单字类型只取 1 位、首字母撞车按字典顺序先到先得并延长取字（详见 `examples/safety-desk/data/schema.md`）。

---

## 四、兼容与迁移

**只加不改**：新增字段一律「读时补默认值」，不要写迁移脚本。

```js
// store.js 载入时
(d.hazards || []).forEach(function (h) {
  if (!h.riskLevel) h.riskLevel = 'mid';
  if (!Array.isArray(h.photos)) h.photos = [];
});
```

**换 schema 版本**：只有「结构不可兼容」时才改 `storageKey` 的 `_v1` → `_v2`，并在 README 里写清迁移办法（导出旧版 → 手工补字段 → 导入新版）。

---

## 五、备份格式

```json
{
  "app": "安全员工作台",
  "version": 1,
  "exportedAt": "2026-10-25T08:00:00.000Z",
  "data": { "hazards": [], "inspections": [], "…": [] }
}
```

导入时校验：`data` 存在、目标集合是数组、编号合法（含空号直接拒），失败给**具体原因**而不是「导入失败」。
