(function () {
  if (window.IronBendAuth?.installed) return;

  const nativeFetch = window.fetch.bind(window);
  const ACCESS_KEY = 'ib_access_token';
  const ROLE_KEY = 'ib_role';
  const USER_KEY = 'ib_user';

  function accessToken() {
    return sessionStorage.getItem(ACCESS_KEY) || localStorage.getItem(ACCESS_KEY);
  }

  function currentUser() {
    return {
      username: sessionStorage.getItem(USER_KEY) || localStorage.getItem(USER_KEY) || '',
      role: sessionStorage.getItem(ROLE_KEY) || localStorage.getItem(ROLE_KEY) || '',
    };
  }

  function clearSession() {
    for (const storage of [sessionStorage, localStorage]) {
      storage.removeItem(ACCESS_KEY);
      storage.removeItem(ROLE_KEY);
      storage.removeItem(USER_KEY);
    }
  }

  function storeSession(result, remember = true) {
    if (!result?.access_token || !result?.user) throw new Error('Invalid auth response');
    const primary = remember ? localStorage : sessionStorage;
    const secondary = remember ? sessionStorage : localStorage;

    secondary.removeItem(ACCESS_KEY);
    secondary.removeItem(USER_KEY);
    primary.setItem(ACCESS_KEY, result.access_token);
    primary.setItem(USER_KEY, result.user.username || '');

    // Role is display/navigation state only. Server permissions come from JWT.
    primary.setItem(ROLE_KEY, result.user.role || '');
    localStorage.setItem(ROLE_KEY, result.user.role || '');
  }

  async function refreshAccessToken() {
    const response = await nativeFetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'same-origin',
    });
    if (!response.ok) return null;
    const result = await response.json();
    storeSession(result, true);
    return result.access_token;
  }

  function isApiUrl(url) {
    return url.startsWith('/api/') || url.includes('/api/');
  }

  function isAuthUrl(url) {
    return url.includes('/api/auth/');
  }

  async function authFetch(input, init = {}) {
    const url = typeof input === 'string' ? input : input.url;
    const isApi = isApiUrl(url);
    const isAuth = isAuthUrl(url);
    const headers = new Headers(init.headers || (typeof input === 'string' ? undefined : input.headers));
    const token = accessToken();

    headers.delete('x-user-role');
    headers.delete('x-user-id');
    if (isApi && !isAuth && token) headers.set('Authorization', `Bearer ${token}`);

    let response = await nativeFetch(input, { ...init, headers, credentials: init.credentials || 'same-origin' });
    if (response.status === 401 && isApi && !isAuth) {
      const refreshedToken = await refreshAccessToken();
      if (refreshedToken) {
        headers.set('Authorization', `Bearer ${refreshedToken}`);
        response = await nativeFetch(input, { ...init, headers, credentials: init.credentials || 'same-origin' });
      }
    }
    if (isApi && !isAuth && (response.status === 401 || response.status === 403)) {
      window.dispatchEvent(new CustomEvent('ironbend:auth-denied', {
        detail: { status: response.status, url },
      }));
      if (response.status === 403 && window.showToast) {
        window.showToast('אין הרשאה לפעולה זו', true);
      }
    }
    return response;
  }

  window.IronBendAuth = {
    installed: true,
    fetch: authFetch,
    nativeFetch,
    accessToken,
    currentUser,
    storeSession,
    clearSession,
    refreshAccessToken,
  };

  window.__ironBendFetchInstalled = true;
  window.fetch = authFetch;
})();
