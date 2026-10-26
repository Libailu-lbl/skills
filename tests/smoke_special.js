/* 安全员工作台 · 特种作业模块 冒烟自检
   用法：node smoke_special.js [url]
   覆盖：数据 → 导航（独立项+子菜单+层级） → 路由跳转 → 功能入口卡片
        → 人员台账 增删 → 作业票 状态流转 → 权限门禁（角色切换）
*/
const { JSDOM } = require('jsdom');
const URL_ = process.argv[2] || 'http://127.0.0.1:8124/index.html';
const wait = ms => new Promise(r => setTimeout(r, ms));

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
  win.addEventListener('unhandledrejection', e => errors.push('rejection: ' + String(e.reason && e.reason.message || e.reason)));

  for (let i = 0; i < 80 && !(win.SD && win.SD.app && win.SD.app.state.summary); i++) await wait(150);
  const SD = win.SD;
  // 2026-10-25：工作台默认「受限用户」，测试先解锁为安全员（等同输入六位密码）
  SD.auth.set('safety_officer');
  if (SD.app.refreshAll) SD.app.refreshAll();
  await wait(300);

  if (!SD || !SD.app) { console.log('FATAL: SD 未初始化'); process.exit(1); }
  const doc = win.document;

  console.log('== 1. 数据 ==');
  const s = SD.app.state.summary;
  ok('特种作业人员 8 条', s.specialPersonnel.length === 8, s.specialPersonnel.length);
  ok('危险作业票 8 张', s.workPermits.length === 8, s.workPermits.length);
  ok('人员资质：含过期/待复审', s.specialPersonnelSummary.expired === 2 && s.specialPersonnelSummary.pending_review === 3, JSON.stringify(s.specialPersonnelSummary));
  ok('作业票：含待审批', s.permitSummary.pending >= 1, s.permitSummary.pending);
  // 2026-10-21：作业类别新增「吊装作业」
  const cats = SD.mock.DICT.specialCategory;
  ok('作业类别含「吊装作业」', cats.indexOf('吊装作业') >= 0, cats.join('/'));
  ok('新增后类别共 11 项（含其他）', cats.length === 11, cats.length);

  console.log('== 2. 导航：独立项 + 子菜单 + 层级 ==');
  // 2026-10-24 起「特种作业」移入左侧常用区，父级与子菜单都在 #navPrimary 内
  const navSpecial = doc.getElementById('navPrimary');
  ok('特种作业已并入常用导航区', !!navSpecial && !!navSpecial.querySelector('[data-route="special"]'));
  const parentBtn = navSpecial.querySelector('[data-route="special"]');
  ok('特种作业 是独立导航项', !!parentBtn, parentBtn && parentBtn.textContent.trim());
  ok('子菜单常驻展开（三个入口直接可见，不再折叠）',
    (() => {
      const kids = parentBtn.parentNode.querySelector('.nav-children');
      return !!kids && !kids.hasAttribute('hidden') &&
        !!kids.querySelector('[data-route="specPersonnel"]') &&
        !!kids.querySelector('[data-route="devicePersonnel"]') &&
        !!kids.querySelector('[data-route="specPermit"]');
    })());
  const childP = navSpecial.querySelector('[data-route="specPersonnel"]');
  const childW = navSpecial.querySelector('[data-route="specPermit"]');
  ok('子菜单：特种作业人员', !!childP);
  ok('子菜单：危险作业票', !!childW);
  ok('子菜单缩进容器', !!navSpecial.querySelector('.nav-children'));

  console.log('== 3. 路由跳转：落地页 ==');
  win.location.hash = '#/special';
  await wait(300);
  let view = doc.getElementById('view');
  ok('落地页渲染（无加载失败）', /功能入口/.test(view.textContent) && !/加载失败/.test(view.textContent));
  const entryCards = view.querySelectorAll('.entry-card');
  /* 父级落地页必须与左侧导航的三个子级一一对应（含特种设备人员台账） */
  const cardTitles = Array.from(entryCards).map(c => (c.querySelector('.ec-title') || {}).textContent || '');
  ok('落地页有三个功能入口卡片（与子级一一对应）', entryCards.length === 3, entryCards.length);
  ok('入口含 特种作业人员台账 / 特种设备人员台账 / 危险作业票',
    ['特种作业人员台账', '特种设备人员台账', '危险作业票'].every(t => cardTitles.some(x => x.indexOf(t) >= 0)),
    cardTitles.join('|'));
  ok('副标题汇总含特种设备人员',
    /特种设备人员\s*\d+\s*人/.test((doc.getElementById('viewSub') || {}).textContent || ''),
    (doc.getElementById('viewSub') || {}).textContent);
  ok('落地页指标卡 4 张', view.querySelectorAll('.grid.cols-4 .stat-card, .grid.cols-4 > *').length >= 4);

  console.log('== 4. 功能入口卡片跳转到子页面 ==');
  // 点第一张入口卡 → 特种作业人员
  entryCards[0].dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(300);
  ok('点卡片跳转特种作业人员', win.location.hash === '#/specPersonnel', win.location.hash);
  ok('子菜单展开（在子树内）', !navSpecial.querySelector('.nav-children').hidden);

  console.log('== 5. 特种作业人员台账：增 / 删 ==');
  win.location.hash = '#/specPersonnel';
  await wait(300);
  view = doc.getElementById('view');
  ok('人员台账表格行 = 8', view.querySelectorAll('table tbody tr').length === 8, view.querySelectorAll('table tbody tr').length);
  const before = SD.store.data().specialPersonnel.length;
  await SD.api.createSpecialPersonnel({
    code: 'SP-' + String(new Date().getFullYear()) + '-901',
    name: '测试员甲', dept: '测试部', category: '电工作业', operation: '低压电工作业',
    certNo: 'TEST-001', issuer: '市应急管理局', validFrom: '2020-01-01', validTo: '2030-01-01',
    reviewDate: '2030-01-01', status: 'valid'
  });
  await SD.app.reload(); await wait(300);
  const after = SD.store.data().specialPersonnel.length;
  ok('新增人员成功', after === before + 1, before + '→' + after);
  const created = SD.store.data().specialPersonnel.filter(x => x.certNo === 'TEST-001')[0];
  await SD.api.removeSpecialPersonnel(created.id);
  await SD.app.reload(); await wait(300);
  ok('删除人员成功', SD.store.data().specialPersonnel.length === before, SD.store.data().specialPersonnel.length);
  ok('人员页面无脚本报错', errors.length === 0, errors[0] || '');

  console.log('== 6. 危险作业票：状态流转 ==');
  win.location.hash = '#/specPermit';
  await wait(300);
  view = doc.getElementById('view');
  ok('作业票表格行 = 8', view.querySelectorAll('table tbody tr').length === 8, view.querySelectorAll('table tbody tr').length);
  const pending = SD.store.data().workPermits.filter(x => x.status === 'pending')[0];
  ok('存在待审批作业票', !!pending, pending && pending.code);
  await SD.api.updateWorkPermit(pending.id, { status: 'approved', approvedBy: '王安全', approvedAt: s.today + ' 08:30' });
  await SD.app.reload(); await wait(300);
  const approved = SD.store.data().workPermits.filter(x => x.id === pending.id)[0];
  ok('批准流转成功', approved.status === 'approved', approved.status);
  ok('批准自动写审批人', approved.approvedBy === '王安全', approved.approvedBy);
  ok('作业票页面无脚本报错', errors.length === 0, errors[0] || '');

  console.log('== 7. 权限门禁：角色切换 ==');
  // 切到受限角色 → 特种作业应被锁、子页面显示无权限
  SD.auth.set('restricted');
  SD.app.refreshAll();
  await wait(300);
  const lockedBtn = doc.querySelector('#navPrimary [data-route="special"].locked');
  ok('受限角色下 特种作业 导航加锁', !!lockedBtn);
  win.location.hash = '#/special';
  await wait(300);
  ok('受限角色下显示无权限页', !!doc.querySelector('.forbidden-card'), doc.querySelector('.forbidden-card') ? '有' : '无');
  // 恢复全权
  SD.auth.set('safety_officer');
  SD.app.refreshAll();
  await wait(300);
  ok('恢复后导航解锁', !doc.querySelector('#navPrimary [data-route="special"].locked'));
  win.location.hash = '#/special';
  await wait(300);
  ok('恢复后 可进入特种作业', !!doc.querySelector('.entry-card') && !doc.querySelector('.forbidden-card'));

  console.log('== 8. 全局无脚本报错 ==');
  ok('整个流程无 JS 报错', errors.length === 0, errors.join(' | ') || '无');

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('异常:', e); process.exit(1); });
