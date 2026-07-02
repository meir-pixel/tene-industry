/**
 * access-guard.js — page-level access enforcement
 *
 * Each protected HTML page loads this script early (before DOMContentLoaded).
 * It reads GET /api/access/me and:
 *   - hidden → redirects to /dashboard.html (page does not exist for this role)
 *   - read   → marks document.body.dataset.access='read'; CSS hides [data-requires-edit]
 *   - edit   → marks document.body.dataset.access='edit'; full access
 *
 * Usage: add to each protected page's <head>:
 *   <script src="/access-guard.js" data-screen="<screen-id>"></script>
 */
(function () {
  const scriptEl = document.currentScript || (function () {
    const scripts = document.getElementsByTagName('script');
    return scripts[scripts.length - 1];
  })();

  const screenId = scriptEl && scriptEl.dataset.screen;
  if (!screenId) return;

  const style = document.createElement('style');
  style.textContent = '[data-requires-edit] { display: none !important; }';
  style.id = 'ib-access-guard-style';

  async function enforce() {
    try {
      const token = (typeof IronBendAuth !== 'undefined' && IronBendAuth.getToken && IronBendAuth.getToken()) ||
                    localStorage.getItem('ib_access_token') || sessionStorage.getItem('ib_access_token');
      if (!token) {
        window.location.href = '/login.html?redirect=' + encodeURIComponent(location.pathname);
        return;
      }

      const res = await fetch('/api/access/me', {
        headers: { Authorization: 'Bearer ' + token }
      });

      if (res.status === 401) {
        window.location.href = '/login.html?redirect=' + encodeURIComponent(location.pathname);
        return;
      }

      if (!res.ok) return;

      const { screens } = await res.json();
      const screen = screens.find(s => s.id === screenId);
      const level = screen ? screen.access : 'hidden';

      if (level === 'hidden') {
        window.location.href = '/dashboard.html';
        return;
      }

      document.body.dataset.access = level;
      if (level === 'read') {
        document.head.appendChild(style);
      } else {
        const existing = document.getElementById('ib-access-guard-style');
        if (existing) existing.remove();
      }
    } catch {
      // Network error — let page load, server-side auth still protects data
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', enforce);
  } else {
    enforce();
  }
})();
