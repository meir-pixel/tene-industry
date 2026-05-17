// IronBend – Shared navigation (light theme)
(function () {
  const PAGE = document.body.dataset.page || '';

  const allLinks = [
    { href: '/admin.html',    icon: '⚙️',  label: 'ניהול',   id: 'admin'    },
    { href: '/holdings.html', icon: '🏢',  label: 'אחזקות',  id: 'holdings' },
    { href: '/dashboard.html',icon: '📊',  label: 'דשבורד',  id: 'dashboard'},
    { href: '/orders.html',   icon: '📋',  label: 'הזמנות',  id: 'orders'   },
    { href: '/index.html',    icon: '➕',  label: 'חדשה',    id: 'new'      },
    { href: '/machine.html',  icon: '🔧',  label: 'מכונה',   id: 'machine'  },
    { href: '/reports.html',  icon: '📈',  label: 'דוחות',   id: 'reports'  },
    { href: '/driver.html',   icon: '🚚',  label: 'נהג',     id: 'driver'   },
  ];

  // ── Bottom nav (mobile) ────────────────────────────────
  // Show only the 5 most important on mobile
  const mobileLinks = allLinks.filter(l => ['admin','dashboard','orders','new','machine'].includes(l.id));

  const nav = document.createElement('nav');
  nav.id = 'bottom-nav';
  nav.innerHTML = mobileLinks.map(l => `
    <a href="${l.href}" class="bnav-item ${l.id === PAGE ? 'active' : ''}">
      <span class="bnav-icon">${l.icon}</span>
      <span class="bnav-label">${l.label}</span>
    </a>`).join('');

  const style = document.createElement('style');
  style.textContent = `
    #bottom-nav {
      display: none;
      position: fixed; bottom: 0; right: 0; left: 0; z-index: 500;
      background: #ffffff;
      border-top: 1px solid rgba(0,0,0,0.09);
      box-shadow: 0 -2px 10px rgba(0,0,0,0.08);
      padding: 0; height: 60px;
      grid-template-columns: repeat(5, 1fr);
    }
    .bnav-item {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 2px; text-decoration: none; color: #8fa0b0;
      font-family: 'Heebo', sans-serif; font-size: 10px; font-weight: 600;
      transition: color 0.2s; padding: 6px 0;
      -webkit-tap-highlight-color: transparent;
    }
    .bnav-item.active { color: #c9621a; }
    .bnav-item:active { background: rgba(0,0,0,0.03); }
    .bnav-icon { font-size: 19px; line-height: 1; }
    @media (max-width: 768px) {
      #bottom-nav { display: grid; }
      body { padding-bottom: 64px; }
      .top-nav-links, .nav-links { display: none !important; }
    }
  `;

  document.head.appendChild(style);
  document.body.appendChild(nav);

  // ── PWA / SW ───────────────────────────────────────────
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
    navigator.serviceWorker.addEventListener('message', e => {
      if (e.data?.type === 'order_synced') showToast(`סונכרן: ${e.data.orderNum}`);
    });
  }
  window.addEventListener('online',  () => showToast('החיבור חזר ✓'));
  window.addEventListener('offline', () => showToast('אין חיבור – מצב Offline', true));

  // ── Toast ──────────────────────────────────────────────
  window.showToast = function(msg, isError = false) {
    let t = document.getElementById('_toast');
    if (!t) {
      t = document.createElement('div');
      t.id = '_toast';
      Object.assign(t.style, {
        position:'fixed', bottom:'72px', left:'50%', transform:'translateX(-50%)',
        padding:'10px 20px', borderRadius:'10px', fontFamily:'Heebo,sans-serif',
        fontWeight:'700', fontSize:'13px', zIndex:'999', transition:'opacity 0.4s',
        direction:'rtl', whiteSpace:'nowrap', pointerEvents:'none',
        boxShadow:'0 4px 16px rgba(0,0,0,0.15)'
      });
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.background = isError ? '#b83227' : '#1a7a42';
    t.style.color = 'white';
    t.style.opacity = '1';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.style.opacity = '0', 3500);
  };
})();
