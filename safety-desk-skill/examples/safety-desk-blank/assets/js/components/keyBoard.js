/* =========================================================
   components/keyBoard.js — 安全重要工作看板（★ 2026-11-10）
   ────────────────────────────────────────────────────────
   干什么：
     安全概览页原来的「今天要处理」是一列纵向清单，只能看、只能点完成；
     这里换成**四列状态看板**（待开始 / 进行中 / 待验收 / 已完成），
     一屏看清「哪些事还没动、哪些在推、哪些等验收、哪些已闭环」。

   形态来源：
     布局与交互参照一张独立的看板原型（safety-board.html）：四列 + 卡片 +
     顶部统计条 + 筛选栏 + 新增/编辑/删除 + 拖动换列。
     **但配色、字号、圆角、按钮一律改用工作台既有变量**
     （--brand / --line / --lv-* / --ok / --warn …），不引入任何外部样式，
     保证和概览页其它卡片是同一套视觉。

   数据：
     store 集合 keyWorks，经 metrics.summarize 透传到 ctx.summary.keyWorks，
     所以它和其它台账一样进备份、进「清空数据」、跨机迁移不丢。
     字段：{ id, title, owner, cat, pri, status, due, note, createdAt }
       pri    high 高 / mid 中 / low 低
       status todo 待开始 / doing 进行中 / review 待验收 / done 已完成

   交互：
     · 新增 / 编辑：formDialog；编辑弹窗左下角带「删除」（危险色，需安全员权限）
     · 推进：卡片底部「推进到「X」→」，状态单向前进，走完就是已闭环
     · 拖动：桌面端把卡片拖进别的列即改状态（移动端不依赖拖拽，用推进按钮）
       ★ 2026-11-11：**受限模式不允许推进状态**（用户要求）——
         推进按钮、拖拽换列两条路一起锁，与「待办任务」页的锁定口径一致：
           ① 渲染：按钮 disabled + is-locked（虚线边+灰字）+ 小锁 + title 说明；卡片 draggable=false
           ② 事件：click / dragstart 直接不往下走（不是拦一次报个错就完）
           ③ 函数入口：advance() / moveTo() 各判一次权限（程序内直接调也改不动）
         受限时看板上方多一条说明条，手机上没有 hover 也知道为什么点不了。
     · 筛选：关键词 / 负责人 / 类别 / 优先级 / 仅看逾期
       条件存在 ctx.state.filters.keyWorks，切页、改数据重绘都不丢
       （与其它列表页的筛选口径一致：只存内存，刷新页面即复位）

   与「待办任务」页的分工：
     待办任务 = 由台账（隐患/巡检/作业票/培训）自动推导出来的待办，只读；
     本看板   = 自己手录的重点工作，四列状态机由人推。
     两者互不覆盖，也不互相生成。
   ========================================================= */
window.SD = window.SD || {};
SD.comp = SD.comp || {};

SD.comp.keyBoard = (function () {
  var U = SD.utils;

  /* 四列状态：颜色取工作台语义色（灰=未动、蓝=在推、橙=待验收、绿=闭环） */
  var STATUS = [
    { k: 'todo',   name: '待开始', color: 'var(--muted)' },
    { k: 'doing',  name: '进行中', color: 'var(--info)'  },
    { k: 'review', name: '待验收', color: 'var(--warn)'  },
    { k: 'done',   name: '已完成', color: 'var(--ok)'    }
  ];

  /* 优先级：沿用隐患的三级色（红/橙/灰），与全站「红=最急」一致 */
  var PRI = {
    high: { name: '高', color: 'var(--lv-major)', bg: 'var(--lv-major-bg)', rank: 0 },
    mid:  { name: '中', color: 'var(--lv-large)', bg: 'var(--lv-large-bg)', rank: 1 },
    low:  { name: '低', color: 'var(--muted)',    bg: 'var(--muted-bg)',    rank: 2 }
  };

  function statusOf(k) {
    for (var i = 0; i < STATUS.length; i++) if (STATUS[i].k === k) return STATUS[i];
    return STATUS[0];
  }
  function statusIndex(k) {
    for (var i = 0; i < STATUS.length; i++) if (STATUS[i].k === k) return i;
    return 0;
  }
  function priOf(k) { return PRI[k] || PRI.mid; }

  function list(ctx) {
    return (ctx && ctx.summary && ctx.summary.keyWorks) || [];
  }
  function findById(ctx, id) {
    var all = list(ctx);
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }

  /* 截止时间文案：逾期 / 今天到期 / 明天 / 剩 N 天 / 具体日期
     —— done 的卡片不再催，只显示日期 */
  function dueOf(t, today) {
    if (!t.due) return { txt: '未设截止', cls: '' };
    var d = String(t.due).slice(5).replace('-', '/');
    if (t.status === 'done') return { txt: d, cls: '' };
    var n = U.diffDays(t.due, today);
    if (n == null) return { txt: d, cls: '' };
    if (n < 0) return { txt: d + ' · 逾期' + (-n) + '天', cls: 'over' };
    if (n === 0) return { txt: d + ' · 今天到期', cls: 'over' };
    if (n === 1) return { txt: d + ' · 明天', cls: 'soon' };
    if (n <= 3) return { txt: d + ' · 剩' + n + '天', cls: 'soon' };
    return { txt: d, cls: '' };
  }

  /** 是否逾期（未闭环 + 有截止日 + 已过期） */
  function isOver(t, today) {
    if (!t || t.status === 'done' || !t.due) return false;
    var n = U.diffDays(t.due, today);
    return n != null && n < 0;
  }

  /** 统计条：总数 / 进行中 / 已逾期 / 完成率 */
  function statOf(all, today) {
    var total = all.length, doing = 0, done = 0, over = 0;
    all.forEach(function (t) {
      if (t.status === 'done') done++;
      else if (t.status === 'doing') doing++;
      if (isOver(t, today)) over++;
    });
    return {
      total: total, doing: doing, done: done, over: over,
      rate: total ? Math.round(done / total * 100) : 0
    };
  }

  /** 筛选：负责人 / 类别 / 优先级 / 仅看逾期 / 关键词 */
  function filtered(all, f, today) {
    var kw = String(f.q || '').trim().toLowerCase();
    return all.filter(function (t) {
      if (f.owner && t.owner !== f.owner) return false;
      if (f.cat && t.cat !== f.cat) return false;
      if (f.pri && t.pri !== f.pri) return false;
      if (f.over && !isOver(t, today)) return false;
      if (kw) {
        var hay = [t.title, t.owner, t.cat, t.note].join(' ').toLowerCase();
        if (hay.indexOf(kw) < 0) return false;
      }
      return true;
    });
  }

  /** 同列内排序：优先级高的在前，其次截止早的在前，最后按创建时间（新→旧） */
  function sortItems(arr) {
    return arr.slice().sort(function (a, b) {
      var pa = priOf(a.pri).rank, pb = priOf(b.pri).rank;
      if (pa !== pb) return pa - pb;
      var da = a.due || '9999-12-31', db = b.due || '9999-12-31';
      if (da !== db) return da < db ? -1 : 1;
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });
  }

  function cardHtml(t, today, canAdv) {
    var p = priOf(t.pri);
    var d = dueOf(t, today);
    var i = statusIndex(t.status);
    var next = i < STATUS.length - 1 ? STATUS[i + 1] : null;
    var done = t.status === 'done';

    /* 推进按钮：受限时禁用 + is-locked + 小锁 + title（不禁用只提示，等于让人白点一次） */
    var advHtml = done
      ? '<span class="kw-done">' + SD.icons.get('check', 12) + '已闭环</span>'
      : (canAdv
          ? '<button class="kw-adv" type="button" data-act="advance" data-id="' + U.esc(t.id) + '">' +
            '推进到「' + next.name + '」→</button>'
          : '<button class="kw-adv is-locked" type="button" data-act="advance" data-id="' + U.esc(t.id) + '"' +
            ' disabled aria-disabled="true" title="受限模式：推进状态需要安全员权限，点右上角「受限模式」输入六位密码解锁">' +
            SD.icons.get('lock', 11) + '推进到「' + next.name + '」</button>');

    return '<article class="kw-item' + (done ? ' done' : '') + '" draggable="' + (canAdv ? 'true' : 'false') + '"' +
        ' data-id="' + U.esc(t.id) + '" style="--p:' + p.color + '">' +
        '<div class="kw-tags">' +
          '<span class="kw-tag cat">' + U.esc(t.cat || '未分类') + '</span>' +
          '<span class="kw-tag pri" style="--pc:' + p.color + ';--pb:' + p.bg + '">' + p.name + '</span>' +
        '</div>' +
        '<h4 class="kw-title">' + U.esc(t.title) + '</h4>' +
        (t.note ? '<p class="kw-note">' + U.esc(t.note) + '</p>' : '') +
        '<div class="kw-meta">' +
          '<span class="kw-av">' + U.esc(String(t.owner || '未').slice(0, 1)) + '</span>' +
          '<span class="kw-owner">' + U.esc(t.owner || '未指派') + '</span>' +
          '<span class="kw-due ' + d.cls + '">' + SD.icons.get('clock', 11) + U.esc(d.txt) + '</span>' +
        '</div>' +
        '<div class="kw-foot">' + advHtml + '</div>' +
      '</article>';
  }

  function sumHtml(st) {
    return '<span class="kw-k"><b class="kw-dot" style="background:var(--brand)"></b>重点事项 <em>' + st.total + '</em> 项</span>' +
      '<span class="kw-k"><b class="kw-dot" style="background:var(--info)"></b>进行中 <em>' + st.doing + '</em></span>' +
      '<span class="kw-k' + (st.over ? ' is-danger' : '') + '"><b class="kw-dot" style="background:var(--danger)"></b>已逾期 <em>' + st.over + '</em></span>' +
      '<span class="kw-k"><b class="kw-dot" style="background:var(--ok)"></b>完成率 <em>' + st.rate + '%</em></span>' +
      '<span class="kw-prog" aria-hidden="true"><i style="width:' + st.rate + '%"></i></span>' +
      '<span class="kw-prog-txt">已完成 ' + st.done + ' / ' + st.total + ' 项</span>';
  }

  /* ---------------- 表单 ---------------- */
  var FIELDS = [
    { name: 'title', label: '事项名称', full: true, required: true, maxLength: 80,
      placeholder: '如：二号车间东侧配电箱未上锁、箱内积尘，需清理并加锁挂牌' },
    { name: 'owner', label: '负责人', placeholder: '如：张伟' },
    { name: 'cat', label: '事项类别', placeholder: '如：隐患整改 / 设备设施 / 教育培训' },
    { name: 'pri', label: '优先级', type: 'select', def: 'mid',
      options: [
        { v: 'high', n: '高（立即处理）' },
        { v: 'mid',  n: '中（本周完成）' },
        { v: 'low',  n: '低（按计划推进）' }
      ] },
    { name: 'status', label: '当前状态', type: 'select', def: 'todo',
      options: STATUS.map(function (s) { return { v: s.k, n: s.name }; }) },
    { name: 'due', label: '截止时间', type: 'date', def: function () { return U.today(); } },
    { name: 'note', label: '备注 / 依据', type: 'textarea', full: true, rows: 3,
      placeholder: '整改要求、依据条款、验收标准等（可留空）' }
  ];

  /** 编辑弹窗左下角挂「删除」：删除是不可逆动作，单独一个危险色按钮，不和保存挨着 */
  function injectDelete(modal, ctx, item) {
    var foot = modal.querySelector('.modal-foot');
    if (!foot) return;
    var btn = U.h('<button class="btn danger sm js-kw-del" type="button">删除</button>');
    foot.insertBefore(btn, foot.firstChild);
    btn.addEventListener('click', function () {
      SD.comp.dialog.confirm({
        title: '删除重要工作',
        message: '将从看板删除「' + item.title + '」。删除后不可恢复。',
        okText: '确认删除', danger: true,
        onOk: function () {
          return SD.api.removeKeyWork(item.id).then(function () {
            var x = modal.querySelector('.modal-close');
            if (x) x.click();
            U.toast('已删除', 'ok');
            ctx.reload();
          });
        }
      });
    });
  }

  function openForm(ctx, item) {
    var isNew = !item;
    SD.comp.formDialog.open({
      title: isNew ? '新增安全重要工作' : '编辑安全重要工作',
      width: 620,
      fields: FIELDS,
      values: item || null,
      okText: isNew ? '新增' : '保存',
      hint: '推进顺序：待开始 → 进行中 → 待验收 → 已完成',
      onSubmit: function (v) {
        v.owner = String(v.owner || '').trim() || '未指派';
        v.cat = String(v.cat || '').trim() || '未分类';
        if (isNew) {
          v.createdAt = new Date().toISOString();
          return SD.api.createKeyWork(v).then(function () {
            U.toast('已新增「' + v.title + '」', 'ok');
            ctx.reload();
          });
        }
        return SD.api.updateKeyWork(item.id, v).then(function () {
          U.toast('已保存修改', 'ok');
          ctx.reload();
        });
      },
      onMount: isNew ? null : function (modal) { injectDelete(modal, ctx, item); }
    });
  }

  /* ---------------- 推进状态 ----------------
     ★ 2026-11-11：受限模式不允许推进（用户要求）。
     这一道是**函数入口守卫**：按钮已禁用，但程序内直接调 / 别处复用也会被挡住。 */
  function advance(ctx, id) {
    if (!SD.auth.can('data.write')) {
      U.toast('受限模式：推进状态需要安全员权限。点右上角「受限模式」输入六位密码解锁。', 'err');
      return;
    }
    var t = findById(ctx, id);
    if (!t) return;
    var i = statusIndex(t.status);
    if (i >= STATUS.length - 1) return;
    var next = STATUS[i + 1];
    SD.api.updateKeyWork(t.id, { status: next.k }).then(function () {
      U.toast('已推进到「' + next.name + '」', 'ok');
      ctx.reload();
    });
  }

  function moveTo(ctx, id, st) {
    if (!SD.auth.can('data.write')) {
      U.toast('受限模式：拖拽换列需要安全员权限。点右上角「受限模式」输入六位密码解锁。', 'err');
      return;
    }
    var t = findById(ctx, id);
    if (!t || !st || t.status === st) return;
    SD.api.updateKeyWork(t.id, { status: st }).then(function () {
      U.toast('已移动到「' + statusOf(st).name + '」', 'ok');
      ctx.reload();
    });
  }

  /* ---------------- 主渲染 ---------------- */
  function render(host, ctx) {
    /* 筛选条件挂在 app 的 state.filters 上（只存内存，刷新页面即复位） */
    var f = (ctx.state.filters.keyWorks = ctx.state.filters.keyWorks || {
      q: '', owner: '', cat: '', pri: '', over: false
    });

    var sec = U.h(
      '<section class="card kw-sec">' +
        '<div class="card-head">' +
          '<div>' +
            '<h3>安全重要工作</h3>' +
            '<div class="sub">按「待开始 → 进行中 → 待验收 → 已完成」推进；逾期标红，卡片可拖动换列</div>' +
          '</div>' +
          '<div class="actions"></div>' +
        '</div>' +
        '<div class="kw-sum"></div>' +
        '<div class="kw-hint" hidden></div>' +
        '<div class="kw-lock" hidden></div>' +
        '<div class="filters kw-filters"></div>' +
        '<div class="kw-board"></div>' +
      '</section>'
    );

    var sumBox = sec.querySelector('.kw-sum');
    var hintBox = sec.querySelector('.kw-hint');
    var lockBox = sec.querySelector('.kw-lock');
    var fBox = sec.querySelector('.kw-filters');
    var board = sec.querySelector('.kw-board');

    /* 受限模式：推进 / 拖拽 / 新增编辑删除都要安全员权限。
       这里只算一次「能不能推」——角色切换后 app 会整体重渲染，不需要监听。 */
    var canAdv = SD.auth.can('data.write');
    if (!canAdv) {
      lockBox.hidden = false;
      lockBox.innerHTML = SD.icons.get('lock', 13) +
        '<span><b>受限模式</b>：可查看与筛选；<b>推进状态、拖拽换列</b>以及新增 / 编辑 / 删除都已锁定。' +
        '要推进请点右上角「受限模式」输入六位密码解锁。</span>';
      sec.querySelector('.card-head .sub').textContent =
        '按「待开始 → 进行中 → 待验收 → 已完成」推进；逾期标红（受限模式下只能看，不能推进）';
    }

    /* 新增：data-write 让受限模式的写操作守卫能拦住（和登记隐患同一套口径） */
    var addBtn = U.h('<button class="btn primary sm" data-write type="button">' +
      SD.icons.get('plus', 14) + '新增事项</button>');
    addBtn.addEventListener('click', function () { openForm(ctx, null); });
    sec.querySelector('.actions').appendChild(addBtn);

    /* ---- 筛选栏 ---- */
    var q = U.h('<input class="input kw-q" type="search" placeholder="搜事项 / 负责人 / 备注"' +
      ' value="' + U.esc(f.q) + '" data-keep-focus="keyWorks">');
    q.addEventListener('input', function () { f.q = q.value; redraw(); });
    fBox.appendChild(q);

    function buildSelect(placeholder, items, cur, onPick) {
      var sel = U.h('<select class="ctl-select"></select>');
      sel.innerHTML = '<option value="">' + U.esc(placeholder) + '</option>' +
        items.map(function (x) {
          return '<option value="' + U.esc(x) + '"' + (x === cur ? ' selected' : '') + '>' +
            U.esc(x) + '</option>';
        }).join('');
      sel.addEventListener('change', function () { onPick(sel.value); });
      fBox.appendChild(sel);
      return sel;
    }

    var owners = {}, cats = {};
    list(ctx).forEach(function (t) {
      if (t.owner) owners[t.owner] = 1;
      if (t.cat) cats[t.cat] = 1;
    });
    buildSelect('全部负责人', Object.keys(owners).sort(), f.owner, function (v) { f.owner = v; redraw(); });
    buildSelect('全部类别', Object.keys(cats).sort(), f.cat, function (v) { f.cat = v; redraw(); });
    buildSelect('全部优先级', ['高', '中', '低'], (PRI[f.pri] || {}).name || '', function (v) {
      /* 下拉显示的是「高/中/低」，存的是 high/mid/low */
      f.pri = v === '高' ? 'high' : v === '中' ? 'mid' : v === '低' ? 'low' : '';
      redraw();
    });

    var overChip = U.h('<button class="chip kw-chk' + (f.over ? ' on' : '') + '" type="button">仅看逾期</button>');
    overChip.addEventListener('click', function () {
      f.over = !f.over;
      overChip.classList.toggle('on', f.over);
      redraw();
    });
    fBox.appendChild(overChip);

    var resetBtn = U.h('<button class="btn ghost sm kw-reset" type="button">重置</button>');
    resetBtn.addEventListener('click', function () {
      f.q = ''; f.owner = ''; f.cat = ''; f.pri = ''; f.over = false;
      /* 输入框/下拉的当前值也要清掉，否则界面与筛选状态不一致 */
      q.value = '';
      Array.prototype.forEach.call(fBox.querySelectorAll('select'), function (s) { s.value = ''; });
      overChip.classList.remove('on');
      redraw();
    });
    fBox.appendChild(resetBtn);

    /* ---- 重绘（只动统计条与看板，不重建筛选栏 → 输入框不丢焦点） ---- */
    function redraw() {
      var all = list(ctx);
      var today = U.today();
      var st = statOf(all, today);

      sumBox.innerHTML = sumHtml(st);

      /* 一条都没有时给个起步提示，比四个空列更像「能用」 */
      if (!all.length) {
        hintBox.hidden = false;
        hintBox.innerHTML = SD.icons.get('infoCircle', 14) +
          '<span>还没有记录。点右上角「新增事项」录入第一条，例如：三号仓库消防通道被托盘占用、空压机安全阀到期校验。</span>';
      } else {
        hintBox.hidden = true;
        hintBox.innerHTML = '';
      }

      var rows = sortItems(filtered(all, f, today));

      board.innerHTML = STATUS.map(function (s) {
        var items = rows.filter(function (t) { return t.status === s.k; });
        return '<section class="kw-col" data-st="' + s.k + '">' +
          '<div class="kw-col-hd">' +
            '<i style="background:' + s.color + '"></i>' +
            '<span>' + s.name + '</span>' +
            '<b>' + items.length + '</b>' +
          '</div>' +
          '<div class="kw-col-body">' +
            (items.length
              ? items.map(function (t) { return cardHtml(t, today, canAdv); }).join('')
              : '<div class="kw-empty">暂无事项</div>') +
          '</div>' +
        '</section>';
      }).join('');

      /* 筛选后一条都不剩（但库里有数据）→ 在列区上方说明是筛出来的空 */
      if (all.length && !rows.length) {
        hintBox.hidden = false;
        hintBox.innerHTML = SD.icons.get('filter', 14) +
          '<span>当前筛选没有匹配的事项，点「重置」看全部 ' + all.length + ' 项。</span>';
      }
    }

    /* ---- 卡片点击：推进 / 编辑（事件委托，重绘后仍然有效） ---- */
    board.addEventListener('click', function (e) {
      var adv = e.target.closest('[data-act="advance"]');
      if (adv) {
        e.stopPropagation();
        /* 受限：按钮本身是 disabled（点不出事件），这里兜的是「有人强解 disabled」
           —— 不弹表单、不改状态，只说一句要解锁 */
        if (!SD.auth.can('data.write')) {
          U.toast('受限模式：推进状态需要安全员权限。点右上角「受限模式」输入六位密码解锁。', 'err');
          return;
        }
        advance(ctx, adv.dataset.id);
        return;
      }
      var card = e.target.closest('.kw-item');
      if (!card) return;
      var item = findById(ctx, card.dataset.id);
      if (item) openForm(ctx, item);
    });

    /* ---- 拖动换列（桌面端；触屏用推进按钮，不强依赖拖拽） ---- */
    var dragId = null;
    board.addEventListener('dragstart', function (e) {
      /* 受限：卡片 draggable=false 一般不触发；真触发了也不许拖 */
      if (!SD.auth.can('data.write')) {
        e.preventDefault();
        return;
      }
      var card = e.target.closest('.kw-item');
      if (!card) return;
      dragId = card.dataset.id;
      card.classList.add('dragging');
      try {
        e.dataTransfer.setData('text/plain', dragId);
        e.dataTransfer.effectAllowed = 'move';
      } catch (err) { /* 老浏览器不支持 dataTransfer 时仍能靠 dragId 兜底 */ }
    });
    board.addEventListener('dragend', function (e) {
      var card = e.target.closest('.kw-item');
      if (card) card.classList.remove('dragging');
      Array.prototype.forEach.call(board.querySelectorAll('.kw-col.drag-over'), function (c) {
        c.classList.remove('drag-over');
      });
      dragId = null;
    });
    board.addEventListener('dragover', function (e) {
      var col = e.target.closest('.kw-col');
      if (!col) return;
      e.preventDefault();
      if (!col.classList.contains('drag-over')) col.classList.add('drag-over');
    });
    board.addEventListener('dragleave', function (e) {
      var col = e.target.closest('.kw-col');
      if (col && !col.contains(e.relatedTarget)) col.classList.remove('drag-over');
    });
    board.addEventListener('drop', function (e) {
      var col = e.target.closest('.kw-col');
      if (!col) return;
      e.preventDefault();
      col.classList.remove('drag-over');
      var id = dragId;
      if (!id) { try { id = e.dataTransfer.getData('text/plain'); } catch (err) { id = ''; } }
      moveTo(ctx, id, col.dataset.st);
    });

    host.appendChild(sec);
    redraw();
  }

  return {
    render: render,
    STATUS: STATUS,
    PRI: PRI,
    /* 下面几个导出给自检用（不参与界面） */
    statOf: statOf,
    dueOf: dueOf,
    isOver: isOver
  };
})();
