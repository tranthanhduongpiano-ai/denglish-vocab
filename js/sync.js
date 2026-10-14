/* Denglish Vocab (iPhone) - dong bo so tu voi kho GitHub rieng tu (giong vocab_sync.py ben may tinh)
 *
 *   cards/0.json ... cards/f.json   the, chia 16 file theo chu so hex thu hai cua id
 *   img/<ten anh>                   anh minh hoa
 *   audio/<tu>_uk.mp3               giong doc mau Oxford (may tinh gui len)
 *   stats/<may>.json                so tu on moi ngay cua tung may
 *
 * Ban nao sua sau thi thang (moc "modified"). Ghi file kem sha cu: neu may kia vua ghi truoc thi doc lai,
 * gop, roi moi ghi. Tu dong bo khi mo app, khi co mang tro lai, va vai giay sau moi thay doi.
 */
import { db, getMeta, setMeta } from './db.js';
import { applyRemote, S, syncRecords } from './store.js';
import { b64ToBytes, bytesToB64, canon, fetchT, fromUtf8, hex, sha1hex, utf8 } from './util.js';

const API = 'https://api.github.com';
const SHARDS = '0123456789abcdef';
const MAX_UP = 40;

export const state = { running: false, last: '', error: '', configured: false };
const listeners = new Set();
export const onState = (fn) => listeners.add(fn);
const emit = () => listeners.forEach(fn => { try { fn(state); } catch (e) {} });

class SyncError extends Error {}
class Conflict extends Error {}

export async function config() {
  const repo = await getMeta('repo', '');
  const token = await getMeta('token', '');
  if (!repo || !token) return null;
  let device = await getMeta('device', '');
  if (!device) { device = 'phone-' + hex(3); await setMeta('device', device); }
  return { repo, token, device, api: (await getMeta('apiBase', '')) || API };
}

async function gh(cfg, method, path, opts) {
  opts = opts || {};
  const headers = {
    Authorization: 'Bearer ' + cfg.token,
    Accept: opts.raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (opts.body) headers['Content-Type'] = 'application/json';
  let r;
  try {
    r = await fetchT(cfg.api + path, { method, headers, body: opts.body ? JSON.stringify(opts.body) : undefined, cache: 'no-store' }, 60000);
  } catch (e) {
    throw new SyncError('Không kết nối được GitHub (mất mạng?). Sẽ tự thử lại.');
  }
  const ok = opts.ok || [200, 201];
  if (ok.includes(r.status)) return r;
  if ((r.status === 409 || r.status === 422) && method === 'PUT') throw new Conflict();
  const text = await r.text().catch(() => '');
  if (r.status === 401) throw new SyncError('Mã truy cập GitHub sai hoặc đã hết hạn — quét lại mã cài đặt trên máy tính.');
  if (r.status === 403 || r.status === 429) {
    if (/rate limit/i.test(text)) throw new SyncError('GitHub đang giới hạn số lượt gọi — sẽ tự thử lại sau.');
    throw new SyncError('Mã truy cập chưa có quyền ghi vào kho ' + cfg.repo + ' (cần Contents: Read and write).');
  }
  if (r.status === 404) throw new SyncError('Không thấy kho ' + cfg.repo + ' — kiểm tra tên kho và mã truy cập.');
  throw new SyncError('GitHub báo lỗi ' + r.status + '.');
}

async function branchOf(cfg) {
  const key = 'branch:' + cfg.repo;
  let b = await getMeta(key, '');
  if (!b) {
    b = (await (await gh(cfg, 'GET', '/repos/' + cfg.repo)).json()).default_branch || 'main';
    await setMeta(key, b);
  }
  return b;
}

async function tree(cfg) {
  const info = await (await gh(cfg, 'GET', '/repos/' + cfg.repo)).json();
  const branch = info.default_branch || 'main';
  await setMeta('branch:' + cfg.repo, branch);
  const r = await gh(cfg, 'GET', '/repos/' + cfg.repo + '/git/trees/' + branch + '?recursive=1', { ok: [200, 404, 409] });
  const files = {};
  if (r.status === 200) for (const t of (await r.json()).tree || []) if (t.type === 'blob') files[t.path] = t.sha;
  return { branch, files };
}

async function getFile(cfg, path, branch) {
  const q = '/repos/' + cfg.repo + '/contents/' + path + '?ref=' + encodeURIComponent(branch);
  const info = await (await gh(cfg, 'GET', q)).json();
  if (info.encoding === 'base64' && info.content) return { sha: info.sha, bytes: b64ToBytes(info.content) };
  const raw = await gh(cfg, 'GET', q, { raw: true });
  return { sha: info.sha, bytes: new Uint8Array(await raw.arrayBuffer()) };
}

async function put(cfg, path, bytes, sha, branch, message) {
  const body = { message, content: bytesToB64(bytes), branch };
  if (sha) body.sha = sha;
  const r = await gh(cfg, 'PUT', '/repos/' + cfg.repo + '/contents/' + path, { body });
  return (await r.json()).content.sha;
}

/** Doc mot file trong kho (anh, giong doc) */
export async function getRaw(path) {
  const cfg = await config();
  if (!cfg) throw new SyncError('Chưa kết nối kho.');
  const branch = await branchOf(cfg);
  const r = await gh(cfg, 'GET', '/repos/' + cfg.repo + '/contents/' + path + '?ref=' + encodeURIComponent(branch), { raw: true });
  return new Uint8Array(await r.arrayBuffer());
}

/** Thu ket noi truoc khi luu */
export async function check(repo, token) {
  if (!/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/.test(repo || '')) throw new SyncError('Tên kho phải có dạng tên-tài-khoản/tên-kho.');
  const info = await (await gh({ repo, token, api: (await getMeta('apiBase', '')) || API }, 'GET', '/repos/' + repo)).json();
  return { private: !!info.private };
}

const hashRecs = (recs) => sha1hex(recs.map(canon).join('\n'));
const dumpShard = (recs) => utf8('{"cards":[\n' + recs.map(canon).join(',\n') + '\n]}\n');
function readShard(bytes) {
  try {
    const cards = JSON.parse(fromUtf8(bytes)).cards || [];
    return cards.filter(c => c && c.id).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  } catch (e) { return []; }
}

export async function syncNow() {
  if (state.running) return null;
  const cfg = await config();
  state.configured = !!cfg;
  if (!cfg) { emit(); return null; }
  if (!navigator.onLine) { state.error = 'Đang mất mạng — sẽ đồng bộ khi có mạng.'; emit(); return null; }
  state.running = true;
  emit();
  const st = await getMeta('syncState', { shards: {}, stats: {} });
  let pulled = 0, pushed = 0;
  try {
    const { branch, files } = await tree(cfg);

    // 1. Keo the may kia vua sua
    for (const [path, sha] of Object.entries(files)) {
      if (!/^cards\/[0-9a-f]\.json$/.test(path) || (st.shards[path] || {}).sha === sha) continue;
      const recs = readShard((await getFile(cfg, path, branch)).bytes);
      pulled += await applyRemote(recs);
      st.shards[path] = { sha, hash: await hashRecs(recs) };
    }

    // 2. Day the may nay vua sua
    let local = syncRecords();
    for (const shard of SHARDS) {
      const path = 'cards/' + shard + '.json';
      let recs = local[shard] || [];
      let h = await hashRecs(recs);
      const base = st.shards[path];
      if ((base && base.hash === h && files[path] === base.sha) || (!recs.length && !files[path])) continue;
      let done = false;
      for (let attempt = 0; attempt < 4 && !done; attempt++) {
        try {
          const sha = await put(cfg, path, dumpShard(recs), files[path], branch, 'Đồng bộ sổ từ từ iPhone');
          files[path] = sha;
          st.shards[path] = { sha, hash: h };
          pushed++;
          done = true;
        } catch (e) {
          if (!(e instanceof Conflict)) throw e;
          const got = await getFile(cfg, path, branch);          // may kia vua ghi: doc lai, gop
          const remote = readShard(got.bytes);
          pulled += await applyRemote(remote);
          files[path] = got.sha;
          local = syncRecords();
          recs = local[shard] || [];
          h = await hashRecs(recs);
          const rh = await hashRecs(remote);
          st.shards[path] = { sha: got.sha, hash: rh };
          if (h === rh) done = true;
        }
      }
      if (!done) throw new SyncError('Hai máy cùng ghi liên tục — sẽ thử lại sau.');
    }

    // 3. Gui anh vua them tren iPhone
    const queue = await getMeta('uploads', []);
    const live = new Set([...S.cards.values()].map(c => c.image && 'img/' + c.image).filter(Boolean));
    const left = [];
    let up = 0;
    for (const path of queue) {
      if (!live.has(path)) continue;                      // anh da bi thay / the da xoa
      if (files[path]) continue;
      if (up >= MAX_UP) { left.push(path); continue; }
      const row = await db.get('blobs', path);
      if (!row || !row.blob) continue;
      files[path] = await put(cfg, path, new Uint8Array(await row.blob.arrayBuffer()), null, branch, 'Ảnh minh hoạ');
      up++;
    }
    await setMeta('uploads', left);

    // 4. So tu on moi ngay
    await syncStats(cfg, st, files, branch);

    state.last = new Date().toISOString();
    state.error = '';
    st.last = state.last;
    return { pulled, pushed };
  } catch (e) {
    state.error = e.message || String(e);
    if (!(e instanceof SyncError)) console.error(e);
    return null;
  } finally {
    st.error = state.error;
    await setMeta('syncState', st);
    state.running = false;
    emit();
  }
}

async function syncStats(cfg, st, files, branch) {
  const own = 'stats/' + cfg.device + '.json';
  const days = Object.fromEntries(Object.entries(S.days).sort().slice(-400));
  const text = JSON.stringify({ days });
  const h = await sha1hex(text);
  if ((st.stats[own] || {}).hash !== h || !files[own]) {
    let sha;
    try { sha = await put(cfg, own, utf8(text), files[own], branch, 'Số từ ôn mỗi ngày'); }
    catch (e) {
      if (!(e instanceof Conflict)) throw e;
      sha = await put(cfg, own, utf8(text), (await getFile(cfg, own, branch)).sha, branch, 'Số từ ôn mỗi ngày');
    }
    st.stats[own] = { sha, hash: h };
    files[own] = sha;
  }
  let changed = false;
  for (const [path, sha] of Object.entries(files)) {
    if (!path.startsWith('stats/') || !path.endsWith('.json') || path === own || (st.stats[path] || {}).sha === sha) continue;
    try {
      const data = JSON.parse(fromUtf8((await getFile(cfg, path, branch)).bytes));
      S.daysRemote[path.slice(6, -5)] = { days: data.days || {} };
      changed = true;
    } catch (e) {}
    st.stats[path] = { sha };
  }
  if (changed) await setMeta('daysRemote', S.daysRemote);
}

/* ---------- tu dong bo ---------- */
let timer = null;
export function requestSync(delay) {
  clearTimeout(timer);
  timer = setTimeout(() => { syncNow(); }, delay == null ? 8000 : delay);
}

export async function startAutoSync() {
  const cfg = await config();
  state.configured = !!cfg;
  const st = await getMeta('syncState', null);
  if (st) { state.last = st.last || ''; state.error = st.error || ''; }
  emit();
  window.addEventListener('online', () => requestSync(1000));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') requestSync(1500); });
  setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 5 * 60000);
  requestSync(500);
}

/** Doi kho / nhap ma moi: quen nhung gi da dong bo voi kho cu */
export async function resetSyncState() {
  await setMeta('syncState', { shards: {}, stats: {} });
}
