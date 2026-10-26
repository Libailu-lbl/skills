/* 安全员工作台 · 特种设备人员台账自检（2026-10-24 新增，数据来自 2026 叉车证人员名单）
   用法：node smoke_device.js [url]        默认 http://127.0.0.1:8124/index.html
   覆盖：① 导航位置（特种作业下）与视图/CRUD 注册
        ② 数据完整性：78 人、状态合计、日期规范化（只有年月 → 月末）
        ③ 台账渲染 / 搜索 / 状态筛选 / 表头排序
        ④ 新增：编号默认顺延（TZSB-079）、必填拦截、保存落库
        ⑤ 编辑回显与删除
   说明：空白版为空台账，段 B 自动降级为「空表不报错 + 造一条测试数据后再验」。
*/
const { JSDOM, requestInterceptor } = require('jsdom');
const skipPrint = requestInterceptor(r => {
  if (String(r.url).indexOf('print-only.css') >= 0) return new Response('', { headers: { 'Content-Type': 'text/css' } });
});
const wait = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n + (x != null ? '  → ' + x : '')); } else { fail++; console.log('  FAIL ' + n + (x != null ? '  → ' + x : '')); } };

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
  for (let i = 0; i < 120 && !(win.SD && win.SD.app && win.SD.app.state.summary); i++) await wait(120);
  const SD = win.SD;
  // 2026-10-25：工作台默认「受限用户」，测试先解锁为安全员（等同输入六位密码）
  SD.auth.set('safety_officer');
  if (SD.app.refreshAll) SD.app.refreshAll();
  await wait(300);

  const go = async (h) => { win.location.hash = '#/' + h; await wait(600); };

  console.log('== A. 导航与注册 ==');
  const navItem = doc.querySelector('#navPrimary [data-route="devicePersonnel"]');
  ok('导航里有「特种设备人员」', !!navItem, navItem && navItem.textContent.trim());
  ok('挂在「特种作业」父级之下', !!navItem && !!navItem.closest('.nav-children'));
  ok('视图已注册', !!SD.views.devicePersonnel && typeof SD.views.devicePersonnel.render === 'function');
  ok('四个语义函数齐全',
    ['listDevicePersonnel', 'createDevicePersonnel', 'updateDevicePersonnel', 'removeDevicePersonnel']
      .every(k => typeof SD.api[k] === 'function'));
  ok('路由可直达', (function () { go('devicePersonnel'); return true; })());
  await wait(300);
  ok('页面标题是「特种设备人员」', /特种设备人员/.test(doc.getElementById('viewTitle').textContent),
    doc.getElementById('viewTitle').textContent);

  console.log('== B. 数据完整性 ==');
  let arr = (SD.app.state.summary.devicePersonnel || []).slice();
  let isSample = arr.length > 0;
  let isSampleSeedLoaded = false;
  console.log('  （' + (isSample ? '示例版：' + arr.length + ' 人' : '空白版：空台账，先造一条') + '）');
  if (!isSample) {
    // 空台账：先验「载入内置名单」（这是空白版看到 78 人的正常入口）
    const seedBtn = Array.from(doc.querySelectorAll('#view button')).find(x => /载入内置名单/.test(x.textContent));
    ok('空台账时有「载入内置名单」按钮', !!seedBtn, seedBtn && seedBtn.textContent.trim());
    ok('内置名单数据可用（SD.deviceSeed）', (SD.deviceSeed || []).length === 78, (SD.deviceSeed || []).length + ' 条');
    if (seedBtn) {
      seedBtn.click();
      await wait(1600);
      arr = (SD.app.state.summary.devicePersonnel || []).slice();
      ok('点击后载入 78 人', arr.length === 78, arr.length + ' 人');
      ok('载入后页面渲染出表格', doc.querySelectorAll('#view tbody tr').length === 78,
        doc.querySelectorAll('#view tbody tr').length + ' 行');
      ok('载入后按钮消失', !Array.from(doc.querySelectorAll('#view button')).some(x => /载入内置名单/.test(x.textContent)));
    }
    if (!arr.length) {
      await SD.api.createDevicePersonnel({
        code: 'TZSB-001', name: '测试人员', empNo: '00001', dept: '仓储物流部', post: '叉车班',
        certType: 'N1', idNo: '320682199001011234', validTo: '2026-11-30', phone: '13800000000',
        note: '', status: 'pending_review'
      });
      if (SD.app.reload) SD.app.reload();
      await wait(1400);
      await go('devicePersonnel');
      arr = (SD.app.state.summary.devicePersonnel || []).slice();
    }
    isSampleSeedLoaded = arr.length === 78;
  }
  ok('台账有数据', arr.length > 0, arr.length + ' 人');
  if (isSample || arr.length === 78) {
    ok('导入人数 78', arr.length === 78, arr.length);
    const sum = SD.app.state.summary.devicePersonnelSummary;
    ok('状态四类合计 = 总数',
      sum.valid + sum.pending_review + sum.expired + sum.suspended === sum.total,
      sum.valid + '+' + sum.pending_review + '+' + sum.expired + '+' + sum.suspended + '=' + sum.total);
    const first = arr[0];
    ok('首条为内置名单第一人（示例数据已脱敏）', first.name === '华桂兰', first.name);
    ok('工号保留前导零样式（文本）', typeof first.empNo === 'string', first.empNo);
    ok('身份证号按文本存（X 结尾保留）',
      arr.some(x => /X$/i.test(String(x.idNo))), (arr.filter(x => /X$/i.test(String(x.idNo)))[0] || {}).idNo);
    ok('只有年月的有效期补成月末（2026-12 → 2026-12-31）',
      arr.some(x => x.validTo === '2026-12-31'),
      arr.filter(x => x.validTo.indexOf('2026-12') === 0).map(x => x.validTo).join(','));
    ok('完整日期原样保留（2029-11-30）', arr.some(x => x.validTo === '2029-11-30'));
    ok('Excel 日期序列（2029-04-01 00:00:00）已转成 2029-04-01',
      arr.some(x => x.validTo === '2029-04-01'));
    ok('日期都规范成 YYYY-MM-DD',
      arr.every(x => !x.validTo || /^\d{4}-\d{2}-\d{2}$/.test(x.validTo)),
      arr.filter(x => x.validTo && !/^\d{4}-\d{2}-\d{2}$/.test(x.validTo)).length + ' 条异常');
    ok('每条都有编号 / 姓名 / 部门 / 证书类型',
      arr.every(x => x.code && x.name && x.dept && x.certType));
  }

  console.log('== C. 渲染 / 搜索 / 筛选 / 排序 ==');
  const rows = doc.querySelectorAll('#view tbody tr');
  ok('表格行数 = 数据条数', rows.length === arr.length, rows.length + ' vs ' + arr.length);
  ok('表头含 证书类型 / 有效期至 / 证件编号',
    ['证书类型', '有效期至', '证件编号'].every(t => doc.querySelector('#view').textContent.indexOf(t) >= 0));
  ok('按剩余天数升序：第一行是最急的', (function () {
    var tr = doc.querySelector('#view tbody tr');
    var nameEl = tr && tr.querySelector('.js-dpname');
    if (!nameEl) return false;
    var sorted = arr.slice().sort(function (a, b) {
      var va = (a._daysLeft == null ? 9999 : a._daysLeft);
      var vb = (b._daysLeft == null ? 9999 : b._daysLeft);
      return va - vb;
    });
    return nameEl.textContent.trim() === sorted[0].name;
  })(), (function () {
    var tr = doc.querySelector('#view tbody tr');
    var el = tr && tr.querySelector('.js-dpname');
    return el ? el.textContent.trim() : '';
  })());

  const q = doc.querySelector('#view [data-keep-focus="device"]');
  ok('有搜索框', !!q);
  if (q) {
    q.focus();
    q.value = '叉车班';
    q.dispatchEvent(new win.Event('input', { bubbles: true }));
    await wait(600);
    const n1 = doc.querySelectorAll('#view tbody tr').length;
    ok('搜岗位「叉车班」能过滤', n1 > 0 && n1 <= arr.length, n1 + ' 行');
    ok('输入框未被重建（可连续输入）', doc.querySelector('#view [data-keep-focus="device"]') === q);
    q.value = '';
    q.dispatchEvent(new win.Event('input', { bubbles: true }));
    await wait(500);
  }

  const chips = Array.from(doc.querySelectorAll('#view .chip'));
  ok('状态 chips 齐全（全部/有效/待复审/已过期/停用）', chips.length === 5, chips.map(c => c.textContent.trim()).join(' | '));
  const expiredChip = chips.find(x => /已过期/.test(x.textContent));
  if (expiredChip) {
    expiredChip.click();
    await wait(400);
    const n2 = doc.querySelectorAll('#view tbody tr').length;
    const want = SD.app.state.summary.devicePersonnelSummary.expired;
    ok('按「已过期」筛选生效', n2 === want, n2 + ' vs ' + want);
    const allChip = chips.find(x => /^全部/.test(x.textContent.trim()));
    if (allChip) { allChip.click(); await wait(400); }
  }

  const thName = Array.from(doc.querySelectorAll('#view th')).find(x => /姓名/.test(x.textContent));
  if (thName) {
    thName.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await wait(400);
    ok('点表头可排序', SD.app.state.sort.devicePersonnel.key === 'name', JSON.stringify(SD.app.state.sort.devicePersonnel));
  }

  console.log('== D. 新增：编号顺延与必填 ==');
  const addBtn = Array.from(doc.querySelectorAll('#view button')).find(x => /新增设备人员/.test(x.textContent));
  ok('有新增按钮', !!addBtn);
  if (addBtn) {
    addBtn.click();
    await wait(500);
    const next = SD.code.next('device');
    const codeEl = doc.querySelector('#ff_code');
    ok('编号默认顺延填入（可手改）', codeEl && codeEl.value === next, (codeEl && codeEl.value) + ' vs ' + next);
    ok('证书类型默认 N1', doc.querySelector('#ff_certType').value === 'N1');
    ok('有证件编号 / 有效期至 / 照片字段',
      !!doc.querySelector('#ff_idNo') && !!doc.querySelector('#ff_validTo') && !!doc.querySelector('#ff_photos'));

    // 空表单直接提交 → 必填拦截
    const okBtn = doc.querySelector('.modal .js-ok');
    okBtn.click();
    await wait(400);
    ok('必填未填时拦截（弹窗不关）', !!doc.querySelector('.modal'), (doc.querySelector('.field-err') || {}).textContent);

    // 填完保存
    function set(id, v) {
      const el = doc.querySelector('#ff_' + id);
      el.value = v;
      el.dispatchEvent(new win.Event('input', { bubbles: true }));
      el.dispatchEvent(new win.Event('change', { bubbles: true }));
    }
    set('name', '烟测新增');
    set('dept', '测试部');
    set('certType', 'N1');
    set('idNo', '320682199001019999');
    set('validTo', '2029-12-31');
    await wait(200);
    doc.querySelector('.modal .js-ok').click();
    await wait(1600);
    ok('保存后弹窗关闭', !doc.querySelector('.modal'));
    const created = (SD.app.state.summary.devicePersonnel || []).filter(x => x.name === '烟测新增')[0];
    ok('新记录已落库', !!created, created && created.code);
    ok('新记录编号 = 顺延值', !!created && created.code === next, created && created.code);
  }

  console.log('== E. 编辑回显与删除 ==');
  const target = (SD.app.state.summary.devicePersonnel || []).filter(x => x.name === '烟测新增')[0];
  if (target) {
    const row = Array.from(doc.querySelectorAll('#view tbody tr')).find(tr => tr.textContent.indexOf('烟测新增') >= 0);
    const ops = row && row.querySelector('[data-act="dops"]');
    ok('找到该行操作按钮', !!ops);
    if (ops) {
      ops.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      await wait(300);
      const editItem = Array.from(doc.querySelectorAll('.dd-item')).find(x => /编辑/.test(x.textContent));
      editItem.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      await wait(500);
      ok('编辑带出原编号', doc.querySelector('#ff_code').value === target.code, doc.querySelector('#ff_code').value);
      ok('编辑带出姓名与有效期', doc.querySelector('#ff_name').value === '烟测新增' && doc.querySelector('#ff_validTo').value === '2029-12-31',
        doc.querySelector('#ff_name').value + ' / ' + doc.querySelector('#ff_validTo').value);
      doc.querySelector('.modal-close').click();
      await wait(300);

      // 删除
      ops.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      await wait(300);
      const delItem = Array.from(doc.querySelectorAll('.dd-item')).find(x => /删除/.test(x.textContent));
      delItem.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      await wait(500);
      const confirmBtn = Array.from(doc.querySelectorAll('.modal .btn')).find(x => /确认删除/.test(x.textContent));
      ok('删除有二次确认', !!confirmBtn);
      if (confirmBtn) {
        confirmBtn.click();
        await wait(1500);
        const gone = !(SD.app.state.summary.devicePersonnel || []).some(x => x.name === '烟测新增');
        ok('删除后记录消失', gone);
      }
    }
  }

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ERR', e && e.stack || e); process.exit(1); });
