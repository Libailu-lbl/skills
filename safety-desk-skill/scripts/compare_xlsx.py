#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""compare_xlsx.py — 把导出件和「基线表」逐格比对，用数据说话

用法：
    python scripts/compare_xlsx.py 基线.xlsx 导出件.xlsx

比对项（按「会不会被人一眼看出不一样」排序）：
    1. 合并区        —— 少一个合并，整张表就散
    2. 列宽 / 行高    —— 差 0.5 字符就会折行/截断
    3. 可见边框线条   —— 相邻两格任一边有线即该线可见（只比线条，不比每格 flag）
    4. 字号 / 字体    —— 纸质单据常见「宋体 11pt」
    5. 页面设置       —— 方向 / 纸张 / 页边距 / 是否缩放到一页
    6. 文字内容       —— 忽略基线里的空模板值（只报导出件不该缺的）

依赖：pip install openpyxl
退出码：0 = 全部一致；1 = 有差异
"""
import sys

try:
    import openpyxl
except ImportError:
    sys.exit('需要 openpyxl：pip install openpyxl')


def side(style):
    """边框样式缩写：m=medium t=thin，其它取首字母"""
    if not style:
        return '-'
    return {'medium': 'm', 'thin': 't', 'thick': 'k', 'hair': 'h'}.get(style, style[0])


def load(path):
    wb = openpyxl.load_workbook(path)
    ws = wb.active
    return ws


def outline(ws, max_row, max_col):
    """可见线条：竖向（列之间）/ 横向（行之间）"""
    V = {}
    for r in range(1, max_row + 1):
        for c in range(1, max_col):
            a = ws.cell(row=r, column=c).border
            b = ws.cell(row=r, column=c + 1).border
            V['V%d.%d' % (r, c)] = bool(a.right.style) or bool(b.left.style)
    for r in range(1, max_row):
        for c in range(1, max_col + 1):
            a = ws.cell(row=r, column=c).border
            b = ws.cell(row=r + 1, column=c).border
            V['H%d.%d' % (r, c)] = bool(a.bottom.style) or bool(b.top.style)
    return V


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    base_path, out_path = sys.argv[1], sys.argv[2]
    b, o = load(base_path), load(out_path)

    R = max(b.max_row, o.max_row)
    C = max(b.max_column, o.max_column)
    diffs = []

    # 1) 合并区
    mb = sorted(str(x) for x in b.merged_cells.ranges)
    mo = sorted(str(x) for x in o.merged_cells.ranges)
    if mb != mo:
        diffs.append(('合并区', mb, mo))

    # 2) 列宽 / 行高
    wb_ = {k: round(v.width or 0, 2) for k, v in b.column_dimensions.items()}
    wo_ = {k: round(v.width or 0, 2) for k, v in o.column_dimensions.items()}
    for k in sorted(set(list(wb_.keys()) + list(wo_.keys()))):
        if abs(wb_.get(k, 0) - wo_.get(k, 0)) > 0.05:
            diffs.append(('列宽 ' + k, wb_.get(k, 0), wo_.get(k, 0)))

    hb = {k: round(v.height or 0, 1) for k, v in b.row_dimensions.items() if v.height}
    ho = {k: round(v.height or 0, 1) for k, v in o.row_dimensions.items() if v.height}
    for k in sorted(set(list(hb.keys()) + list(ho.keys()))):
        if abs(hb.get(k, 0) - ho.get(k, 0)) > 0.3:
            diffs.append(('行高 第%s行' % k, hb.get(k, 0), ho.get(k, 0)))

    # 3) 可见线条
    vb = outline(b, R, C)
    vo = outline(o, R, C)
    line_diff = [k for k in vb if vb[k] != vo.get(k)]
    if line_diff:
        diffs.append(('可见边框线条（%d 处）' % len(line_diff), '见下', line_diff[:20]))

    # 4) 字体字号（取表头与正文各一格代表）
    for ref in ('A1', 'A2', 'A3', 'A4', 'A5', 'C5'):
        try:
            fb, fo = b[ref].font, o[ref].font
        except Exception:
            continue
        if (fb.name, fb.sz) != (fo.name, fo.sz):
            diffs.append(('字体 %s' % ref, '%s/%s' % (fb.name, fb.sz), '%s/%s' % (fo.name, fo.sz)))

    # 5) 页面设置
    psb, pso = b.page_setup, o.page_setup
    if psb.orientation != pso.orientation:
        diffs.append(('纸张方向', psb.orientation, pso.orientation))
    mrg_b, mrg_o = b.page_margins, o.page_margins
    for k in ('left', 'right', 'top', 'bottom'):
        if abs(getattr(mrg_b, k) - getattr(mrg_o, k)) > 0.05:
            diffs.append(('页边距 ' + k, round(getattr(mrg_b, k), 2), round(getattr(mrg_o, k), 2)))
    if b.sheet_properties.pageSetUpPr and o.sheet_properties.pageSetUpPr:
        if bool(b.sheet_properties.pageSetUpPr.fitToPage) != bool(o.sheet_properties.pageSetUpPr.fitToPage):
            diffs.append(('缩放到一页', b.sheet_properties.pageSetUpPr.fitToPage,
                          o.sheet_properties.pageSetUpPr.fitToPage))

    # 6) 文字（基线里非空的结构性文字，导出件不该缺）
    missing = []
    for r in range(1, R + 1):
        for c in range(1, C + 1):
            bv = b.cell(row=r, column=c).value
            ov = o.cell(row=r, column=c).value
            if isinstance(bv, str) and bv.strip() and not isinstance(ov, str):
                missing.append('%s: %r' % (b.cell(row=r, column=c).coordinate, bv[:20]))
    if missing:
        diffs.append(('导出件缺失的文字（%d 处）' % len(missing), '见下', missing[:10]))

    print('基线   : %s' % base_path)
    print('导出件 : %s' % out_path)
    print('尺寸   : %d 行 × %d 列' % (R, C))
    print('')
    if not diffs:
        print('✅ 全部一致（合并区 / 列宽 / 行高 / 可见线条 / 字体 / 页面 / 文字）')
        return 0

    print('❌ 发现 %d 处差异：' % len(diffs))
    for item in diffs:
        print('  · %s' % item[0])
        print('      基线: %s' % (item[1],))
        print('      出件: %s' % (item[2],))
    return 1


if __name__ == '__main__':
    sys.exit(main())
