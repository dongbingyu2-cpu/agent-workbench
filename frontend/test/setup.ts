import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom has no ResizeObserver; the minimap only needs it for live re-measuring.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
if (typeof globalThis.ResizeObserver === 'undefined') {
  (globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver = ResizeObserverStub;
}

// Node 24 + jsdom do not expose window.localStorage by default. Provide a small
// in-memory Storage so theme/i18n/tests that read and write it behave.
function createMemoryStorage(): Storage {
  let store = new Map<string, string>();
  const storage: Storage = {
    get length(): number { return store.size; },
    clear: () => { store = new Map(); },
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    key: (index: number) => [...store.keys()][index] ?? null,
    removeItem: (key: string) => { store.delete(key); },
    setItem: (key: string, value: string) => { store.set(key, String(value)); },
  };
  return storage;
}

if (typeof globalThis.localStorage === 'undefined') {
  (globalThis as unknown as { localStorage: Storage }).localStorage = createMemoryStorage();
}
if (typeof window !== 'undefined' && typeof window.localStorage === 'undefined') {
  (window as unknown as { localStorage: Storage }).localStorage = createMemoryStorage();
}

afterEach(() => cleanup());