type CacheEntry<T> = {
  data: T;
  timestamp: number;
};

export function createCache<T>(successTtl: number, errorTtl: number) {
  const store = new Map<string, CacheEntry<T | null>>();

  return {
    get(key: string): T | null | undefined {
      const entry = store.get(key);
      if (!entry) return undefined;

      const ttl = entry.data === null ? errorTtl : successTtl;
      if (Date.now() - entry.timestamp > ttl) {
        store.delete(key);
        return undefined;
      }

      return entry.data;
    },

    set(key: string, data: T | null) {
      store.set(key, { data, timestamp: Date.now() });
    },

    clear() {
      store.clear();
    },

    delete(key: string) {
      store.delete(key);
    }
  };
}
