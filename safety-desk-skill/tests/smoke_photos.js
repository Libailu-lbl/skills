/* 安全员工作台 · 作业人员 / 照片查看 冒烟自检
   用法：node smoke_photos.js [url]
   覆盖：① 危险作业票加「作业人员」（标签输入 + 落库）
        ② 作业票照片单独成区 + 点击查看大图（lightbox 切换 / 关闭）
        ③ 特种作业人员加「证件照」+ 点击查看大图
        ④ 保存为 Word（.docx：docSpec + OOXML 包 + media 部件 + 栅格化）
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
  if (cond) { pass++; console.log('  OK  ' + name + (extra != null ? ' => ' + extra : '')); }
  else { fail++; console.log('  FAIL ' + name + (extra != null ? ' => ' + extra : '')); }
}

(async () => {
  const errors = [];
  const dom = await JSDOM.fromURL(URL_, {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    beforeParse(win) {
      win.matchMedia = q => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      win.fetch = (u, o) => globalThis.fetch(u, o);
      win.Headers = globalThis.Headers; win.Request = globalThis.Request;
      win.Response = globalThis.Response; win.AbortController = globalThis.AbortController;
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

  if (!SD || !SD.app) { console.log('FATAL: SD 未初始化'); process.exit(1); }
  const doc = win.document;

  const go = async r => { win.location.hash = '#/' + r; await wait(340); };
  const view = () => doc.getElementById('view');
  const click = el => el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  const key = (el, k) => el.dispatchEvent(new win.KeyboardEvent('keydown', { key: k, bubbles: true }));
  const modal = () => doc.querySelector('.mask');
  const submit = async (m, ms = 1800) => { click(m.querySelector('.js-ok')); await wait(ms); };
  const n = k => (SD.app.state.summary[k] || []).length;

  /* ---------- 1. 数据 ---------- */
  console.log('== 1. 数据：workers / photos ==');
  const s0 = SD.app.state.summary;
  const withWorkers = s0.workPermits.filter(p => (p.workers || []).length);
  ok('作业票带作业人员名单', withWorkers.length > 0, withWorkers.length + ' 张');
  ok('作业人员是数组', Array.isArray(withWorkers[0] && withWorkers[0].workers),
    JSON.stringify(withWorkers[0] && withWorkers[0].workers));
  const wpPhotos = s0.workPermits.filter(p => (p.photos || []).length);
  ok('有带照片的作业票（示例）', wpPhotos.length > 0, wpPhotos.length + ' 张');
  const spPhotos = s0.specialPersonnel.filter(p => (p.photos || []).length);
  ok('有带证件照的人员（示例）', spPhotos.length > 0, spPhotos.length + ' 人');

  /* ---------- 2. 作业票表单：作业人员项 ---------- */
  console.log('== 2. 新增作业票：作业人员（标签输入） ==');
  await go('specPermit');
  const addBtn = Array.from(view().querySelectorAll('.btn')).find(b => /新增作业票/.test(b.textContent));
  ok('找到「新增作业票」按钮', !!addBtn);
  click(addBtn);
  await wait(260);
  let m = modal();
  ok('弹窗打开', !!m);
  const ppSlot = m && m.querySelector('#ff_workers');
  ok('表单有「作业人员」项', !!ppSlot);
  ok('是 people 标签控件（有输入框 + 添加按钮）',
    !!ppSlot && !!ppSlot.querySelector('.pp-input') && !!ppSlot.querySelector('.pp-add'));
  ok('联想名单取自特种作业人员台账',
    !!ppSlot && ppSlot.querySelectorAll('datalist option').length === s0.specialPersonnel.length,
    ppSlot && ppSlot.querySelectorAll('datalist option').length);

  // 添加两个人：一个点按钮，一个回车
  const input = ppSlot.querySelector('.pp-input');
  input.value = '测试甲';
  click(ppSlot.querySelector('.pp-add'));
  await wait(120);
  input.value = '测试乙';
  key(input, 'Enter');
  await wait(120);
  ok('已添加 2 个人员标签', ppSlot.querySelectorAll('.pp-chip').length === 2,
    ppSlot.querySelectorAll('.pp-chip').length);
  // 重名拦截
  input.value = '测试甲';
  click(ppSlot.querySelector('.pp-add'));
  await wait(120);
  ok('重名不重复添加', ppSlot.querySelectorAll('.pp-chip').length === 2);
  // 删除一个再加回
  click(ppSlot.querySelector('.pp-x'));
  await wait(120);
  ok('可单独移除某个人员', ppSlot.querySelectorAll('.pp-chip').length === 1);

  // 填必填项后提交（编号 2026-10-21 起为手动必填）
  const set = (id, v) => { const e = m.querySelector('#' + id); if (e) e.value = v; };
  set('ff_code', 'FZZY-0000901');
  set('ff_location', '冒烟测试工位');
  set('ff_dept', '安环部');
  set('ff_applicant', '王安全');
  set('ff_leader', '王安全');
  set('ff_guardian', '孙浩');
  set('ff_planStart', SD.utils.today());
  set('ff_planEnd', SD.utils.today());
  await submit(m);
  const created = SD.app.state.summary.workPermits.find(p => p.location === '冒烟测试工位');
  ok('作业票已新增', !!created);
  ok('作业人员已落库', !!created && (created.workers || []).length === 1,
    JSON.stringify(created && created.workers));
  ok('落库的是移除后剩下的那个人', !!created && created.workers[0] === '测试乙',
    created && created.workers[0]);

  /* ---------- 3. 表格：作业人员列；照片不再单列，改点作业类型看 ---------- */
  console.log('== 3. 表格：作业人员列 / 照片栏已去掉 ==');
  await go('specPermit');
  const headText = Array.from(view().querySelectorAll('th')).map(th => th.textContent.trim());
  ok('表头有「作业人员」列', headText.some(t => /作业人员/.test(t)), headText.join(' | '));
  ok('表头已无「照片」列', !headText.some(t => t === '照片'), headText.join(' | '));
  ok('表头已无「申请人」列（不再单列）', !headText.some(t => t === '申请人'), headText.join(' | '));
  ok('表格里有人员标签渲染', view().querySelectorAll('.tags .tag').length > 0,
    view().querySelectorAll('.tags .tag').length);
  // 照片不单列、也不在底部单独成区；表格里不应出现缩略图（看大图改点「作业类型」）
  const tbl = view().querySelector('.table-scroll') || view();
  ok('表格里已无照片缩略图', tbl.querySelectorAll('.thumb').length === 0,
    tbl.querySelectorAll('.thumb').length);

  // 点作业类型 → 打开现场照片大图；无照片的只提示不弹图
  const wpNoIds = SD.app.state.summary.workPermits.filter(p => !(p.photos || []).length).map(p => p.id);
  const typeNone = Array.from(view().querySelectorAll('.js-ptype'))
    .find(el => wpNoIds.indexOf(el.dataset.id) >= 0);
  ok('取到无照片的作业票类型单元', !!typeNone);
  click(typeNone);
  await wait(220);
  ok('无照片的作业票点了只提示、不弹图', !doc.querySelector('.lb-mask'));
  const wpWith = SD.app.state.summary.workPermits.filter(p => (p.photos || []).length)[0];
  const type2 = view().querySelector('.js-ptype[data-id="' + wpWith.id + '"]');
  ok('取到有照片的作业票类型单元', !!type2, wpWith.code);
  click(type2);
  await wait(220);
  let lb0 = doc.querySelector('.lb-mask');
  ok('点作业类型打开大图', !!lb0);
  ok('首张是作业票第一张照片', !!lb0 && lb0.querySelector('.lb-img').getAttribute('src') === wpWith.photos[0]);
  ok('大图标题带票号与类型', !!lb0 &&
    new RegExp(wpWith.code).test(lb0.querySelector('.lb-cap').textContent) &&
    new RegExp(wpWith.type).test(lb0.querySelector('.lb-cap').textContent),
    lb0 && lb0.querySelector('.lb-cap').textContent);
  click(lb0.querySelector('.lb-close'));
  await wait(180);
  ok('大图可关闭', !doc.querySelector('.lb-mask'));

  /* ---------- 4. lightbox：从「作业类型」打开，验证切换/键盘/计数 ---------- */
  console.log('== 4. 作业类型开大图：切换 / 键盘 / 计数 ==');
  await go('specPermit');
  const multi = SD.app.state.summary.workPermits.filter(p => (p.photos || []).length > 1)[0]
    || SD.app.state.summary.workPermits.filter(p => (p.photos || []).length)[0];
  const typeEl = view().querySelector('.js-ptype[data-id="' + multi.id + '"]');
  ok('取到目标作业票类型单元', !!typeEl, multi.code);
  click(typeEl);
  await wait(220);
  let lb = doc.querySelector('.lb-mask');
  ok('点作业类型打开了大图', !!lb);
  ok('首张为第一张照片', !!lb && lb.querySelector('.lb-img').getAttribute('src') === multi.photos[0]);
  ok('标题带票号与类型', !!lb &&
    new RegExp(multi.code).test(lb.querySelector('.lb-cap').textContent) &&
    new RegExp(multi.type).test(lb.querySelector('.lb-cap').textContent),
    lb && lb.querySelector('.lb-cap').textContent);

  if (multi.photos.length > 1) {
    click(lb.querySelector('.lb-next'));
    await wait(150);
    lb = doc.querySelector('.lb-mask');
    ok('点「下一张」切换成功', lb.querySelector('.lb-img').getAttribute('src') === multi.photos[1]);
    ok('计数跟到 2', new RegExp('2 / ' + multi.photos.length).test(lb.querySelector('.lb-cap').textContent));
    key(doc, 'ArrowLeft');
    await wait(150);
    lb = doc.querySelector('.lb-mask');
    ok('键盘 ← 回到上一张', lb.querySelector('.lb-img').getAttribute('src') === multi.photos[0]);
  }
  key(doc, 'Escape');
  await wait(180);
  ok('Esc 关闭大图', !doc.querySelector('.lb-mask'));

  /* ---------- 5. 特种作业人员：证件照 ---------- */
  console.log('== 5. 特种作业人员：证件照项 ==');
  await go('specPersonnel');
  const spAdd = Array.from(view().querySelectorAll('.btn')).find(b => /新增人员/.test(b.textContent));
  click(spAdd);
  await wait(260);
  m = modal();
  ok('人员弹窗打开', !!m);
  ok('表单有「证件照」项', !!m.querySelector('#ff_photos'),
    !!m && Array.from(m.querySelectorAll('.field > span')).map(x => x.textContent).join(' | '));
  m.querySelector('.js-cancel').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(160);

  // 证件照不再单列：表头应无「证件照」列，改点姓名看大图
  const spHead = Array.from(view().querySelectorAll('th')).map(th => th.textContent.trim());
  ok('表头已无「证件照」列', !spHead.some(t => /证件照/.test(t)), spHead.join(' | '));

  const spIds = SD.app.state.summary.specialPersonnel.filter(x => (x.photos || []).length).map(x => x.id);
  const spName = Array.from(view().querySelectorAll('.js-pname'))
    .find(el => spIds.indexOf(el.dataset.id) >= 0);
  ok('姓名可点', !!spName);
  ok('姓名不变色（无 link 样式类）', !!spName && !/link/.test(spName.className), spName && spName.className);
  const spRec = SD.app.state.summary.specialPersonnel.find(x => x.id === (spName && spName.dataset.id));
  ok('姓名后无角标', !!spName && !/证件照\s*\d/.test(spName.textContent), spName && spName.textContent);
  ok('悬停仍提示张数', !!spName && /点击查看证件照/.test(spName.getAttribute('title') || ''),
    spName && spName.getAttribute('title'));
  // 无证件照的人：点了只提示，不弹空图
  const spNone = Array.from(view().querySelectorAll('.js-pname'))
    .find(el => spIds.indexOf(el.dataset.id) < 0);
  if (spNone) {
    click(spNone);
    await wait(200);
    ok('无证件照的人点了不弹图', !doc.querySelector('.lb-mask'));
  }
  click(spName);
  await wait(220);
  lb = doc.querySelector('.lb-mask');
  ok('点证件照打开大图', !!lb);
  ok('大图内容正确', !!lb && lb.querySelector('.lb-img').getAttribute('src') === spRec.photos[0]);
  ok('大图标题带姓名', !!lb && new RegExp(spRec.name).test(lb.querySelector('.lb-cap').textContent),
    lb && lb.querySelector('.lb-cap').textContent);
  click(lb.querySelector('.lb-close'));
  await wait(180);
  ok('点关闭按钮可关', !doc.querySelector('.lb-mask'));

  /* ---------- 6. 隐患：点标题看照片 ---------- */
  console.log('== 6. 隐患：点标题看照片 ==');
  const hzPhotos = SD.app.state.summary.hazards.filter(h => (h.photos || []).length);
  ok('有带照片的隐患（示例）', hzPhotos.length > 0, hzPhotos.length + ' 条');
  await go('hazard');
  const hzTarget = hzPhotos[0];
  const hzTitle = view().querySelector('.js-hz-title[data-id="' + hzTarget.id + '"]');
  ok('隐患标题可点击（带 link 类）', !!hzTitle && hzTitle.classList.contains('link'));
  ok('标题后挂照片张数角标', !!hzTitle && new RegExp('照片 ' + hzTarget.photos.length).test(hzTitle.textContent),
    hzTitle && hzTitle.textContent);

  click(hzTitle);
  await wait(240);
  let hzLb = doc.querySelector('.lb-mask');
  ok('点标题打开大图', !!hzLb);
  ok('显示该隐患第一张照片', !!hzLb && hzLb.querySelector('.lb-img').getAttribute('src') === hzTarget.photos[0]);
  ok('大图标题带隐患编号', !!hzLb && new RegExp(hzTarget.code).test(hzLb.querySelector('.lb-cap').textContent),
    hzLb && hzLb.querySelector('.lb-cap').textContent);
  click(hzLb.querySelector('.lb-close'));
  await wait(180);
  ok('关闭大图', !doc.querySelector('.lb-mask'));

  // 编辑隐患表单也能补 / 改照片（整改后补一张闭环证据最常见）
  const hzOps = view().querySelector('[data-act="ops"][data-id="' + hzTarget.id + '"]');
  click(hzOps);
  await wait(200);
  const hzMenu = doc.querySelector('.dd-menu');
  const hzEdit = Array.from((hzMenu || { querySelectorAll: () => [] }).querySelectorAll('.dd-item'))
    .find(b => /编辑/.test(b.textContent));
  ok('隐患操作菜单有「编辑」', !!hzEdit);
  click(hzEdit);
  await wait(320);
  const em = modal();
  ok('编辑隐患弹窗有「隐患照片」项', !!em && !!em.querySelector('#ff_photos'));
  const phBoxes = em ? em.querySelectorAll('#ff_photos .ph-box') : [];
  ok('编辑时带出已有照片', phBoxes.length === hzTarget.photos.length,
    phBoxes.length + ' / ' + hzTarget.photos.length);
  await submit(em, 1400);
  const hzAfter = SD.app.state.summary.hazards.find(h => h.id === hzTarget.id);
  ok('保存后照片没被清空', (hzAfter && (hzAfter.photos || []).length) === hzTarget.photos.length,
    hzAfter && (hzAfter.photos || []).length);

  // 无照片的隐患：点了只提示，不打开大图
  const hzNone = SD.app.state.summary.hazards.filter(h => !(h.photos || []).length)[0];
  const noneTitle = view().querySelector('.js-hz-title[data-id="' + hzNone.id + '"]');
  ok('无照片隐患标题不带 link 类', !!noneTitle && !noneTitle.classList.contains('link'));
  click(noneTitle);
  await wait(200);
  ok('无照片时不弹大图（仅提示）', !doc.querySelector('.lb-mask'));

  /* ---------- 8. 作业票照片打印页：按姓名自动带出作业人员证件照 ---------- */
  console.log('== 8. 作业票照片打印页：自动带出作业人员证件照 ==');
  const PP = SD.comp.printPhotos;
  const people = SD.app.state.summary.specialPersonnel;
  const wp = SD.app.state.summary.workPermits.find(p => p.code === 'FZZY-0000001');
  ok('示例作业票有作业人员 + 现场照片', !!wp && (wp.workers || []).length > 0 && (wp.photos || []).length > 0,
    wp && ((wp.workers || []).join('/') + ' | ' + (wp.photos || []).length + ' 张'));

  const certs = PP.certsOf(wp, people);
  ok('按作业人员姓名匹配到证件照', certs.length > 0, certs.map(c => c.name).join(','));
  ok('没证件照的人不带（孙浩）', !certs.some(c => c.name === '孙浩'), certs.map(c => c.name).join(','));
  ok('说明含姓名 + 作业类别 + 证件照',
    !!certs[0] && new RegExp(certs[0].name).test(certs[0].cap) && /证件照/.test(certs[0].cap),
    certs[0] && certs[0].cap);
  ok('未传人员名单时不带（组件不反向读视图）', PP.certsOf(wp, []).length === 0);

  const st = { certs: certs, photos: wp.photos };
  const sheet = PP.buildSheet(wp, st);
  ok('证件照排在第一张', sheet.indexOf(certs[0].src) < sheet.indexOf(wp.photos[0]));
  /* 2026-10-22 用户要求打印预览与保存页一致：一排一张 + 长边横向 + 一页同比例缩放。
     CSS 侧 .pp-grid 的 grid-auto-rows:1fr 平分高度、.pp-cell img 的 object-fit:contain
     等比缩放——JS 侧只需把网格改单列。 */
  ok('屏幕/打印也改一排一张（单列网格）', /grid-template-columns:1fr/.test(sheet),
    (sheet.match(/grid-template-columns:[^;"]*/) || [''])[0]);
  ok('格子上带说明文字 pp-cap', /class="pp-cap"/.test(sheet));
  ok('抬头注明含证件照张数', new RegExp('含 ' + certs.length + ' 张作业人员证件照').test(sheet),
    (sheet.match(/<div class="pp-head">[^<]*/) || [''])[0]);

  // 示例证件照是 URL 编码的 SVG（非位图，Word 内嵌不了 → 走栅格化），这里用真实 base64 验 docx 打包
  const B64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const stB = { certs: [{ name: '王磊', src: B64, cap: '王磊 · 高处作业 · 证件照' }], photos: [B64] };
  // 默认尺寸 4:3 → 横图，每张独立成行、占满行宽（20 细列）
  const spec = PP.docSpec(wp, stB, []);
  ok('Word 里证件照在第一行', spec.blocks[0].table.rows[0].cells[0].imgs.length === 1);
  ok('一排一张（2 张 4:3 横图 → 2 行 × 1 格）',
    spec.blocks[0].table.rows.length === 2 && spec.blocks[0].table.rows.every(r => r.cells.length === 1),
    spec.blocks[0].table.rows.length + '行');
  ok('细粒度 20 列 tblGrid（gridSpan 拼行宽）', spec.blocks[0].table.cols.length === 20,
    spec.blocks[0].table.cols.length);
  /* 2026-10-22 用户要求：Word 出件只要干净照片墙——不输出抬头行（票号那行，
     用户视角即「页眉页脚内容」），照片格下方不放任何文字（说明 / 序号）。 */
  ok('Word 无抬头行（只有表格一个块）', spec.blocks.length === 1 && !!spec.blocks[0].table,
    spec.blocks.map(b => b.table ? 'table' : 'p').join(','));
  ok('照片格无说明文字与序号',
    spec.blocks[0].table.rows.every(r => r.cells.every(c => !(c.paras || []).length)),
    JSON.stringify(spec.blocks[0].table.rows[0].cells[0]));
  /* 一排一张：横图满行宽 20 列横放；方图 13 列；竖图 6 列；高度各设上限 */
  ok('横图占满行宽（20 细列）', spec.blocks[0].table.rows[0].cells[0].span === 20,
    spec.blocks[0].table.rows[0].cells[0].span);
  ok('横图高度受 380pt 上限约束',
    spec.blocks[0].table.rows[0].cells[0].imgs[0].hPt <= 380,
    spec.blocks[0].table.rows[0].cells[0].imgs[0].hPt);
  const specV = PP.docSpec(wp, { certs: [], photos: [B64] }, [{ w: 480, h: 640 }]);
  ok('竖图单独一行占 6 细列', specV.blocks[0].table.rows.length === 1 &&
    specV.blocks[0].table.rows[0].cells[0].span === 6, specV.blocks[0].table.rows[0].cells[0].span);
  const specSq = PP.docSpec(wp, { certs: [], photos: [B64] }, [{ w: 600, h: 600 }]);
  ok('方图单独一行占 13 细列', specSq.blocks[0].table.rows.length === 1 &&
    specSq.blocks[0].table.rows[0].cells[0].span === 13, specSq.blocks[0].table.rows[0].cells[0].span);
  const specMx = PP.docSpec(wp, { certs: [], photos: [B64, B64, B64] },
    [{ w: 640, h: 480 }, { w: 480, h: 640 }, { w: 600, h: 600 }]);
  ok('横/竖/方各自成行不混排', specMx.blocks[0].table.rows.length === 3 &&
    specMx.blocks[0].table.rows.map(r => r.cells[0].span).join(',') === '20,6,13',
    specMx.blocks[0].table.rows.map(r => r.cells[0].span).join(','));
  /* 2026-10-22 用户要求：全部照片同比例缩放，保证在同一张 A4 纸内。
     内容高 785pt，每行预留 6pt（cellMar 上下 + 边框）+ 底部 10pt。 */
  function sumImgH(spec) {
    return spec.blocks[0].table.rows.reduce(function (a, r) {
      return a + r.cells[0].imgs[0].hPt;
    }, 0);
  }
  // 4 张 4:3 横图：单张 538×403.5 → 合计 1614pt > 763pt 预算 → 必须缩放
  const spec4 = PP.docSpec(wp, { certs: [], photos: [B64, B64, B64, B64] },
    [{ w: 640, h: 480 }, { w: 640, h: 480 }, { w: 640, h: 480 }, { w: 640, h: 480 }]);
  var budget4 = 785 - 6 * 4 - 10;
  ok('4 张横图总高超页 → 触发同比例缩放', sumImgH(spec4) <= budget4,
    sumImgH(spec4) + 'pt ≤ 预算 ' + budget4 + 'pt');
  ok('缩放后各图同比例（宽高比保持 4:3）',
    spec4.blocks[0].table.rows.every(r => Math.abs(r.cells[0].imgs[0].wPt / r.cells[0].imgs[0].hPt - 640 / 480) < 0.02),
    JSON.stringify(spec4.blocks[0].table.rows.map(r => r.cells[0].imgs[0])));
  // 12 张横图（上限张数）也必须锁进一页
  const spec12 = PP.docSpec(wp, { certs: [], photos: new Array(12).fill(B64) },
    new Array(12).fill(0).map(() => ({ w: 640, h: 480 })));
  var budget12 = 785 - 6 * 12 - 10;
  ok('12 张横图也锁进一页 A4', sumImgH(spec12) <= budget12,
    sumImgH(spec12) + 'pt ≤ 预算 ' + budget12 + 'pt');
  // 竖图转横后同样参与一页预算（640×480 目标尺寸）
  const specV2 = PP.docSpec(wp, { certs: [], photos: [B64, B64] }, [{ w: 640, h: 480 }, { w: 640, h: 480 }]);
  ok('2 张横图合计 807pt 超预算 → 同样缩放锁一页', sumImgH(specV2) <= 785 - 6 * 2 - 10,
    sumImgH(specV2) + 'pt');

  /* ★ 2026-10-22 用户要求：照片墙**所有页**的照片统一再等比缩 5%
       （屏幕预览 / 浏览器打印走 CSS transform；Word 保存页走 PHOTO_SHRINK）。
       单张横图不会触发「一页缩放」（kAll=1），正好用来单独验这 5%。 */
  const colPt = (11906 - 567 * 2) / 20 / 20;               // 每细列 pt
  const k0 = Math.min(1, (20 * colPt) / 640, 380 / 480);   // 未缩时的等比系数
  const w0 = Math.floor(640 * k0), h0 = Math.floor(480 * k0);
  const specShrink = PP.docSpec(wp, { certs: [], photos: [B64] }, [{ w: 640, h: 480 }]);
  const imS = specShrink.blocks[0].table.rows[0].cells[0].imgs[0];
  ok('PHOTO_SHRINK 常量为 0.95', PP.PHOTO_SHRINK === 0.95, PP.PHOTO_SHRINK);
  ok('Word 保存页照片统一缩 5%（未触发一页缩放时也一样）',
    Math.abs(imS.wPt / w0 - 0.95) < 0.01 && Math.abs(imS.hPt / h0 - 0.95) < 0.01,
    imS.wPt + '×' + imS.hPt + ' vs 未缩 ' + w0 + '×' + h0);
  ok('缩 5% 后宽高比不变（等比）',
    Math.abs((imS.wPt / imS.hPt) - (640 / 480)) < 0.02, (imS.wPt / imS.hPt).toFixed(3));
  const cssText = readAppFile('assets/css/print.css');
  ok('预览页 / 打印页同步缩 5%（CSS .pp-cell img transform: scale(.95)）',
    /\.pp-cell img\s*\{[^}]*transform:\s*scale\(\s*\.95\s*\)/.test(cssText));
  ok('CSS 缩放写在基础样式里（打印与预览同幅）',
    /\.pp-cell img\s*\{[\s\S]*?transform:\s*scale\(\s*\.95\s*\)[\s\S]*?\}/.test(cssText));

  /* 2026-10-22：Word 出件改走 components/docxWriter.js 生成真 .docx。
     之前 MHTML（.doc）用户实测「打开空白、照片不显示」——Word 各版本对 HTML
     导入解析不一致；.docx 图片走 media 部件 + DrawingML 引用，零歧义。 */
  const DW = SD.comp.docxWriter;
  ok('docxWriter 组件存在', !!DW && typeof DW.buildBytes === 'function');
  const bytes = DW.buildBytes(spec);
  const files = unzipStored(bytes);
  ok('ZIP 头为 PK\x03\x04', bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04);
  ok('OOXML 部件齐全（document/rels/styles/contentTypes）',
    !!files['word/document.xml'] && !!files['word/_rels/document.xml.rels'] &&
    !!files['word/styles.xml'] && !!files['[Content_Types].xml']);
  const docXml = new TextDecoder().decode(files['word/document.xml']);
  ok('media 两个图片部件', !!files['word/media/image1.png'] && !!files['word/media/image2.png'],
    Object.keys(files).filter(k => k.indexOf('media/') >= 0).join(','));
  ok('document.xml 两条 blip 引用', (docXml.match(/<a:blip r:embed="rId\d+"\/>/g) || []).length === 2,
    (docXml.match(/<a:blip r:embed="rId\d+"\/>/g) || []).length);
  ok('图片按单元格尺寸缩放（EMU 宽高都给了）', /<wp:extent cx="\d+" cy="\d+"\/>/.test(docXml));
  ok('正文无抬头行/无说明文字/无序号（干净照片墙）',
    docXml.indexOf(wp.code) < 0 && docXml.indexOf('证件照') < 0 && docXml.indexOf('>1<') < 0 && docXml.indexOf('>2<') < 0,
    'code=' + (docXml.indexOf(wp.code) >= 0) + ' cap=' + (docXml.indexOf('证件照') >= 0));
  ok('流式 tblGrid 20 细列', (docXml.match(/<w:gridCol /g) || []).length === 20,
    (docXml.match(/<w:gridCol /g) || []).length);
  ok('gridSpan 拼行宽（横图满行 20）', /<w:gridSpan w:val="20"\/>/.test(docXml),
    (docXml.match(/<w:gridSpan w:val="\d+"\/>/g) || []).join(' '));
  ok('rels 映射 rId → media', new TextDecoder().decode(files['word/_rels/document.xml.rels']).indexOf('Target="media/image1.png"') >= 0);

  // 栅格化：位图原样返回；SVG 等非位图在无 canvas 环境（jsdom）返回 null，由调用方兜底
  DW.rasterize(B64, src2 => {
    ok('位图 dataURL 栅格化原样返回', src2 === B64, typeof src2);
  });
  DW.rasterize('data:image/svg+xml;charset=utf-8,%3Csvg%3E%3C/svg%3E', src2 => {
    ok('非位图（SVG）无 canvas 时返回 null 不崩', src2 === null, String(src2));
  });
  PP.ensureRaster([{ src: B64, cap: '' }], items => {
    ok('ensureRaster 位图不换图', items.length === 1 && items[0].src === B64);
  });
  /* 2026-10-22 用户要求「按照片长度长的一边横向放」：竖图旋转 90° 成横图，
     横图原样；jsdom 无 canvas 时原样返回、不挂死（真机里转出真横图）。 */
  PP.ensureLandscape([{ src: B64, cap: '' }, { src: B64, cap: '证件照' }],
    [{ w: 640, h: 480 }, { w: 480, h: 640 }], items => {
      ok('横图不旋转', items.length === 2 && items[0].src === B64);
      ok('竖图走旋转分支（无 canvas 原样返回不挂死）', items[1].src === B64 && items[1].cap === '证件照');
    });
  PP.ensureLandscape([], [], items => {
    ok('ensureLandscape 空数组直接回调', items.length === 0);
  });
  // 竖图一旦被转成横图，docSpec 就按横图满行宽排（模拟 ensureLandscape 之后的 items）
  const specLand = PP.docSpec(wp, { certs: [], rotItems: [{ src: B64, cap: '' }] }, [{ w: 640, h: 480 }]);
  ok('转横后的图也按横图满行宽（span 20）',
    specLand.blocks[0].table.rows.length === 1 && specLand.blocks[0].table.rows[0].cells[0].span === 20,
    specLand.blocks[0].table.rows[0].cells[0].span);

  // 端到端：从作业票操作菜单打开打印预览，第一格应是证件照
  await go('specPermit');
  const wpBtn = view().querySelector('[data-act="pops"][data-id="' + wp.id + '"]');
  click(wpBtn);
  await wait(200);
  const wpMenu = doc.querySelector('.dd-menu');
  const wpPhotoItem = Array.from((wpMenu || { querySelectorAll: () => [] }).querySelectorAll('.dd-item'))
    .find(b => /照片/.test(b.textContent));
  ok('作业票菜单有「照片」入口', !!wpPhotoItem);
  click(wpPhotoItem);
  await wait(360);
  const ov = doc.querySelector('.pp-overlay');
  ok('打印预览已打开', !!ov);
  const firstCell = ov && ov.querySelector('.pp-cell');
  ok('第一格是证件照（带说明）', !!firstCell && /pp-cap/.test(firstCell.innerHTML),
    firstCell && firstCell.textContent.slice(0, 40));
  /* ★ 2026-10-27 修 bug 的回归：一次点击只保存一份 .docx。
     修复前 loadSizes 的兜底定时器不判 finished → 图片加载完后 800ms 又回调一次
     → 整条导出链跑两遍 → 浏览器落下两个同名文件（第二个带 (1)）。
     这里把 Image 换成「立即 onload」的假实现，模拟真实浏览器（图片很快加载完）。 */
  if (ov) {
    let dlCount = 0;
    const origDownload = SD.comp.docxWriter.download;
    SD.comp.docxWriter.download = function () { dlCount++; };
    const OrigImage = win.Image;
    win.Image = function () {
      this.naturalWidth = 640; this.naturalHeight = 480;
      this.onload = null; this.onerror = null;
      const self = this;
      Object.defineProperty(this, 'src', {
        set: function () { setTimeout(function () { if (self.onload) self.onload(); }, 0); },
        get: function () { return ''; }
      });
    };
    const docBtn = ov.querySelector('.js-doc');
    ok('预览里有「保存为 Word」按钮', !!docBtn);
    if (docBtn) click(docBtn);
    await wait(1600);                       // 必须跨过 800ms 兜底定时器才抓得到第二次
    ok('● 一次点击只保存一份 Word（修复前会落两份同名文件）', dlCount === 1, dlCount);
    SD.comp.docxWriter.download = origDownload;
    win.Image = OrigImage;
  }
  if (ov) { click(ov.querySelector('.js-close')); await wait(200); }
  ok('关闭打印预览', !doc.querySelector('.pp-overlay'));

  /* 2026-10-22 用户要求：照片页保存的 Word 文件名 = 20261022吊装
     （出件日期 + 作业类型，类型去掉结尾「作业」二字；同名再出件加 -1/-2/-3）。 */
  console.log('== 8.5 出件文件名 ==');
  ok('typeShort 已导出', typeof PP.typeShort === 'function');
  ok('「吊装作业」→「吊装」', PP.typeShort('吊装作业') === '吊装', PP.typeShort('吊装作业'));
  ok('「高处作业」→「高处」', PP.typeShort('高处作业') === '高处', PP.typeShort('高处作业'));
  ok('「受限空间作业」→「受限空间」', PP.typeShort('受限空间作业') === '受限空间', PP.typeShort('受限空间作业'));
  ok('类型为空兜底「照片」', PP.typeShort('') === '照片' && PP.typeShort(null) === '照片', PP.typeShort(''));
  const UU = SD.utils;
  const baseP = UU.compactDate() + '吊装';
  const pn1 = UU.docName(baseP), pn2 = UU.docName(baseP), pn3 = UU.docName(baseP);
  ok('照片页文件名 = YYYYMMDD + 类型.docx', pn1 === baseP + '.docx', pn1);
  ok('● 无后缀：连出三份都同名不加 -1/-2',
    pn1 === pn2 && pn2 === pn3 && !/-\d\.docx$/.test(pn3), [pn1, pn2, pn3].join(' / '));

  /* ---------- 9. 收尾 ---------- */
  console.log('== 9. 收尾 ==');
  // 清掉冒烟建的作业票，避免污染后续用例
  if (created) {
    await SD.api.removeWorkPermit(created.id);
    SD.app.reload();                // reload 不返回 Promise，轮询等 summary 刷出来
    for (let i = 0; i < 25 && SD.app.state.summary.workPermits.some(p => p.id === created.id); i++) await wait(200);
    ok('冒烟作业票已清理', !SD.app.state.summary.workPermits.some(p => p.id === created.id));
  }
  ok('无 JS 报错', errors.length === 0, errors.slice(0, 3).join(' | '));

  console.log('\n结果：通过 ' + pass + ' / 失败 ' + fail);
  process.exit(fail ? 1 : 0);
})();
