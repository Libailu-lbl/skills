# 数据字段定义（Data Schema）

> 用途：前端与后端对齐的唯一依据。字段名一律 `lowerCamelCase`，日期一律 `YYYY-MM-DD` 字符串，
> 时间戳字段（如 `flow[].at`）为 `YYYY-MM-DD HH:mm` 字符串，避免时区歧义。
>
> 约定：以下划线 `_` 开头的字段（如 `_overdue`、`_daysLeft`）**不是接口字段**，
> 是前端计算层 `metrics.js` 派生出来的，后端无需返回。
> **本单机版程序内不含任何示例 / 模拟数据**：首次打开所有集合均为空数组，
> 数据全部由用户录入；本文档中的 JSON 片段仅为字段格式说明，不是内置数据。

---

## 0. 总览：接口与字段的对应关系

| 语义函数（前端调用） | 真实接口（约定） | 方法 | 返回结构 |
|---|---|---|---|
| `api.fetchAll()` | `/workbench/overview` | GET | 下面 1~6 的全量聚合 |
| `api.listHazards()` | `/hazards` | GET | `hazard[]` |
| `api.createHazard(payload)` | `/hazards` | POST | `hazard` |
| `api.updateHazard(id, patch)` | `/hazards/{id}` | PATCH | `hazard` |
| `api.advanceHazard(id, to, extra)` | `/hazards/{id}/status` | POST | `hazard` |
| `api.voidHazard(id, reason)` | `/hazards/{id}/void` | POST | `hazard`（置为 `void`，不物理删） |
| ~~`api.nextCode(list, prefix)`~~ | — | — | **2026-10-21 已移除、未恢复**：自动流水号不回来；2026-10-24 起表单默认值改由前端 `SD.code.next(类型)` 顺延生成（仅初值，可手改，不自动落库） |
| `api.listInspections()` | `/inspections` | GET | `inspection[]` |
| `api.createInspection(payload)` | `/inspections` | POST | `inspection` |
| `api.updateInspection(id, patch)` | `/inspections/{id}` | PATCH | `inspection` |
| `api.removeInspection(id)` | `/inspections/{id}` | DELETE | `{id, removed}` |
| `api.completeInspection(id, payload)` | `/inspections/{id}/complete` | POST | `inspection` |
| `api.rescheduleInspection(id, to, reason)` | `/inspections/{id}/reschedule` | POST | `inspection` |
| `api.listTrainings()` / `createTraining` / `updateTraining(id,patch)` / `removeTraining(id)` | `/trainings` | GET/POST/PATCH/DELETE | `training[]` / `training` |
| `api.listCertificates()` / `createCertificate` / `updateCertificate(id,patch)` / `removeCertificate(id)` | `/certificates` | GET/POST/PATCH/DELETE | `certificate[]` / `certificate` |
| `api.listNotices()` / `createNotice` / `updateNotice(id,patch)` / `removeNotice(id)` | `/notices` | GET/POST/PATCH/DELETE | `notice[]` / `notice` |
| `api.listSpecialPersonnel()` / `createSpecialPersonnel` / `updateSpecialPersonnel(id,patch)` / `removeSpecialPersonnel(id)` | `/special-personnel` | GET/POST/PATCH/DELETE | `specialPersonnel[]` / `specialPersonnel` |
| `api.listWorkPermits()` / `createWorkPermit` / `updateWorkPermit(id,patch)` / `removeWorkPermit(id)` | `/work-permits` | GET/POST/PATCH/DELETE | `workPermits[]` / `workPermits` |
| `api.listDevicePersonnel()` / `createDevicePersonnel` / `updateDevicePersonnel(id,patch)` / `removeDevicePersonnel(id)` | `/device-personnel` | GET/POST/PATCH/DELETE | `devicePersonnel[]` / `devicePersonnel` |
| `api.listShiftLogs()` / `createShiftLog` / `updateShiftLog(id,patch)` / `removeShiftLog(id)` | `/shift-logs` | GET/POST/PATCH/DELETE | `shiftLog[]` / `shiftLog`（2026-10-25 新增） |

> 巡检 / 培训 / 证书 / 通知 四类的 CRUD 形状一致，前端由 `dataSource.js` 里的
> `crud(集合名, 路径, 选项)` 工厂统一生成，新增同类实体不需要再写一遍请求代码。

统一响应包（建议）：`{ code: 0, message: "ok", data: <上表返回结构> }`。
`dataSource.js` 里已做兼容：若后端直接返回裸对象/数组也能解析。

---

## 1. hazard —— 隐患（核心实体）

> ★ 2026-11-04：界面列表**默认只显示当年**（年份下拉可切年 / 回到今年），归年按 `foundDate`（缺失回退 `dueDate`，再没有归当年）；年份只是视图过滤，不改数据、不影响本节的字段与统计口径。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 是 | 主键，前端生成形如 `H-xxxx-XXXX`；后端可覆盖 |
| `code` | string | 是 | 隐患编号，展示用，如 `FZYH-0000001`；**2026-10-21 起用户掌控、2026-10-24 起各类分号 + 新增表单默认顺延填入下一个可用编号**（可手动修改 / 清空手填；空 / 同类型重复会被拒） |
| `title` | string | 是 | 隐患标题 |
| `type` | enum | 是 | 隐患类型：`消防 / 电气 / 机械 / 高处作业 / 有限空间 / 危化品 / 职业健康 / 特种设备 / 作业环境 / 其他` |
| `typeCode` | number | 否 | 类型序号（1 起），便于后端存枚举 |
| `severity` | enum | 是 | **管理三级（内部口径）**：`major`=重大(红) / `large`=较大(橙) / `general`=一般(黄) |
| `statutoryLevel` | enum | 是 | **法定两级（对外口径）**：`major`=重大事故隐患 / `general`=一般事故隐患；按安监总局令第 16 号。前端规则：`severity==='major' → 'major'`，其余 → `general` |
| `dept` | string | 是 | 责任部门 |
| `owner` | string | 否 | 责任人 |
| `location` | string | 否 | 发现区域 / 位置 |
| `source` | enum | 是 | 发现来源：`日常巡检 / 专项检查 / 员工上报 / 上级督查 / 第三方检测` |
| `foundDate` | date | 是 | 发现日期 |
| `originalDueDate` | date | 是 | **原始整改期限，永不改写**（改期限洗不掉逾期记录的依据） |
| `dueDate` | date | 是 | 当前整改期限；延期获批后才推进 |
| `status` | enum | 是 | 见下方状态机 |
| `delayCount` | number | 否 | 累计延期次数，默认 0 |
| `delayReason` | string | 否 | 最近一次延期原因 |
| `delayApprovedBy` | string | 否 | 延期批准人 |
| `measure` | string | 否 | 整改措施（验收时对照） |
| `closedAt` | date \| null | 否 | 闭环日期 |
| `voidReason` | string | 否 | 作废原因（仅 `status==='void'` 时有值） |
| `photos[]` | string[] | 否 | 隐患现场照片，base64（dataURL）数组，最多 3 张，上传时压到宽 1000px。**登记弹窗与编辑弹窗里都能添加 / 替换**（2026-10-19 新增），也可在通知书预览页补传。**台账里点隐患标题即开大图查看**（有照片时标题变主色 + 挂「照片 N」角标） |
| `flow[]` | flowItem[] | 是 | 流转记录，每次状态变化 / 调整期限 / 作废 / **下发整改通知书** 强制追加一条 |

### 整改通知书打印字段映射（前端 `printNotice.js`）

版式参数实测自企业现行《事故隐患整改通知书》：A4 纵向、页边距 上 25.4／下 12.3／左右 31.7 mm、
单表 10 行两列 11.9% : 88.1%（原第 2 行「检查日期 + 检查单位」按要求拆成两行）。栏目与字段对应如下：

| 通知书栏目 | 字段 | 说明 |
|---|---|---|
| 检查日期 | `foundDate` | 转成中文日期（2026年9月8日），独占一行 |
| 检查单位 | 可配，默认「安全环保部」 | 独占一行，不与检查日期同行；存 `localStorage['sd_print_cfg_v1']` |
| 事故隐患整改责任单位 | `dept` | — |
| 事故隐患图片及部位 | `location` + `title` + `measure` + `photos[]` | 自动成文，正文可现场改；**不写编号 / 等级 / 类型**（内部管理信息，只留在台账） |
| 领导批示 | — | 留白，纸质件手写 |
| 要求整改完工日期 | `dueDate` | 当前期限 |
| 整改责任人 | **留白** | 纸质件上手写，不打印 `owner` |
| 整改完工验收单位 | **留白** | 纸质件上手写；配置值只用于正文「报××验收」字样 |
| 验收人 | — | 留白，纸质件手写 |

打印后若勾选「写流转留痕」，追加 flowItem：
`note = 下发《事故隐患整改通知书》：要求 {dept} 于 {dueDate} 前完成整改，责任人 {owner}。`

### 状态机（status）

```
待整改 pending ──▶ 整改中 fixing ──▶ 待验收 verifying ──▶ 已闭环 closed
     │                  │                   │
     └──────▶ 已延期 delayed ◀──────────────┘(验收不通过可退回 fixing)
                    │
                    └──▶ 整改中 fixing（批准延期后回到主链）

（登记有误时）任一在办状态 ──▶ 已作废 void（终态，留痕、不物理删除）
```

- `TRANSITIONS` 定义见 `metrics.js`：`pending→[fixing,delayed]`、`fixing→[verifying,delayed]`、
  `verifying→[closed,fixing]`、`delayed→[fixing,closed]`、`closed→[]`、`void→[]`
- **逾期口径**：`dueDate < 今天` 且 `status ∉ {closed, delayed, void}` → 逾期。
  走完审批的延期不再计逾期，但列入「延期跟进」单独盯办（`delayCount > 0`）。
- **作废口径**：`void` 不计入未整改 / 逾期 / 待办 / 部门整改率 / 类型分布，
  但**台账列表与流转留痕永久保留**（隐患台账是法定留痕材料，不允许抹掉记录）。
- **改期限留痕**：编辑时只允许改 `dueDate`；`originalDueDate` 永不改写。
  一旦期限变化，必须填「变更说明」，系统自动在 `flow` 里追加一条记录。

### 编号规则（2026-10-21 起用户掌控；★ 2026-10-24 起八类各用各的号 + 新增默认顺延填入；★ 2026-10-28 起作业票前缀按类型动态生成）

八类单据的 `code` **由用户掌控**：新增表单**默认顺延填入下一个可用编号**（`SD.code.next(类型)`：本类型当前最大序号 +1，
撞号自动跳，带年份只顺延今年、过年归 1，一 / 二代老编号不参与），可直接用也可改 / 清空手填；编辑带出原号。
系统**不自动落库补号**（原自动流水号、「默认」回填按钮、数据源静默补号均已移除；`nextCode` 未恢复）。

**★ 2026-10-24 起八类各用各的编号（前缀不再统一）**：

| 单据类型 | 编号示例 | 前缀 | 年份 | 序号位数 | 规则（codeRules） |
|---|---|---|---|---|---|
| 隐患 | `FZYH-0000001` | FZYH | 不挎 | 7 | `{ prefix:'FZYH', withYear:false, seqLen:7 }` |
| 巡检 | `FZXJ-2026-001` | FZXJ | 挎 | 3 | `{ prefix:'FZXJ', withYear:true, seqLen:3 }` |
| 培训 | `FZPX-2026-001` | FZPX | 挎 | 3 | `{ prefix:'FZPX', withYear:true, seqLen:3 }` |
| 通知（原公告） | `FZTG-2026-001` | FZTG | 挎 | 3 | `{ prefix:'FZTG', withYear:true, seqLen:3 }` |
| 危险作业票 | `FZDZ-0000001` | FZ+类型首字母 | 不挎 | 7 | `{ prefix:'FZ', prefixFrom:'type', withYear:false, seqLen:7 }` |
| 特种作业人员 | `TZZY-001` | TZZY | 不挎 | 3 | `{ prefix:'TZZY', withYear:false, seqLen:3 }` |
| 证书 | `ZGZS-001` | ZGZS | 不挎 | 3 | `{ prefix:'ZGZS', withYear:false, seqLen:3 }` |

- ★ 2026-10-25：证书编号定为 `ZGZS-001`（前缀 ZGZS · 无年份 · 序号 3 位）。
- 八类的**序号池仍各自独立**（隐患的 `FZYH-0000001` 与作业票的 `FZDZ-0000001` 可并存，唯一性只在同类型内比较）；
  作业票内部再按**类型前缀**分池（`FZDZ-0000001` 与 `FZDH-0000001` 也可并存）。

- **表单**：新增 / 编辑均为空值必填输入框，placeholder 给该类示例（如隐患 `FZYH-0000003`）；
  保存时不通过不关窗，错误显示在弹窗顶部。
- **规则表**：`config.js` 的 `SD.CONFIG.codeRules`，按单据类型给 `prefix / label / withYear /
  seqLen / seqMin / seqMax / allowNoYear / allowLegacy / pattern`——**只用于格式校验，不参与生成**。
  改前缀或改序号位数只改这一张表，校验正则跟着变；逻辑集中在 `assets/js/code.js`（`SD.code`）。
- **各类型互不干扰**：唯一性只在**同一类型的记录池**内比较，
  隐患 `FZYH-0000001` 与作业票的 `FZDZ-0000001` 可以同时存在。
#### 危险作业票：前缀按作业类型动态生成（★ 2026-10-28 起）

**生成逻辑**：`编号 = 固定前缀 FZ + 作业类型名称前两个汉字的拼音首字母（大写） + "-" + 7 位序号`

| 作业类型 | 取字 | 前缀 | 编号示例 |
|---|---|---|---|
| 动火作业 | 动火 → D H | FZDH | `FZDH-0000001` |
| 受限空间作业 | 受限 → S X | FZSX | `FZSX-0000001` |
| 盲板抽堵作业 | 盲板 → M B | FZMB | `FZMB-0000001` |
| 高处作业 | 高处 → G C | FZGC | `FZGC-0000001` |
| 吊装作业 | 吊装 → D Z | FZDZ | `FZDZ-0000001` |
| 临时用电作业 | 临时 → L S | FZLS | `FZLS-0000001` |
| 动土作业 | 动土 → D T | FZDT | `FZDT-0000001` |
| 断路作业 | 断路 → D L | FZDL | `FZDL-0000001` |

- **序号**：仍为 7 位；**每个前缀各自从 0000001 顺延**（FZDZ 与 FZDH 互不占号）。
- **首字母来源**：`assets/js/pinyin.js`（GB2312 一二级 6763 字，离线内置，零外部依赖）。
  多音字取默认读音；个别行业惯读可在该文件的 `TYPE_FIX` 里按整名覆盖。
- **适用范围**：仅 `permit`（危险作业票）。其余七类（隐患 / 巡检 / 培训 / 通知 / 人员 / 证书 / 设备）前缀不变。
  作业类型改名字（改 `DICT.permitType`）→ 新票前缀随之变，无需改代码。

**特殊情形与处理**：

| 情形 | 处理 | 示例 |
|---|---|---|
| 单字类型名 | 只取 1 位首字母 | 「焊」→ `FZH-0000001` |
| 名称里有英文 | 英文取前两个字母 | 「LOTO作业」→ `FZLO-0000001` |
| 一个字母都取不到（纯符号） | 兜底 `QT`（其他） | 「（）」→ `FZQT-0000001` |
| 前两字首字母撞车 | **字典顺序先到先得**：先登记者占 2 位；后来者自动延长取第 3、第 4 位 | 受限空间 `FZSX`、射线探伤 `FZSXT`、水下 `FZSXZ` |
| 整名首字母仍相同 | 追加序号 2、3… | 「焊」`FZH` / 「弧」`FZH2` |
| 后来新增的同首字母类型 | **只影响它自己**，已登记类型的前缀不动（历史票号不会失效） | 新增「射线探伤」后，受限空间仍是 `FZSX` |

**校验口径**（`SD.code.check('permit', 值, { typeVal: 作业类型 })`）：

1. 形状：`FZ` + 1~6 位大写字母 + `-` + 7 位数字（大小写：输入框失焦自动转大写）；
2. 旧号放行：`FZZY-0000001`（2026-10-24 版通用号）、`WP-2026-041`（一代）、`FZ-0000001`（二代）；
3. **跨类型软校验**：前缀若属于「另一个现存作业类型」→ 报错并点名归属与应填前缀
   （如「`FZGC-0000009` 是『高处作业』的编号，当前作业类型是『吊装作业』，应为 `FZDZ-…`」）；
   不属于任何现存类型的前缀（类型改名后的旧前缀）**不拦**，避免历史票被卡；
4. 同类重复：作业票池内大小写不敏感查重。
5. **编辑不改号**：打开编辑不重算前缀；改作业类型也不静默改号，若真的不符，保存时由上面第 3 条提示，人来决定。

- **保存时三条校验**（`SD.code.check`，顺序如下）：
  1. 空 → 「隐患编号」不能为空
  2. 格式不符 → 「隐患编号」格式应形如 FZYH-0000001，当前填写的是「ABC-1」
  3. 同类重复 → 「隐患编号」FZYH-0000001 已存在，请换一个（大小写不敏感）
  （作业票在此之上多一条「前缀与作业类型是否对得上」，见上「危险作业票动态前缀」）
- **三道防线**：表单校验 → 数据层兜底（`create` 拒空号 + 查重；`update` **只在确实改了号**才校验，
  历史重号记录改其它字段不会被拦）→ 导入校验（`store.importJSON` 逐类查空号 / 重号，
  不静默补号，报错点名问题记录，最多列 5 条）。
- **后端约定**：`POST /hazards` 等创建接口收到空 `code` 或撞号 `code` 时应返回 4xx，
  前端会把错误文案原样透传到弹窗；不要在后端自动补号（与前端口径保持一致）。
- **历史数据兼容**：
  · 一代老编号（`HZ-2026-001` / `INS-2026-041` / `TR-2026-09` / `CT-001` /
    `NT-2026-014` / `SP-2026-001` / `WP-2026-041`）→ 由 `code.js` 的 `LEGACY_PREFIXES` **默认放行**，
    老记录编辑保存不会被格式校验拦；要只认新号就在规则里加 `allowLegacy: false`；
  · 二代统一号时期的 `FZ-0000001`（第二段 7 位数字）→ 同样**默认放行**
    （2026-10-25 前的证书号正是它，换号前不会报错）；
    但 `FZ-001` / `FZ-2026-001` 这种不符合任何一类规则的仍会被拒；
  · 老编号序号位数短 / 无年份 → 规则表的 `seqMin / seqMax`、`allowNoYear` 仍可用于放宽；
  · 老记录本来就没有 `code` → 列表显示「—」，编辑时补填并按新规则校验；
  · 老备份（含空号 / 重号）导入会被拒，需先补好编号再导。
- **改号不会自动同步引用**：巡检备注、通知书标题里若以文本形式引用了旧隐患编号，
  改号后这些文本不会跟着变，需要人工核对；已下载的文件同样不会自动更新。

  改号后这些文本不会跟着变，需要人工核对；已下载的文件同样不会自动更新。

| 类型 codeType | 数据集合 | 前缀 | 示例（2026-10-24 起各类分号） |
|---|---|---|---|
| `hazard` | hazards | FZYH | FZYH-0000001 |
| `inspection` | inspections | FZXJ | FZXJ-2026-001 |
| `training` | trainings | FZPX | FZPX-2026-001 |
| `certificate` | certificates | ZGZS | ZGZS-001 |
| `notice` | notices | FZTG | FZTG-2026-001 |
| `special` | specialPersonnel | TZZY | TZZY-001 |
| `permit` | workPermits | FZ+类型首字母 | FZDZ-0000001 |

> 序号池按类型各自独立，故各类各从自己的 `0000001` / `001` 起、互不影响；
> 老编号（一代 `HZ-2026-001` 一类、二代 `FZ-0000001`）仍可保存，属兼容放行（见上「历史数据兼容」）；
> 2026-10-25 前录入的证书号 `FZ-0000001` 走的就是这条，不会因换号报错。

### flowItem —— 流转记录（法定留痕）

| 字段 | 类型 | 说明 |
|---|---|---|
| `at` | string | `YYYY-MM-DD HH:mm` |
| `by` | string | 操作人 |
| `from` | string | 原状态名（新建为 `—`） |
| `to` | string | 目标状态名 |
| `note` | string | 备注（写清做了什么，便于追溯） |

### 示例

```json
{
  "id": "H1000",
  "code": "FZYH-0000001",
  "title": "装配车间消防通道被物料占用",
  "type": "消防",
  "typeCode": 1,
  "severity": "major",
  "statutoryLevel": "major",
  "dept": "生产一部",
  "owner": "张伟",
  "location": "A 区装配线东侧",
  "source": "日常巡检",
  "foundDate": "2026-10-01",
  "originalDueDate": "2026-10-10",
  "dueDate": "2026-10-10",
  "status": "pending",
  "delayCount": 0,
  "measure": "清理通道内物料，划定消防通道黄线并张贴禁放标识",
  "closedAt": null,
  "flow": [
    { "at": "2026-10-01 09:00", "by": "王安全", "from": "—", "to": "待整改", "note": "巡检发现，现场拍照取证" }
  ]
}
```

---

## 2. inspection —— 巡检任务

> ★ 2026-11-04：界面列表**默认只显示当年**，归年按 `scheduledDate`；「本周」视图不套年份（跨年周照常完整显示）。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 是 | 主键 |
| `code` | string | 是 | 任务编号，如 `FZXJ-2026-001`；**2026-10-21 起用户手动必填、2026-10-24 起各类分号**（空 / 同类型重复会被拒） |
| `planName` | string | 是 | 计划名称 |
| `type` | enum | 是 | `日常巡检 / 专项检查 / 季节性检查 / 节假日检查 / 综合巡查` |
| `area` | string | 是 | 巡检区域 |
| `dept` | string | 否 | 责任部门。★ 2026-11-12：一单可拆多部门，本字段降级为**兼容镜像**（取第一个非空部门），真实归属看 `problems[].dept` |
| `executor` | string | 是 | 执行人 |
| `scheduledDate` | date | 是 | 计划日期（**判定「本周」的依据**，周一起算） |
| `status` | enum | 是 | `planned` 待执行 / `done` 已完成 / `rescheduled` 已改期 / `cancelled` 已取消 |
| `completedAt` | date \| null | 否 | 完成日期 |
| `rescheduleTo` | date \| null | 否 | 改期后的日期 |
| `reason` | string | 否 | 改期 / 取消原因（必填，留痕） |
| `hazardCount` | number | 否 | 本次发现的隐患**条数**，默认 0。★ 2026-11-11 起**两个入口都能填**：新增 / 编辑表单的「隐患条数」与「标记完成」弹窗；★ **2026-11-12 起，有 `problems` 时它是各行 `count` 之和**（镜像），无 `problems` 时仍是顶层唯一口径，`record.hazardCount` 只作老数据兜底。读取一律走 `metrics.hazardCountOf`，任何地方不要再直接读本字段。**它是数据看板「隐患条数」的唯一来源**，与照片张数无关 |
| `hazardLevel` | enum | 否 | **隐患等级**（★ 2026-11-11 新增）：`major` 重大 / `large` 较大 / `general` 一般，取 `dict.severity`。非必填，空值 = **未定级**。★ 2026-11-12：有 `problems` 时取各行等级的**最高档**（镜像）；统计按行逐条计入，所以等级合计 = 隐患条数，但不能反推每条隐患各自的等级 |
| `hazardType` | enum | 否 | **隐患类型**（★ 2026-11-10 新增）：`消防 / 电气 / 机械 / 高处作业 / 有限空间 / 危化品 / 职业健康 / 特种设备 / 作业环境 / 其他`，取 `dict.hazardType`。供数据看板「隐患类型分布」出图。非必填，没填的归「未分类」但仍计入。★ 2026-11-12：有 `problems` 时取第一条有类型的行（镜像），类型分布按行统计。注意与 `type`（巡检类型：日常/专项）不是一回事 |
| `fixDueDate` | date | **新增必填 / 编辑不强制**（★ 2026-11-12）：**整改期限**（★ 2026-11-12 新增）：要求整改**完成**的日期，`YYYY-MM-DD`。与 `fixDate`（实际完成日）不是一回事。空 = **未设期限**（只可能出现在本字段上线前的历史记录里；**新增巡检未填会被表单拦下**），看板单独计一格，**既不判逾期也不判按期**。★ 有 `problems` 时取各行**最早**的非空值作镜像（仅供列表 / 导出 / 单部门展示），**逾期与及时率一律逐行判定**，不得用本字段反推整单状态 |
| `fixDate` | date | 否 | **整改日期**（★ 2026-11-11 新增）：隐患整改**完成**的日期，`YYYY-MM-DD`。与 `scheduledDate` 没有先后约束。★ 2026-11-12：有 `problems` 时取第一个非空值（镜像），整改状态按行判定 |
| `fixPhotos[]` | string[] | 否 | **整改照片**（dataURL 数组，★ 2026-11-11 新增），最多 **18 张**，原图不压缩（同一套 photoVault 外置）。与 `photos`（整改前）**分开存**。<br>★ **不进看板口径**：`metrics.inspectionPhotos` 只读 `photos`，本字段不计入「隐患照片」张数，否则同一件事的照片会被数两遍。<br>★ 2026-11-12：有 `problems` 时是各行整改照片的**拼接镜像** |
| `remark` | string | 否 | 备注 |
| `record` | object \| null | 否 | 执行记录，仅 `done` 时有值 |
| `photos[]` | string[] | 否 | **隐患照片**（dataURL 数组），最多 **18 张**（★ 2026-10-30 起，原 6 张），**原图不压缩**（大图自动外置，JSON 里只留 `vault:` 引用）。列表点「区域」看大图（有照片时挂「照片 N」角标）；执行记录弹窗里也有入口。<br>★ **2026-11-10 更名**：显示名由「巡查照片」改为「隐患照片」，**存储键仍为 `photos`**，历史记录与备份零迁移。<br>★ **2026-11-12**：有 `problems` 时是各行 `photos` 的**拼接镜像**（供列表角标 / 灯箱 / 导出 / 打印直接读）；统计仍按行，镜像只为兼容，不会重复计数。<br>★ **统计口径**：看板按**张数**、按明细行的 `dept` 汇总，未填部门归「未指定部门」，按 `scheduledDate` 归月，任务改期 / 取消后已上传的照片仍计入。<br>★ **类型分布口径**：按行 `type` 分组，计的是**次数** —— 一处有照片的上报记一次（含「未分类」），所以类型合计 = 有照片的上报处数，**不等于照片张数**（照片是证据，上报是事件）。 |

### problems —— 分部门问题明细（★ 2026-11-12）

> 一张巡检单可以登记多个部门各自的问题：表单里点「按部门拆分」后逐行录入。
> **它才是隐患条数 / 等级 / 类型 / 照片 / 整改的唯一真值**；上面那几个标量字段只是它的汇总镜像。
> 单部门录入时不产生这个数组（走原路径），所以单部门单的存储结构与 v1.3.5 完全一致。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 行内标识，保存时自动生成，仅前端定位用 |
| `dept` | string | 责任部门（该行归属；空值统计时归「未指定部门」） |
| `content` | string | **问题内容**（现场描述，如「配电箱门无法闭合，线路外露」） |
| `type` | enum | 隐患类型，取 `dict.hazardType`；空 = 未分类 |
| `level` | enum | 隐患等级 `major` / `large` / `general`；空 = 未定级 |
| `count` | number | 该部门本次发现的隐患**条数**（≥0，可为 0 —— 只拍照没数条数） |
| `photos[]` | string[] | 该部门的隐患照片（≤18 张，整改前） |
| `fixDueDate` | date | **该部门的整改期限**（★ 2026-11-12）。空 = 未设期限，该行不参与逾期判定 |
| `fixDate` | date | 该部门的整改完成日期 |
| `fixPhotos[]` | string[] | 该部门的整改照片（≤18 张，整改后） |

**老记录没有这个数组** → 读取时合成「一行」，取顶层的 `dept` / `record.findings` / `hazardType` / `hazardLevel` / `hazardCount` / `photos` / `fixDueDate` / `fixDate` / `fixPhotos`。
一条记录 = 一行，所有按行累加的结果与改造前**逐值相同**（见 `metrics.hazardRowsOf`），
所以升级不动历史数字，也不需要数据迁移。

### record —— 执行记录

| 字段 | 类型 | 说明 |
|---|---|---|
| `findings` | string | 现场情况 / 发现 |
| `hazardCount` | number | **兼容镜像**（★ 2026-11-11）：与顶层 `hazardCount` 同值，只为老读取方保留；**统计一律以顶层为准** |
| `signedBy` | string | 现场签字人 |
| `signedAt` | string | 签字时间 `YYYY-MM-DD HH:mm` |

### 完成率口径

- 分母 = 本周（`周一 ~ 周日`）内 `scheduledDate` 落在区间、且 `status !== 'cancelled'` 的任务数
- 分子 = 其中 `status === 'done'` 的数量
- **改期不减免**：`rescheduled` 仍留在分母且不算完成 —— 刻意如此，避免改期成为规避手段

### 隐患条数与整改口径（★ 2026-11-11 统一；2026-11-12 起**按明细行**）

> 入口：`metrics.inspectionStats(data, today)` —— **巡检侧所有数字只从这里出**，
> 巡检页顶部汇总条、数据看板「隐患与整改」段（v1.4.1 由「安全巡检（隐患与整改）」改名）都读它，所以两页数值必然一致。
> 照片口径另有一套（`metrics.inspectionPhotos`），两者不混算。
> 两者都先过 `metrics.hazardRowsOf(t)`：**有 `problems` 用明细行，没有就用顶层字段合成一行**。

**三套数，各说各的**

| 数 | 来源 | 含义 | 用在哪 |
|---|---|---|---|
| 照片**张数** | 各明细行 `photos[].length` 之和 | 现场证据几张 | 看板「各部门隐患照片」与其趋势 |
| 隐患**条数** | `Σ 各行 count`（老记录 = `hazardCount`） | 发现了几处隐患 | 看板 KPI「隐患条数 / 整改率」、分部门隐患条数、等级图、巡检页汇总条 |
| 隐患**处数** | **有照片的明细行数**（老记录 = 该任务） | 几处上报带了证据 | 看板「隐患类型分布」、各部门照片的「N 项」 |

> 「处数」与「任务数」在多部门单上不相等：一张单拆 3 个部门、其中 2 个带照片 →
> 处数 2、任务数 1。看板「合计 N 张 / M 项」在两者不等时补一句「（共 R 项任务）」。

**整改状态：派生，不存字段，按行判定**

```
该行有 fixDate              → 已整改 done
该行无 fixDate 但有 fixPhotos → 整改中 doing
两者都没有                  → 未整改 none
```

- 三态**按条数累计**：`none + doing + done === hazardCount`
- 整改率 = `done / hazardCount`（0 条时为 `null`，页面显示「—」）
  —— 用条数不用任务数，才不会出现「隐患 5 条、已整改 4 条、整改率 50%」
- 只有 `Σ count > 0` 的记录进隐患 / 整改口径：没发现问题的巡检不该被算成「未整改」
- 整单状态（`fixStatusOf`）= 有條数的行全 done 才 done；有 none 则 none；否则 doing。
  纯照片行（`count = 0`）不参与判定。

**逾期与整改及时率（★ 2026-11-12 新增，按行六格）**

`fixDueDate` 让巡检可以自己判逾期，不必再借台账的状态机。判定入口 `metrics.rowDueOf(row, today)`，
六格**互斥且完备**（每条隐患恰好落一格）：

| 格 | 条件 |
|---|---|
| `doneOnTime` | 有 `fixDate`，有期限且 `fixDate <= fixDueDate`（按期整改） |
| `doneLate` | 有 `fixDate`，有期限且 `fixDate > fixDueDate`（超期整改） |
| `doneNoDue` | 有 `fixDate`，无期限 |
| `openOverdue` | 无 `fixDate`，有期限且 `fixDueDate < today`（**逾期未整改**） |
| `openInDue` | 无 `fixDate`，有期限且 `fixDueDate >= today` |
| `openNoDue` | 无 `fixDate`，无期限 |

- 「整改中」（只有整改照片、没有整改日期）归**未整改侧**参与逾期判定 ——
  与台账 `isOverdue` 把 `fixing` 算逾期一致
- **未设期限既不算逾期、也不算按期**：存量记录全都没有这个字段，硬判成任一边都是编数。
  看板在一条期限都没设时，逾期卡直接显示「尚未设置整改期限」，不写「无逾期」
- **整改及时率 = `doneOnTime / (doneOnTime + doneLate)`**；分母 0 → `null`（页面显示「—」）。
  无期限的已整改不进分母（判不了按期）
- 三条恒等式（冒烟测试逐个断言，用来抓"漏行"）：
  ```
  六格之和 === hazardCount === fix.none + fix.doing + fix.done
  doneOnTime + doneLate + doneNoDue === fix.done
  openOverdue + openInDue + openNoDue === fix.none + fix.doing
  ```

**看板统计范围：年 / 月两档（★ 2026-11-12 v1.3.8 起；v1.3.9 加月档）**

`metrics.inspectionStats` / `metrics.inspectionPhotos` 接受一个可选第三参：
不传 = **当年**（与 v1.3.8 逐值一致）；传 `{ ym:'2026-11' }` = **该自然月**。
两者都走同一个聚合层（`statsOf` / `photosOf`），只是筛选区间不同 —— 所以六格恒等式、
部门汇总、等级分布在两档下不可能分叉。归期依据一律是 **`scheduledDate`**：

- 年档：按年份筛掉跨年记录，条数 / 六格 / 部门 / 等级 / 照片 / 趋势全部只算当年
- 月档：按 `'YYYY-MM'` 筛，趋势改用**逐日**（`days` 个点）；月份可由
  `inspectionMonthsOf(data)` 取「数据中出现过的年月 + 当月」（可回看往年）

新增字段（只增不改）：`range {kind, ym, label, start, end, days}`、
`daily [{date, found, fixed}]`（月档逐日，全 0 → `[]`）、
`fixedCarryIn`（本月改完但上报不在本月的条数）。

> 月档的「已整改」曲线是**事件窗口**（所有记录中 `fixDate` 落在本月的行），
> 「上报」是 containment（本月记录）—— 否则「上月发现、本月改完」两边都不出现。
> 年档两线都是 containment，与 v1.3.8 一致。

原「只统计当年」的其余约定仍然成立：

- 输出 `year`（'YYYY'）与 `recordsAll`（全库记录数，仅作对照）——
  `records` 的语义是「**区间内**记录数」（年档=当年 / 月档=当月）
- 年档趋势横轴为**本年度 1–12 月**（`monthsOfYear`），不再是滚动近 12 个月；
  月档为**该月逐日**（`daily`）
- 取不到 `scheduledDate` 的记录**不计入**（归不了期就不编到某一段去）
- 看板收窄的是**统计**，不是数据：巡检列表的年份下拉照旧可查往年
- 「本周完成率」不套区间过滤（周指标，跨年那一周要算上上一年那几天）
- 逾期 / 最长逾期两档都按**今天**判定，不给历史月做「月末快照」

**等级分布**

- 按**行** `level` 分组，value = 该组 `Σ count`；空值归「未定级」
- 每一行的条数整体计入该行等级，因此 `Σ byLevel === hazardCount`；仍**不能反推每条隐患的等级**
- 固定顺序 `重大 → 较大 → 一般 → 未定级`，与台账等级图配色一致

**部门分布**

- 按**行** `dept` 分组（空 → 未指定部门）：`Σ byDept.hazardCount === hazardCount`
- `byDept[].tasks` 按 (记录, 部门) 去重 —— 同一张单在同一部门记 1 个任务

**边界**

- **不按任务状态过滤**：改期 / 取消的任务，已填条数与已上传照片都照算（既成事实不随状态消失）
- **条数与照片的过滤条件不同**：条数口径要求 `count > 0`，照片口径只要求 `photos.length > 0`。
  「拍了照但没填条数」会进照片统计、不进条数统计 —— 这是刻意的，两条代码路径各自写死，不要合并
- **巡检隐患不会自动生成隐患台账记录**：巡检的「条数 / 逾期 / 整改率」与台账的「已闭环 / 逾期 / 整改率」是两本账，不互相折算（逐条台账化是后续方向）。★ 2026-11-12 起数据看板**只讲巡检**，台账数字仅保留一行快照作对照。

---

## 3. training —— 培训计划

> ★ 2026-11-04：界面列表**默认只显示当年**，归年按 `startDate`（缺失回退 `endDate`）；页内四张指标卡与状态计数同步按所选年份统计。

> 2026-10-19 起页面侧「培训与证书」模块**只保留培训**：证书台账与三档到期预警的 UI 已移除，
> 持证到期预警改由 `specialPersonnel`（特种作业人员）的 `reviewDate` 承担。
> **`certificate` 的数据结构与接口保留**，只是本模块不再展示（见第 4 节）。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 是 | 主键 |
| `code` | string | 是 | 计划编号，如 `FZPX-2026-001`；**2026-10-21 起用户手动必填、2026-10-24 起各类分号**（空 / 同类型重复会被拒） |
| `name` | string | 是 | 培训名称 |
| `type` | enum | 是 | `三级教育 / 专项培训 / 应急演练 / 特种作业` |
| `target` | string | 是 | 培训对象 |
| `trainer` | string | 否 | 讲师 / 组织方 |
| `startDate` | date | 是 | 开始日期 |
| `endDate` | date | 是 | 结束日期 |
| `status` | enum | 是 | `planned` 未开始 / `ongoing` 进行中 / `done` 已完成 |
| `required` | number | 是 | 应到人数 |
| `actual` | number | 是 | 实到人数 |
| `photos[]` | string[] | 否 | 培训照片（dataURL 数组），最多 6 张，压到宽 1000px。**新增 / 编辑弹窗底部上传**（2026-10-20 新增）；台账**不单列照片栏**，**直接点培训名称看大图**——有照片时标题变主色并挂「照片 N」角标，无照片时点击只提示；悬停显示张数 |

---

## 4. certificate —— 人员证书

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 是 | 主键 |
| `code` | string | 是 | 台账编号，如 `FZ-0000001`；**2026-10-21 起用户手动必填、2026-10-24 起各类分号**（空 / 同类型重复会被拒） |
| `person` | string | 是 | 持证人 |
| `dept` | string | 是 | 所属部门 |
| `certName` | string | 是 | 证书名称，如「低压电工作业」 |
| `certType` | string | 是 | 证书类别，如「特种作业操作证」 |
| `certNo` | string | 是 | 证书编号 |
| `issuer` | string | 否 | 发证机关 |
| `validFrom` | date | 是 | 有效期起 |
| `validTo` | date | 是 | 有效期止（**预警判定依据**） |

### 预警档位（阈值可在页面「阈值设置」里改，存本机）

| 档位 | 判定 | 默认阈值 |
|---|---|---|
| `expired` 已过期（红） | `validTo < 今天` | — |
| `warn` 即将到期（橙） | `剩余 ≤ certWarnDays` | 30 天 |
| `notice` 需关注（黄） | `剩余 ≤ certNoticeDays` | 90 天 |
| `ok` 正常 | 其余 | — |

---

## 5. notice —— 通知公告

> ★ 2026-11-04：界面列表**默认只显示当年**，归年按 `publishAt`。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 是 | 主键 |
| `code` | string | 是 | 通知编号，如 `FZTG-2026-001`；**2026-10-21 起用户手动必填、2026-10-24 起各类分号**（空 / 同类型重复会被拒） |
| `title` | string | 是 | 标题 |
| `source` | string | 是 | 发布单位 |
| `level` | enum | 是 | `urgent` 紧急 / `important` 重要 / `normal` 普通 |
| `publishAt` | date | 是 | 发布日期 |
| `summary` | string | 否 | 摘要正文（列表里展示这段） |
| `docs` | array | 否 | **文档附件**（★ 2026-11-12 新增，可选）。数组元素：`{id, name, size, mime, dataUrl}`。列表里带附件的标题可点，点开查看；**未上传时不写该字段**（不是空数组） |
| `pinned` | boolean | 否 | 是否置顶（置顶优先，其余按发布时间倒序） |

**附件约束（`components/docAttach.js`，改之前先读）**

| 项 | 规则 |
|---|---|
| 类型 | PDF / doc,docx / xls,xlsx / ppt,pptx / txt / png,jpg,webp；**html / svg / js / exe / bat 等明确拒绝**（点开即执行环境） |
| 大小 | 单文件 **2MB**；浏览器无 IndexedDB（隐私模式 / 老浏览器）时降到 **800KB** |
| 数量 | 每条公告 **≤ 3 个** |
| 超限行为 | 拒绝并提示上限，**不静默截断、不压缩**（Office 文件压不了） |
| 落盘 | `dataUrl` 由 `photoVault` 外置到 IndexedDB，localStorage 里只留 `vault:doc:<key>` 引用；图片仍是 `vault:<key>` |
| 丢失 | 水合时文档引用找不到 → 给 `data:text/plain` 占位并标「文件已丢失」，不拿图片占位顶替 |
| 打开 | 图片走灯箱预览；PDF 用 blob URL 新窗口（Chrome 已禁止顶级导航到 `data:`）；Office **只能下载**后用 WPS/Office 打开 |
| 导入导出 | JSON 备份完整带附件；Excel / 日报 / 周报**不含**公告，因此不带附件 |

---

## 6. trend —— 隐患趋势（按月聚合）

| 字段 | 类型 | 说明 |
|---|---|---|
| `ym` | string | 月份 `YYYY-MM` |
| `created` | number | 当月新增隐患数 |
| `closed` | number | 当月闭环隐患数 |

> 前端 `mock.js` 生成近 12 个月；真实接口建议返回最近 12~24 个月。
> 看板上「两条线的差值」即当月净增未闭环量。
>
> ★ 2026-11-11：`metrics.hazardTrend(data, today)` 补了**现算兜底** ——
> 没有预聚合时按 `hazards.foundDate`（新增）与 `closedAt`（闭环，仅 `status==='closed'`）自己算，
> 与 `deptTrend` 同一口径（新增不排除作废），因此「全厂合计 = 各部门合计」。
> **全 0 时返回 `[]`**，让看板继续显示「暂无趋势数据」空态，不画空折线。

### 6.1 deptTrend —— 各部门隐患趋势（按月聚合）

| 字段 | 类型 | 说明 |
|---|---|---|
| `dept` | string | 部门名（与隐患台账 `dept` 一致） |
| `ym` | string | 月份 `YYYY-MM` |
| `count` | number | 该部门当月新增隐患数 |

- 形状为扁平数组 `[{dept, ym, count}]`，前端 `metrics.deptTrend(data)` 负责重整成
  `{months:[12 个月], depts:[{dept, data:[12], total}]}`（部门按总量降序）供看板渲染。
- **口径约束**：各月「各部门合计 = 全厂 `trend.created`」，保证「全厂趋势」与「部门趋势」两张图同一口径。
- 数据来源两级：① `data.deptTrend` 预聚合（后端 / 示例，优先）；② 没有预聚合时从 `hazards.foundDate` 现算（兜底）。
- 看板交互：部门 chips 多选对比，默认勾选总量前 4，勾选状态存 `filters.dashboard`，刷新不丢。

---

## 8. specialPersonnel —— 特种作业人员台账

> 聚焦「特种作业人员」这一高风险场景（区别于第 4 节「人员证书」覆盖全部证书）。
> 类别按应急部《特种作业人员安全技术培训考核管理规定》列 10 类，**另含用户补充的「吊装作业」**（2026-10-21），共 11 个选项。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 是 | 主键 |
| `code` | string | 是 | 人员编号，如 `TZZY-001`；**2026-10-21 起用户手动必填、2026-10-24 起各类分号**（空 / 同类型重复会被拒） |
| `name` | string | 是 | 姓名 |
| `dept` | string | 是 | 所属部门 |
| `category` | enum | 是 | 作业类别：`电工作业 / 焊接与热切割作业 / 高处作业 / **吊装作业** / 制冷与空调作业 / 金属非金属矿山作业 / 石油天然气作业 / 冶金（有色）生产安全作业 / 危险化学品安全作业 / 烟花爆竹安全作业 / 其他`（吊装作业 2026-10-21 新增） |
| `operation` | string | 是 | 操作项目，如「低压电工作业」「熔化焊接与热切割」 |
| `certNo` | string | 是 | 证书编号 |
| `issuer` | string | 否 | 发证机关 |
| `validFrom` | date | 是 | 有效期起 |
| `validTo` | date | 是 | 有效期止 |
| `reviewDate` | date | 是 | 复审日期（到期前须完成复审换证） |
| `status` | enum | 是 | `valid` 有效 / `pending_review` 待复审 / `expired` 已过期 / `suspended` 停用 |
| `photos[]` | string[] | 否 | 证件照（dataURL 数组），最多 3 张。台账**不单列证件照**，姓名不加视觉修饰（不变色、无角标），**直接点姓名看大图**，悬停提示张数（2026-10-20 改）；另外作业票照片打印页会按 `name` 自动把第一张证件照排在最前，**并和现场照片一样按长宽比自动旋转**（2026-10-21） |

### 预警口径（复用证书三档阈值 `certWarnDays` / `certNoticeDays`）

按 `validTo` 距今天数：`已过期`(红) / `≤30`(橙) / `≤90`(黄) / 正常。列表按剩余天数升序，最急的在最上；`suspended` 不计入预警但台账保留。

### 语义函数（新增到 `dataSource.js`）

`api.listSpecialPersonnel()` / `createSpecialPersonnel(payload)` / `updateSpecialPersonnel(id,patch)` / `removeSpecialPersonnel(id)`
→ 真实接口约定 `GET/POST/PATCH/DELETE /special-personnel`。

---

## 8.5 devicePersonnel —— 特种设备人员台账（2026-10-24 新增）

> 覆盖叉车等**特种设备**作业人员及其操作证（「人员证书」与「特种作业人员」都不管这块）。
> 初始数据由 `2026叉车证人员名单.xlsx` 导入（78 人，全部 N1 叉车司机证）。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 是 | 主键 |
| `code` | string | 是 | 人员编号，如 `TZSB-001`；新增时默认顺延填入，可手改 |
| `name` | string | 是 | 姓名 |
| `empNo` | string | 否 | 工号，**按文本存**（原表有前导零，如 `06359`） |
| `dept` | string | 是 | 所属部门 |
| `post` | string | 否 | 岗位（如 叉车班 / 发泡仓 / 设备） |
| `certType` | string | 是 | 证书类型，默认 `N1`（叉车司机） |
| `idNo` | string | 是 | 证件编号（原表填的是身份证号；含 `X` 结尾的按原样存） |
| `validTo` | date | 是 | 证书有效期至；预警与过期判定依据 |
| `phone` | string | 否 | 联系方式 |
| `note` | string | 否 | 备注 |
| `status` | enum | 是 | `valid` 有效 / `pending_review` 待复审 / `expired` 已过期 / `suspended` 停用（与第 8 节同一套字典） |
| `photos[]` | string[] | 否 | 证书照片（dataURL 数组），最多 3 张；点姓名看大图 |

### 导入时的规范化（原表写法不统一，不处理会算错预警）

| 原表写法 | 处理 |
|---|---|
| `2028-5`、`2026-12`（只有年月） | 补成**当月最后一天**：`2028-05-31`、`2026-12-31`（宁早不晚，安全口径） |
| `2029-04-01 00:00:00`（Excel 日期时间） | 取日期部分：`2029-04-01` |
| `06359`、`32062219691202173X` | 一律按**文本**存，前导零与结尾 `X` 不丢 |

### 状态实时计算

`status` 不写死在数据里：`metrics.summarize` 按 `validTo` 与当天比较得出展示口径
（已过期 / `certNoticeDays`（默认 90 天）内待复审 / 有效），隔天打开自动更新。
数据层仍保留 `status` 字段，编辑弹窗可手工改成「停用」。

### 语义函数

`api.listDevicePersonnel()` / `createDevicePersonnel(payload)` / `updateDevicePersonnel(id,patch)` / `removeDevicePersonnel(id)`
→ 真实接口约定 `GET/POST/PATCH/DELETE /device-personnel`。

---

## 9. workPermits —— 危险作业票（八大危险作业）

> 聚焦 GB 30871 八大危险作业审批：动火 / 受限空间 / 盲板抽堵 / 高处 / 吊装 / 临时用电 / 动土 / 断路。

**列表按月展示（★ 2026-10-30 起）**：页面默认只显示**当月**作业票，顶部月份条可「‹ 上一月 / 直接选月 / 下一月 ›」，
非当月时出现「回到本月」。归月口径取 `planStart` 所在月（跨月作业只算开始月；`planStart` 缺失回退 `planEnd`，
仍无则归当月，避免记录从月视图里消失）。**月份只是视图过滤**：指标卡与状态 chips 的计数同步限定在该月，
数据、编号规则、状态机、日报/周报口径都不变；新增作业票若计划日期不在当前月，保存后自动切到该月。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 是 | 主键 |
| `code` | string | 是 | 作业票编号，如 `FZDZ-0000001`（FZ + 作业类型首字母 + 7 位序号，**2026-10-28 起按类型动态生成**）；空 / 同类型重复 / 前缀与类型不符都会被拒 |
| `type` | enum | 是 | 八大危险作业之一（见上） |
| `location` | string | 是 | 作业地点 |
| `dept` | string | 是 | 申请部门 |
| `applicant` | string | 是 | 申请人 |
| `leader` | string | 是 | 作业负责人 |
| `guardian` | string | 是 | 监护人 |
| `workers[]` | string[] | 否 | **作业人员名单**（实际进场干活的人，可多个）；表单走标签输入，联想名单取自 `specialPersonnel.name` |
| `risk` | string | 否 | 风险辨识 |
| `measures` | string | 否 | 安全措施 |
| `photos[]` | string[] | 否 | 作业现场照片（dataURL 数组），最多 6 张，压到宽 1000px。三处消费：**表格点「作业类型」看大图**（表格已不单列照片栏）、页面底部「作业现场照片」专区（按票分组铺开缩略图）、「操作 ▾ → 照片（打印 / Word）」排成一张 A4 出件（**出件时前面会自动补上 `workers` 对应人员的证件照**） |
| `planStart` | date | 是 | 计划开始 |
| `planEnd` | date | 是 | 计划结束 |
| `status` | enum | 是 | `draft` 草稿 / `pending` 待审批 / `approved` 已批准 / `working` 作业中 / `done` 已完工 / `void` 已作废 |
| `approvedBy` | string | 否 | 审批人（审核动作自动写入） |
| `approvedAt` | string | 否 | 审批时间 `YYYY-MM-DD HH:mm`（审核动作自动写入） |

### 状态机

```
草稿 draft ──▶ 待审批 pending ──▶ 已批准 approved ──▶ 作业中 working ──▶ 已完工 done
                  │                                      │
                  └──────────────▶ 已作废 void ◀──────────┘（任一在办状态可作废，留痕不物理删）
```

- `void` 为终态、留痕、不物理删除（与隐患「作废」同一原则）。
- 批准动作（`pending→approved`）由系统在界面自动写入 `approvedBy='王安全'` 与 `approvedAt`，满足 EHS 审批留痕。

### 语义函数（新增到 `dataSource.js`）

`api.listWorkPermits()` / `createWorkPermit(payload)` / `updateWorkPermit(id,patch)` / `removeWorkPermit(id)`
→ 真实接口约定 `GET/POST/PATCH/DELETE /work-permits`。

### 照片单页 A4 出件（前端 `printPhotos.js`）

| 项 | 说明 |
|---|---|
| 入口 | 作业票行「操作 ▾」→ `照片（打印 / Word）` |
| 内容 | 只输出照片 + 一行抬头（票号 · 类型 · 地点 · 时段） |
| 列数 | 1 张→1 列，2~4→2 列，5~9→3 列，≥10→4 列；`grid-auto-rows:1fr` 平分纸高 |
| 上限 | 12 张（再多也不出第二页） |
| 打印 | ★ 2026-10-22 起走**独立打印样式 `assets/css/print-only.css`**（`<link media="print">`，只在打印时生效）：`@page` A4 + 上 20.4 / 左右 24.8 / 下 13.8 mm（与保存的 Word 件一致）、纸张自身 padding 归零、隐藏工具条/导航/侧栏/按钮/提示条/删除键、单元格 `overflow:visible` 不截断、短行 `break-inside:avoid`、照片行允许跨页（长内容正常分页）、`print-color-adjust:exact` 保 0.5pt 框线；照片页 10mm 的 `@page` 仍由 JS 打开预览时注入、关闭时撤掉（纸张锁 277mm） |
| Word | 导 **真 .docx**（`components/docxWriter.js`：stored ZIP + OOXML，表格 / DrawingML 图片 / media 部件）—— 2026-10-22 起不再走 MHTML/HTML 冒充 .doc；**通知书版式照企业原件《事故隐患整改通知书（26.9.8）.docx》逐格复刻**（10 行、边距 1157/1406/781/1406、列宽 720/8520、行高 781/640/640/663/6600/1949/663/663/663/683、检查日期与检查单位各自单独一行、照片标签每字竖排、图片段在最上、cellMar 0/108、autofit、tblInd 270）；**作业票照片墙为一排一张横放 + 长边横向 + 一页同比例缩放**（20 细列每张独立成行：横图满行宽、方图 13 列、竖图 6 列，高度上限 380/340/300pt；从原始插入图片出发、竖图旋转 90° 转横；总高超一页预算 785−6n−10pt 时全体同比例缩小）；**通知书照片按正文预算自适应**（单张 260×预算、多横图横排一行、混合竖排，9 行合计 698.5pt < 745pt 锁一页）；**通知书屏幕预览 / 浏览器打印与保存页同一版式**（列宽 7.8/92.2、标签竖排、照片在正文之上、照片尺寸由 layoutPhotos 同一算法算出）；非位图 dataURL 导出前过 canvas 栅格化为 PNG；**照片墙所有页（预览/打印/Word）照片统一再等比缩 5%**（PHOTO_SHRINK 0.95 + CSS `transform:scale(.95)`）；**出件文件名**：通知书 `事故隐患整改通知书（2026.10.22）.docx`、作业票照片页 `20261022吊装.docx`（**同名再出不加任何后缀**，见 `SD.utils.docName`） |

---

## 9.5 shiftLogs —— 安全巡检交接班记录（2026-10-25 新增）

**一条记录 = 某天 + 某班次**（同一天同一班次只保留一份，再保存即覆盖）。版面照《现场安全巡检与交接班记录.xlsx》复刻，19 个检查项。

**列表按月展示（★ 2026-11-04）**：界面默认只列**当月**记录，右上角月份选择器可切月 / 上下月 / 回到本月。
归月只看 `date` 的前 7 位（`YYYY-MM`）；`date` 缺失才回退 `updatedAt`，仍没有就归当月。
**月份是纯视图过滤**：不写库、不影响 `date` / `shift` 编辑区、不影响打印与导出（两者始终按当前编辑的那天出件），
刷新页面即回当月（月份不落本地存储）。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 是 | 主键，前端生成形如 `SL-xxxx-XXXX` |
| `date` | string | 是 | 巡检日期 `YYYY-MM-DD`（页面上用日期控件选） |
| `shift` | enum | 是 | 班次：`day` 白班 / `middle` 中班 / `night` 夜班（字典在 `SD.CONFIG.shiftLog.shifts`） |
| `plant` | string | 否 | 厂区，**固定值**，取自 `SD.CONFIG.shiftLog.plant`（默认「缝制中心」） |
| `dept` | string | 否 | 部门，同上，取自 `SD.CONFIG.shiftLog.dept`（默认「安全环保部」） |
| `inspector` | string | 否 | 巡检人员，**页面可手填并存下来**；**打印 / 导出 Excel 时一律留空**（留位现场手签） |
| `checks` | string[] | 是 | 长度固定 **19**，与 `views/shiftLog.js` 的 `ITEMS` 一一对应；每项取值 `''` / `'ok'`（√ 正常）/ `'bad'`（× 异常） |
| `events` | string[] | 否 | 备注里的「当班事件」，一条一条罗列；打印 / 导出时按 `1、…　2、…` 编号输出 |
| `updatedAt` | string | 否 | 最后保存时间（ISO） |

**检查项清单（19 项，顺序即 `checks` 下标）**：建筑 1 / 危化品区 1 / 发泡区域 1 / 作业场所安全管理 9 / 特种设备 1 / 电气 1 / 消防安全设备设施 4 / 其它 1。

`api.listShiftLogs()` / `createShiftLog(payload)` / `updateShiftLog(id,patch)` / `removeShiftLog(id)`
→ 真实接口约定 `GET/POST/PATCH/DELETE /shift-logs`。

**出件**：打印走 A4 横向 + 常规页边距（`@page { size: A4 landscape; margin:19mm 18mm }`，预览时注入、关闭时撤掉；自动缩放到刚好一页）；
导出走 `components/xlsxWriter.js` 真 .xlsx，文件名 `安全巡检交接班记录-2026-10-25-白班.xlsx`。
★ 2026-10-25：出件**列宽照原表**（「检查内容」列加宽到 78 让最长内容一行放下）、
★ 2026-11-04：序号列 4.41→6.5、备注列 34.08→40（按用户要求加宽，见下「列宽」条）、**行高照原表**（标题 27 /
抬头 22 / 表头 30.5 / 表尾 17.5，明细行不锁高、随内容自动撑开不截断）、**备注单元格 wrapText 打开**
（一条一行，编号 `1、` `2、`），并写入 `pageSetup orientation=portrait` + `pageSetUpPr fitToPage`，
打印时缩放到一页，内容不会漏到第二页。
★ 2026-10-25（行高）：明细行 **24pt**（与保存页那份文件一致），其余行 30/27/22/30.5/17.5pt 不变。
★ 2026-10-25（打印）：打印预览的缩放用 `zoom` 而非 `transform`（zoom 改布局尺寸，打印分页按缩放后
高度算 → 预览与真打印同一页）；表头独立 `<thead>` 每页重复；明细行 `break-inside:auto` 允许跨页；
`print-only.css` 保留 `.sl-overlay` 并隐藏其余一切（按钮/导航/工具条）。
★ 2026-10-25（列宽）：`COLW = [6.5, 9, 78, 5.66, 40]`（★ 2026-11-04 序号 4.41→6.5、备注 34.08→40）—— 「检查内容」列由原表 69.75 加宽到 78，
最长的一条（74 个单位）一行正好放下，19 行全部 20.5pt 不加高；巡检人员后留约 9 个全角字宽的手签空位。
★ 2026-10-25（页面）：`page` 增加 `margins`（英寸），不传时用常规页边距 0.7/0.75/0.3；
交接班记录为 **A4 横向 + 常规页边距 + fitToPage 1×1**。
★ 2026-10-25：出件与原表**逐格一致** —— 24 行 5 列（第 1 行空行放左上角标识）、
合并区 `A2:E2 / A3:C3 / B8:B16 / B19:B22 / E5:E23 / A24:E24`、列宽、行高（30/27/22/30.5/20.5·36/17.5）、
表尾注（含 4 个前导空格、11pt、无边框）全部照抄；`sheet.image` 把 `assets/js/brandLogo.js` 的
base64 解成 PNG 嵌进 `xl/media/image1.png` + `xl/drawings/drawing1.xml`（oneCellAnchor 钉 A1，165×30px）。
★ 2026-10-25（逐边边框）：`border` 除 `true`（四边细线）外还接受对象 `{l,r,t,b}`，
值 `'m'`=medium、`'t'`=thin、缺省=不画该边。交接班记录照原表复刻：
外框 medium、内线 thin、「检查内容」列（C）没有左右竖线、抬头行只有 A:C 有下边框、标题/表尾行无框。
★ 2026-10-25（合并吞格）：某行前面的格子带 `mergeAcross` 时，后面的格子**必须显式写 `cell.col`**，
否则会按顺序落到被合并掉的列上、内容被一口吃掉（交接班抬头行的「班次 / 日期」就这么丢过）。
`xlsxWriter` 现支持 `cell.col`（0 起），合并范围按该格自己的列位计算。
★ 2026-10-25：**19 个明细行每行必须占满 A~E 五格**（被纵向合并掉的列补 `{v:'',border:true}` 占位格），
否则 xlsxWriter 按顺序落格会让第 2 组起整体左移一格、右侧缺边框；明细行行高按内容行数放宽（20.5 / 36pt），
长检查内容不会被截；标题行与抬头行**无边框、居中**。

---

## 9.6 violations —— 安全违章考核单（★ 2026-11-04 新增）

**一张单 = 一次现场违章**（不做状态机，登记即生效；改错直接编辑）。
编号 `FZKH-001`（前缀 FZKH · 不带年份 · 3 位序号 · 同类型内唯一，规则在 `config.codeRules.violation`）。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 是 | 主键，前端生成形如 `VK-xxxx-XXXX` |
| `code` | string | 是 | 编号 `FZKH-001`；新增默认顺延、可手改；空 / 格式 / 同类重复会被拒 |
| `date` | string | 是 | 违章日期 `YYYY-MM-DD`；**列表的「全年 / 时间范围」筛选按它算** |
| `applicant` | string | 是 | 申请人（登记人） |
| `employee` | string | 是 | 违章员工 |
| `empNo` | string | 是 | 工号 |
| `dept` | string | 是 | 部门 |
| `leader` | string | 是 | 部门负责人 |
| `content` | string | 是 | 违章内容（时间 / 地点 / 具体行为 / 违反的规定） |
| `assessment` | object | 否 | **考核情况**（★ 2026-11-05）：`{ picks: ['处罚','保证书','其它'], other: '口头教育' }`。
`picks` 可多选，取值限于 处罚 / 保证书 / 其它；`other` 是勾「其它」时的手写说明，**与 picks 分开存**，
避免把「其它」里写的内容当成新选项。勾了「其它」却没写说明，保存时会被拒 |
| `photos` | string[] | 否 | 现场照片 dataURL，最多 6 张，上传时压到宽 1000px；列表点编号看大图 |
| `remark` | string | 否 | 备注（处理跟进、整改情况等） |
| `createdAt` / `updatedAt` | string | 否 | `YYYY-MM-DD HH:mm`，前端写入 |

**接口**：`GET/POST /violations`、`PATCH/DELETE /violations/{id}`
（mock 下对应 `SD.api.listViolations / createViolation / updateViolation / removeViolation`，集合名 `violations`）。

**列表**：默认展示**今年全年**（`date` 落在今年 01-01 ~ 12-31），可切年份、也可自定起止日期；
年份 / 区间只是视图过滤，不改数据、不影响接口。

**考核情况的展示**：列表「考核情况」列按 `picks` 逐项渲染成小标签（处罚 = 红、保证书 = 蓝、其它 = 灰），
勾了「其它」时标签写成「其它：口头教育」。搜索框会一并匹配标签文本与 `other` 里的说明，
所以搜「保证书」或「停工培训」都能找到这一条。

## 10. 权限控制（auth.js，可选对接后端）

- `SD.auth.can(perm)` 是唯一权限判定入口。
- **★ 2026-10-25 起默认受限**：打开页面即 `restricted`，解锁状态存 **sessionStorage**（只对本次
  打开有效，关掉再进回到受限）；切到 `safety_officer` 必须输入**六位安全员密码**（默认 `123456`，
  本机 localStorage 只存加盐摘要，不存明文）。
- 五种能力点：`data.read`（浏览，受限也有）/ `data.write`（增删改）/ `data.export`（导出出件，**2026-11-10 新增**）/ `special.view`（特种作业）/ `settings.write`（导入 / 清空 / 改密码）。
- 路由表 `router.ROUTES` 中特种作业相关条目声明 `perm:'special.view'`。
- `app.refreshAll` 在中央统一门禁：路由声明了 `perm` 且 `auth.can(perm)` 为 false → 渲染「无权限」占位页。
- 另有**写操作兜底拦截** `app.js → installWriteGuard()`：受限态下点新增 / 编辑 / 删除 / 保存一类
  按钮直接拦下并提示输密码。
- **★ 2026-11-10 起「打印」与「导出」分开**：受限用户**只能查看与打印**，导出全部锁定。
  - 判定入口 `SD.auth.canExport()`（= `can('data.export')`），提示文案唯一口径 `SD.auth.DENY_EXPORT_MSG`。
  - 三层防护：① 按钮 `is-locked` + 禁用（模块内导出按钮）；② `app.js → installExportGuard()`
    捕获阶段拦下所有 `[data-export]` 元素；③ 导出函数入口 + `xlsxWriter.download` /
    `docxWriter.download` 两个下载落点再判一次。
  - 收紧范围（8 处）：顶栏齿轮「导出备份 JSON」（保留可点 → 先弹密码框，与「导入」一致）、
    台账「导出 Excel」（设备人员 / 特种人员）、日报 / 周报「生成 Excel」、交接班「导出 Excel（白夜班）」、
    隐患通知书「保存为 Word」、作业票照片「保存为 Word」、培训「下载照片」（水印弹窗，含原图 / 批量）、
    台账「下载导入模板」。
  - **打印不在收紧范围**：纸质留痕不产生可编辑文件，受限仍可打印通知书 / 交接班表 / 照片页。
  - 顺带补的两个写口子：通知书 / 照片页弹窗里的「上传照片」在受限下置灰（`updateHazard` /
    `updateWorkPermit` 会改台账，属写操作）。
- **清空数据专用密码（2026-10-25 新增）**：`settings.write` 之外再加一道
  —— `SD.auth.verifyPurge(pin)`（默认 `888888`，独立存储 `sd_auth_purge`，与登录密码互不影响；
  `setPurgePin` / `hasPurgePin` 配套）。`app.js → openPurgeDialog()` 里密码错**直接 return 错误串**，
  弹窗不关、`SD.store.reset()` 不调用 → 数据一条不动。
- **空闲自动退回受限（2026-10-25 新增）**：`Config.security.idleLockMin`（默认 30 分钟，0 = 关闭）；
  `app.js → startIdleWatch()` 监听 mousedown / pointerdown / touchstart / keydown / wheel / scroll 刷新时间戳，
  每 15s `checkIdle()` 一次，超时且当前是 `safety_officer` → `auth.lock()` + 重绘 + toast。
  切回标签页时补判一次（后台定时器被节流）。自检入口：`SD.app.idle.check() / touch() / ms()`。
- 真实系统：把 `auth.ROLES` 的 `perms` 换成后端下发的权限集即可，门禁逻辑不变。

---

## 11. 派生字段一览（前端计算，后端无需返回）

| 字段 | 来源 | 说明 |
|---|---|---|
| `_daysLeft` | `diffDays(dueDate, today)` | 剩余天数，负数为已超期 |
| `_overdue` / `_overdueDays` | 逾期口径 | 是否逾期 / 逾期天数 |
| `_soon` | 临期口径 | 剩余 ≤ `soonDays`（默认 3 天） |
| `_delayedTrack` | `status==='delayed' \|\| delayCount>0` | 是否进入延期跟进 |
| `_open` | `status !== 'closed'` | 是否未闭环 |
| `_sevName` / `_sevCls` | severity 字典 | 等级显示名 / 样式类 |
| `_stName` / `_statutoryName` | 字典 | 状态名 / 法定口径名 |
| `_level` / `_levelName` / `_levelCls` | 证书 | 预警档位 / 显示名 / 样式类 |

全部派生逻辑集中在 `assets/js/metrics.js`，改口径只改这一个文件。

---

## 12. keyWorks —— 安全重要工作看板（★ 2026-11-10 新增）

> 定位：**手录的重点工作**，不是法定台账。与「待办任务」分工明确 ——
> 待办任务是从隐患 / 巡检 / 作业票 / 培训**自动推导**出来的只读清单；
> 本看板是安全员自己列的「本月要盯的几件事」，四列状态由人推。
> 两者互不生成、互不覆盖。
>
> 存储：`localStorage` 的 `sd_safety_desk_v1` → `data.keyWorks`（已进 `store.DATA_KEYS`，
> 因此**进备份、进导入白名单、进跨机迁移对数**）。无单据编号，不走 `code.js` 编号中枢。

### 字段

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 是 | 本地生成（`KW…`），导入时缺省自动补 |
| `title` | string | 是 | 事项名称，≤ 80 字；卡片最多显示 3 行（超出省略） |
| `owner` | string | 否 | 负责人，空值落库为「未指派」 |
| `cat` | string | 否 | 事项类别，自由文本（如 隐患整改 / 设备设施 / 教育培训 / 应急演练 / 人员资质 / 消防管理 / 制度台账），空值落库为「未分类」 |
| `pri` | enum | 否 | `high` 高 / `mid` 中（默认）/ `low` 低；决定卡片左条颜色与列内排序 |
| `status` | enum | 否 | `todo` 待开始（默认）/ `doing` 进行中 / `review` 待验收 / `done` 已完成 |
| `due` | `YYYY-MM-DD` | 否 | 截止日期。空值显示「未设截止」，不参与逾期统计 |
| `note` | string | 否 | 备注 / 依据 / 验收标准，≤ 200 字；卡片最多显示 2 行 |
| `createdAt` | ISO string | 否 | 创建时间，用于同优先级同截止日时的排序 |

### 状态机

```
待开始 todo ──▶ 进行中 doing ──▶ 待验收 review ──▶ 已完成 done
```

- **单向前进**：卡片底部「推进到「X」→」只前进不后退；拖拽换列可以直接落到任意列（含往回拖）。
- 走到 `done` 即「已闭环」，卡片弱化显示，不再提供推进按钮。
- 状态改的是这条记录本身，不做流转留痕（它不是法定材料，不需要 audit trail）。
- **★ 2026-11-11：受限模式不允许推进状态**（用户要求）。推进与拖拽两条路一起锁：
  - 渲染：推进按钮 `disabled` + `is-locked`（虚线边 + 灰底）+ 小锁图标 + title；卡片 `draggable="false"`；
    看板上方常驻一条说明条（`.kw-lock`），副标题改「受限模式下只能看，不能推进」；
  - 事件：`click` 命中 `[data-act="advance"]` 时先判权限（兜「强解 disabled」），`dragstart` 直接 `preventDefault`；
  - 函数入口：`advance()` / `moveTo()` 各判一次 `SD.auth.can('data.write')`，程序内直调也改不动。

### 统计口径（看板顶部统计条）

| 指标 | 口径 |
|---|---|
| 重点事项 | `keyWorks.length`（全部，不受筛选影响） |
| 进行中 | `status === 'doing'` |
| 已逾期 | `status !== 'done'` 且 `due` 早于今天 |
| 完成率 | `done / 总数`，四舍五入到整数百分比（总数为 0 时显示 0%） |

> 统计条**始终按全量计算**，筛选只影响下方四列显示的卡片 ——
> 否则一筛选数字就变，容易误判「是不是数据没了」。

### 语义函数（`dataSource.js`）

| 函数 | 说明 |
|---|---|
| `listKeyWorks()` | 列表（本地读 `data.keyWorks`） |
| `createKeyWork(payload)` | 新增，id 前缀 `KW` |
| `updateKeyWork(id, patch)` | 局部更新（推进 / 编辑都走它） |
| `removeKeyWork(id)` | 物理删除（确认框二次确认后调用） |
