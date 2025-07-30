import { LazyStore } from "@tauri-apps/plugin-store";
import { jwtDecode, JwtPayload } from "jwt-decode";

// Custom JWT payload interface for our application
export interface CustomJwtPayload extends JwtPayload {
  org_id?: string;
  org_name?: string;
  org_image_url?: string;
  org_slug?: string;
  api_key?: string;
  device_fingerprint?: string;
  scope?: string;
}

const store = new LazyStore("settings.json", { autoSave: true }); // debounce-saving, 100 ms

export async function get<T>(key: string, fallback: T): Promise<T> {
  const v = await store.get<T>(key);
  return v ?? fallback;
}

export async function set<T>(key: string, value: T) {
  await store.set(key, value);
}

/* ---- domain helpers ------------------------------------------- */

const RECENT_KEY = "recentDirs";
const MAX_RECENT = 5;

export async function pushRecent(dir: string) {
  const list = (await get<string[]>(RECENT_KEY, [])).filter((p) => p !== dir); // de-dupe
  list.unshift(dir);
  await set(RECENT_KEY, list.slice(0, MAX_RECENT));
}

export async function getRecentDirs(): Promise<string[]> {
  return get<string[]>("recentDirs", []);
}

const TOKEN_KEY = "token";

export async function setToken(token: string) {
  await set(TOKEN_KEY, token);
}

export async function getToken(): Promise<CustomJwtPayload | null> {
  const token = await get<string | null>(TOKEN_KEY, null);
  if (!token) return null;
  const decoded = jwtDecode<CustomJwtPayload>(token);
  return decoded;
}

export async function clearToken() {
  await store.delete(TOKEN_KEY);
}

const ORG_ID_KEY = "organization_id";

export async function setOrganizationId(orgId: string) {
  await set(ORG_ID_KEY, orgId);
}

export async function getOrganizationId(): Promise<string | null> {
  return get<string | null>(ORG_ID_KEY, null);
}

export async function clearOrganizationId() {
  await store.delete(ORG_ID_KEY);
}
