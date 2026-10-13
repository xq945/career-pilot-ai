/* ============================================================================
   智能求职辅助平台 —— 原型共享脚本
   职责：注入侧边栏与顶栏、提供图标、驱动少量演示交互（弹窗 / 标签页 / 题目切换）。
   说明：本文件仅服务于原型演示。Vue 实现阶段对应「布局组件 AppLayout」与
        「侧边栏 / 顶栏组件」，图标改用 Element Plus Icons，交互改用组件状态。
   ========================================================================== */

/* ---- 图标（内联 SVG，24×24 线性风格） ---------------------------------- */
const ICON_PATHS = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  agent:     '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 8V4M9 4h6"/><circle cx="9" cy="14" r="1.2"/><circle cx="15" cy="14" r="1.2"/>',
  resume:    '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>',
  job:       '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/><path d="M3 12h18"/>',
  match:     '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  interview: '<path d="M20 15a2 2 0 0 1-2 2H8l-4 3V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z"/><path d="M9 10h6"/>',
  user:      '<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>',
  logout:    '<path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
  plus:      '<path d="M12 5v14M5 12h14"/>',
  search:    '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/>',
  upload:    '<path d="M12 16V4"/><path d="M8 8l4-4 4 4"/><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
  trash:     '<path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/>',
  edit:      '<path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M14.5 5.5l3 3"/>',
  refresh:   '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>',
  sparkle:   '<path d="M12 3l1.8 4.7L18.5 9.5 13.8 11.3 12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M18.5 16.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
  check:     '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x:         '<path d="M6 6l12 12M18 6L6 18"/>',
  info:      '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  alert:     '<path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17h.01"/>',
  clock:     '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  arrowRight:'<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>',
  arrowLeft: '<path d="M19 12H5"/><path d="M11 18l-6-6 6-6"/>',
  send:      '<path d="M4 12l16-8-6 16-3-6z"/><path d="M11 14l9-10"/>',
  chart:     '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  target:    '<circle cx="12" cy="12" r="8"/><path d="M12 8v8M8 12h8"/>',
  gap:       '<path d="M4 18V9M10 18V5M16 18v-6"/><path d="M2 21h20"/>',
};

function icon(name, size) {
  const s = size || 18;
  const path = ICON_PATHS[name] || ICON_PATHS.info;
  return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}

/**
 * 品牌标记：机器人助手的简化头像，与 assets/favicon.svg 保持同一视觉。
 * 侧边栏 Logo 直接复用站点图标，保证品牌在各处一致 ——
 * 小尺寸下只保留头部与五官（去掉天线、简历卡片与星星），这是经渲染验证的取舍。
 * 注意：此处内联而非引用文件，故渐变 id 加 bm- 前缀，避免与页面内其他 SVG 冲突。
 */
function brandMark(size) {
  const s = size || 26;
  return `<svg width="${s}" height="${s}" viewBox="0 0 64 64" aria-hidden="true">
    <defs>
      <linearGradient id="bm-head" x1="0" y1="0" x2="0.55" y2="1">
        <stop offset="0" stop-color="#8FCBF7"/>
        <stop offset="1" stop-color="#78BDF5"/>
      </linearGradient>
    </defs>
    <rect x="2" y="3" width="60" height="58" rx="19" fill="url(#bm-head)"/>
    <ellipse cx="32" cy="33" rx="24" ry="18" fill="#FFF9F0"/>
    <circle cx="22" cy="30" r="6.2" fill="#34415E"/>
    <circle cx="42" cy="30" r="6.2" fill="#34415E"/>
    <path d="M25.5 40Q32 46 38.5 40" fill="none" stroke="#34415E" stroke-width="4.2" stroke-linecap="round"/>
  </svg>`;
}

/* ---- 导航配置（与 Vue Router 路由表一一对应） --------------------------- */
const NAV_GROUPS = [
  {
    label: '总览',
    items: [
      { key: 'dashboard', text: '仪表盘', href: 'dashboard.html', icon: 'dashboard' },
      { key: 'agent', text: '求职智能体', href: 'agent.html', icon: 'agent' },
    ],
  },
  {
    label: '求职材料',
    items: [
      { key: 'resumes', text: '简历管理', href: 'resumes.html', icon: 'resume' },
      { key: 'jobs', text: '岗位管理', href: 'jobs.html', icon: 'job' },
    ],
  },
  {
    label: 'AI 分析与练习',
    items: [
      { key: 'optimization', text: '简历定向优化', href: 'optimization.html', icon: 'match' },
      { key: 'interview', text: 'AI 面试', href: 'interview.html', icon: 'interview' },
    ],
  },
  {
    label: '账号',
    items: [
      { key: 'profile', text: '个人中心', href: 'profile.html', icon: 'user' },
    ],
  },
];

/* ---- 侧边栏 / 顶栏注入 -------------------------------------------------- */
function renderShell() {
  const body = document.body;
  const active = body.dataset.page || '';
  const crumb = body.dataset.crumb || '';

  const sidebar = document.getElementById('sidebar');
  if (sidebar) {
    const groups = NAV_GROUPS.map((g) => `
      <div class="sidebar__group">${g.label}</div>
      ${g.items.map((it) => `
        <a class="nav-item${it.key === active ? ' is-active' : ''}" href="${it.href}">
          ${icon(it.icon)}<span>${it.text}</span>
          ${it.badge ? `<span class="nav-item__badge">${it.badge}</span>` : ''}
        </a>`).join('')}
    `).join('');

    sidebar.innerHTML = `
      <div class="sidebar__brand">
        <div class="sidebar__logo">${brandMark(26)}</div>
        <div class="sidebar__title">智能求职辅助平台</div>
      </div>
      <nav class="sidebar__nav">${groups}</nav>
      <div class="sidebar__foot">毕业设计原型 · Vue 3 待实现</div>`;
  }

  const topbar = document.getElementById('topbar');
  if (topbar) {
    topbar.innerHTML = `
      <div class="topbar__crumb">${crumb}</div>
      <div class="topbar__spacer"></div>
      <div class="topbar__user">
        <div class="avatar" style="width:26px;height:26px;border-radius:50%;background:var(--brand-600);
          color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;">求</div>
        <span class="topbar__user-name">求职者</span>
      </div>`;
  }
}

/* ---- 演示交互 ---------------------------------------------------------- */
document.addEventListener('click', (e) => {
  // 打开弹窗
  const opener = e.target.closest('[data-modal-open]');
  if (opener) {
    const el = document.getElementById(opener.dataset.modalOpen);
    if (el) { el.style.display = 'flex'; }
    return;
  }
  // 关闭弹窗
  const closer = e.target.closest('[data-modal-close]');
  if (closer) {
    const ov = closer.closest('.overlay');
    if (ov) { ov.style.display = 'none'; }
    return;
  }
  // 点击遮罩关闭
  if (e.target.classList.contains('overlay')) { e.target.style.display = 'none'; return; }

  // 按钮组切换：切换选中态；若该组存在对应面板则一并切换面板。
  // 纯选择器场景（如面试题型按钮）没有面板，此时只切换选中态即可。
  const tab = e.target.closest('[data-switch]');
  if (tab) {
    const group = tab.dataset.switch;
    document.querySelectorAll(`[data-switch="${group}"]`).forEach((n) => n.classList.remove('is-active'));
    tab.classList.add('is-active');
    // 用 class 切换而非 style.display —— 面板自身可能是 flex 布局，
    // 直接写 display 会把它的 display:flex 一并覆盖掉。
    document.querySelectorAll(`[data-switch-panel="${group}"]`).forEach((p) => {
      p.classList.toggle('is-hidden', p.dataset.switchTarget !== tab.dataset.switchTarget);
    });
    return;
  }

  // 上下文选择芯片开关
  const chip = e.target.closest('.ctx-chip');
  if (chip) { chip.classList.toggle('is-on'); }

  // 编辑态切换：点击带 data-edit-toggle（值为目标容器选择器）的按钮，
  // 切换目标容器的 is-editing 状态，由页面内样式控制「展示态 ↔ 编辑态」的显隐。
  // 首个使用者为个人中心「基本资料」卡片（展示态只读、编辑态可改）。
  const editToggle = e.target.closest('[data-edit-toggle]');
  if (editToggle) {
    const target = document.querySelector(editToggle.dataset.editToggle);
    if (target) { target.classList.toggle('is-editing'); }
  }
});

document.addEventListener('DOMContentLoaded', renderShell);
