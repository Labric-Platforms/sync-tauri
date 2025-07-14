import { LazyStore } from '@tauri-apps/plugin-store';

const store = new LazyStore('settings.json', { autoSave: true }); // debounce-saving, 100 ms

export async function get<T>(key: string, fallback: T): Promise<T> {
  const v = await store.get<T>(key);
  return v ?? fallback;
}

export async function set<T>(key: string, value: T) {
  await store.set(key, value);
}

/* ---- domain helpers ------------------------------------------- */

const RECENT_KEY = 'recentDirs';
const MAX_RECENT = 5;

export async function pushRecent(dir: string) {
  const list = (await get<string[]>(RECENT_KEY, []))
    .filter(p => p !== dir);           // de-dupe
  list.unshift(dir);
  await set(RECENT_KEY, list.slice(0, MAX_RECENT));
}

export async function getRecentDirs(): Promise<string[]> {
    return get<string[]>('recentDirs', []);
  }
  