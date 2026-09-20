import { config } from './config.js';
export function configured() {
  try {
    const u = new URL(config.supabaseUrl);
    const key = config.supabasePublishableKey;
    if (u.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(u.hostname) || u.pathname !== '/' || u.search || u.username || u.password) return false;
    if (key.startsWith('sb_publishable_')) return true;
    const payload = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.role === 'anon';
  } catch { return false; }
}
export async function rpc(name, args = {}, signal) {
  if (!configured()) throw new Error('NOT_CONFIGURED');
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 18000);
  try {
    const response = await fetch(`${config.supabaseUrl.replace(/\/$/, '')}/rest/v1/rpc/${encodeURIComponent(name)}`, {
      method: 'POST', headers: { apikey: config.supabasePublishableKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(args), signal: controller.signal, credentials: 'omit', cache: 'no-store'
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(data?.message === 'RATE_LIMIT' ? 'RATE_LIMIT' : data?.message === 'INVALID_SUBMISSION' ? 'INVALID_SUBMISSION' : 'REQUEST_FAILED');
      error.status = response.status;
      throw error;
    }
    return data;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
let adminClientPromise;
export async function getAdminClient() {
  if (!configured()) return null;
  if (!adminClientPromise) adminClientPromise = (async () => {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = new URL('./vendor/supabase-2.57.4.js', import.meta.url).href;
      script.onload = resolve; script.onerror = () => reject(new Error('CLIENT_UNAVAILABLE'));
      document.head.append(script);
    });
    return window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
      auth: { storage: sessionStorage, storageKey: 'pixelalty-admin-auth', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      global: { headers: { 'X-Client-Info': 'pixelalty-admin/1.0' } }
    });
  })();
  return adminClientPromise;
}
export function element(tag, className = '', text = '') {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== '') el.textContent = String(text);
  return el;
}
export const serviceNames = Object.freeze({launch:'Launch Website',growth:'Growth Website',premium:'Premium Website',advanced:'Advanced / Ecommerce',listing:'Listing Video',other:'Other'});
export function dateLabel(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '' : new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(date);
}
