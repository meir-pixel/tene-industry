(function () {
  if (window.__ironBendFetchInstalled) return;
  window.__ironBendFetchInstalled = true;

  const nativeFetch = window.fetch.bind(window);
  function accessToken() {
    return sessionStorage.getItem('ib_access_token') || localStorage.getItem('ib_access_token');
  }
  async function refreshAccessToken() {
    const response = await nativeFetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'same-origin',
    });
    if (!response.ok) return null;
    const result = await response.json();
    localStorage.setItem('ib_access_token', result.access_token);
    localStorage.setItem('ib_role', result.user.role);
    localStorage.setItem('ib_user', result.user.username);
    return result.access_token;
  }
  window.fetch = async function ironBendFetch(input, init = {}) {
    const url = typeof input === 'string' ? input : input.url;
    const isApi = url.startsWith('/api/') || url.includes('/api/');
    const isAuth = url.includes('/api/auth/');
    const headers = new Headers(init.headers || (typeof input === 'string' ? undefined : input.headers));
    const token = accessToken();
    if (isApi && !isAuth && token) headers.set('Authorization', `Bearer ${token}`);
    let response = await nativeFetch(input, { ...init, headers, credentials: init.credentials || 'same-origin' });
    if (response.status === 401 && isApi && !isAuth) {
      const refreshedToken = await refreshAccessToken();
      if (refreshedToken) {
        headers.set('Authorization', `Bearer ${refreshedToken}`);
        response = await nativeFetch(input, { ...init, headers, credentials: init.credentials || 'same-origin' });
      }
    }
    return response;
  };
})();
