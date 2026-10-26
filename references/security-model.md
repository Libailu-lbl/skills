# 安全模型（角色 / 密码 / 空闲锁）

> ⚠️ 先说清楚：**这是本机前端门禁，不是安全边界**。
> 它能防误操作、防「顺手改一下」、防「借别人电脑删库」，但挡不住会开 F12 的人。
> 真系统请把权限判定放到后端 —— 架构里 `can(perm)` 的调用点一处不用改。

---

## 一、两个角色

| 角色 | 能做什么 | 不能做什么 |
|---|---|---|
| `restricted` 受限（默认） | 查看、打印、导出 Excel/Word、导出备份 | 新增/修改/删除、进特种作业、导入、清空、改密码 |
| `safety_officer` 安全员 | 全部 | — |

**默认进来就是受限** —— 这是刻意的：绝大多数时间用户只是「看一眼、打一张」，不该一直握着写权限。

---

## 二、能力点（perm）

```js
var PERMS = {
  safety_officer: ['data.read', 'data.write', 'special.view', 'settings.write'],
  restricted:     ['data.read']
};
```

| perm | 含义 |
|---|---|
| `data.read` | 浏览（受限也有） |
| `data.write` | 增删改 |
| `special.view` | 特种作业模块 |
| `settings.write` | 导入 / 清空 / 改密码 |

三道闸：

1. **导航层**：路由声明 `perm`，无权限显示锁；点进去渲染「无权限」占位页（`refreshAll` 里统一判，不在每个 view 里判）
2. **按钮层**：`if (!SD.auth.can('data.write')) 拦下 + 提示`
3. **兜底层**：全局捕获点击，受限态拦下 `.btn.primary / [data-act=del] / [data-write]` 一类选择器 —— 防止有人漏写按钮级判断

---

## 三、登录密码

| 项 | 做法 |
|---|---|
| 位数 | 6 位数字（手机数字键盘友好） |
| 存储 | `localStorage` 存 `{salt, hash}`，**不存明文** |
| 摘要 | 多轮 FNV-1a + 每次随机盐（纯前端只求不存明文，不是密码学强度） |
| 生效范围 | **sessionStorage**：只对本次打开有效，关掉浏览器再进回到受限 |
| 出厂值 | `123456`（示例）/ `123456`（骨架）—— 页面会提示「还在用默认密码」，建议首次就改 |
| 忘记 | **没有找回入口**。只能清站点数据（会丢业务数据，所以提示先导出备份） |

```js
SD.auth.unlock('123456');       // {ok:true} 并切到安全员
SD.auth.current();              // 'safety_officer' | 'restricted'
SD.auth.can('data.write');      // boolean
SD.auth.lock();                 // 立刻退回受限
```

---

## 四、清空专用密码（破坏性操作）

「清空数据」不可撤销，所以除了安全员权限，还要再过一道**专用密码**：

| 项 | 做法 |
|---|---|
| 出厂值 | `888888`（`config.security.defaultPurgePin`） |
| 存储 | 独立 key（`sd_auth_purge`），与登录密码**各自的盐与摘要**，互不影响 |
| 输错 | **不执行**：弹窗不关、顶部红字「专用密码不正确：已阻止清空，数据没有任何改动」，`store.reset()` 压根不调用 |
| 位数不对 | 同样拦下（「请输入 6 位数字的专用密码」） |
| 修改 | 「密码设置」弹窗下半部分可单独改；与登录密码相同 / 两次不一致 都拒 |

实现要点：dialog 的 `onOk` **返回字符串即视为校验失败**（弹窗不关、红字提示），所以校验就是一行 `if (!verifyPurge(v)) return '专用密码不正确…'`。

---

## 五、空闲自动锁权

复核完忘了收权，是最常见的真实漏洞。

```js
// app.js
var IDLE = { last: 0, timer: null };
function idleMs() { var m = Number(SD.CONFIG.security.idleLockMin); return m > 0 ? m * 60000 : 0; }
function touch() { IDLE.last = Date.now(); }
function checkIdle() {
  if (!idleMs()) return false;                                   // 0 = 关闭
  if (SD.auth.current() !== 'safety_officer') { touch(); return false; }  // 受限态不用锁
  if (Date.now() - IDLE.last < idleMs()) return false;
  SD.auth.lock(); refreshAll();
  U.toast('已连续 30 分钟无操作，自动退回受限模式', 'err');
  return true;
}
```

- 计时口径：`mousedown / pointerdown / touchstart / keydown / wheel / scroll` 任一操作都重新计时
- 每 15s 检查一次；**切回标签页时立刻补判一次**（后台标签页的定时器会被浏览器节流）
- 阈值：`config.security.idleLockMin`（默认 30，0 = 关闭）
- 自检入口：`SD.app.idle.check() / touch() / ms()` —— 测试里把阈值临时改成 0.01 分钟（0.6s），不用真等半小时

---

## 六、写操作兜底拦截

```js
var WRITE_SEL = '.btn.primary, .btn.danger, [data-act="edit"], [data-act="del"], [data-write]';
document.addEventListener('click', function (e) {
  if (SD.auth.can('data.write')) return;
  var hit = e.target.closest && e.target.closest(WRITE_SEL);
  if (!hit) return;
  if (hit.closest('[data-auth]')) return;      // 密码弹窗自身不受限
  if (hit.closest('.gear-menu')) return;       // 菜单项各自处理
  e.preventDefault(); e.stopPropagation();
  U.toast('受限模式：该操作需要安全员权限', 'err');
}, true);   // ← 捕获阶段
```

要点：用**捕获阶段**（`true`）才能抢在业务 handler 之前拦下；两个白名单（密码弹窗、设置菜单）必须有，否则连「输密码」都点不动。

---

## 七、数据边界

| 项 | 说明 |
|---|---|
| 数据在哪 | 只在本机浏览器（localStorage + IndexedDB），不上传任何服务器 |
| 备份 | 导出 JSON 即明文，**别直接发到群里**（里面可能有人名/电话） |
| 部署 | 部署成公网链接后页面公开可访问，**不要预填真实隐私数据** |
| 密码 | 只防误触；localStorage 里的数据本身没加密，能开 F12 的人能看到 |
| 示例数据 | 仓库里的名单全部是生成的假数据，字段结构真实、内容虚构 |

---

## 八、自检该测什么

- 默认是受限；受限态点写操作被拦（且**不弹**业务弹窗）
- 错密码不放行、位数不对不放行、正确密码放行
- 清空：错专用密码 → 数据条数不变 + 有明确提示；对 → 真的清空
- 专用密码不能与登录密码相同
- 空闲：默认 30 分钟；超时锁回受限；有操作重新计时；受限态不重复锁；配 0 关闭
- 退回受限后 `can('data.write')` 立刻为 false
