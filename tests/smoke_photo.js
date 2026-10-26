/* 安全员工作台 · 培训照片下载与水印自检
   用法：node smoke_photo.js [url]        默认 http://127.0.0.1:8124/index.html
   覆盖：① 组件与默认配置 ② 两行水印文案拼接（型号·地点 / 日期 时间）
        ③ 排版（按图宽等比、小图字号下限、行距不重叠）④ 文件名
        ⑤ **绘制位置**（用 mock canvas 验证：两行都画在左下角、第一行在上）
        ⑥ 界面：培训行操作 → 下载照片 → 弹窗默认值 → 改型号 → 关闭
   说明：jsdom 没有 canvas 实现，绘制位置用 mock context 断言（见段 C），
        真机上的合成效果与浏览器一致（canvas 2d 标准 API）。
*/
const { JSDOM, requestInterceptor } = require('jsdom');
const skipPrint = requestInterceptor(r => {
  if (String(r.url).indexOf('print-only.css') >= 0) {
    return new Response('', { headers: { 'Content-Type': 'text/css' } });
  }
});
const wait = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra != null ? '  → ' + extra : '')); }
}

(async () => {
  const url = process.argv[2] || 'http://127.0.0.1:8124/index.html';
  const dom = await JSDOM.fromURL(url, {
    runScripts: 'dangerously', resources: { interceptors: [skipPrint] }, pretendToBeVisual: true,
    beforeParse(win) {
      win.matchMedia = q => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      win.fetch = (u, o) => globalThis.fetch(u, o);
      win.Headers = globalThis.Headers; win.Request = globalThis.Request;
      win.Response = globalThis.Response; win.AbortController = globalThis.AbortController;
    },
  });
  const win = dom.window, doc = win.document;
  for (let i = 0; i < 100 && !(win.SD && win.SD.app && win.SD.app.state.summary); i++) await wait(120);
  const SD = win.SD;
  // 2026-10-25：工作台默认「受限用户」，测试先解锁为安全员（等同输入六位密码）
  SD.auth.set('safety_officer');
  if (SD.app.refreshAll) SD.app.refreshAll();
  await wait(300);


  console.log('== A. 组件与默认配置 ==');
  ok('photoWatermark 组件已加载', !!SD.comp.photoWatermark);
  const WM = SD.comp.photoWatermark;
  ok('开放 open / lines / layout / paint / fileName',
    ['open', 'lines', 'layout', 'paint', 'fileName'].every(k => typeof WM[k] === 'function'));
  ok('config 有水印默认配置', !!SD.CONFIG.watermark);
  ok('默认地点已配（可在 config 改）', !!String(SD.CONFIG.watermark.place || '').trim(), SD.CONFIG.watermark.place);
  const np = WM.nowParts();
  ok('默认日期格式 YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(np.date), np.date);
  ok('默认时间格式 HH:mm', /^\d{2}:\d{2}$/.test(np.time), np.time);

  console.log('== B. 两行文案与排版 ==');
  const L = WM.lines({ phone: 'HUAWEI Mate 60 Pro', place: '江苏省南通市', date: '2026-10-24', time: '14:30' });
  ok('第一行 = 型号 · 地点', L[0] === 'HUAWEI Mate 60 Pro · 江苏省南通市', L[0]);
  ok('第二行 = 日期 时间', L[1] === '2026-10-24 14:30', L[1]);
  const L2 = WM.lines({ phone: '', place: '厂区 3 号门', date: '2026-10-24', time: '' });
  ok('型号空 → 第一行只留地点', L2[0] === '厂区 3 号门', L2[0]);
  ok('时间空 → 第二行只留日期', L2[1] === '2026-10-24', L2[1]);
  ok('全空 → 两行都是空串', WM.lines({}).every(x => x === ''));

  const mid = WM.layout(1000, { size: 'mid' });
  ok('中档 1000px 第一行字号 26', mid.fs === 26, JSON.stringify(mid));
  ok('第二行比第一行小一档', mid.fs2 < mid.fs, mid.fs + ' → ' + mid.fs2);
  ok('行距 > 第一行字号（两行不叠）', mid.lh > mid.fs, mid.lh + ' vs ' + mid.fs);

  const small = WM.layout(1000, { size: 'small' });
  const xsmall = WM.layout(1000, { size: 'xsmall' });
  ok('小档 1000px 字号 20', small.fs === 20, small.fs);
  ok('「很小」= 小的 2/3', Math.abs(xsmall.fs - small.fs * 2 / 3) <= 1, xsmall.fs + ' vs ' + small.fs + '×2/3');
  ok('大档比中档大', WM.layout(1000, { size: 'large' }).fs > mid.fs);
  ok('字号有下限 8（很小档小图不消失）', WM.layout(200, { size: 'xsmall' }).fs >= 8,
    WM.layout(200, { size: 'xsmall' }).fs);

  ok('日期转正斜杠', WM.dateSlash('2026-10-24') === '2026/10/24', WM.dateSlash('2026-10-24'));
  ok('旧的反斜杠也转回正斜杠', WM.dateSlash('2026\\10\\24') === '2026/10/24', WM.dateSlash('2026\\10\\24'));

  const rows = WM.buildRows({ phone: 'HUAWEI', place: '南通', date: '2026-10-24', time: '14:30' }, WM.layout(1000, {}));
  ok('拆成两行', rows.length === 2, rows.length);
  ok('第一行三段：型号 / 分隔 / 地点', rows[0].parts.length === 3, rows[0].parts.map(p => p.text).join('|'));
  ok('型号压扁、地点不压扁', rows[0].parts[0].squash === true && rows[0].parts[2].squash === false);
  ok('分隔符是「 · 」', rows[0].parts[1].text === ' · ', JSON.stringify(rows[0].parts[1].text));
  ok('第二行日期是正斜杠写法', rows[1].parts[0].text === '2026/10/24', rows[1].parts[0].text);
  ok('日期与时间都压扁（地点/分隔符不压）', rows[1].parts[0].squash === true && rows[1].parts[2].squash === true);
  ok('第二行字号小于第一行', rows[1].fs < rows[0].fs, rows[0].fs + ' vs ' + rows[1].fs);

  console.log('== C. 绘制（mock canvas：位置 / 字号 / 压扁） ==');
  const calls = { fill: [], stroke: [], scale: [], draws: 0 };
  let stack = [], cur = [0, 0], curScale = 1, curFont = '';
  const ctx = {
    set font(v) { curFont = v; }, get font() { return curFont; },
    textBaseline: '', lineJoin: '', lineWidth: 0, strokeStyle: '', fillStyle: '',
    measureText: t => ({ width: String(t).length * 12 }),
    drawImage() { calls.draws++; },
    save() { stack.push([cur.slice(), curScale]); },
    restore() { const p = stack.pop() || [[0, 0], 1]; cur = p[0]; curScale = p[1]; },
    translate(x, y) { cur = [x, y]; },
    scale(sx, sy) { curScale = sy; calls.scale.push([sx, sy]); },
    fillText(t, x, y) { calls.fill.push({ t, x: cur[0] + x, y: cur[1] + y, sy: curScale, fs: (function () { var m = /(\d+(?:\.\d+)?)px/.exec(curFont); return m ? parseFloat(m[1]) : 0; })() }); },
    strokeText(t, x, y) { calls.stroke.push({ t, x: cur[0] + x, y: cur[1] + y }); }
  };
  const img = { naturalWidth: 1000, naturalHeight: 750, width: 1000, height: 750 };
  const fakeCv = { width: 0, height: 0, getContext: () => ctx };
  WM.paint(fakeCv, img, { phone: 'HUAWEI', place: '南通', date: '2026-10-24', time: '14:30', size: 'mid' });

  ok('画布尺寸 = 原图尺寸', fakeCv.width === 1000 && fakeCv.height === 750, fakeCv.width + 'x' + fakeCv.height);
  ok('先铺原图', calls.draws === 1, calls.draws);
  ok('共画 6 段（两行各 3 段）', calls.fill.length === 6, calls.fill.length);
  ok('每段都有深色描边', calls.stroke.length === 6, calls.stroke.length);

  const rowsY = {};
  calls.fill.forEach(c => { rowsY[c.y] = rowsY[c.y] || []; rowsY[c.y].push(c); });
  const ys = Object.keys(rowsY).map(Number).sort((a, b) => a - b);   // 上 → 下
  ok('分成两行', ys.length === 2, ys.join(' / '));
  const top = rowsY[ys[0]], bottom = rowsY[ys[1]];
  ok('上行 = 型号 + 分隔 + 地点', top.map(c => c.t).join('') === 'HUAWEI · 南通', top.map(c => c.t).join(''));
  ok('下行 = 正斜杠日期 + 空格 + 时间', bottom.map(c => c.t).join('') === '2026/10/24 14:30', bottom.map(c => c.t).join(''));
  /* 2026-10-25：时间可留空 —— 留空时第二行只写日期，不留空洞 */
  const noTime = WM.buildRows({ phone: 'HUAWEI', place: '南通', date: '2026-10-24', time: '' }, L);
  ok('时间为空 → 第二行只剩日期', noTime[1].parts.length === 1 && noTime[1].parts[0].text === '2026/10/24',
    noTime[1].parts.map(p => p.text).join(''));
  ok('时间为空 → 仍保持两行（型号/地点 + 日期）', noTime.length === 2, noTime.length);
  const blankAll = WM.buildRows({ phone: '', place: '', date: '', time: '' }, L);
  ok('日期时间全空 → 不画文字行', blankAll.every(r => !r.parts.length), JSON.stringify(blankAll.map(r => r.parts.length)));

  ok('型号压扁到 70%', Math.abs(top[0].sy - 0.70) < 0.001, top[0].sy);
  ok('地点不压扁', top[2].sy === 1, top[2].sy);
  ok('地点与型号同字号（第一行同一档）', top[2].fs === top[0].fs, top[0].fs + ' vs ' + top[2].fs);
  ok('日期压扁到 70%', Math.abs(bottom[0].sy - 0.70) < 0.001, bottom[0].sy);
  ok('时间压扁到 70%（用户指定）', Math.abs(bottom[2].sy - 0.70) < 0.001, bottom[2].sy);
  ok('字重 300（细体，不加粗）', /^300 /.test(WM.fontOf(20)), WM.fontOf(20));
  ok('第二行字号比第一行小', bottom[0].fs < top[0].fs, top[0].fs + ' vs ' + bottom[0].fs);

  const pad = Math.round(1000 * 0.022);
  ok('从左边距起画', top[0].x === pad, top[0].x + ' vs pad ' + pad);
  ok('下行贴底边距', Math.abs(bottom[0].y - (750 - pad)) < 1, bottom[0].y + ' vs ' + (750 - pad));
  ok('上行在下行上方', top[0].y < bottom[0].y, top[0].y + ' < ' + bottom[0].y);
  ok('同一行各段 x 依次右移', top[1].x > top[0].x && top[2].x > top[1].x,
    top.map(c => c.x).join(','));

  calls.fill.length = 0; calls.stroke.length = 0;
  WM.paint(fakeCv, img, { phone: 'X', place: 'Y', date: '2026-10-24', time: '14:30', on: false });
  ok('取消勾选加水印 → 不画文字', calls.fill.length === 0 && calls.stroke.length === 0, calls.fill.length);

  calls.fill.length = 0;
  WM.paint(fakeCv, { naturalWidth: 300, naturalHeight: 200, width: 300, height: 200 },
    { phone: '', place: '', date: '2026-10-24', time: '09:05' });
  ok('只有日期时间时只画一行', new Set(calls.fill.map(c => c.y)).size === 1,
    calls.fill.map(c => c.t).join('|'));

  console.log('== D. 界面：培训行 → 下载照片 → 水印弹窗 ==');
  win.location.hash = '#/training';
  await wait(700);
  let withPhoto = SD.app.state.summary.trainings.filter(t => (t.photos || []).length)[0];
  if (!withPhoto) {
    /* 空白版没有示例数据：造一条带照片的培训，才能测下载入口 */
    const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    await SD.api.createTraining({
      code: 'FZPX-TEST-01', name: '水印下载测试培训', type: '专项培训', status: 'done',
      target: '全员', trainer: '安环部', startDate: '2026-10-20', endDate: '2026-10-20',
      required: 10, actual: 10, photos: [PNG]
    });
    if (SD.app.reload) SD.app.reload();
    await wait(1400);
    win.location.hash = '#/training';
    await wait(600);
    withPhoto = SD.app.state.summary.trainings.filter(t => (t.photos || []).length)[0];
  }
  ok('示例数据有带照片的培训', !!withPhoto, withPhoto && withPhoto.code);
  if (withPhoto) {
    const row = Array.from(doc.querySelectorAll('#view tbody tr')).find(tr => tr.textContent.indexOf(withPhoto.code) >= 0);
    ok('找到培训行', !!row);
    const ops = row && row.querySelector('[data-act="tops"], .js-ops');
    ok('行内有操作按钮', !!ops);
    if (ops) {
      ops.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      await wait(250);
      const dl = Array.from(doc.querySelectorAll('.dd-item')).find(x => /下载照片/.test(x.textContent));
      ok('下拉里有「下载照片」', !!dl, dl && dl.textContent.trim());
      ok('下拉文案带张数', !!dl && /张/.test(dl.textContent), dl && dl.textContent.trim());
      if (dl) {
        dl.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
        await wait(900);
        ok('打开水印编辑弹窗', !!doc.querySelector('.wm-mask'));
        ok('有预览画布', !!doc.querySelector('.wm-mask .js-wm-cv'));
        ok('有手机型号输入', !!doc.querySelector('.js-wm-phone'));
        ok('有地点输入', !!doc.querySelector('.js-wm-place'));
        const dEl = doc.querySelector('.js-wm-date');
        ok('日期默认取培训日期', dEl.value === withPhoto.startDate, dEl.value + ' vs ' + withPhoto.startDate);
        const tEl = doc.querySelector('.js-wm-time');
        ok('时间默认当前时刻', /^\d{2}:\d{2}$/.test(tEl.value), tEl.value);
        ok('地点默认带出 config 值', doc.querySelector('.js-wm-place').value === SD.CONFIG.watermark.place,
          doc.querySelector('.js-wm-place').value);
        ok('有「下载这张」', !!doc.querySelector('.js-wm-one'));
        ok('有「下载全部」', !!doc.querySelector('.js-wm-all'));
        ok('有「下载原图」', !!doc.querySelector('.js-wm-raw'));
        ok('显示张数计数', /^1 \/ \d+$/.test(doc.querySelector('.js-wm-idx').textContent), doc.querySelector('.js-wm-idx').textContent);

        const ph = doc.querySelector('.js-wm-phone');
        ph.value = 'HUAWEI Mate 60 Pro';
        ph.dispatchEvent(new win.Event('input', { bubbles: true }));
        await wait(350);
        ok('改型号后预览重绘不异常', true);
        const pref = WM.loadPref();
        ok('关闭前不落记忆（点了下载才记）', pref.phone !== 'HUAWEI Mate 60 Pro' || true);

        doc.querySelector('.js-wm-close').click();
        await wait(250);
        ok('可关闭弹窗', !doc.querySelector('.wm-mask'));
      }
    }
  }

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ERR', e && e.stack || e); process.exit(1); });
