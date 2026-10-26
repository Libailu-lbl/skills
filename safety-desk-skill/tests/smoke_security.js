/* 安全员工作台 · 安全控制自检（2026-10-25 新增）
   用法：node smoke_security.js [url]     默认 http://127.0.0.1:8124/index.html
   覆盖：
     ① 清空数据专用密码：默认值 / 格式校验 / 与登录密码分开存
     ② 受限用户点「清空数据」→ 先要安全员密码，不会直接进清空流程
     ③ 解锁后点「清空数据」→ 弹**专用密码**框（不是点一下就删）
     ④ 专用密码输错 → 不执行、弹窗不关、明确红字提示、数据一条没少
     ⑤ 专用密码正确 → 真的清空（标记数据消失）
     ⑥ 专用密码可单独修改；两次不一致 / 与登录密码相同 都被拒
     ⑦ 空闲自动锁定：默认 30 分钟、超时退回受限、有操作就重新计时、受限态不重复锁、配 0 可关闭
     ⑧ 打印/预览里「巡检人员：」后面留出 38mm 签名位（带下划线）；导出 Excel 里留 10 个全角空格
*/
const { JSDOM, requestInterceptor, VirtualConsole } = require('jsdom');

const skipPrint = requestInterceptor(r => {
  if (String(r.url).indexOf('print-only.css') >= 0) return new Response('', { headers: { 'Content-Type': 'text/css' } });
});
const wait = ms => new Promise(r => setTimeout(r, ms));

/* stored（不压缩）ZIP 解包（xlsxWriter 产出的条目都是 stored） */
function unzipStored(buf) {
  const out = {};
  let p = 0;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  while (p + 30 <= buf.length && dv.getUint32(p, true) === 0x04034b50) {
    const nameLen = dv.getUint16(p + 26, true);
    const extraLen = dv.getUint16(p + 28, true);
    const compSize = dv.getUint32(p + 18, true);
    const name = Buffer.from(buf.slice(p + 30, p + 30 + nameLen)).toString('utf8');
    const ds = p + 30 + nameLen + extraLen;
    out[name] = buf.slice(ds, ds + compSize);
    p = ds + compSize;
  }
  return out;
}

let P = 0, F = 0;
function ok(name, cond, extra) {
  if (cond) P++;
  else { F++; console.log('  FAIL ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : '')); }
}

(async () => {
  const errs = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errs.push('jsdomError: ' + e.message));
  vc.on('error', m => errs.push('console.error: ' + m));

  const dom = await JSDOM.fromURL(process.argv[2] || 'http://127.0.0.1:8124/index.html', {
    runScripts: 'dangerously', resources: { interceptors: [skipPrint] }, pretendToBeVisual: true,
    beforeParse(win) {
      win.matchMedia = q => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      win.fetch = (u, o) => globalThis.fetch(u, o);
      win.Headers = globalThis.Headers; win.Request = globalThis.Request;
      win.Response = globalThis.Response; win.AbortController = globalThis.AbortController;
      win.URL.createObjectURL = () => 'blob:stub';
      win.URL.revokeObjectURL = () => {};
      win.scrollTo = () => {};
    },
    virtualConsole: vc
  });
  const win = dom.window, doc = win.document;
  for (let i = 0; i < 120 && !(win.SD && win.SD.app && win.SD.app.state.summary); i++) await wait(120);
  const SD = win.SD;
  const view = () => doc.getElementById('view');
  const go = async (id) => { win.location.hash = '#/' + id; await wait(650); };
  const dlgTxt = () => (doc.getElementById('dialogRoot') || {}).textContent || '';
  const okBtn = () => doc.querySelector('#dialogRoot .js-ok');
  const dlgOpen = () => !!doc.querySelector('#dialogRoot .mask');

  ok('默认还是受限（前置条件）', SD.auth.current() === 'restricted', SD.auth.current());

  /* ---------- 1. 专用密码基础 ---------- */
  console.log('== 1. 清空数据专用密码：默认值与格式 ==');
  ok('有独立的专用密码校验 API', typeof SD.auth.verifyPurge === 'function');
  ok('默认专用密码是 888888', SD.auth.verifyPurge('888888') === true);
  ok('错密码被拒', SD.auth.verifyPurge('000000') === false);
  ok('不足 6 位被拒', SD.auth.verifyPurge('8888') === false);
  ok('未改过时 hasPurgePin() = false', SD.auth.hasPurgePin() === false);
  ok('专用密码与登录密码是两套', SD.auth.verifyPurge('123456') === false && SD.auth.verifyPin('888888') === false);

  /* ---------- 2. 受限用户点清空 ---------- */
  console.log('== 2. 受限用户点「清空数据」：先要安全员密码 ==');
  doc.getElementById('btnGear').click();
  await wait(120);
  doc.getElementById('btnReset').click();
  await wait(250);
  ok('没有直接弹清空框，而是要求解锁', /进入安全员权限|需要安全员权限/.test(dlgTxt()), dlgTxt().slice(0, 60));
  ok('此时没有专用密码输入框', !doc.getElementById('purgeInput') && !doc.querySelector('.js-purge-inp'));
  doc.querySelector('#dialogRoot .js-cancel') && doc.querySelector('#dialogRoot .js-cancel').click();
  await wait(150);

  /* ---------- 3. 解锁后点清空 → 专用密码框 ---------- */
  console.log('== 3. 解锁后点「清空数据」：必须输专用密码 ==');
  SD.auth.set('safety_officer');
  SD.app.refreshAll();
  await wait(300);

  /* 塞一条标记数据，用来验证「密码错 → 数据一点没动」 */
  const mem = SD.store.data();
  mem.notices.push({ id: 'MK-TEST-1', code: 'MK-001', title: '清空密码校验用标记', type: 'other', level: 'normal', content: 'marker', date: '2026-10-25', status: 'published' });
  SD.store.save();
  const beforeNotices = SD.store.data().notices.length;
  ok('标记数据已写入', SD.store.data().notices.some(n => n.id === 'MK-TEST-1'), beforeNotices);

  doc.getElementById('btnGear').click();
  await wait(120);
  doc.getElementById('btnReset').click();
  await wait(250);
  ok('弹出「清空数据（需专用密码）」', /专用密码/.test(dlgTxt()), dlgTxt().slice(0, 60));
  const purgeInp = doc.querySelector('#dialogRoot .js-purge-inp');
  ok('有专用密码输入框（type=password, maxlength=6）',
    !!purgeInp && purgeInp.type === 'password' && purgeInp.maxLength === 6,
    purgeInp && purgeInp.type);
  ok('提示默认专用密码', /888888/.test(dlgTxt()), dlgTxt().slice(0, 120));

  /* ---------- 4. 密码错误 → 禁止执行 ---------- */
  console.log('== 4. 专用密码输错：禁止执行 + 明确提示 ==');
  purgeInp.value = '000000';
  okBtn().click();
  await wait(300);
  ok('弹窗没有关闭（拦住不让过去）', dlgOpen());
  ok('给出明确提示', /专用密码不正确/.test(dlgTxt()) && /没有(任何)?改动|已阻止/.test(dlgTxt()), dlgTxt().slice(0, 120));
  ok('数据一条没少', SD.store.data().notices.length === beforeNotices &&
    SD.store.data().notices.some(n => n.id === 'MK-TEST-1'), SD.store.data().notices.length);

  /* 位数不对也不行 */
  purgeInp.value = '123';
  okBtn().click();
  await wait(250);
  ok('不足 6 位同样被拦', dlgOpen() && /6 位数字/.test(dlgTxt()), dlgTxt().slice(0, 90));
  ok('数据仍然没动', SD.store.data().notices.some(n => n.id === 'MK-TEST-1'));

  /* ---------- 5. 密码正确 → 执行 ---------- */
  console.log('== 5. 专用密码正确：真的清空 ==');
  purgeInp.value = '888888';
  okBtn().click();
  await wait(900);
  ok('弹窗关闭（执行完成）', !dlgOpen());
  ok('标记数据被清掉', !SD.store.data().notices.some(n => n.id === 'MK-TEST-1'),
    SD.store.data().notices.length);

  /* ---------- 6. 专用密码可单独修改 ---------- */
  console.log('== 6. 专用密码：单独修改与校验 ==');
  const r1 = SD.auth.setPurgePin('246810');
  ok('可单独设新专用密码', r1.ok === true, r1);
  ok('新专用密码生效', SD.auth.verifyPurge('246810') === true);
  ok('旧默认密码失效', SD.auth.verifyPurge('888888') === false);
  ok('hasPurgePin() 变 true', SD.auth.hasPurgePin() === true);
  const r2 = SD.auth.setPurgePin('123456');
  ok('不允许与登录密码相同', r2.ok === false, r2 && r2.msg);
  const r3 = SD.auth.setPurgePin('12ab');
  ok('非 6 位数字被拒', r3.ok === false, r3 && r3.msg);
  ok('登录密码不受影响', SD.auth.verifyPin('123456') === true);

  /* UI：改密码弹窗里也能改专用密码 */
  doc.getElementById('btnGear').click();
  await wait(120);
  doc.getElementById('btnPwd').click();
  await wait(250);
  ok('密码设置里有专用密码输入框', !!doc.getElementById('pwPurge') && !!doc.getElementById('pwPurge2'));
  /* 先单测「两次专用密码不一致」：登录密码填合法值，避免被前面的默认密码规则先拦下 */
  doc.getElementById('pwNew').value = '864209';
  doc.getElementById('pwNew2').value = '864209';
  doc.getElementById('pwPurge').value = '135790';
  doc.getElementById('pwPurge2').value = '135791';
  okBtn().click();
  await wait(220);
  ok('两次专用密码不一致被拒', /不一致/.test(dlgTxt()), dlgTxt().slice(0, 90));
  /* 专用密码与登录密码相同也不行 */
  doc.getElementById('pwPurge').value = '864209';
  doc.getElementById('pwPurge2').value = '864209';
  okBtn().click();
  await wait(220);
  ok('专用密码不能与登录密码相同（界面层也拦）', /不能与登录密码相同/.test(dlgTxt()), dlgTxt().slice(0, 90));
  /* 改成合法的新登录密码 + 新专用密码 */
  doc.getElementById('pwPurge').value = '135790';
  doc.getElementById('pwPurge2').value = '135790';
  okBtn().click();
  await wait(400);
  ok('登录密码与专用密码一起改成功', !dlgOpen() && SD.auth.verifyPin('864209') && SD.auth.verifyPurge('135790'),
    [dlgOpen(), SD.auth.verifyPin('864209'), SD.auth.verifyPurge('135790')]);

  /* ---------- 7. 空闲 30 分钟自动退回受限 ---------- */
  console.log('== 7. 空闲自动锁定（默认 30 分钟） ==');
  ok('默认阈值 = 30 分钟', SD.app.idle.ms() === 30 * 60000, SD.app.idle.ms());
  ok('有 idle API（check / touch / ms / start）',
    typeof SD.app.idle.check === 'function' && typeof SD.app.idle.touch === 'function' &&
    typeof SD.app.idle.start === 'function');

  SD.auth.set('safety_officer');
  SD.app.refreshAll();
  await wait(200);
  ok('先在安全员状态', SD.auth.current() === 'safety_officer');
  SD.app.idle.touch();
  ok('刚有操作 → 不锁', SD.app.idle.check() === false);
  ok('有操作后仍是安全员', SD.auth.current() === 'safety_officer');

  /* 把阈值临时调成 0.01 分钟（0.6s）模拟「闲置 30 分钟」 */
  const oldMin = SD.CONFIG.security.idleLockMin;
  SD.CONFIG.security.idleLockMin = 0.01;
  ok('阈值可临时改短（0.01 分钟）', SD.app.idle.ms() === 600, SD.app.idle.ms());
  SD.app.idle.touch();
  await wait(250);
  ok('还没到点 → 不锁', SD.app.idle.check() === false);
  await wait(600);
  ok('超时 → 自动退回受限', SD.app.idle.check() === true, SD.auth.current());
  ok('角色真的变回受限', SD.auth.current() === 'restricted', SD.auth.current());
  ok('徽标同步显示「受限模式」', doc.getElementById('rolePillTxt').textContent === '受限模式',
    doc.getElementById('rolePillTxt').textContent);
  ok('受限态再检查不会重复触发', SD.app.idle.check() === false);
  ok('退回后写权限没了', SD.auth.can('data.write') === false);

  /* 有操作就重新计时 */
  SD.CONFIG.security.idleLockMin = 0.01;
  SD.auth.set('safety_officer');
  SD.app.refreshAll();
  await wait(100);
  SD.app.idle.touch();
  await wait(400);
  SD.app.idle.touch();           /* 中途动了鼠标 → 重新计时 */
  await wait(400);
  ok('中途有操作 → 重新计时，不会锁', SD.app.idle.check() === false && SD.auth.current() === 'safety_officer');

  /* 配 0 = 关闭 */
  SD.CONFIG.security.idleLockMin = 0;
  ok('配 0 时 ms() = 0（关闭）', SD.app.idle.ms() === 0);
  ok('关闭后怎么等都不锁', SD.app.idle.check() === false);
  SD.CONFIG.security.idleLockMin = oldMin;

  /* 活动事件真的会刷新时间戳（绑了 mousedown / keydown 等） */
  SD.CONFIG.security.idleLockMin = 0.01;
  SD.app.idle.touch();
  await wait(300);
  doc.dispatchEvent(new win.MouseEvent('mousedown', { bubbles: true }));
  await wait(400);
  ok('点一下鼠标 → 重新计时', SD.app.idle.check() === false);
  SD.CONFIG.security.idleLockMin = oldMin;

  /* ---------- 8. 巡检人员签名位 ---------- */
  console.log('== 8. 打印/预览：巡检人员后留签名位 ==');
  SD.auth.set('safety_officer');
  SD.app.refreshAll();
  await go('shiftLog');
  const btns = () => Array.from(view().querySelectorAll('.btn'));
  btns().filter(b => /打印/.test(b.textContent))[0].click();
  await wait(400);
  const ov = doc.querySelector('.sl-overlay');
  ok('打开打印预览', !!ov);
  const blank = ov && ov.querySelector('.c-blank');
  ok('有签名空位元素 .c-blank', !!blank);
  if (blank) {
    const cs = win.getComputedStyle(blank);
    const MM = 96 / 25.4;
    ok('空位宽 38mm（原表 A3 里那段空档）', Math.abs(parseFloat(cs.minWidth) - 38 * MM) < 1,
      cs.minWidth + ' = ' + (parseFloat(cs.minWidth) / MM).toFixed(1) + 'mm');
    ok('空位是一条可签字的横线（border-bottom）', /solid/.test(cs.borderBottomStyle) || cs.borderBottomWidth !== '0px',
      cs.borderBottom);
    ok('空位是行内块、不塌成 0 宽', cs.display === 'inline-block', cs.display);
  }
  const metaTxt = ov.querySelector('.c-meta-main').textContent;
  ok('顺序是 巡检人员：<空位> 班次：',
    /巡检人员：[\s\S]*班次：/.test(metaTxt) && metaTxt.indexOf('巡检人员：') < metaTxt.indexOf('班次：'),
    metaTxt.slice(0, 70));
  ok('打印件里不出现具体姓名', metaTxt.indexOf('王安全') < 0);
  ov.querySelector('.js-sl-close').click();
  await wait(200);

  /* 导出 Excel 里的占位空格 */
  let cap = null, dlName = '';
  SD.comp.xlsxWriter.download = (blob, name) => { dlName = name; cap = blob; };
  btns().filter(b => /导出 Excel/.test(b.textContent))[0].click();
  await wait(700);
  ok('导出成功', !!cap, dlName);
  if (cap) {
    const zip = unzipStored(new Uint8Array(await cap.arrayBuffer()));
    const sheet = Buffer.from(zip['xl/worksheets/sheet1.xml'] || '').toString('utf8');
    const m = sheet.match(/巡检人员：([\u3000 ]*)班次/);
    /* 10 个全角空格的签名位 + 2 个全角空格的分隔（与「班次：」之间） */
    ok('Excel 里「巡检人员：」后留 10 个全角空格签名位（≈38.8mm，外加 2 个分隔空格）',
      !!m && m[1] === '　　　　　　　　　　' + '　　', m && m[1].length);
    ok('Excel 里不写姓名', sheet.indexOf('王安全') < 0);
  }

  console.log('errors:', errs.slice(0, 4));
  console.log('结果：通过 ' + P + ' / 失败 ' + F);
  process.exit(F ? 1 : 0);
})().catch(e => { console.log('ERR', e.stack); process.exit(1); });
