# skills

个人 AI Skill 合集。**每个 skill 一个子目录**，自带 `SKILL.md`（方法论）+ 可运行示例 + 自检脚本，克隆下来就能跑。

| Skill | 一句话 | 版本 |
|---|---|---|
| [`safety-desk-skill`](safety-desk-skill/) | 离线优先的个人业务工作台：多模块台账 + A4 打印 / Excel / Word 出件 + 角色权限，双击 `index.html` 即用 | v1.0.0 |

---

## 怎么用

### 只想跑起来看看

```bash
git clone https://github.com/Libailu-lbl/skills.git
cd skills/safety-desk-skill
node tests/serve.js 8124 examples/safety-desk      # 需要 Node 18+
# 浏览器打开 http://127.0.0.1:8124/index.html
```

也可以直接双击 `safety-desk-skill/examples/safety-desk/index.html`（`file://` 可用，无需服务）。
初始是**受限模式**，点右上角输入 `123456` 解锁。

### 想拿它搭自己的

```bash
cd safety-desk-skill
bash scripts/scaffold.sh my-desk "我的工作台"
node tests/serve.js 8132 my-desk
```

### 想读方法论

- 先看 [`safety-desk-skill/SKILL.md`](safety-desk-skill/SKILL.md) —— 12 步流程、技术选型、可配置参数
- 卡住了看 [`references/pitfalls.md`](safety-desk-skill/references/pitfalls.md) —— 22 条实测踩坑（打印、Excel、权限、测试）
- 每个 skill 的 `README.md` 是它自己的总览

---

## 约定

- **零外链**：不引 CDN / 外部字体 / 图表库，断网可用
- **自包含**：每个 skill 目录独立可跑，互不依赖
- **自检**：每个 skill 都带 `tests/`，改完必须全绿再提交
- **不含真实数据**：示例里的人名、证件号、手机号均为生成值

## 许可

各 skill 单独声明，默认 [MIT](safety-desk-skill/LICENSE)。
