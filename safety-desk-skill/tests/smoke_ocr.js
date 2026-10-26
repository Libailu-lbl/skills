/* 安全员工作台 · 证件图片识别自检（识别接口 + 本地解析 + 填表链路）
   用法：node smoke_ocr.js [url]        默认 http://127.0.0.1:8124/index.html
   覆盖：① ocr 组件与配置 ② 解析器（标准证 / 全角与中式日期 / 类别反推 / 异常输入）
        ②.5 标签与值被 OCR 拆成两行时仍能解析（真实识别常见）
        ③ 未配接口时的明确提示 ④ 识别请求体与返回结构兜底（data.text / words_result）
        ④.5 本机服务探活 + 一键启动（协议 iframe / 启动失败提示）
        ⑤ 界面：编辑弹窗识别按钮 → 上传证件照 → stub 接口 → 字段自动填满 → 表单回读
   说明：不需要真 OCR 接口，测试里用 stub fetch 返回文字；真接口只需在 config.js 填 endpoint。
*/
/* OCR 解析器 + 识别链路自检（不需要真接口：stub fetch 返回文字） */
const { JSDOM, requestInterceptor } = require('jsdom');
const skipPrint = requestInterceptor(r => { if (String(r.url).indexOf('print-only.css') >= 0) return new Response('', { headers: { 'Content-Type': 'text/css' } }); });
const wait = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n + (x ? ' => ' + x : '')); } else { fail++; console.log('  FAIL ' + n + (x ? ' => ' + x : '')); } };

(async () => {
  const dom = await JSDOM.fromURL(process.argv[2] || 'http://127.0.0.1:8124/index.html', {
    runScripts: 'dangerously', resources: { interceptors: [skipPrint] }, pretendToBeVisual: true,
    beforeParse(win) {
      win.matchMedia = q => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      win.fetch = (u, o) => globalThis.fetch(u, o);
      win.Headers = globalThis.Headers; win.Request = globalThis.Request;
      win.Response = globalThis.Response; win.AbortController = globalThis.AbortController;
    },
  });
  const win = dom.window, doc = win.document;
  for (let i = 0; i < 80 && !(win.SD && win.SD.app && win.SD.app.state.summary); i++) await wait(150);
  const SD = win.SD;
  // 2026-10-25：工作台默认「受限用户」，测试先解锁为安全员（等同输入六位密码）
  SD.auth.set('safety_officer');
  if (SD.app.refreshAll) SD.app.refreshAll();
  await wait(300);

  const OCR = SD.comp.ocr;

  console.log('== 1. 组件与配置 ==');
  ok('SD.comp.ocr 存在', !!OCR && typeof OCR.recognize === 'function' && typeof OCR.parse === 'function');
  ok('配置块存在', !!SD.CONFIG.ocr);
  ok('endpoint 已配置（本机服务或公司接口）', !!String(SD.CONFIG.ocr.endpoint || '').trim(),
    SD.CONFIG.ocr.endpoint);
  ok('ready() 为真（已配置）', OCR.ready() === true);

  console.log('== 1.5 本机服务：探活 + 一键启动（协议） ==');
  ok('config 有 protocol / healthPath / startTimeout',
    !!SD.CONFIG.ocr.protocol && !!SD.CONFIG.ocr.healthPath && !!SD.CONFIG.ocr.startTimeout,
    JSON.stringify({ p: SD.CONFIG.ocr.protocol, h: SD.CONFIG.ocr.healthPath, t: SD.CONFIG.ocr.startTimeout }));
  ok('origin() 取出接口源地址', OCR.origin() === new URL(SD.CONFIG.ocr.endpoint).origin, OCR.origin());
  ok('isLocal() 认出本机地址', OCR.isLocal() === true);
  const hc = await OCR.health(2500);
  ok('health() 返回结构化结果（失败也不抛错）', hc && typeof hc.ok === 'boolean', JSON.stringify(hc));

  // launch()：用隐藏 <a> 的 click 触发自定义协议（iframe 加载外部协议浏览器不放行）
  let proto = '', launchErr = null;
  try { proto = OCR.launch(); } catch (e) { launchErr = e; }
  ok('launch() 返回协议地址', proto === (SD.CONFIG.ocr.protocol || 'safetyocr') + '://start', proto);
  ok('launch() 不抛异常（协议未注册也不影响页面）', launchErr === null, launchErr && launchErr.message);
  ok('页面未残留临时节点', doc.querySelectorAll('a[href^="safetyocr://"]').length === 0);

  if (hc.ok) {
    const st1 = await OCR.startLocal({ timeout: 4000 });
    ok('服务已在运行时 startLocal 直接返回 already（不重复启动）',
      !!st1 && st1.ok === true && st1.already === true, JSON.stringify(st1));
  } else {
    console.log('  (本机服务未运行，跳过 already 分支，改测「启动失败提示」)');
  }

  // 指向一个不通的端口：应轮询超时并给出可操作提示，而不是静默失败
  const savedEp = SD.CONFIG.ocr.endpoint;
  SD.CONFIG.ocr.endpoint = 'http://127.0.0.1:8199/ocr';
  ok('换端口后 isLocal 仍判定为本机', OCR.isLocal() === true);
  let errStart = '';
  try { await OCR.startLocal({ timeout: 2200 }); } catch (e) { errStart = (e && e.message) || ''; }
  ok('启动失败提示可操作（install_ocr_protocol / start_ocr.bat）',
    /install_ocr_protocol|start_ocr/.test(errStart), errStart);


  let errSkip = '';
  try { await OCR.startLocal({ skipLaunch: true, timeout: 1500 }); } catch (e) { errSkip = (e && e.message) || ''; }
  ok('skipLaunch 模式（点击栈内已拉协议）同样判定失败并给提示',
    /install_ocr_protocol|start_ocr/.test(errSkip), errSkip);  SD.CONFIG.ocr.endpoint = savedEp;

  console.log('== 2. 解析：标准特种作业操作证 ==');
  const T1 = [
    '中华人民共和国特种作业操作证',
    '姓名 张伟',
    '性别 男',
    '作业类别 电工作业',
    '准操项目 低压电工作业',
    '证书编号 T32012020018200',
    '发证机关 江苏省应急管理厅',
    '有效期 2020-01-15 至 2026-01-14',
    '复审日期 2024-01-15',
  ].join('\n');
  let r = OCR.parse(T1);
  ok('姓名', r.name === '张伟', r.name);
  ok('作业类别（字典值）', r.category === '电工作业', r.category);
  ok('操作项目', r.operation === '低压电工作业', r.operation);
  ok('证书编号', r.certNo === 'T32012020018200', r.certNo);
  ok('发证机关', r.issuer === '江苏省应急管理厅', r.issuer);
  ok('有效期起', r.validFrom === '2020-01-15', r.validFrom);
  ok('有效期止', r.validTo === '2026-01-14', r.validTo);
  ok('复审日期', r.reviewDate === '2024-01-15', r.reviewDate);

  console.log('== 2.5 解析：OCR 把「标签」与「值」拆成两行（真实识别常见）==');
  const T1b = ['中华人民共和国特种作业操作证', '姓名', '张伟', '性别', '男', '作业类别', '电工作业',
    '准操项目', '低压电工作业', '证书编号', 'T32012020018200', '发证机关', '江苏省应急管理厅',
    '有效期限', '2020-01-15至2026-01-14', '复审日期', '2024-01-15'].join('\n');
  r = OCR.parse(T1b);
  ok('拆行：姓名', r.name === '张伟', r.name);
  ok('拆行：作业类别', r.category === '电工作业', r.category);
  ok('拆行：操作项目', r.operation === '低压电工作业', r.operation);
  ok('拆行：证书编号', r.certNo === 'T32012020018200', r.certNo);
  ok('拆行：发证机关', r.issuer === '江苏省应急管理厅', r.issuer);
  ok('拆行：有效期', r.validFrom === '2020-01-15' && r.validTo === '2026-01-14', r.validFrom + ' ~ ' + r.validTo);
  ok('拆行：复审日期', r.reviewDate === '2024-01-15', r.reviewDate);

  console.log('== 3. 解析：全角数字 / 中文日期 / 空格式 ==');
  const T2 = [
    '姓 名：李　强',
    '作业类别：焊接与热切割作业',
    '准操项目：熔化焊接与热切割',
    '证号：T32012020001330',
    '发证单位：市应急管理局',
    '有效期限：２０２０年０３月０１日 至 ２０２６年０２月２８日',
    '复审：2024年03月01日',
  ].join('\n');
  r = OCR.parse(T2);
  ok('姓名（全角空格）', r.name === '李强', r.name);
  ok('类别（焊接）', r.category === '焊接与热切割作业', r.category);
  ok('操作项目', r.operation === '熔化焊接与热切割', r.operation);
  ok('证号（证号写法）', r.certNo === 'T32012020001330', r.certNo);
  ok('发证单位 → issuer', r.issuer === '市应急管理局', r.issuer);
  ok('有效期中式日期', r.validFrom === '2020-03-01' && r.validTo === '2026-02-28', r.validFrom + ' ~ ' + r.validTo);
  ok('复审中式日期', r.reviewDate === '2024-03-01', r.reviewDate);

  console.log('== 4. 解析：类别反推 / 异常输入 ==');
  r = OCR.parse('准操项目：登高架设作业');
  ok('无「作业类别」行时用准操项目反推', r.category === '高处作业', r.category);
  r = OCR.parse('准操项目：起重机械指挥');
  ok('起重 → 吊装作业', r.category === '吊装作业', r.category);
  r = OCR.parse('这是一段无关文字 123');
  ok('无关文本不误填任何字段', Object.keys(r).length === 0, JSON.stringify(r));
  r = OCR.parse('');
  ok('空文本安全', Object.keys(r).length === 0);

  console.log('== 5. 识别：未配置接口时明确报错（不做假按钮） ==');
  const savedEndpoint = SD.CONFIG.ocr.endpoint;
  SD.CONFIG.ocr.endpoint = '';                 // 临时清空，模拟「还没配接口」
  ok('endpoint 为空时 ready() = false', OCR.ready() === false);
  let errMsg = '';
  try { await OCR.recognize('data:image/jpeg;base64,AAAA'); } catch (e) { errMsg = e.message; }
  ok('提示去 config.js 配 endpoint', /未配置识别接口/.test(errMsg) && /endpoint/.test(errMsg), errMsg);
  SD.CONFIG.ocr.endpoint = savedEndpoint;      // 恢复真实配置

  console.log('== 6. 识别：stub 接口返回文字（json 模式） ==');
  SD.CONFIG.ocr.endpoint = '/mock-ocr';
  let seenBody = null, seenHeaders = null;
  win.fetch = function (url, opt) {
    seenBody = opt && opt.body;
    seenHeaders = opt && opt.headers;
    return Promise.resolve(new Response(JSON.stringify({ text: T1 }), { headers: { 'Content-Type': 'application/json' } }));
  };
  const text = await OCR.recognize('data:image/jpeg;base64,QUJD');
  ok('取回文字', /张伟/.test(text), text.slice(0, 16));
  ok('请求体是 base64（不含 data: 前缀）', /"image":"QUJD"/.test(String(seenBody)), String(seenBody).slice(0, 40));
  ok('默认带 Content-Type: application/json', seenHeaders && seenHeaders['Content-Type'] === 'application/json');

  console.log('== 7. 识别：返回结构兜底（data.text / words_result） ==');
  win.fetch = () => Promise.resolve(new Response(JSON.stringify({ data: { text: '姓名 王磊' } }), { headers: { 'Content-Type': 'application/json' } }));
  ok('data.text 兜底', /王磊/.test(await OCR.recognize('data:image/jpeg;base64,QUJD')));
  win.fetch = () => Promise.resolve(new Response(JSON.stringify({ words_result: [{ words: '姓名 赵敏' }, { words: '通知编号 X' }] }), { headers: { 'Content-Type': 'application/json' } }));
  ok('words_result 兜底（百度式）', /赵敏/.test(await OCR.recognize('data:image/jpeg;base64,QUJD')));

  console.log('== 8. 界面：编辑弹窗有识别按钮，端到端填表 ==');
  win.fetch = (u, o) => globalThis.fetch(u, o);   // 先恢复正常
  win.location.hash = '#/specPersonnel';
  await wait(400);
  let rows = Array.from(doc.querySelectorAll('#view tbody tr'));
  if (!rows.length) {
    // 空白版没有示例数据：先造一条，才能测编辑弹窗里的识别按钮
    await SD.api.createSpecialPersonnel({
      code: 'TZZY-001', name: '待识别', dept: '生产一部', category: '电工作业',
      operation: '低压电工作业', certNo: 'PLACEHOLDER01', issuer: '',
      validFrom: '2020-01-01', validTo: '2026-01-01', reviewDate: '2024-01-01', status: 'valid'
    });
    if (SD.app.reload) SD.app.reload();     // 造完数据要重新取数，页面才会出现这一行
    await wait(1200);
    win.location.hash = '#/specPersonnel';
    await wait(600);
    rows = Array.from(doc.querySelectorAll('#view tbody tr'));
  }
  ok('台账有数据行', rows.length > 0, rows.length + ' 行');
  // 点第一行「操作 ▾」→ 编辑
  const opsBtn = doc.querySelector('#view [data-act="sops"]');
  ok('有操作下拉', !!opsBtn);
  opsBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(220);
  const menu = doc.querySelector('.dd-menu');
  const editItem = menu && Array.from(menu.querySelectorAll('.dd-item')).find(x => /编辑/.test(x.textContent));
  ok('菜单里有「编辑」', !!editItem);
  editItem.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(300);
  const modal = doc.querySelector('.mask');
  ok('编辑弹窗打开', !!modal);
  ok('弹窗顶部有识别工具条', !!modal.querySelector('.ocr-bar'));
  const ocrBtn = modal.querySelector('.js-ocr');
  ok('有「识别图片」按钮', !!ocrBtn && /识别图片/.test(ocrBtn.textContent));

  // 没上传照片就点 → 提示
  ocrBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(200);
  const toast1 = doc.querySelector('.toast');
  ok('未上传证件照时提示先添加图片', !!toast1 && /请先在「证件照」/.test(toast1.textContent), toast1 && toast1.textContent.trim().slice(0, 30));

  // 上传一张 1×1 JPEG 占位图，再点识别
  const phBox = modal.querySelector('#ff_photos');
  ok('证件照控件已挂载', !!(phBox && phBox._ph));
  const P1 = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEBAQFAwUFAAAAAQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEBAAA/APn+gD//2Q==';
  phBox._ph.set([P1]);
  ok('已放入 1 张证件照', phBox._ph.get().length === 1);

  // 配好接口 + stub 返回标准证书文字
  SD.CONFIG.ocr.endpoint = '/mock-ocr';
  win.fetch = function () {
    return Promise.resolve(new Response(JSON.stringify({ text: T1 }), { headers: { 'Content-Type': 'application/json' } }));
  };
  ocrBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(600);
  const v = id => (modal.querySelector('#ff_' + id) || {}).value;
  ok('姓名已填入', v('name') === '张伟', v('name'));
  ok('作业类别已填入（下拉）', v('category') === '电工作业', v('category'));
  ok('操作项目已填入', v('operation') === '低压电工作业', v('operation'));
  ok('证书编号已填入', v('certNo') === 'T32012020018200', v('certNo'));
  ok('发证机关已填入', v('issuer') === '江苏省应急管理厅', v('issuer'));
  ok('有效期起已填入', v('validFrom') === '2020-01-15', v('validFrom'));
  ok('有效期止已填入', v('validTo') === '2026-01-14', v('validTo'));
  ok('复审日期已填入', v('reviewDate') === '2024-01-15', v('reviewDate'));
  ok('提示条显示已填项数', /已填入 \d+ 项/.test(modal.querySelector('.js-ocr-tip').textContent),
    modal.querySelector('.js-ocr-tip').textContent.slice(0, 40));

  // 保存后字段真的落库？（直接调 onSubmit 太绕，改验证 readValues 能读到）
  const vals = SD.comp.formDialog.readValues(modal, [{ name: 'name' }, { name: 'certNo' }], {});
  ok('表单回读能拿到识别值', vals.name === '张伟' && vals.certNo === 'T32012020018200', JSON.stringify(vals));

  console.log('\n结果：通过 ' + pass + ' / 失败 ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('异常:', (e && e.stack) || e); process.exit(1); });
