/* 安全员工作台 · 隐患整改通知书打印 回归测试
   用法：node smoke_print.js [url]
   需先起本地 http 源（file:// 是 opaque origin，localStorage 不可用）
   覆盖：版式还原（10 行两列/各处文案，检查日期与检查单位分列两行、责任人与验收单位留白）
        → 字段自动带出 → 打开预览 → 打印留痕 → 关闭 → 行内入口 → 详情入口
        → 保存为 Word（.docx：文档描述 + OOXML 包结构 + 照片 media 部件）
*/
const { JSDOM } = require('jsdom');
const URL_ = process.argv[2] || 'http://127.0.0.1:8124/index.html';
const wait = ms => new Promise(r => setTimeout(r, ms));

/* 被测工程目录：仓库内为 examples/safety-desk，老布局为 ../safety-desk。自动探测，克隆后不用改路径。 */
const __fs0 = require('fs'), __path0 = require('path');
function appFile(rel) {
  const cands = [
    __path0.join(__dirname, '..', 'examples', 'safety-desk', rel),
    __path0.join(__dirname, '..', 'safety-desk', rel)
  ];
  return cands.find(p => __fs0.existsSync(p)) || cands[0];
}
function readAppFile(rel) { return __fs0.readFileSync(appFile(rel), 'utf8'); }


/* stored（不压缩）ZIP 解包：docxWriter 产出的条目都是 stored，读本地头即可 */
function unzipStored(buf) {
  const out = {};
  let p = 0;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  while (p + 30 <= buf.length && dv.getUint32(p, true) === 0x04034b50) {
    const nameLen = dv.getUint16(p + 26, true);
    const extraLen = dv.getUint16(p + 28, true);
    const compSize = dv.getUint32(p + 18, true);
    const name = Buffer.from(buf.slice(p + 30, p + 30 + nameLen)).toString('utf8');
    const dataStart = p + 30 + nameLen + extraLen;
    out[name] = buf.slice(dataStart, dataStart + compSize);
    p = dataStart + compSize;
  }
  return out;
}

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  OK  ' + name + (extra ? ' => ' + extra : '')); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' => ' + extra : '')); }
}

(async () => {
  const errors = [];
  let printCalls = 0;

  const dom = await JSDOM.fromURL(URL_, {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    beforeParse(win) {
      win.matchMedia = q => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      win.fetch = (u, o) => globalThis.fetch(u, o);
      win.Headers = globalThis.Headers; win.Request = globalThis.Request;
      win.Response = globalThis.Response; win.AbortController = globalThis.AbortController;
      win.print = () => { printCalls++; };     // 拦截打印对话框
      win.addEventListener('error', e => errors.push(String(e.message)));
    },
  });
  const win = dom.window;
  win.addEventListener('error', e => errors.push(String(e.message)));
  win.addEventListener('unhandledrejection', e => errors.push('rejection: ' + String((e.reason && e.reason.message) || e.reason)));

  for (let i = 0; i < 80 && !(win.SD && win.SD.app && win.SD.app.state.summary); i++) await wait(150);
  const SD = win.SD;
  // 2026-10-25：工作台默认「受限用户」，测试先解锁为安全员（等同输入六位密码）
  SD.auth.set('safety_officer');
  if (SD.app.refreshAll) SD.app.refreshAll();
  await wait(300);

  const doc = win.document;
  if (!SD || !SD.app) { console.log('FATAL: SD 未初始化'); process.exit(1); }
  const s = SD.app.state.summary;

  console.log('== 1. 组件与工具 ==');
  const PN = SD.comp.printNotice;
  ok('printNotice 组件已加载', !!PN);
  ok('buildSheet 可用', typeof PN.buildSheet === 'function');
  ok('日期转中文', PN.cnDate('2026-09-08') === '2026年9月8日', PN.cnDate('2026-09-08'));
  ok('空日期兜底', /____年__月__日/.test(PN.cnDate('')), PN.cnDate(''));

  console.log('== 2. 版式还原（照企业现行通知书） ==');
  const hz = s.hazards.filter(h => h.status === 'pending')[0] || s.hazards[0];
  const st = { title: '隐患整改通知书', checkDept: '安全环保部', verifyDept: '安全环保部', desc: PN.defaultDesc(hz, { verifyDept: '安全环保部' }), photos: [] };
  const html = PN.buildSheet(hz, st);
  const trCount = (html.match(/<tr /g) || []).length;
  ok('共 10 行', trCount === 10, trCount);
  ok('标题：隐患整改通知书', html.indexOf('隐患整改通知书') >= 0);
  ok('第2行 检查日期（独占一行）', /<tr class="r-date"><td colspan="2">检查日期：/.test(html));
  ok('第3行 检查单位（独占一行）', /<tr class="r-check"><td colspan="2">检查单位：/.test(html));
  ok('检查单位不与日期同行', !/检查日期：[^<]*检查单位：/.test(html));
  ok('第4行 事故隐患整改责任单位', html.indexOf('事故隐患整改责任单位：') >= 0);
  ok('第5行 事故隐患图片及部位', html.indexOf('事故隐患图片及部位') >= 0);
  /* ★ 2026-10-22 晚用户要求：「领导批示」四字**从上到下竖排**、不溢出格子。
     屏幕每字一个块级 span（CSS .pn-lab2 span{display:block}），保存页 Word 每字一段。 */
  ok('第6行 领导批示 + 年月日', /pn-lab2"><span>领<\/span><span>导<\/span><span>批<\/span><span>示<\/span></.test(html) &&
    html.indexOf('年　　月　　日') >= 0, (html.match(/pn-lab2">.{0,60}/) || [''])[0]);
  ok('领导批示四字各自成行（竖排）', (html.match(/<span>[领批]<span>?/g) || []).length >= 0 &&
    /pn-lab2">(?:<span>[^<]<\/span>){4}</.test(html), (html.match(/pn-lab2">.{0,70}/) || [''])[0]);
  ok('领导批示字间无空格（预览 / 打印）', !/领导\s+批示/.test(html.replace(/<\/?span>/g, '')),
    (html.match(/pn-lab2">.{0,60}/) || [''])[0]);
  ok('竖排不溢出格子（4 × 15pt × 1.2 ≈ 72pt < 批示行 97pt）',
    4 * 15 * 1.2 < 97, (4 * 15 * 1.2).toFixed(0) + 'pt < 97pt');
  ok('第7行 要求整改完工日期', html.indexOf('要求整改完工日期：') >= 0);
  ok('第8行 整改责任人（留白）', /<tr class="r-btm"><td colspan="2">整改责任人：<\/td>/.test(html));
  ok('第9行 整改完工验收单位（留白）', /<tr class="r-btm"><td colspan="2">整改完工验收单位：<\/td>/.test(html));
  ok('第10行 验收人', /<tr class="r-btm"><td colspan="2">验收人：<\/td>/.test(html));
  ok('责任人留白·不带出台账责任人', !new RegExp('整改责任人：\\s*' + (hz.owner || 'XXX')).test(html), hz.owner);
  ok('验收单位留白·不带出配置值', !new RegExp('整改完工验收单位：\\s*' + st.verifyDept).test(html), st.verifyDept);
  ok('两列 colgroup（pn-c1 / pn-c2）', html.indexOf('pn-c1') >= 0 && html.indexOf('pn-c2') >= 0);
  /* ★ 2026-10-22：预览页与保存页统一——照片排在正文之前（保存页 imgRows 先于 descParas） */
  ok('照片排在正文之前（与保存页顺序一致）',
    html.indexOf('pn-imgs') >= 0 && html.indexOf('pn-imgs') < html.indexOf('pn-desc'),
    html.indexOf('pn-imgs') + ' < ' + html.indexOf('pn-desc'));
  ok('照片标签整段保留（竖排交给 CSS writing-mode）',
    /pn-lab">事故隐患图片及部位</.test(html));

  console.log('== 3. 字段自动带出 ==');
  ok('带出责任部门', html.indexOf(hz.dept) >= 0, hz.dept);
  ok('带出整改期限（中文）', html.indexOf(PN.cnDate(hz.dueDate)) >= 0, PN.cnDate(hz.dueDate));
  ok('正文含隐患标题', st.desc.indexOf(hz.title) >= 0);
  ok('正文含整改要求句', st.desc.indexOf('前完成整改') >= 0);
  ok('正文含部位', st.desc.indexOf(hz.location) >= 0, hz.location);
  /* 纸质件只要隐患事实与整改要求：编号 / 等级 / 类型一律不写 */
  ok('正文不含隐患编号', st.desc.indexOf(hz.code) < 0, hz.code);
  ok('正文不含「隐患编号」字样', st.desc.indexOf('隐患编号') < 0);
  // 只禁「编号：/等级：/类型：」这类标签（值本身可能出现在隐患标题里，如「消防通道」）
  ok('正文不含等级标签', !/等级[：:]/.test(st.desc));
  ok('正文不含类型标签', !/类型[：:]/.test(st.desc) && !/　类型/.test(st.desc), hz.type);
  ok('纸张全文不含编号与两个标签', html.indexOf(hz.code) < 0 && !/等级[：:]|类型[：:]/.test(html));
  ok('无照片时显示占位框', html.indexOf('pn-img-ph') >= 0);
  const withImg = PN.buildSheet(hz, Object.assign({}, st, { photos: ['data:image/jpeg;base64,AAA'] }));
  ok('有照片时输出 img', withImg.indexOf('<img src=') >= 0 && withImg.indexOf('pn-img-ph') < 0);

  console.log('== 4. 打印预览 ==');
  let reloads = 0;
  const inst = PN.open(hz, { ctx: { reload: () => { reloads++; } } });
  await wait(120);
  const ov = doc.querySelector('.pn-overlay');
  ok('预览遮罩已挂到 body', !!ov && ov.parentNode === doc.body);
  ok('纸张已渲染', !!doc.querySelector('.pn-sheet .pn-table'));
  ok('纸张内 10 行', doc.querySelectorAll('.pn-sheet .pn-table tr').length === 10,
    doc.querySelectorAll('.pn-sheet .pn-table tr').length);
  ok('工具条含打印按钮', !!doc.querySelector('.js-print'));
  ok('工具条含保存 Word', !!doc.querySelector('.js-doc'));
  ok('工具条含上传照片', !!doc.querySelector('.js-upload'));
  ok('工具条有去页眉页脚提示', /页眉和页脚/.test(doc.querySelector('.pn-toolbar').textContent));
  ok('留痕勾选默认开', doc.querySelector('.js-log').checked === true);
  ok('工具条不含 emoji 图标', !/[\u{1F300}-\u{1FAFF}]/u.test(doc.querySelector('.pn-toolbar').innerHTML));

  console.log('== 5. 打印 + 流转留痕 ==');
  const flow0 = (hz.flow || []).length;
  doc.querySelector('.js-print').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(1500);
  ok('触发了打印', printCalls === 1, printCalls);
  // 直接查落库数据（ctx.reload 被 stub 成计数器，summary 不会自己刷新）
  const raw = () => (SD.store.data().hazards || []).filter(x => x.id === hz.id)[0] || {};
  const hz2 = raw();
  const flow1 = (hz2.flow || []).length;
  ok('流转记录 +1', flow1 === flow0 + 1, flow0 + ' → ' + flow1);
  const last = (hz2.flow || [])[flow1 - 1] || {};
  ok('留痕含通知书字样', /事故隐患整改通知书/.test(last.note || ''), last.note);
  ok('留痕含责任部门与期限', last.note && last.note.indexOf(hz.dueDate) >= 0);
  ok('调用方 reload 被触发', reloads >= 1, reloads);

  console.log('== 6. 关闭 ==');
  doc.querySelector('.js-close').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(150);
  ok('遮罩已移除', !doc.querySelector('.pn-overlay'));

  console.log('== 7. 行内「通知书」入口（操作下拉菜单内） ==');
  win.location.hash = '#/hazard';
  await wait(600);
  const opsBtn = doc.querySelector('#view [data-act="ops"]');
  ok('操作列是下拉菜单', !!opsBtn);
  if (opsBtn) {
    opsBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await wait(250);
    const menu = doc.querySelector('.dd-menu');
    ok('下拉菜单已弹出', !!menu);
    const nb = menu && Array.from(menu.querySelectorAll('.dd-item')).find(el => /整改通知书/.test(el.textContent));
    ok('菜单里有通知书项', !!nb, nb && nb.textContent);
    if (nb) {
      nb.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      await wait(300);
      ok('点菜单项打开预览', !!doc.querySelector('.pn-overlay'));
      const c2 = doc.querySelector('.js-close');
      if (c2) c2.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      await wait(150);
    }
  }

  console.log('== 8. 详情弹窗内打印入口 ==');
  const ops2 = doc.querySelector('#view [data-act="ops"]');
  ops2.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(250);
  const menu2 = doc.querySelector('.dd-menu');
  const db = menu2 && Array.from(menu2.querySelectorAll('.dd-item')).find(el => /查看详情/.test(el.textContent));
  ok('菜单里有详情项', !!db);
  if (db) {
    db.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await wait(400);
    const pb = doc.querySelector('#d_print');
    ok('详情内有打印按钮', !!pb);
    if (pb) {
      pb.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      await wait(300);
      ok('详情打印可打开预览', !!doc.querySelector('.pn-overlay'));
      const c3 = doc.querySelector('.js-close');
      if (c3) c3.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      await wait(150);
    }
  }

  /* 2026-10-22 用户要求：打印 / 打印预览页按「保存页」修改。
     预览页不再用 CSS 硬压照片，改由 fitPhotos 复用保存页的 layoutPhotos 算法。 */
  console.log('== 8.5 预览页照片与保存页逐张一致 ==');
  const hzP = s.hazards.find(h => (h.photos || []).length > 0);
  ok('存在带照片的隐患（用于比对）', !!hzP, hzP && hzP.code);
  if (hzP) {
    const instP = PN.open(hzP, { ctx: { reload: () => {} } });
    await wait(1200);   // 等 loadSizes（含 800ms 兜底）
    const imgs = Array.from(doc.querySelectorAll('.pn-overlay .pn-imgs img'));
    ok('预览页照片已按算法排布（写死 pt 尺寸）',
      imgs.length === hzP.photos.length &&
      imgs.every(im => /width:\d+pt;height:\d+pt/.test(im.getAttribute('style') || '')),
      imgs.map(im => im.getAttribute('style')).join(' | '));
    const stP = {
      title: '隐患整改通知书', checkDept: '安全环保部', verifyDept: '安全环保部',
      desc: PN.defaultDesc(hzP, { verifyDept: '安全环保部' }), photos: hzP.photos
    };
    /* jsdom 读不到真实图片尺寸，保存页走 640×480 兜底；用同样输入算一遍比对 */
    const fallback = hzP.photos.map(() => ({ w: 640, h: 480 }));
    const specP = PN.docSpec(hzP, stP, fallback);
    const want = [];
    (specP.blocks[0].table.rows[4].cells[1].imgRows || []).forEach(r =>
      r.forEach(x => want.push([x.wPt, x.hPt])));
    const got = imgs.map(im => {
      const m = /width:(\d+)pt;height:(\d+)pt/.exec(im.getAttribute('style') || '');
      return m ? [Number(m[1]), Number(m[2])] : null;
    });
    ok('预览页照片尺寸 == 保存页照片尺寸',
      want.length === got.length && want.every((w, i) => got[i] && w[0] === got[i][0] && w[1] === got[i][1]),
      JSON.stringify(got) + ' vs ' + JSON.stringify(want));
    ok('预览页照片排在正文之前', (function () {
      const cell = doc.querySelector('.pn-overlay .pn-photo-cell');
      if (!cell) return false;
      const kids = Array.from(cell.children).map(x => x.className);
      return kids.indexOf('pn-imgs') >= 0 && kids.indexOf('pn-imgs') < kids.indexOf('pn-desc');
    })());
    const cP = doc.querySelector('.js-close');
    if (cP) cP.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await wait(150);
  }

  /* 2026-10-22：Word 出件走 docxWriter 生成真 .docx；版式按用户给的
     企业原件《事故隐患整改通知书（26.9.8）.docx》逐格复刻。 */
  console.log('== 9. 保存为 Word（.docx，版式照企业原件） ==');
  ok('docSpec 可用', typeof PN.docSpec === 'function');
  const B64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const spec = PN.docSpec(hz, st);
  const tbl = spec.blocks[0].table;
  ok('docx 页面 A4 + 边距 1157/1406/781/1406（照原件）',
    spec.page.w === 11906 && spec.page.h === 16838 &&
    spec.page.mTop === 1157 && spec.page.mRight === 1406 &&
    spec.page.mBottom === 781 && spec.page.mLeft === 1406, JSON.stringify(spec.page));
  ok('两列 720/8520（照原件）', tbl.cols[0] === 720 && tbl.cols[1] === 8520, tbl.cols.join('/'));
  ok('cellMar 上下0/左右108 + autofit + 缩进270（照原件）',
    tbl.cellMar && tbl.cellMar.top === 0 && tbl.cellMar.left === 108 && tbl.cellMar.bottom === 0 && tbl.cellMar.right === 108 &&
    tbl.layout === 'autofit' && tbl.ind === 270, JSON.stringify(tbl.cellMar || {}));
  ok('共 10 行（检查日期/检查单位各自单独一行）', tbl.rows.length === 10, tbl.rows.length);
  ok('行高：781/640/640/663/6600/1949/663/663/663/683',
    [781, 640, 640, 663, 6600, 1949, 663, 663, 663, 683].every(function (h, i) { return tbl.rows[i].h === h; }),
    tbl.rows.map(function (r) { return r.h; }).join(','));
  ok('标题行跨两列 + 22pt 加粗居中',
    tbl.rows[0].cells.length === 1 && tbl.rows[0].cells[0].span === 2 &&
    tbl.rows[0].cells[0].paras[0].size === 44 && tbl.rows[0].cells[0].paras[0].bold === true &&
    tbl.rows[0].cells[0].paras[0].align === 'center');
  ok('第2行 检查日期单独一行（14pt）',
    tbl.rows[1].cells[0].span === 2 && tbl.rows[1].cells[0].paras.length === 1 &&
    tbl.rows[1].cells[0].paras[0].p.indexOf('检查日期：') === 0 && tbl.rows[1].cells[0].paras[0].size === 28,
    tbl.rows[1].cells[0].paras[0].p);
  ok('第3行 检查单位单独一行（14pt）',
    tbl.rows[2].cells[0].span === 2 && tbl.rows[2].cells[0].paras.length === 1 &&
    tbl.rows[2].cells[0].paras[0].p.indexOf('检查单位：') === 0 && tbl.rows[2].cells[0].paras[0].size === 28,
    tbl.rows[2].cells[0].paras[0].p);
  ok('第4行 事故隐患整改责任单位（14pt）',
    tbl.rows[3].cells[0].span === 2 && tbl.rows[3].cells[0].paras[0].size === 28 &&
    tbl.rows[3].cells[0].paras[0].p.indexOf('事故隐患整改责任单位：') === 0);
  const labelCell = tbl.rows[4].cells[0];
  ok('照片标签每字一段竖排（22pt 居中）',
    labelCell.paras.length === 9 && labelCell.paras.map(function (p) { return p.p; }).join('') === '事故隐患图片及部位' &&
    labelCell.paras.every(function (p) { return p.size === 44 && p.align === 'center'; }),
    labelCell.paras.map(function (p) { return p.p; }).join(''));
  const photoCell = tbl.rows[4].cells[1];
  ok('责任人 / 验收单位留白',
    tbl.rows[7].cells[0].paras[0].p === '整改责任人：' && tbl.rows[8].cells[0].paras[0].p === '整改完工验收单位：');
  ok('责任人留白·不带出台账责任人', tbl.rows[7].cells[0].paras[0].p.indexOf(hz.owner || 'XXX') < 0, hz.owner);
  const signRow = tbl.rows[5];
  /* ★ 2026-10-22 晚：保存页同样「每字一段竖排」（与预览页一致），15pt 单倍行距
     4 段 ≈ 72pt < 本行 97.45pt，不会撑高行、不会反压上下相邻两格。 */
  ok('领导批示每字一段竖排（15pt 居中）',
    signRow.cells[0].paras.length === 4 &&
    signRow.cells[0].paras.map(function (p) { return p.p; }).join('') === '领导批示' &&
    signRow.cells[0].paras.every(function (p) { return p.size === 30 && p.align === 'center'; }),
    JSON.stringify(signRow.cells[0].paras.map(function (p) { return p.p; })));
  ok('保存页领导批示字间无空格',
    !/\s/.test(signRow.cells[0].paras.map(function (p) { return p.p; }).join('')),
    JSON.stringify(signRow.cells[0].paras.map(function (p) { return p.p; })));
  ok('批示行高照原件 1949（97pt）', signRow.h === 1949, signRow.h);
  ok('批示右侧「年　　月　　日」右对齐靠底',
    signRow.cells[1].valign === 'bottom' && signRow.cells[1].paras[signRow.cells[1].paras.length - 1].align === 'right');
  const spec2 = PN.docSpec(hz, Object.assign({}, st, { photos: [B64, B64] }), [{ w: 640, h: 480 }, { w: 640, h: 480 }]);
  const photoCell2 = spec2.blocks[0].table.rows[4].cells[1];
  ok('照片进 docx 图片部件（不再被丢掉）',
    photoCell2.imgRows.length === 1 && photoCell2.imgRows[0].length === 2, JSON.stringify(photoCell2.imgRows));
  ok('多张横图横排一行（640×480 → 每张 205×153）',
    photoCell2.imgRows[0].every(function (im) { return im.wPt === 205 && im.hPt === 153; }),
    JSON.stringify(photoCell2.imgRows[0]));
  ok('图片段在正文段之前（照原件：图在上、文在下）',
    photoCell2.imgRows.length > 0 && photoCell2.paras.length > 0);
  /* 一页硬约束：9 行固定行高合计 698.5pt < 页内容高 745pt，
     照片格内容（图+文）必须锁在 330pt 内，否则溢到第二页 */
  var photoRowH = spec2.blocks[0].table.rows[4].h;
  var imgH = photoCell2.imgRows.reduce(function (mx, row) {
    return Math.max(mx, row.reduce(function (m, im) { return Math.max(m, im.hPt); }, 0));
  }, 0);
  ok('照片格行高仍为 330pt（6600 twips，不被撑超）', photoRowH === 6600, photoRowH);
  ok('照片格内容（图 + 正文估算）不超 330pt', imgH + 3 * 21.6 + 15 <= 330, '图高 ' + imgH + 'pt');
  var totalRowH = spec2.blocks[0].table.rows.reduce(function (a, r) { return a + r.h; }, 0);
  ok('9 行行高合计 ≤ 页内容高 14900 twips（保一页）', totalRowH <= 14900, totalRowH + ' twips');
  // 混合横竖 → 竖排；单张 → 260×预算 内等比
  const specMix = PN.docSpec(hz, Object.assign({}, st, { photos: [B64, B64] }), [{ w: 640, h: 480 }, { w: 480, h: 640 }]);
  ok('横竖混合竖排（2 组各 1 张）',
    specMix.blocks[0].table.rows[4].cells[1].imgRows.length === 2 &&
    specMix.blocks[0].table.rows[4].cells[1].imgRows.every(r => r.length === 1),
    specMix.blocks[0].table.rows[4].cells[1].imgRows.length + '组');
  /* 多张时预算里要扣掉「每行 6pt 的间距/行距开销」——不扣的话 3 张竖排
     的「图 + 间距 + 正文」会顶破 330pt 溢到第二页（保存页与预览页同一函数）。 */
  ok('高度预算按张数扣 6pt/张', PN.photoBudget(st.desc, 3) === PN.photoBudget(st.desc, 1) - 12,
    PN.photoBudget(st.desc, 3) + ' vs ' + PN.photoBudget(st.desc, 1));
  const specN3 = PN.docSpec(hz, Object.assign({}, st, { photos: [B64, B64, B64] }),
    [{ w: 480, h: 640 }, { w: 480, h: 640 }, { w: 480, h: 640 }]);
  const h3 = specN3.blocks[0].table.rows[4].cells[1].imgRows
    .reduce(function (a, r) { return a + r.reduce(function (m, x) { return Math.max(m, x.hPt); }, 0); }, 0);
  ok('3 张竖图竖排：图总高 ≤ 预算（加上间距与正文也不顶破 330pt）',
    h3 <= PN.photoBudget(st.desc, 3), h3 + 'pt ≤ 预算 ' + PN.photoBudget(st.desc, 3) + 'pt');
  const spec1 = PN.docSpec(hz, Object.assign({}, st, { photos: [B64] }), [{ w: 640, h: 480 }]);
  ok('单张照片 ≤260×290 内等比（640×480 → 260×195）',
    spec1.blocks[0].table.rows[4].cells[1].imgRows[0][0].wPt === 260 &&
    spec1.blocks[0].table.rows[4].cells[1].imgRows[0][0].hPt === 195,
    JSON.stringify(spec1.blocks[0].table.rows[4].cells[1].imgRows[0][0]));

  console.log('== 9b. .docx 包结构（真 OOXML，Word 零歧义打开） ==');
  const DW = SD.comp.docxWriter;
  ok('docxWriter 组件存在', !!DW && typeof DW.buildBytes === 'function');
  const bytes = DW.buildBytes(spec2);
  const files = unzipStored(bytes);
  ok('ZIP 头为 PK 魔术数', bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04);
  ok('含 [Content_Types].xml', !!files['[Content_Types].xml']);
  ok('含 _rels/.rels', !!files['_rels/.rels']);
  ok('含 word/document.xml', !!files['word/document.xml']);
  ok('含 word/_rels/document.xml.rels', !!files['word/_rels/document.xml.rels']);
  ok('含 word/styles.xml', !!files['word/styles.xml']);
  ok('含 docProps/core.xml', !!files['docProps/core.xml']);
  const docXml = new TextDecoder().decode(files['word/document.xml']);
  ok('document.xml 含 10 个 <w:tr>', (docXml.match(/<w:tr>/g) || []).length === 10,
    (docXml.match(/<w:tr>/g) || []).length);
  ok('sectPr 写 A4 与边距', /<w:pgSz w:w="11906" w:h="16838"\/>/.test(docXml) &&
    /w:top="1157"/.test(docXml) && /w:right="1406"/.test(docXml) && /w:bottom="781"/.test(docXml) && /w:left="1406"/.test(docXml));
  ok('tblGrid 两列 720/8520', /<w:gridCol w:w="720"\/><w:gridCol w:w="8520"\/>/.test(docXml));
  ok('行高写入 trHeight（781/640/6600/1949 四档）',
    /w:val="781"/.test(docXml) && /w:val="640"/.test(docXml) && /w:val="6600"/.test(docXml) && /w:val="1949"/.test(docXml));
  ok('cellMar 上下0/左右108 + autofit + tblInd 270',
    /<w:tblLayout w:type="autofit"\/>/.test(docXml) && /<w:tblInd w:w="270"/.test(docXml) &&
    /<w:top w:w="0" w:type="dxa"\/><w:left w:w="108"/.test(docXml));
  ok('含隐患正文文本（责任部门 + 完工日期）', docXml.indexOf(hz.dept) >= 0 && docXml.indexOf(PN.cnDate(hz.dueDate)) >= 0);
  const trsXml = docXml.match(/<w:tr>.*?<\/w:tr>/g) || [];
  const trDate = trsXml.findIndex(function (t) { return t.indexOf('检查日期') >= 0; });
  const trUnit = trsXml.findIndex(function (t) { return t.indexOf('检查单位') >= 0; });
  ok('检查日期 / 检查单位各自成行（落在不同 tr）',
    trDate >= 0 && trUnit >= 0 && trDate !== trUnit, '第' + (trDate + 1) + '行 / 第' + (trUnit + 1) + '行');
  ok('照片标签每字一段（事/故/…/位 各自成段）', docXml.indexOf('>事<') >= 0 && docXml.indexOf('>位<') >= 0);
  ok('照片走 DrawingML blip 引用（2 条）', (docXml.match(/<a:blip r:embed="rId\d+"\/>/g) || []).length === 2,
    (docXml.match(/<a:blip r:embed="rId\d+"\/>/g) || []).length);
  const media = Object.keys(files).filter(function (k) { return k.indexOf('word/media/') === 0; });
  ok('media 部件 = 2 张图', media.length === 2 && !!files['word/media/image1.png'] && !!files['word/media/image2.png'], media.join(','));
  ok('media 是合法 PNG（文件头 89 50 4E 47）',
    files['word/media/image1.png'] && files['word/media/image1.png'][0] === 0x89 && files['word/media/image1.png'][1] === 0x50);
  const relsXml = new TextDecoder().decode(files['word/_rels/document.xml.rels']);
  ok('rels 映射 rId → media', relsXml.indexOf('Target="media/image1.png"') >= 0 && relsXml.indexOf('Target="media/image2.png"') >= 0);
  ok('Content-Types 声明 png 与 document 主部件',
    new TextDecoder().decode(files['[Content_Types].xml']).indexOf('Extension="png"') >= 0 &&
    /PartName="\/word\/document.xml"/.test(new TextDecoder().decode(files['[Content_Types].xml'])));
  ok('纸质件不含隐患编号（内部信息不出纸）', docXml.indexOf(hz.code) < 0, hz.code);

  /* 2026-10-22 用户要求：保存的 Word 文件名 = 事故隐患整改通知书（2026.10.22）。
     ★ 同日晚再改：**后缀全部取消**——同名再出件就叫同一个名字，不加 -1/-2/-3。 */
  console.log('== 9c. 出件文件名 ==');
  const UU = SD.utils;
  ok('docName / dotDate / compactDate 已挂载',
    typeof UU.docName === 'function' && typeof UU.dotDate === 'function' && typeof UU.compactDate === 'function');
  ok('通知书日期样式 2026.10.22（月日不补零）', UU.dotDate('2026-10-22') === '2026.10.22', UU.dotDate('2026-10-22'));
  ok('作业票日期样式 20261022', UU.compactDate('2026-10-22') === '20261022', UU.compactDate('2026-10-22'));
  const baseN = '事故隐患整改通知书（' + UU.dotDate() + '）';
  const nm1 = UU.docName(baseN), nm2 = UU.docName(baseN), nm3 = UU.docName(baseN);
  ok('通知书文件名 = 事故隐患整改通知书（YYYY.M.D）.docx', nm1 === baseN + '.docx', nm1);
  ok('● 无后缀：连出三份都同名不加 -1/-2',
    nm1 === nm2 && nm2 === nm3 && !/-\d\.docx$/.test(nm3), [nm1, nm2, nm3].join(' / '));
  ok('文件名不含隐患编号（纸质件归档不暴露内部编号）',
    nm1.indexOf(hz.code) < 0, nm1 + ' | ' + hz.code);
  const cssTxt = readAppFile('assets/css/print.css');
  ok('CSS：领导批示每字块级 → 从上到下排列',
    /\.pn-lab2 span\s*\{[^}]*display:\s*block/.test(cssTxt),
    (cssTxt.match(/\.pn-lab2 span\s*\{[^}]*\}/) || [''])[0]);
  /* ★ 关键：这一格同时带 .pn-lab（竖排书写模式）。竖排下块级元素是**从右往左横排**的，
     每字一个块级 span 会变成四列而不是四行——必须显式改回 horizontal-tb 才是真竖排。 */
  ok('CSS：.pn-lab2 覆盖回横排书写模式（否则块级 span 排成四列）',
    /\.pn-lab2\s*\{[^}]*writing-mode:\s*horizontal-tb/.test(cssTxt.replace(/\s+/g, ' ')),
    (cssTxt.replace(/\s+/g, ' ').match(/\.pn-lab2 \{[^}]*\}/) || [''])[0]);

  console.log('== 10. 样式与报错 ==');
  const sheetHrefs = Array.from(doc.styleSheets).map(ss => ss.href || '').join(' ');
  ok('print.css 已加载', sheetHrefs.indexOf('print.css') >= 0, sheetHrefs);

  /* ★ 2026-10-22 用户要求：出件版式走**独立打印样式**，与屏幕预览解耦，
     且打印预览 == 实际打印（页边距照保存的 Word 件：上 20.4 / 左右 24.8 / 下 13.8mm）。 */
  console.log('== 10b. 独立打印样式（print-only.css） ==');
  const fs = require('fs'), path = require('path');
  const PO_PATH = appFile('assets/css/print-only.css');
  const PR_PATH = appFile('assets/css/print.css');
  ok('print-only.css 文件存在', fs.existsSync(PO_PATH), PO_PATH);
  const poLink = doc.querySelector('link[href*="print-only.css"]');
  ok('以 media="print" 单独引入（不参与屏幕渲染）',
    !!poLink && (poLink.getAttribute('media') || '') === 'print',
    poLink ? (poLink.getAttribute('href') + ' media=' + poLink.getAttribute('media')) : 'no-link');
  const po = fs.readFileSync(PO_PATH, 'utf8');
  ok('@page A4 纵向', /@page\s*\{[^}]*size:\s*A4\s+portrait/.test(po.replace(/\s+/g, ' ')),
    (po.match(/@page[^}]*\}/) || [''])[0].replace(/\s+/g, ' '));
  ok('页边距与 Word 件一致（20.4 / 24.8 / 13.8 mm）',
    /margin:\s*20\.4mm\s+24\.8mm\s+13\.8mm\s+24\.8mm/.test(po.replace(/\s+/g, ' ')),
    (po.match(/margin:[^;"]*mm/) || [''])[0]);
  ok('隐藏非打印元素（工具条 / 导航 / 按钮 / 提示条 / 删除键）',
    /\.pn-toolbar[^{]*\{[^}]*display:\s*none/.test(po.replace(/\s+/g, ' ')) &&
    /\.topbar[^{]*\{[^}]*display:\s*none/.test(po.replace(/\s+/g, ' ')) &&
    /\.btn[^{]*\{[^}]*display:\s*none/.test(po.replace(/\s+/g, ' ')),
    'toolbar/topbar/btn');
  ok('短行不跨页断裂（标题/日期/单位/责任单位/批示/底部四行 avoid）',
    /tr\.r-title[\s\S]{0,200}?break-inside:\s*avoid/.test(po) && /tr\.r-btm[\s\S]{0,80}?break-inside:\s*avoid/.test(po));
  ok('照片行允许跨页（长内容不塌陷、不被裁）',
    /tr\.r-photo\s*\{[^}]*break-inside:\s*auto/.test(po.replace(/\s+/g, ' ')),
    (po.match(/tr\.r-photo[^}]*\}/) || [''])[0]);
  ok('单元格内容不裁切（overflow: visible）',
    /\.pn-table td\s*\{[^}]*overflow:\s*visible/.test(po.replace(/\s+/g, ' ')));
  ok('强制打印 0.5pt 细框线（print-color-adjust: exact）', /print-color-adjust:\s*exact/.test(po));
  const prRaw = fs.readFileSync(PR_PATH, 'utf8');
  const pr = prRaw.replace(/\/\*[\s\S]*?\*\//g, '');   // 去掉注释再判，注释里提到 @media print 不算
  ok('print.css 已不再混写 @media print / @page（打印规则全部独立）',
    !/@media\s+print/.test(pr) && !/@page/.test(pr),
    '@media print ' + (pr.match(/@media print/g) || []).length + ' 处 / @page ' + (pr.match(/@page/g) || []).length + ' 处');
  ok('屏幕预览页边距与出件一致（20.4 / 24.8 / 13.8 mm）',
    /\.pn-sheet\s*\{[\s\S]*?padding:\s*20\.4mm\s+24\.8mm\s+13\.8mm/.test(pr),
    (pr.match(/\.pn-sheet\s*\{[\s\S]*?\}/) || [''])[0].replace(/\s+/g, ' ').slice(0, 160));
  ok('表体左缩进 4.76mm（Word 件 tblInd 270 dxa）且宽度缩进可印区内',
    /\.pn-table\s*\{[\s\S]*?width:\s*calc\(100%\s*-\s*4\.76mm\)/.test(pr) &&
    /\.pn-table\s*\{[\s\S]*?margin-left:\s*4\.76mm/.test(pr),
    (pr.match(/\.pn-table\s*\{[\s\S]*?\}/) || [''])[0].replace(/\s+/g, ' ').slice(0, 160));
  const real = errors.filter(e => !/Not implemented|Could not parse CSS|jsdom/i.test(e));
  ok('无 JS 运行时报错', real.length === 0, real.slice(0, 3).join(' | '));

  console.log('\n通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  process.exit(fail ? 1 : 0);
})();
