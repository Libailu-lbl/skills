/* 安全员工作台 · 口径说明折叠 + 通知公告文档附件（v1.4.0）
   用法：node smoke_notice_docs.js http://127.0.0.1:8234/index.html

   覆盖：
     ① 六页说明卡（看板 / 隐患 / 巡检 / 待办 / 培训 / 通知）默认收起，
        收起时正文仍在 DOM（Ctrl+F 与断言都还能命中）；
     ② 点标题展开 / 收起、aria-expanded 同步、提示文案切换；
     ③ 通知公告编辑表单新增「文档附件」字段（挂载 docAttach）；
     ④ 上传校验：危险类型拒绝、扩展名白名单、单文件上限、数量上限；
     ⑤ 保存后 docs 落库（含完整 dataURL / size / mime）；
     ⑥ 列表点标题打开查看弹窗（附件清单、图片预览、PDF 打开、说明文案）；
     ⑦ 编辑时附件保留、可逐个删除并落库；
     ⑧ 无附件的老公告标题保持纯文本（不做假按钮）。
*/
const { JSDOM, requestInterceptor } = require('jsdom');
const noPrintSheet = requestInterceptor(function (request) {
  if (String(request.url).indexOf('print-only.css') >= 0) {
    return new Response('', { headers: { 'Content-Type': 'text/css' } });
  }
});
const URL_ = process.argv[2] || 'http://127.0.0.1:8125/index.html';
const wait = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  OK  ' + name + (extra != null ? ' => ' + extra : '')); }
  else { fail++; console.log('  FAIL ' + name + (extra != null ? ' => ' + extra : '')); }
}

(async () => {
  const errors = [];
  const dom = await JSDOM.fromURL(URL_, {
    runScripts: 'dangerously', resources: { interceptors: [noPrintSheet] }, pretendToBeVisual: true,
    beforeParse(win) {
      win.matchMedia = q => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      win.fetch = function () { return Promise.reject(new Error('离线版不应发起请求')); };
      win.Headers = globalThis.Headers; win.Request = globalThis.Request;
      win.Response = globalThis.Response; win.AbortController = globalThis.AbortController;
      win.addEventListener('error', e => errors.push(String(e.message)));
    },
  });
  const win = dom.window;
  const doc = win.document;
  win.addEventListener('error', e => errors.push(String(e.message)));
  win.addEventListener('unhandledrejection', e => errors.push('rejection: ' + String((e.reason && e.reason.message) || e.reason)));

  for (let i = 0; i < 80 && !(win.SD && win.SD.app && win.SD.app.state.summary); i++) await wait(150);
  const SD = win.SD;
  SD.auth.set('safety_officer');
  if (SD.app.refreshAll) SD.app.refreshAll();
  await wait(300);

  const view = () => doc.getElementById('view') || doc.querySelector('.main');
  const go = async (r) => { win.location.hash = '#/' + r; await wait(450); };
  const click = (el) => { el.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); };

  /* ================= 1. 口径说明默认收起 ================= */
  console.log('== 1. 口径说明默认收起 ==');
  const PAGES = ['dashboard', 'hazard', 'inspection', 'todo', 'training', 'notice'];
  for (const r of PAGES) {
    await go(r);
    const cards = view().querySelectorAll('.note-card');
    ok('#' + r + ' 有且只有一张说明卡', cards.length === 1, cards.length);
    if (!cards.length) continue;
    const c = cards[0];
    ok('#' + r + ' 默认收起（data-open=0）', c.getAttribute('data-open') === '0');
    ok('#' + r + ' 提示「点击展开」', /点击展开/.test(c.querySelector('.note-tip').textContent));
    ok('#' + r + ' aria-expanded=false', c.querySelector('.note-head').getAttribute('aria-expanded') === 'false');
    const body = c.querySelector('.note-body');
    ok('#' + r + ' 收起时正文仍在 DOM（可搜索 / 可断言）',
      !!body && body.textContent.trim().length > 20,
      body ? body.textContent.trim().slice(0, 22) : '无');
  }

  await go('todo');
  const nc = view().querySelector('.note-card');
  click(nc.querySelector('.note-head'));
  await wait(120);
  ok('点标题展开（data-open=1）', nc.getAttribute('data-open') === '1');
  ok('展开后提示变「点击收起」', /点击收起/.test(nc.querySelector('.note-tip').textContent));
  ok('展开后 aria-expanded=true', nc.querySelector('.note-head').getAttribute('aria-expanded') === 'true');
  /* 重绘后展开态要保住：refresh 会重建整页 DOM，靠 noteCard 内部记忆 */
  SD.app.refreshAll();
  await wait(600);
  const nc2 = view().querySelector('.note-card');
  ok('展开态跨重绘保持（refresh 后仍展开）', !!nc2 && nc2.getAttribute('data-open') === '1');
  click(nc2.querySelector('.note-head'));
  await wait(120);
  ok('再点一次收起', nc2.getAttribute('data-open') === '0');
  ok('收起后正文仍在（不清空节点）', (nc2.querySelector('.note-body').textContent || '').length > 20);

  /* ================= 2. 附件字段与上传校验 ================= */
  console.log('== 2. 通知公告编辑：文档附件 ==');
  await go('notice');
  const addBtn = Array.from(view().querySelectorAll('button')).find(b => /发布通知/.test(b.textContent));
  click(addBtn);
  await wait(400);
  let modal = doc.querySelector('.mask .modal');
  ok('发布弹窗打开', !!modal);
  const daBox = modal && modal.querySelector('#ff_docs');
  ok('表单含「文档附件」字段', !!modal && /文档附件/.test(modal.textContent));
  ok('字段挂载了附件选择器（_da）', !!(daBox && daBox._da));
  ok('默认显示「未添加文档」', !!modal && /未添加文档/.test(modal.textContent));
  ok('字段说明写明「点标题查看」', !!modal && /点标题即可查看/.test(modal.textContent));

  const setV = (sel, v) => { const el = modal.querySelector(sel); if (el) el.value = v; };
  setV('#ff_code', 'FZTG-2026-901');
  setV('#ff_title', '关于开展冬季防火专项检查的通知');
  setV('#ff_source', '安环部');

  const fileInput = modal.querySelector('.js-da-file');
  async function pick(files) {
    Object.defineProperty(fileInput, 'files', { value: files, configurable: true });
    fileInput.dispatchEvent(new win.Event('change', { bubbles: true }));
    await wait(400);
  }

  await pick([new win.File(['MZ'], '病毒.exe', { type: 'application/octet-stream' })]);
  ok('拒绝 .exe（不在白名单）', modal.querySelectorAll('.da-row').length === 0,
    modal.querySelectorAll('.da-row').length);

  await pick([new win.File(['<html></html>'], 'page.html', { type: 'text/html' })]);
  ok('拒绝 .html（网页类文件不收）', modal.querySelectorAll('.da-row').length === 0);

  await pick([new win.File(['x'], '通知.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })]);
  ok('收下 Word 文档', modal.querySelectorAll('.da-row').length === 1);

  const bigTxt = 'a'.repeat(900 * 1024);
  await pick([new win.File([bigTxt], '超大.txt', { type: 'text/plain' })]);
  ok('超单文件上限（无 IndexedDB → 800KB）被拒', modal.querySelectorAll('.da-row').length === 1,
    modal.querySelectorAll('.da-row').length);

  const pdfBody = '%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF';
  await pick([
    new win.File([pdfBody], '冬季防火检查表.pdf', { type: 'application/pdf' }),
    new win.File(['img-bytes'], '现场照片.png', { type: 'image/png' })
  ]);
  ok('接受 PDF + 图片（累计 3 个）', modal.querySelectorAll('.da-row').length === 3,
    modal.querySelectorAll('.da-row').length);
  ok('文件名按原名显示', /冬季防火检查表\.pdf/.test(modal.textContent));
  ok('行内标出类型与大小', /PDF · \d/.test(modal.textContent.replace(/\s+/g, ' ')));
  ok('计数写明「3 / 3 个」与单个上限', /3 \/ 3 个/.test(modal.textContent) && /单个上限/.test(modal.textContent),
    modal.querySelector('.da-count').textContent);

  await pick([new win.File(['y'], '第四个.txt', { type: 'text/plain' })]);
  ok('超过 3 个不再收', modal.querySelectorAll('.da-row').length === 3);

  /* ================= 3. 保存落库 ================= */
  console.log('== 3. 保存与落库 ==');
  click(modal.querySelector('.js-ok'));
  await wait(1600);
  const saved = SD.store.data().notices[0] || {};
  ok('公告已保存', !!saved.id, saved.title);
  ok('docs 落库 3 个', Array.isArray(saved.docs) && saved.docs.length === 3,
    saved.docs ? saved.docs.length : '无');
  const pdfDoc = (saved.docs || []).filter(d => /\.pdf$/.test(d.name))[0];
  ok('PDF 附件带完整 dataURL', !!pdfDoc && /^data:application\/pdf/.test(pdfDoc.dataUrl),
    pdfDoc ? pdfDoc.name : '无');
  ok('附件存了 size / mime', !!pdfDoc && pdfDoc.size > 0 && /pdf/.test(pdfDoc.mime),
    pdfDoc ? pdfDoc.size + ' / ' + pdfDoc.mime : '无');
  ok('docs 是数组且每条字段齐全',
    (saved.docs || []).every(d => d && d.name && d.dataUrl && d.size != null && d.mime));

  /* ================= 4. 点标题查看 ================= */
  console.log('== 4. 点标题查看文档 ==');
  const link = view().querySelector('.nt-link');
  ok('带附件的标题变成可点按钮', !!link, link ? link.textContent : '无');
  ok('标题旁显示「3 个附件」', /3 个附件/.test(view().textContent));
  click(link);
  await wait(400);
  const vm = doc.querySelector('.mask .modal');
  ok('查看弹窗打开并列出文件名', !!vm && /冬季防火检查表\.pdf/.test(vm.textContent));
  ok('弹窗列出 3 个附件', !!vm && vm.querySelectorAll('.da-vrow').length === 3);
  ok('图片给「预览」、PDF 给「打开」、每个都能「下载」',
    !!vm && !!vm.querySelector('.js-da-preview') && !!vm.querySelector('.js-da-open') &&
    vm.querySelectorAll('.js-da-save').length === 3);
  ok('弹窗说明写清 Word 需下载后用办公软件打开',
    !!vm && /WPS/.test(vm.textContent) && /下载/.test(vm.textContent));
  ok('查看弹窗只有一个关闭按钮（只读）', !!vm && !vm.querySelector('.js-cancel'));
  click(vm.querySelector('.js-ok'));
  await wait(300);
  ok('关闭后弹窗移除', !doc.querySelector('.mask .modal'));

  /* ================= 5. 编辑：保留 / 删除 ================= */
  console.log('== 5. 编辑时附件保留与删除 ==');
  const opsBtn = view().querySelector('.notice-item .nops .btn');
  click(opsBtn);
  await wait(300);
  const editItem = Array.from(doc.querySelectorAll('button, .dd-item, .drop-item'))
    .find(b => /^编辑$/.test(b.textContent.trim()));
  ok('操作菜单含「编辑」', !!editItem);
  if (editItem) {
    click(editItem);
    await wait(500);
    modal = doc.querySelector('.mask .modal');
    ok('编辑弹窗带出原附件 3 个', !!modal && modal.querySelectorAll('.da-row').length === 3,
      modal ? modal.querySelectorAll('.da-row').length : '无');
    click(modal.querySelector('.da-row .da-del'));
    await wait(200);
    ok('删掉一个后剩 2 个', modal.querySelectorAll('.da-row').length === 2);
    click(modal.querySelector('.js-ok'));
    await wait(1600);
    const after = SD.store.data().notices[0] || {};
    ok('删除结果落库（docs 2 个）', Array.isArray(after.docs) && after.docs.length === 2,
      after.docs ? after.docs.length : '无');
    ok('列表附件角标同步为 2', /2 个附件/.test(view().textContent));
    ok('被删的那个文件名不在数据里',
      !(after.docs || []).some(d => /通知\.docx/.test(d.name)),
      (after.docs || []).map(d => d.name).join(','));
  }

  /* ================= 6. 无附件的老公告 ================= */
  console.log('== 6. 无附件公告保持纯文本标题 ==');
  await SD.api.createNotice({
    code: 'FZTG-2026-902', title: '没有附件的口头通知', level: 'normal',
    source: '安环部', publishAt: new Date().toISOString().slice(0, 10), summary: '口头通知'
  });
  await SD.app.reload();
  await wait(700);
  ok('只有一条标题可点（带附件的那条）', view().querySelectorAll('.nt-link').length === 1,
    view().querySelectorAll('.nt-link').length);
  ok('无附件标题没有附件角标', !/没有附件的口头通知[\s\S]{0,30}个附件/.test(view().textContent));
  const plain = SD.store.data().notices.filter(n => /口头通知/.test(n.title))[0] || {};
  ok('无附件的老公告不写空 docs 字段', !('docs' in plain), Object.keys(plain).join(','));

  /* ================= 7. 附件数据形状 ================= */
  console.log('== 7. 数据形状 ==');
  const withDocs = SD.store.data().notices.filter(n => Array.isArray(n.docs) && n.docs.length)[0] || {};
  const sample = (withDocs.docs || [])[0] || {};
  ok('附件字段齐全（id / name / size / mime / dataUrl）',
    ['id', 'name', 'size', 'mime', 'dataUrl'].every(k => k in sample), Object.keys(sample).join(','));

  ok('全程无 JS 报错', errors.length === 0, errors.join(' | ').slice(0, 300));
  console.log('\n结果：通过 ' + pass + ' / 失败 ' + fail);
  win.close();
  process.exit(fail ? 1 : 0);
})();
