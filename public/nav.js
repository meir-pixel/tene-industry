// IronBend – Shared Navigation v3 (3D + RTL drawer)
(function () {
  const CSS = `
    html {
      scrollbar-gutter: stable; /* prevent layout shift when scrollbar appears/disappears */
    }
    #ib-topnav {
      background: linear-gradient(180deg, #ffffff 0%, #f2f5f9 100%);
      border-bottom: 1px solid rgba(0,0,0,0.13);
      height: 56px; display:flex; align-items:center; padding:0 16px;
      position:fixed; top:0; left:0; right:0; z-index:300;
      box-shadow: 0 3px 16px rgba(0,0,0,0.10), 0 1px 0 rgba(255,255,255,0.95) inset;
      font-family:'Heebo',sans-serif;
      width:100%;
    }
    body { padding-top: 56px; }
    #ib-logo {
      display:flex; align-items:center; gap:8px;
      font-weight:800; font-size:15px; color:#1a2533;
      text-decoration:none; margin-left:16px; flex-shrink:0;
    }
    #ib-logo-icon {
      width:32px; height:32px;
      background: linear-gradient(145deg, #df8640 0%, #c9621a 55%, #a4500f 100%);
      border-radius:8px; display:flex; align-items:center;
      justify-content:center; font-size:16px; flex-shrink:0;
      box-shadow: 0 3px 8px rgba(201,98,26,0.40),
                  inset 0 1px 0 rgba(255,255,255,0.25),
                  inset 0 -1px 0 rgba(0,0,0,0.15);
    }
    #ib-links {
      display:flex; gap:2px; flex:1; overflow-x:auto;
      scrollbar-width:none; -ms-overflow-style:none;
    }
    #ib-links::-webkit-scrollbar { display:none; }
    .ib-link {
      padding:6px 11px; border-radius:7px; text-decoration:none;
      color:#526070; font-size:12.5px; font-weight:600;
      transition:all .18s; white-space:nowrap; flex-shrink:0;
      position:relative;
    }
    .ib-link:hover { background:rgba(0,0,0,0.05); color:#1a2533; }
    .ib-link.ib-active {
      background:rgba(201,98,26,0.10); color:#c9621a;
      box-shadow: inset 0 -2px 0 #c9621a;
    }
    #ib-hamburger {
      display:none; background:none; border:none; cursor:pointer;
      padding:6px; border-radius:7px; color:#526070;
      font-size:22px; margin-right:auto; line-height:1;
    }
    #ib-hamburger:hover { background:rgba(0,0,0,0.05); }

    /* ── OVERLAY ── */
    #ib-overlay {
      display:none; position:fixed; inset:0;
      background:rgba(0,0,0,0.45); z-index:400;
    }
    #ib-overlay.open { display:block; }

    /* ── DRAWER — slides from LEFT (RTL "far" side) ── */
    #ib-drawer {
      position:fixed; top:0; left:0; bottom:0; width:270px;
      background:#ffffff; z-index:401;
      transform:translateX(-100%);
      transition:transform .27s cubic-bezier(.4,0,.2,1);
      display:flex; flex-direction:column;
      box-shadow: 4px 0 28px rgba(0,0,0,0.14);
      font-family:'Heebo',sans-serif;
    }
    #ib-drawer.open { transform:translateX(0); }

    #ib-drawer-head {
      height:58px; display:flex; align-items:center; padding:0 16px;
      border-bottom:1px solid rgba(0,0,0,0.09);
      background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
      gap:10px; flex-shrink:0;
    }
    #ib-drawer-close {
      background:none; border:none; cursor:pointer;
      font-size:20px; color:#8fa0b0; padding:6px;
      border-radius:6px; margin-left:auto;
      transition:background .15s;
    }
    #ib-drawer-close:hover { background:rgba(0,0,0,0.06); color:#526070; }

    #ib-drawer-links { flex:1; overflow-y:auto; padding:8px; }
    .ib-dl {
      display:flex; align-items:center; gap:12px;
      padding:11px 14px; border-radius:9px; text-decoration:none;
      color:#526070; font-size:14px; font-weight:600;
      transition:all .15s; margin-bottom:2px;
    }
    .ib-dl:hover { background:rgba(0,0,0,0.04); color:#1a2533; }
    .ib-dl.ib-active { background:rgba(201,98,26,0.10); color:#c9621a; }
    .ib-dl-icon { font-size:17px; width:24px; text-align:center; flex-shrink:0; }

    /* ── BOTTOM NAV (mobile) ── */
    #ib-bottom {
      display:none; position:fixed; bottom:0; right:0; left:0; z-index:300;
      background: linear-gradient(180deg, #f8fafc 0%, #ffffff 100%);
      border-top:1px solid rgba(0,0,0,0.10);
      box-shadow: 0 -3px 14px rgba(0,0,0,0.08);
      height:60px; grid-template-columns:repeat(5,1fr);
    }
    .ib-bn {
      display:flex; flex-direction:column; align-items:center;
      justify-content:center; gap:2px; text-decoration:none;
      color:#8fa0b0; font-size:10px; font-weight:600;
      font-family:'Heebo',sans-serif; transition:color .15s;
    }
    .ib-bn:hover { color:#526070; }
    .ib-bn.ib-active { color:#c9621a; }
    .ib-bn-icon { font-size:20px; line-height:1; }

    @media(max-width:768px) {
      #ib-links { display:none; }
      #ib-hamburger { display:flex; align-items:center; }
    }
    @media(max-width:640px) {
      #ib-bottom { display:grid; }
      body { padding-bottom:64px !important; }
    }

    /* ── TOAST ── */
    #ib-toast {
      position:fixed; bottom:72px; left:50%; transform:translateX(-50%);
      padding:10px 22px; border-radius:10px; font-family:'Heebo',sans-serif;
      font-weight:700; font-size:13px; z-index:999;
      transition:opacity .4s; direction:rtl; white-space:nowrap;
      pointer-events:none; box-shadow:0 4px 18px rgba(0,0,0,0.16); opacity:0;
    }
  `;

  const LINKS = [
    { href:'/dashboard.html',    icon:'📊', label:'דשבורד',      id:'dashboard'    },
    { href:'/orders.html',       icon:'📋', label:'הזמנות',      id:'orders'       },
    { href:'/index.html',        icon:'➕', label:'הזמנה חדשה',  id:'new'          },
    { href:'/customers.html',    icon:'👥', label:'לקוחות',      id:'customers'    },
    { href:'/machine.html',      icon:'🔧', label:'מכונות',      id:'machine'      },
    { href:'/kiosk.html',        icon:'🖥️', label:'תחנת עבודה',  id:'kiosk'        },
    { href:'/warehouse.html',    icon:'📦', label:'מחסן',        id:'warehouse'    },
    { href:'/inventory.html',    icon:'🗄️', label:'מלאי',        id:'inventory'    },
    // BUG-47: stub pages hidden from nav until modules are ready
    // { href:'/procurement.html',  icon:'🛒', label:'רכש',         id:'procurement'  },
    // { href:'/projects.html',     icon:'🏗️', label:'פרויקטים',    id:'projects'     },
    // { href:'/warroom.html',      icon:'🚨', label:'War Room',    id:'warroom'      },
    // { href:'/maintenance.html',  icon:'🛠️', label:'תחזוקה',      id:'maintenance'  },
    { href:'/quality.html',      icon:'🔍', label:'איכות',       id:'quality'      },
    { href:'/reports.html',      icon:'📈', label:'דוחות',       id:'reports'      },
    { href:'/finance.html',      icon:'💰', label:'פיננסים',     id:'finance'      },
    { href:'/driver.html',       icon:'🚚', label:'נהג',         id:'driver'       },
    { href:'/holdings.html',     icon:'🏢', label:'אחזקות',      id:'holdings'     },
    { href:'/admin.html',        icon:'⚙️', label:'ניהול',       id:'admin'        },
  ];

  const BOTTOM_IDS = ['dashboard','orders','new','admin']; // BUG-47: warroom removed (stub)
  const path     = location.pathname.replace(/^\//, '') || 'dashboard.html';
  const activeId = (LINKS.find(l => l.href.replace('/','') === path) || {}).id || '';
  const ia = id => id === activeId ? 'ib-active' : '';

  // ── inject styles ──
  const styleEl = document.createElement('style');
  styleEl.textContent = CSS;
  document.head.appendChild(styleEl);

  // ── top nav ──
  const topnav = document.createElement('nav');
  topnav.id = 'ib-topnav';
  topnav.innerHTML =
    '<a href="/dashboard.html" id="ib-logo"><div id="ib-logo-icon">🔩</div><span>IronBend</span></a>' +
    '<div id="ib-links">' +
      LINKS.map(l => '<a href="'+l.href+'" class="ib-link '+ia(l.id)+'">'+l.icon+' '+l.label+'</a>').join('') +
    '</div>' +
    '<button id="ib-hamburger" aria-label="תפריט">☰</button>';

  // ── overlay ──
  const overlay = document.createElement('div');
  overlay.id = 'ib-overlay';

  // ── drawer (slides from LEFT) ──
  const drawer = document.createElement('div');
  drawer.id = 'ib-drawer';
  drawer.innerHTML =
    '<div id="ib-drawer-head">' +
      '<div style="width:32px;height:32px;background:linear-gradient(145deg,#df8640,#c9621a,#a4500f);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;box-shadow:0 2px 6px rgba(201,98,26,0.35),inset 0 1px 0 rgba(255,255,255,0.22)">🔩</div>' +
      '<span style="font-weight:800;font-size:15px;color:#1a2533">IronBend</span>' +
      '<button id="ib-drawer-close" aria-label="סגור">✕</button>' +
    '</div>' +
    '<div id="ib-drawer-links">' +
      LINKS.map(l =>
        '<a href="'+l.href+'" class="ib-dl '+ia(l.id)+'">' +
          '<span class="ib-dl-icon">'+l.icon+'</span>'+l.label+
        '</a>'
      ).join('') +
    '</div>';

  // ── bottom nav ──
  const bottomNav = document.createElement('nav');
  bottomNav.id = 'ib-bottom';
  bottomNav.innerHTML = LINKS
    .filter(l => BOTTOM_IDS.includes(l.id))
    .map(l =>
      '<a href="'+l.href+'" class="ib-bn '+ia(l.id)+'">' +
        '<span class="ib-bn-icon">'+l.icon+'</span>' +
        '<span>'+l.label+'</span>' +
      '</a>'
    ).join('');

  // ── toast ──
  const toast = document.createElement('div');
  toast.id = 'ib-toast';

  // ── open / close ──
  function openDrawer()  {
    drawer.classList.add('open');
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeDrawer() {
    drawer.classList.remove('open');
    overlay.classList.remove('open');
    document.body.style.overflow = '';
  }

  // ── search overlay ──
  const searchOverlay = document.createElement('div');
  searchOverlay.id = 'ib-search-bar';
  searchOverlay.style.display = 'none';
  searchOverlay.innerHTML =
    '<div id="ib-search-box">' +
      '<input id="ib-search-input" type="text" placeholder="🔍  חיפוש הזמנה, לקוח, חבילה..." autocomplete="off">' +
      '<div id="ib-search-results"><div class="ib-sr-empty">הקלד לפחות 2 תווים לחיפוש</div></div>' +
    '</div>';

  let searchTimer;
  function openSearch() {
    searchOverlay.style.display = 'flex';
    setTimeout(() => document.getElementById('ib-search-input').focus(), 50);
  }
  function closeSearch() {
    searchOverlay.style.display = 'none';
    document.getElementById('ib-search-input').value = '';
    document.getElementById('ib-search-results').innerHTML = '<div class="ib-sr-empty">הקלד לפחות 2 תווים לחיפוש</div>';
  }

  // Add search button to topnav HTML
  const searchBtn = document.createElement('button');
  searchBtn.id = 'ib-search-btn';
  searchBtn.style.cssText = 'background:none;border:none;cursor:pointer;padding:6px 10px;border-radius:7px;color:#526070;font-size:17px;margin-right:4px;line-height:1;transition:background .15s;';
  searchBtn.title = 'חיפוש (Ctrl+K)';
  searchBtn.textContent = '🔍';
  searchBtn.addEventListener('mouseenter', () => searchBtn.style.background='rgba(0,0,0,0.05)');
  searchBtn.addEventListener('mouseleave', () => searchBtn.style.background='none');
  searchBtn.addEventListener('click', openSearch);

  // ── mount ──
  function mount() {
    document.querySelectorAll('nav.topnav, .topnav').forEach(el => el.remove());
    document.body.insertBefore(topnav, document.body.firstChild);
    document.body.appendChild(overlay);
    document.body.appendChild(drawer);
    document.body.appendChild(bottomNav);
    document.body.appendChild(toast);
    document.body.appendChild(searchOverlay);
    // Insert search btn before hamburger
    const nav = document.getElementById('ib-topnav');
    const hamburger = document.getElementById('ib-hamburger');
    nav.insertBefore(searchBtn, hamburger);
    document.getElementById('ib-hamburger').addEventListener('click', openDrawer);
    document.getElementById('ib-drawer-close').addEventListener('click', closeDrawer);
    overlay.addEventListener('click', closeDrawer);
    drawer.querySelectorAll('.ib-dl').forEach(a => a.addEventListener('click', closeDrawer));
    // Search events
    searchOverlay.addEventListener('click', e => { if (e.target === searchOverlay) closeSearch(); });
    document.getElementById('ib-search-input').addEventListener('input', function() {
      clearTimeout(searchTimer);
      const q = this.value.trim();
      if (q.length < 2) {
        document.getElementById('ib-search-results').innerHTML = '<div class="ib-sr-empty">הקלד לפחות 2 תווים לחיפוש</div>';
        return;
      }
      document.getElementById('ib-search-results').innerHTML = '<div class="ib-sr-empty">מחפש...</div>';
      searchTimer = setTimeout(async () => {
        try {
          const r = await fetch('/api/search?q=' + encodeURIComponent(q));
          const { results } = await r.json();
          if (!results.length) {
            document.getElementById('ib-search-results').innerHTML = '<div class="ib-sr-empty">לא נמצאו תוצאות</div>';
            return;
          }
          document.getElementById('ib-search-results').innerHTML = results.map(res =>
            '<a class="ib-sr-item" href="' + res.url + '" onclick="closeSearch&&closeSearch()">' +
              '<span class="ib-sr-icon">' + res.icon + '</span>' +
              '<div><div class="ib-sr-ref">' + res.ref + '</div>' +
              '<div class="ib-sr-label">' + (res.label||'') + (res.status?' · '+res.status:'') + '</div></div>' +
            '</a>'
          ).join('');
        } catch(e) {
          document.getElementById('ib-search-results').innerHTML = '<div class="ib-sr-empty">שגיאת חיפוש</div>';
        }
      }, 280);
    });
    document.getElementById('ib-search-input').addEventListener('keydown', e => {
      if (e.key === 'Escape') closeSearch();
    });
    // Ctrl+K shortcut
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); openSearch(); }
    });
  }
  window.closeSearch = closeSearch;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }

  // ── PWA ──
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
  window.addEventListener('online',  () => window.showToast && window.showToast('החיבור חזר'));
  window.addEventListener('offline', () => window.showToast && window.showToast('אין חיבור לרשת', true));

  // ── global toast ──
  window.showToast = function(msg, isError) {
    const t = document.getElementById('ib-toast');
    if (!t) return;
    t.textContent = msg;
    t.style.background = isError ? '#b83227' : '#1a7a42';
    t.style.color = 'white';
    t.style.opacity = '1';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.style.opacity = '0'; }, 3500);
  };
})();
