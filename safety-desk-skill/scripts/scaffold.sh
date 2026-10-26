#!/usr/bin/env bash
# =========================================================
# scaffold.sh — 从最小骨架生成一个新工作台
# 用法： bash scripts/scaffold.sh <目录名> ["工作台名称"]
# 例：   bash scripts/scaffold.sh team-check "班组点检台"
# =========================================================
set -eu
cd "$(dirname "$0")/.." || exit 1

DIR="${1:-}"
NAME="${2:-我的工作台}"
if [ -z "$DIR" ]; then
  echo "用法: bash scripts/scaffold.sh <目录名> [\"工作台名称\"]"
  exit 1
fi
if [ -e "$DIR" ]; then
  echo "目录已存在：$DIR（换个名字，或先删掉它）"
  exit 1
fi

cp -r assets/skeleton "$DIR"

# 生成 storageKey：wb_<目录名，非字母数字换下划线>_v1
KEY="wb_$(printf '%s' "$DIR" | tr -c 'A-Za-z0-9' '_')_v1"

# 改 config.js 里的名称与 storageKey（用 python 安全替换，兼容中文）
python - "$DIR" "$NAME" "$KEY" <<'PY'
import io, sys
d, name, key = sys.argv[1], sys.argv[2], sys.argv[3]
p = d + '/assets/js/config.js'
s = io.open(p, encoding='utf-8').read()
s = s.replace("appName: '我的工作台',", "appName: '%s'," % name, 1)
s = s.replace("storageKey: 'wb_my_desk_v1',", "storageKey: '%s'," % key, 1)
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('  appName    = ' + name)
print('  storageKey = ' + key)
PY

echo ""
echo "已生成：$DIR/"
echo ""
echo "下一步："
echo "  1) node tests/serve.js 8132 $DIR"
echo "  2) 浏览器打开 http://127.0.0.1:8132/index.html（初始受限模式，密码 123456）"
echo "  3) 改成你自己的业务：见 docs/quickstart.md 第 3 步（加模块）"
echo "  4) 跑自检（需先在 tests/ 里 npm install）："
echo "     node tests/smoke_skeleton.js http://127.0.0.1:8132/index.html"
