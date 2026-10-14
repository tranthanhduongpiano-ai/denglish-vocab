/* Denglish Vocab (iPhone) - luu tru trong may (IndexedDB)
 *   cards : the tu vung (va dau xoa {id, deleted, modified})
 *   blobs : anh minh hoa, giong doc mau - {path: "img/..." | "audio/...", blob, uploaded}
 *   meta  : cai dat, trang thai dong bo, so tu on moi ngay - {k, v}
 */
const DB_NAME = 'denglish-vocab';
let dbp = null;

function open() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('cards')) d.createObjectStore('cards', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs', { keyPath: 'path' });
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'k' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}

async function run(store, mode, fn) {
  const d = await open();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const os = t.objectStore(store);
    let result;
    const r = fn(os);
    if (r && 'onsuccess' in r) r.onsuccess = () => { result = r.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const db = {
  all: (store) => run(store, 'readonly', os => os.getAll()),
  get: (store, key) => run(store, 'readonly', os => os.get(key)),
  put: (store, value) => run(store, 'readwrite', os => os.put(value)),
  putMany: (store, values) => run(store, 'readwrite', os => { values.forEach(v => os.put(v)); }),
  del: (store, key) => run(store, 'readwrite', os => os.delete(key)),
  clear: (store) => run(store, 'readwrite', os => os.clear()),
  keys: (store) => run(store, 'readonly', os => os.getAllKeys()),
};

export async function getMeta(k, fallback) {
  const row = await db.get('meta', k);
  return row ? row.v : fallback;
}
export const setMeta = (k, v) => db.put('meta', { k, v });

/** Xin trinh duyet dung tu xoa du lieu khi may day bo nho */
export function askPersist() {
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
}
