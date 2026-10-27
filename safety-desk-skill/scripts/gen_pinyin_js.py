# -*- coding: utf-8 -*-
"""生成 assets/js/pinyin.js（汉字 → 拼音首字母表）

为什么需要它：
    危险作业票编号前缀 = FZ + 作业类型名前两个汉字的拼音首字母（吊装作业 → FZDZ）。
    工作台要求零外部依赖、断网可用，所以字表必须内嵌；又不能让 JS 里存全拼
    （体积大且用不上），只保留「单字母」。

用法：
    pip install pypinyin
    python scripts/gen_pinyin_js.py    # 覆盖写两个示例的 assets/js/pinyin.js

生成规则：
    · 取 GB2312 一、二级汉字（6763 字），逐字取拼音首字母（pypinyin FIRST_LETTER）
    · 按 A~Z 分组，组内保持 GB2312 顺序（便于 diff 与人工核查）
    · 数字、标点、GB2312 外的生僻字不收录 → 运行时 initial() 返回 ''
      （取不到时由 code.js 的 allocTail() 兜底，见该文件「动态前缀」段）

注意：换用别的数据源时，务必回归
    node tests/smoke_permitcode.js —— 八类内置类型的首字母必须仍是 DH/SX/MB/GC/DZ/LS/DT/DL。
"""
import io
import os
import string

from pypinyin import Style, pinyin

ROOT = os.path.dirname(os.path.abspath(__file__))
# 仓库内布局：scripts/ 的上一级是 skill 根，两个示例在 examples/ 下
TARGETS = [
    os.path.join(ROOT, '..', 'examples', 'safety-desk', 'assets', 'js', 'pinyin.js'),
    os.path.join(ROOT, '..', 'examples', 'safety-desk-blank', 'assets', 'js', 'pinyin.js'),
]

HEAD = '''/* =========================================================
   pinyin.js — 汉字拼音首字母表（零依赖 · 离线可用）
   ────────────────────────────────────────────────────────
   用途：
     危险作业票编号要按「作业类型名称前两个汉字的拼音首字母」生成前缀，
     例如 吊装作业 → DZ（FZ + DZ = FZDZ），所以需要一个「汉字 → 首字母」的
     本地字典。页面要求零外部依赖、断网可用，不能调在线拼音接口，
     因此在文件里内置一份字表，运行时建一次 Map 缓存。

   数据来源：
     GB2312 一、二级汉字（6763 字）逐字取拼音首字母，由 pypinyin 生成后
     按字母分组固化成下面的 GROUPS。字表只含「汉字 → 单字母」，
     不含声调/全拼，体积约 20KB，只在首次调用时构建索引。
     重新生成：safety-desk_dev/gen_pinyin_js.py

   ★ 局限（写在这里，免得以后踩坑）：
     · GB2312 之外的生僻字（如部分人名用字）不在表里 → initial() 返回 ''
       （调用方需按「取不到首字母」的兜底逻辑处理，见 code.js 的 allocTail()）
     · 多音字一律取 pypinyin 的默认读音（如「重」取 chóng 的 C），
       作业类型名里极少出现，遇到就在下面的 TYPE_FIX 里点名修正
     · 数字、标点、空格不产生字母；拉丁字母原样转大写（LOTO → LO）

   对外 API（SD.pinyin）：
     initial(ch)        → 'D' | ''（单字；非汉字返回字母或空）
     initials(text, n)  → 'DZ'（取前 n 个能出字母的字符，n 省略 = 全部）
     size()             → 字表字数（自检用）
   ========================================================= */
window.SD = window.SD || {};

SD.pinyin = (function () {
  /* 按首字母分组固化（同组内为 GB2312 顺序，不含 I / U / V 声母） */
  var GROUPS = {
'''

TAIL = '''
  };

  /* 「一词多音 / 行业惯读」点名修正：键为整个作业类型名，值为要覆盖的前缀。
     例：'重工吊装' 若被读成 chóng，可在这里写 { '重工吊装': 'ZC' }；
     目前 GB2312 常用字无此问题，保留空表供以后按需补。 */
  var TYPE_FIX = {};

  var MAP = null;

  function build() {
    MAP = {};
    for (var k in GROUPS) {
      if (!Object.prototype.hasOwnProperty.call(GROUPS, k)) continue;
      var s = GROUPS[k];
      for (var i = 0; i < s.length; i++) MAP[s.charAt(i)] = k;
    }
  }

  /** 单字 → 首字母（大写）；汉字查表，拉丁字母原样，其它返回 '' */
  function initial(ch) {
    var c = String(ch || '');
    if (!c) return '';
    if (/[A-Za-z]/.test(c)) return c.toUpperCase();
    if (!MAP) build();
    return MAP[c] || '';
  }

  /** 取一段文本的前 n 个首字母（n 省略 = 全部；跳过取不到字母的字符） */
  function initials(text, n) {
    var s = String(text == null ? '' : text), out = '';
    for (var i = 0; i < s.length; i++) {
      var L = initial(s.charAt(i));
      if (!L) continue;
      out += L.charAt(0);
      if (n != null && out.length >= n) break;
    }
    return out;
  }

  /** 整名覆盖（TYPE_FIX 优先于逐字查表） */
  function fixed(name, n) {
    var k = String(name == null ? '' : name);
    if (TYPE_FIX[k]) {
      var v = TYPE_FIX[k];
      return (n != null) ? v.slice(0, n) : v;
    }
    return null;
  }

  function initialsOf(name, n) {
    var f = fixed(name, n);
    return f != null ? f : initials(name, n);
  }

  function size() {
    if (!MAP) build();
    var n = 0;
    for (var k in MAP) if (Object.prototype.hasOwnProperty.call(MAP, k)) n++;
    return n;
  }

  return { initial: initial, initials: initialsOf, size: size, GROUPS: GROUPS };
})();
'''


def build_groups():
    g = {}
    for lo, hi in ((0xB0, 0xD7), (0xD8, 0xF7)):
        for b1 in range(lo, hi + 1):
            for b2 in range(0xA1, 0xFF):
                try:
                    ch = bytes([b1, b2]).decode('gb2312')
                except Exception:
                    continue
                if not ('\u4e00' <= ch <= '\u9fa5'):
                    continue
                r = pinyin(ch, style=Style.FIRST_LETTER, errors='ignore')
                if not r or not r[0] or not r[0][0]:
                    continue
                letter = r[0][0][0].upper()
                if letter not in string.ascii_uppercase:
                    continue
                g.setdefault(letter, []).append(ch)
    return g


def main():
    g = build_groups()
    lines = ["    %s: '%s'" % (k, ''.join(g[k])) for k in sorted(g)]
    src = HEAD + ',\n'.join(lines) + TAIL
    total = sum(len(v) for v in g.values())
    for p in TARGETS:
        io.open(p, 'w', encoding='utf-8', newline='').write(src)
        print('written %s（%d 字 / %d 组）' % (p, total, len(g)))


if __name__ == '__main__':
    main()
