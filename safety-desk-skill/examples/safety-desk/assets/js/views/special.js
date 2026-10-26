/* =========================================================
   views/special.js — 特种作业（落地页 / 功能入口）
   ────────────────────────────────────────────────────────
   · 独立的导航菜单项，点击先进入本落地页
   · 上半部：四张指标卡（特种作业人员 / 特种设备人员 / 危险作业票 / 待审批）
   · 下半部：三个「功能入口」卡片，与左侧导航特种作业下的三个子级**一一对应**：
        特种作业人员台账、特种设备人员台账、危险作业票（八大危险作业）
     （2026-10-25：补齐特种设备人员，父级页面不再漏子级）
   · 权限：route.perm 已在 app.js 中央门禁拦截；这里做二次防御
   ========================================================= */
window.SD = window.SD || {};
SD.views = SD.views || {};

SD.views.special = (function () {
  var U = SD.utils;

  function sub(s) {
    if (!s) return '';
    var p = s.specialPersonnelSummary, w = s.permitSummary;
    var d = s.devicePersonnelSummary || { total: 0 };
    return '特种作业人员 ' + p.total + ' 人 · 特种设备人员 ' + d.total + ' 人 · 危险作业票 ' + w.total + ' 张';
  }

  function render(host, ctx) {
    var s = ctx.summary;
    U.clear(host);

    // 二次防御：理论上中央门禁已拦截，这里兜底
    if (!SD.auth.can('special.view')) {
      host.appendChild(U.h('<section class="card"><h3>无访问权限</h3><p class="t-2">当前角色无特种作业权限。</p></section>'));
      return;
    }

    /* ---------- 指标卡：人员资质 ---------- */
    var p = s.specialPersonnelSummary;
    var w = s.permitSummary;
    var d = s.devicePersonnelSummary || { total: 0, valid: 0, pending_review: 0, expired: 0, suspended: 0 };

    var box = U.h('<div class="grid cols-4"></div>');
    SD.comp.statCard.renderAll(box, [
      { label: '特种作业人员', value: p.total, unit: '人', icon: 'user', tone: 'blue',
        foot: '待复审 ' + p.pending_review + ' · 已过期 ' + p.expired,
        onClick: function () { ctx.go('specPersonnel'); } },
      { label: '特种设备人员', value: d.total, unit: '人', icon: 'wrench',
        tone: d.expired ? 'red' : (d.pending_review ? 'orange' : 'green'),
        foot: '待复审 ' + d.pending_review + ' · 已过期 ' + d.expired,
        onClick: function () { ctx.go('devicePersonnel'); } },
      { label: '危险作业票', value: w.total, unit: '张', icon: 'clipboard', tone: 'blue', foot: '八大危险作业',
        onClick: function () { ctx.go('specPermit'); } },
      { label: '待审批作业票', value: w.pending, unit: '张', icon: 'clock',
        tone: w.pending ? 'orange' : 'green', foot: '需安全部门审批',
        onClick: function () { ctx.go('specPermit'); } }
    ]);
    host.appendChild(box);

    /* ---------- 功能入口卡片 ---------- */
    host.appendChild(U.h(
      '<div class="section-head"><h2>功能入口</h2><div class="sub">点击进入对应管理页面</div></div>'
    ));

    var grid = U.h('<div class="entry-grid"></div>');
    var ENTRIES = [
      {
        icon: 'user', title: '特种作业人员台账',
        desc: '电工作业、焊接与热切割、高处作业等 10 类特种作业人员持证情况，按资质有效期预警（有效 / 待复审 / 已过期 / 停用）。',
        count: p.total + ' 人', warn: p.pending_review + p.expired,
        to: 'specPersonnel'
      },
      {
        icon: 'wrench', title: '特种设备人员台账',
        desc: '叉车、行车、压力容器、锅炉等特种设备作业人员持证情况，按证件有效期预警（有效 / 待复审 / 已过期 / 停用），可载入内置名单。',
        count: d.total + ' 人', warn: d.pending_review + d.expired,
        to: 'devicePersonnel'
      },
      {
        icon: 'clipboard', title: '危险作业票',
        desc: '动火、受限空间、高处、吊装、临时用电等八大危险作业审批流程，覆盖 草稿 → 待审批 → 已批准 → 作业中 → 已完工 全状态。',
        count: w.total + ' 张', warn: w.pending,
        to: 'specPermit'
      }
    ];
    ENTRIES.forEach(function (e) {
      var card = U.h(
        '<button class="entry-card">' +
          '<span class="ec-ico">' + SD.icons.get(e.icon, 26) + '</span>' +
          '<span class="ec-body">' +
            '<span class="ec-title">' + U.esc(e.title) +
              (e.warn ? '<span class="ec-warn">' + e.warn + ' 项需关注</span>' : '') +
            '</span>' +
            '<span class="ec-desc">' + U.esc(e.desc) + '</span>' +
          '</span>' +
          '<span class="ec-meta">' + U.esc(e.count) + '</span>' +
          '<span class="ec-chev">' + SD.icons.get('chevronR', 18) + '</span>' +
        '</button>'
      );
      card.addEventListener('click', function () { ctx.go(e.to); });
      grid.appendChild(card);
    });
    host.appendChild(grid);

    /* ---------- 说明 ---------- */
    host.appendChild(U.h(
      '<section class="card tight t-3 t-sm"><b class="t-2">说明</b>　' +
      '特种作业是 EHS 高风险管控重点：特种作业人员必须持有效《特种作业操作证》上岗，' +
      '特种设备作业人员（叉车 / 行车 / 压力容器等）须持《特种设备作业人员证》，' +
      '动火、受限空间等危险作业须执行作业票审批制度。本模块与「安全培训」区分——' +
      '后者覆盖全部证书与培训计划，本模块聚焦以上三类高频高风险场景。</section>'
    ));
  }

  return { name: '特种作业', sub: sub, render: render };
})();
