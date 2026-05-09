// IndexedDB wrapper for offline storage
const OfflineDB = (() => {
  let _db = null;

  async function open() {
    if (_db) return _db;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('ironbend-offline', 2);
      req.onupgradeneeded = ev => {
        const db = ev.target.result;
        if (!db.objectStoreNames.contains('pending_orders')) {
          db.createObjectStore('pending_orders', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('cached_orders')) {
          const s = db.createObjectStore('cached_orders', { keyPath: 'id' });
          s.createIndex('status', 'status');
        }
        if (!db.objectStoreNames.contains('cached_customers')) {
          db.createObjectStore('cached_customers', { keyPath: 'id' });
        }
      };
      req.onsuccess = () => { _db = req.result; resolve(_db); };
      req.onerror   = () => reject(req.error);
    });
  }

  async function put(store, value) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(store, 'readwrite');
      const req = tx.objectStore(store).put(value);
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  }

  async function getAll(store) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  }

  async function remove(store, key) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(store, 'readwrite');
      const req = tx.objectStore(store).delete(key);
      req.onsuccess = () => resolve();
      req.onerror   = () => reject(req.error);
    });
  }

  async function count(store) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  }

  // Save order payload for later sync
  async function queueOrder(payload) {
    const localId = `local-${Date.now()}`;
    await put('pending_orders', { payload, localId, createdAt: new Date().toISOString() });
    // Request background sync if supported
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
      const reg = await navigator.serviceWorker.ready;
      await reg.sync.register('sync-orders');
    }
    return localId;
  }

  // Cache orders list for offline viewing
  async function cacheOrders(orders) {
    for (const o of orders) await put('cached_orders', o);
  }

  async function getCachedOrders() {
    return getAll('cached_orders');
  }

  async function cacheCustomers(customers) {
    for (const c of customers) await put('cached_customers', c);
  }

  async function getCachedCustomers() {
    return getAll('cached_customers');
  }

  async function getPendingCount() {
    return count('pending_orders');
  }

  async function getPendingOrders() {
    return getAll('pending_orders');
  }

  return { queueOrder, cacheOrders, getCachedOrders, cacheCustomers, getCachedCustomers, getPendingCount, getPendingOrders, remove };
})();
