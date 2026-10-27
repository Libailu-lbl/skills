# 数据字段定义（Data Schema）

> 用途：前端与后端对齐的唯一依据。字段名一律 `lowerCamelCase`，日期一律 `YYYY-MM-DD` 字符串，
> 时间戳字段（如 `flow[].at`）为 `YYYY-MM-DD HH:mm` 字符串，避免时区歧义。
>
> 约定：以下划线 `_` 开头的字段（如 `_overdue`、`_daysLeft`）**不是接口字段**，
> 是前端计算层 `metrics.js` 派生出来的，后端无需返回。

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

- **表单**：新增时预填 `SD.code.next(类型)`（可改可清空），placeholder 给该类示例（如隐患 `FZYH-0000003`）；
  编辑带出原号；保存时不通过不关窗，错误显示在弹窗顶部。
- **规则表**：`config.js` 的 `SD.CONFIG.codeRules`，按单据类型给 `prefix / label / withYear /
  seqLen / seqMin / seqMax / allowNoYear / allowLegacy / pattern`——**既做格式校验，也驱动默认值顺延生成**。
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

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 是 | 主键 |
| `code` | string | 是 | 任务编号，如 `FZXJ-2026-001`；**2026-10-21 起用户手动必填、2026-10-24 起各类分号**（空 / 同类型重复会被拒） |
| `planName` | string | 是 | 计划名称 |
| `type` | enum | 是 | `日常巡检 / 专项检查 / 季节性检查 / 节假日检查 / 综合巡查` |
| `area` | string | 是 | 巡检区域 |
| `dept` | string | 否 | 责任部门 |
| `executor` | string | 是 | 执行人 |
| `scheduledDate` | date | 是 | 计划日期（**判定「本周」的依据**，周一起算） |
| `status` | enum | 是 | `planned` 待执行 / `done` 已完成 / `rescheduled` 已改期 / `cancelled` 已取消 |
| `completedAt` | date \| null | 否 | 完成日期 |
| `rescheduleTo` | date \| null | 否 | 改期后的日期 |
| `reason` | string | 否 | 改期 / 取消原因（必填，留痕） |
| `hazardCount` | number | 否 | 本次发现的隐患数，默认 0 |
| `remark` | string | 否 | 备注 |
| `record` | object \| null | 否 | 执行记录，仅 `done` 时有值 |
| `photos[]` | string[] | 否 | 巡查照片（dataURL 数组），最多 6 张，上传时压到宽 1000px。**新增 / 编辑弹窗底部上传**（2026-10-24 新增）；台账**不单列照片栏**，点「区域」即看大图（有照片时区域名变主色并挂「照片 N」角标，无照片时点击只提示）；执行记录弹窗里也有「查看 N 张照片」按铭 |

### record —— 执行记录

| 字段 | 类型 | 说明 |
|---|---|---|
| `findings` | string | 现场情况 / 发现 |
| `signedBy` | string | 现场签字人 |
| `signedAt` | string | 签字时间 `YYYY-MM-DD HH:mm` |

### 完成率口径

- 分母 = 本周（`周一 ~ 周日`）内 `scheduledDate` 落在区间、且 `status !== 'cancelled'` 的任务数
- 分子 = 其中 `status === 'done'` 的数量
- **改期不减免**：`rescheduled` 仍留在分母且不算完成 —— 刻意如此，避免改期成为规避手段

---

## 3. training —— 培训计划

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

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 是 | 主键 |
| `code` | string | 是 | 通知编号，如 `FZTG-2026-001`；**2026-10-21 起用户手动必填、2026-10-24 起各类分号**（空 / 同类型重复会被拒） |
| `title` | string | 是 | 标题 |
| `source` | string | 是 | 发布单位 |
| `level` | enum | 是 | `urgent` 紧急 / `important` 重要 / `normal` 普通 |
| `publishAt` | date | 是 | 发布日期 |
| `summary` | string | 否 | 摘要正文 |
| `pinned` | boolean | 否 | 是否置顶（置顶优先，其余按发布时间倒序） |

---

## 6. trend —— 隐患趋势（按月聚合）

| 字段 | 类型 | 说明 |
|---|---|---|
| `ym` | string | 月份 `YYYY-MM` |
| `created` | number | 当月新增隐患数 |
| `closed` | number | 当月闭环隐患数 |

> 前端 `mock.js` 生成近 12 个月；真实接口建议返回最近 12~24 个月。
> 看板上「两条线的差值」即当月净增未闭环量。

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

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 是 | 主键，前端生成形如 `SL-xxxx-XXXX` |
| `date` | string | 是 | 巡检日期 `YYYY-MM-DD`（页面上用日期控件选） |
| `shift` | enum | 是 | 班次：`day` 白班 / `middle` 中班 / `night` 夜班（字典在 `SD.CONFIG.shiftLog.shifts`） |
| `plant` | string | 否 | 厂区，**固定值**，取自 `SD.CONFIG.shiftLog.plant`（默认「缝制中心」），出件时写入 |
| `dept` | string | 否 | 部门，同上，取自 `SD.CONFIG.shiftLog.dept`（默认「安全环保部」） |
| `inspector` | string | 否 | 巡检人员，**页面可手填并存下来**；**打印 / 导出 Excel 时一律留空**（留位现场手签） |
| `checks` | string[] | 是 | 长度固定 **19**，与 `views/shiftLog.js` 的 `ITEMS` 一一对应；每项取值 `''`（未判定）/ `'ok'`（√ 正常）/ `'bad'`（× 异常） |
| `events` | string[] | 否 | 备注里的「当班事件」，一条一条罗列；打印 / 导出时按 `1、…　2、…` 编号输出 |
| `updatedAt` | string | 否 | 最后保存时间（ISO） |

**检查项清单（19 项，顺序即 `checks` 下标）**：建筑 1 / 危化品区 1 / 发泡区域 1 / 作业场所安全管理 9 / 特种设备 1 / 电气 1 / 消防安全设备设施 4 / 其它 1。
改检查项文案改 `views/shiftLog.js → ITEMS`，改厂区 / 部门 / 班次字典改 `config.js → SD.CONFIG.shiftLog`。

**出件**：打印走 A4 横向 + 常规页边距（`@page { size: A4 landscape; margin:19mm 18mm }`，预览时注入、关闭时撤掉；自动缩放到刚好一页）；
导出走 `components/xlsxWriter.js` 真 .xlsx，文件名 `安全巡检交接班记录-2026-10-25-白班.xlsx`。
★ 2026-10-25：出件**列宽照原表**（4.41 / 9 / 78 / 5.66 / 34.08，「检查内容」列加宽到 78 让最长内容一行放下）、**行高照原表**（标题 27 /
抬头 22 / 表头 30.5 / 表尾 17.5，明细行不锁高、随内容自动撑开不截断）、**备注单元格 wrapText 打开**
（一条一行，编号 `1、` `2、`），并写入 `pageSetup orientation=portrait` + `pageSetUpPr fitToPage`，
打印时缩放到一页，内容不会漏到第二页。
★ 2026-10-25（行高）：明细行 **24pt**（与保存页那份文件一致），其余行 30/27/22/30.5/17.5pt 不变。
★ 2026-10-25（打印）：打印预览的缩放用 `zoom` 而非 `transform`（zoom 改布局尺寸，打印分页按缩放后
高度算 → 预览与真打印同一页）；表头独立 `<thead>` 每页重复；明细行 `break-inside:auto` 允许跨页；
`print-only.css` 保留 `.sl-overlay` 并隐藏其余一切（按钮/导航/工具条）。
★ 2026-10-25（列宽）：`COLW = [4.41, 9, 78, 5.66, 34.08]` —— 「检查内容」列由原表 69.75 加宽到 78，
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

## 10. 权限控制（auth.js，可选对接后端）

- `SD.auth.can(perm)` 是唯一权限判定入口。
- **★ 2026-10-25 起默认受限**：打开页面即 `restricted`，解锁状态存 **sessionStorage**（只对本
  次打开有效，关掉再进回到受限）；切到 `safety_officer` 必须输入**六位安全员密码**（默认 `123456`，
  本机 localStorage 只存加盐摘要，不存明文）。
- 四种能力点：`data.read`（浏览，受限也有）/ `data.write`（增删改）/ `special.view`（特种作业）/ `settings.write`（导入 / 清空 / 改密码）。
- 路由表 `router.ROUTES` 中特种作业相关条目声明 `perm:'special.view'`。
- `app.refreshAll` 在中央统一门禁：路由声明了 `perm` 且 `auth.can(perm)` 为 false → 渲染「无权限」占位页。
- 另有**写操作兜底拦截** `app.js → installWriteGuard()`：受限态下点新增 / 编辑 / 删除 / 保存一类
  按钮直接拦下并提示输密码（打印 / 导出不在拦截名单，受限也能出件）。
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
