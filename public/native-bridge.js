/*
 * Runs only in the Capacitor worker application. The web/PWA ignores it.
 * A verified Android App Link or iOS Universal Link carries the same public
 * QR URL that a customer camera opens. We never trust its contents here;
 * scan.html parses it and the server still enforces user + device approval.
 */
(function () {
  const capacitor = window.Capacitor;
  const appPlugin = capacitor?.Plugins?.App;
  if (!capacitor?.isNativePlatform?.() || !appPlugin) return;

  function targetFor(urlValue) {
    try {
      const incoming = new URL(String(urlValue || ''));
      if (incoming.protocol !== 'https:' || incoming.origin !== location.origin || incoming.pathname !== '/customer-scan.html') return '';
      if (!incoming.searchParams.get('code')) return '';
      return `/scan.html?native_scan=${encodeURIComponent(incoming.toString())}`;
    } catch (_) {
      return '';
    }
  }

  function openIncoming(urlValue) {
    const target = targetFor(urlValue);
    if (!target || `${location.pathname}${location.search}` === target) return;
    location.replace(target);
  }

  try {
    appPlugin.addListener('appUrlOpen', event => openIncoming(event?.url));
    Promise.resolve(appPlugin.getLaunchUrl?.()).then(event => openIncoming(event?.url)).catch(() => {});
  } catch (_) {
    // A browser may expose a partial Capacitor object. It remains a normal PWA.
  }
})();
