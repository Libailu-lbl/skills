#!/usr/bin/env bash
# =========================================================
# run_all_tests.sh — 一键跑完空白工作台的全量冒烟自检
# ---------------------------------------------------------
# 用法：
#   bash scripts/run_all_tests.sh                 # 默认端口 8127
#   bash scripts/run_all_tests.sh 9127            # 自定义端口（端口被占用时用）
#
# 前置：在 tests/ 下执行过 npm install（需要 jsdom 与 fake-indexeddb）
# 说明：会自己起一个静态服务（tests/serve.js），跑完自动关掉。
#       ★ 2026-11-05 起仓库只保留空白版：示例数据版已从本仓库移除，
#         原先只跑示例版的套件（smoke / smoke_code / smoke_crud / smoke_ops /
#         smoke_photos / smoke_print / smoke_reports / smoke_settings /
#         smoke_special / smoke_training / smoke_trend）一并删除。
# =========================================================
set -u
cd "$(dirname "$0")/.." || exit 1
ROOT="$(pwd)"
P_BLANK="${1:-8127}"

# 依赖：优先用 tests/node_modules；也允许通过 NODE_PATH 指向已有的 node_modules（CI / 复用场景）
if [ ! -d "tests/node_modules" ] && [ -z "${NODE_PATH:-}" ]; then
  echo "缺少依赖：请先在 tests/ 目录执行  npm install"
  exit 1
fi

cleanup() {
  [ -n "${PID1:-}" ] && kill "$PID1" 2>/dev/null
}
trap cleanup EXIT

node tests/serve.js "$P_BLANK" examples/safety-desk-blank >/dev/null 2>&1 & PID1=$!
sleep 2

# 三种汇总格式都要认（历史套件写法不统一）：
#   ① 结果：通过 67 / 失败 0
#   ② 结果：39 通过 / 0 失败
#   ③ 通过 133 项，失败 0 项
read_result() {
  local out="$1" pass fail
  pass=$(printf '%s' "$out" | grep -oE "通过 [0-9]+|[0-9]+ 通过" | tail -1 | grep -oE "[0-9]+")
  fail=$(printf '%s' "$out" | grep -oE "失败 [0-9]+|[0-9]+ 失败" | tail -1 | grep -oE "[0-9]+")
  if [ -z "$fail" ]; then echo "0 ERR"; else echo "${pass:-0} $fail"; fi
}

run_sets() {
  local base="$1"; shift
  local tot=0 bad=0
  for f in "$@"; do
    local out; out=$(node "tests/$f.js" "$base" 2>&1)
    read -r pass fail <<< "$(read_result "$out")"
    if [ "$fail" = "ERR" ]; then
      printf '  %-22s ERR\n' "$f"
      bad=$((bad+1))
    else
      printf '  %-22s 通过 %-4s 失败 %s\n' "$f" "$pass" "$fail"
      tot=$((tot+pass)); bad=$((bad+fail))
    fi
  done
  echo "  小计：通过 $tot / 失败 $bad"
  echo "$bad"
}

echo "== 空白版（单机空白） http://127.0.0.1:$P_BLANK =="
OUT=$(run_sets "http://127.0.0.1:$P_BLANK/index.html" \
  smoke_blank smoke_nav smoke_keyworks smoke_inspection_photos smoke_permitcode smoke_device smoke_excelio smoke_shift \
  smoke_shift_import smoke_shift_month smoke_security smoke_photo smoke_ocr smoke_vault \
  smoke_monthview smoke_yearview smoke_violation smoke_export_gate smoke_notice_docs)
echo "$OUT" | sed '$d'
BAD=$(printf '%s' "$OUT" | tail -1)

echo
if [ "${BAD:-1}" = "0" ]; then
  echo "全部通过 ✅"
  exit 0
else
  echo "有失败项 ❌（失败 $BAD）"
  exit 1
fi
