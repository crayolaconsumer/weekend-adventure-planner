// Simple IndexedDB/localStorage cache with TTL
(function(){
  class CacheManager {
    constructor() {
      this.dbName = 'wap-cache-v1';
      this.storeName = 'kv';
      this.db = null;
      this.supportsIDB = 'indexedDB' in window;
      if (this.supportsIDB) {
        this.open();
      }
    }
    open() {
      try {
        const req = indexedDB.open(this.dbName, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(this.storeName)) {
            db.createObjectStore(this.storeName);
          }
        };
        req.onsuccess = () => { this.db = req.result; };
        req.onerror = () => { console.warn('CacheManager IDB disabled', req.error); };
      } catch(e) { /* ignore */ }
    }
    _idbTxn(mode) {
      if (!this.db) return null;
      try {
        return this.db.transaction(this.storeName, mode).objectStore(this.storeName);
      } catch(e) { return null; }
    }
    async get(key) {
      const now = Date.now();
      try {
        if (this._idbTxn('readonly')) {
          const store = this._idbTxn('readonly');
          return await new Promise((resolve) => {
            const req = store.get(key);
            req.onsuccess = () => {
              const val = req.result && JSON.parse(req.result);
              if (val && (!val.expiresAt || val.expiresAt > now)) resolve(val.value); else resolve(null);
            };
            req.onerror = () => resolve(null);
          });
        }
      } catch(e) {}
      // Fallback localStorage
      try {
        const raw = localStorage.getItem('cm:' + key);
        if (!raw) return null;
        const val = JSON.parse(raw);
        if (val && (!val.expiresAt || val.expiresAt > now)) return val.value;
      } catch(e) {}
      return null;
    }
    async set(key, value, ttlMs) {
      const record = JSON.stringify({ value, expiresAt: ttlMs ? (Date.now() + ttlMs) : null });
      try {
        if (this._idbTxn('readwrite')) {
          const store = this._idbTxn('readwrite');
          await new Promise((resolve) => {
            const req = store.put(record, key);
            req.onsuccess = () => resolve();
            req.onerror = () => resolve();
          });
          return;
        }
      } catch(e) {}
      try { localStorage.setItem('cm:' + key, record); } catch(e) {}
    }
  }
  window.cacheManager = new CacheManager();
})();


