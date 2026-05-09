// Inject bottom mobile nav + shared PWA setup
// Include this script at top of <body> with data-page attribute on <body>
(function () {
  const PAGE = document.body.dataset.page || '';

  const links = [
    { href: '/dashboard.html', icon: '📊', label: 'דשבורד', id: 'dashboard' },
    { href: '/orders.html',    icon: '📋', label: 'הזמנות', id: 'orders'    },
    { href: '/index.html',     icon: '➕', label: 'חדשה',   id: 'new'       },
    { href: '/machine.html',   icon: '🔧', label: 'מכונה',  id: 'machine'   },
  ];

  // Bottom nav (mobile only)
  const nav = document.createElement('nav');
  nav.id = 'bottom-nav';
  nav.innerHTML = links.map(l => `
    <a href="${l.href}" class="bnav-item ${l.id === PAGE ? 'active' : ''}">
      <span class="bnav-icon">${l.icon}</span>
      <span class="bnav-label">${l.label}</span>
    </a>`).join('');

  const style = document.createElement('style');
  style.textContent = `
    #bottom-nav {
      display: none;
      position: fixed; bottom: 0; right: 0; left: 0; z-index: 500;
      background: #1a2637; border-top: 1px solid rgba(255,255,255,0.08);
      padding: 0; height: 60px;
      grid-template-columns: repeat(4, 1fr);
    }
    .bnav-item {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 2px; text-decoration: none; color: #7a93ab;
      font-family: 'Heebo', sans-serif; font-size: 11px; font-weight: 600;
      transition: color 0.2s; padding: 6px 0;
      -webkit-tap-highlight-color: transparent;
    }
    .bnav-item.active { color: #e07b39; }
    .bnav-item:active { background: rgba(255,255,255,0.05); }
    .bnav-icon { font-size: 20px; line-height: 1; }
    @media (max-width: 768px) {
      #bottom-nav { display: grid; }
      body { padding-bottom: 60px; }
      .top-nav-links { display: none !important; }
    }
  `;

  document.head.appendChild(style);
  document.body.appendChild(nav);

  // PWA
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
    navigator.serviceWorker.addEventListener('message', e => {
      if (e.data?.type === 'order_synced') showToast(`סונכרן: ${e.data.orderNum}`);
    });
  }
  window.addEventListener('online',  () => showToast('החיבור חזר'));
  window.addEventListener('offline', () => showToast('אין חיבור – offline', true));

  window.showToast = function(msg, isOffline = false) {
    let t = document.getElementById('_toast');
    if (!t) {
      t = document.createElement('div');
      t.id = '_toast';
      Object.assign(t.style, {
        position:'fixed', bottom:'72px', left:'50%', transform:'translateX(-50%)',
        padding:'10px 20px', borderRadius:'10px', fontFamily:'Heebo,sans-serif',
        fontWeight:'700', fontSize:'13px', zIndex:'999', transition:'opacity 0.4s',
        direction:'rtl', whiteSpace:'nowrap', pointerEvents:'none'
      });
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.background = isOffline ? '#e74c3c' : '#27ae60';
    t.style.color = 'white';
    t.style.opacity = '1';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.style.opacity = '0', 3500);
  };
})();
