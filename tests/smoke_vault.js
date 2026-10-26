/* 安全员工作台 · 照片「不压缩 + 大图外置」自检
   用法：node smoke_vault.js [url]        默认 http://127.0.0.1:8124/index.html
   覆盖：① 不压缩：读文件返回原始分辨率 dataURL（长度≈原始大小×4/3），不走压缩分支
        ② 上传护栏：单张超 25MB 拒收、非图片拒收、HEIC 给出可操作提示
        ③ 无 IndexedDB 环境（jsdom 默认）：photoVault 自动降级，store 仍能正常读写
        ④ 有 IndexedDB 环境（fake-indexeddb）：大图落盘时外置成 vault:key、
           localStorage 体积大幅下降、启动水合能换回原图、同图复用同一 key、清空时清仓库
   说明：真实浏览器走 ④ 这条路径；jsdom 无 IDB 走 ③，两条都要过。
*/
const { JSDOM, requestInterceptor } = require('jsdom');
const { indexedDB: fakeIDB, IDBKeyRange } = require('fake-indexeddb');
const skipPrint = requestInterceptor(r => {
  if (String(r.url).indexOf('print-only.css') >= 0) {
    return new Response('', { headers: { 'Content-Type': 'text/css' } });
  }
});
const wait = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n + (x != null ? '  → ' + x : '')); } else { fail++; console.log('  FAIL ' + n + (x != null ? '  → ' + x : '')); } };

const URL_ = process.argv[2] || 'http://127.0.0.1:8124/index.html';

async function boot(withIDB) {
  const dom = await JSDOM.fromURL(URL_, {
    runScripts: 'dangerously', resources: { interceptors: [skipPrint] }, pretendToBeVisual: true,
    beforeParse(win) {
      win.matchMedia = q => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      win.fetch = (u, o) => globalThis.fetch(u, o);
      win.Headers = globalThis.Headers; win.Request = globalThis.Request;
      win.Response = globalThis.Response; win.AbortController = globalThis.AbortController;
      if (withIDB) { win.indexedDB = fakeIDB; win.IDBKeyRange = IDBKeyRange; }
    },
  });
  const win = dom.window, doc = win.document;
  for (let i = 0; i < 120 && !(win.SD && win.SD.app && win.SD.app.state.summary); i++) await wait(120);
  win.SD.auth.set('safety_officer');   // 2026-10-25：默认受限，先解锁
  return { win, doc, SD: win.SD };
}

(async () => {
  /* ================= A. 不压缩 + 上传护栏（用真实 jsdom 窗口） ================= */
  const A = await boot(false);
  const { win, doc, SD } = A;

  console.log('== A. 照片读取：默认不压缩 ==');
  ok('config 有 photo 配置', !!SD.CONFIG.photo);
  ok('默认 compress = false（不压缩）', SD.CONFIG.photo.compress === false, String(SD.CONFIG.photo.compress));
  ok('photoPicker.readFile 已导出', typeof SD.comp.photoPicker.readFile === 'function');

  // 造一个 600KB 的「JPEG」：不压缩应原样返回（base64 比原文件还大）
  const size = 600 * 1024;
  const buf = new Uint8Array(size);
  for (let i = 0; i < size; i++) buf[i] = i % 251;
  buf[0] = 0xFF; buf[1] = 0xD8; buf[2] = 0xFF;      // JPEG 头
  const f = new win.File([buf], 'IMG_2041.jpg', { type: 'image/jpeg' });
  const got = await new Promise(res => SD.comp.photoPicker.readFile(f, (url, err) => res({ url, err })));
  ok('读取成功（无错误）', !!got.url && !got.err, got.err);
  ok('返回 data:image/jpeg 原图', !!got.url && got.url.indexOf('data:image/jpeg;base64,') === 0);
  ok('保留了原始大小（未压缩：base64 ≥ 原文件）', !!got.url && got.url.length >= size,
    got.url && (got.url.length + ' chars vs 原始 ' + size + ' bytes'));
  ok('未被压到 1000px 的尺寸量级（压缩后通常 < 200KB）', !!got.url && got.url.length > 700 * 1024,
    got.url && Math.round(got.url.length / 1024) + 'KB');

  console.log('== B. 上传护栏 ==');
  const tooBig = { size: 30 * 1024 * 1024, type: 'image/jpeg', name: 'huge.jpg' };
  const r1 = await new Promise(res => SD.comp.photoPicker.readFile(tooBig, (u, e) => res({ u, e })));
  ok('超 25MB 直接拒收', !r1.u && /25MB|上限/.test(r1.e || ''), r1.e);

  const notImg = new win.File([new Uint8Array(10)], 'a.pdf', { type: 'application/pdf' });
  const r2 = await new Promise(res => SD.comp.photoPicker.readFile(notImg, (u, e) => res({ u, e })));
  ok('非图片拒收并说明类型', !r2.u && /不是图片/.test(r2.e || ''), r2.e);

  const heic = { size: 1024, type: 'image/heic', name: 'a.heic' };
  const r3 = await new Promise(res => SD.comp.photoPicker.readFile(heic, (u, e) => res({ u, e })));
  ok('HEIC 给出可操作提示（另存 JPG）', !r3.u && /HEIC|JPG/.test(r3.e || ''), r3.e);

  console.log('== C. 无 IndexedDB 时自动降级（jsdom） ==');
  ok('photoVault 已加载', !!SD.photoVault);
  ok('enabled() = false（本环境没有 IDB）', SD.photoVault.enabled() === false);
  ok('ready() 返回 false 而不是抛错', (await SD.photoVault.ready()) === false);
  ok('store.init 存在', typeof SD.store.init === 'function');
  await SD.store.init();
  ok('降级后业务数据照常可读', !!(SD.store.data() && SD.store.data().hazards), (SD.store.data().hazards || []).length + ' 条隐患');

  /* ================= D. 有 IndexedDB：外置 + 水合 ================= */
  console.log('== D. IndexedDB 可用时：大图外置 / 启动水合 ==');
  const B = await boot(true);
  const SD2 = B.SD, win2 = B.win;

  ok('enabled() = true', SD2.photoVault.enabled() === true);
  ok('ready() = true', (await SD2.photoVault.ready()) === true);

  // 造一张「大图」（> LIMIT）
  const bigLen = Math.round(SD2.photoVault.LIMIT * 2.2);
  const big = 'data:image/jpeg;base64,' + 'A'.repeat(bigLen);
  const small = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
  const payload = { trainings: [{ code: 'T1', photos: [big, small] }] };

  const slim = await SD2.photoVault.externalize(payload);
  ok('大图被替换成 vault: 引用', slim.trainings[0].photos[0].indexOf('vault:') === 0, slim.trainings[0].photos[0].slice(0, 14));
  ok('小图保持原样（不值得外置）', slim.trainings[0].photos[1] === small);
  ok('外置后 JSON 体积大幅下降',
    JSON.stringify(slim).length < JSON.stringify(payload).length / 2,
    JSON.stringify(slim).length + ' vs ' + JSON.stringify(payload).length);

  const back = await SD2.photoVault.hydrate(slim);
  ok('水合后照片完整还原', back.trainings[0].photos[0] === big, (back.trainings[0].photos[0] || '').length + ' chars');
  ok('水合不影响小图', back.trainings[0].photos[1] === small);

  const k1 = SD2.photoVault.keyOf(big), k2 = SD2.photoVault.keyOf(big);
  ok('同一张图 key 稳定（重复保存不堆积）', k1 === k2, k1);

  /* ================= E. store 落盘走外置（模拟刷新） ================= */
  console.log('== E. store 落盘：localStorage 只存引用，刷新后水合回原图 ==');
  const key = SD2.CONFIG.storageKey;
  win2.localStorage.removeItem(key);
  const rawData = JSON.parse(JSON.stringify(SD2.store.data()));
  rawData.trainings = [{ id: 't-vault-test', code: 'FZPX-TEST-01', name: '水合测试', photos: [big] }];
  SD2.store.setData(rawData);
  await wait(900);                                  // 等异步外置写完

  const rawStr = win2.localStorage.getItem(key) || '';
  ok('localStorage 里已落盘', rawStr.length > 0, rawStr.length + ' chars');
  ok('localStorage 不含原始大图（体积可控）', rawStr.indexOf('A'.repeat(2000)) < 0);
  ok('localStorage 里是 vault 引用', /vault:p[0-9a-z]+-[0-9a-z]+/.test(rawStr));

  // 模拟刷新：新建窗口读同一 origin 的 localStorage 不共享（jsdom 隔离），
  // 所以这里直接在内存里验 store.init 的水合能力
  SD2.store.load();                                  // 从 localStorage 读回（照片是引用）
  const afterLoad = SD2.store.data().trainings[0].photos[0];
  ok('刚读回时是引用（未水合）', String(afterLoad).indexOf('vault:') === 0, String(afterLoad).slice(0, 14));
  await SD2.store.init();                            // 走完整启动流程
  const hydrated = SD2.store.data().trainings[0].photos[0];
  ok('store.init 后水合回原图', hydrated === big, (hydrated || '').length + ' chars');

  console.log('== F. 清空数据时同步清仓库 ==');
  await SD2.photoVault.clear();
  const env2 = await SD2.photoVault.hydrate({ trainings: [{ photos: ['vault:' + k1] }] });
  ok('清仓后引用换成占位图（不破图）', /照片丢失|data:image\/svg/.test(env2.trainings[0].photos[0]),
    String(env2.trainings[0].photos[0]).slice(0, 40));

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ERR', e && e.stack || e); process.exit(1); });
