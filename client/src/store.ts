import { deserializeAccount, serializeAccount, type AccountData, type SaveStore } from '../../shared/src';

const DB = 'endless-garden';
const STORE = 'kv';
const KEY = 'account';
const LS_KEY = 'endless-garden.account';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('no idb')); return; }
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet(db: IDBDatabase): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const r = tx.objectStore(STORE).get(KEY);
    r.onsuccess = () => resolve(r.result as string | undefined);
    r.onerror = () => reject(r.error);
  });
}

function idbPut(db: IDBDatabase, value: string | null): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    if (value === null) tx.objectStore(STORE).delete(KEY);
    else tx.objectStore(STORE).put(value, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * ブラウザの保存先。IndexedDB を使い、使えないときは localStorage。
 * サーバーに移すときはこのクラスを差し替える（SaveStore を実装すればよい）。
 */
export class BrowserSaveStore implements SaveStore {
  private db: Promise<IDBDatabase | null>;
  constructor() {
    this.db = openDb().catch(() => null);
  }

  async load(): Promise<AccountData | null> {
    let text: string | undefined | null = null;
    const db = await this.db;
    if (db) { try { text = await idbGet(db); } catch { text = null; } }
    if (!text) { try { text = localStorage.getItem(LS_KEY); } catch { text = null; } }
    if (!text) return null;
    return deserializeAccount(text);
  }

  async save(acc: AccountData): Promise<void> {
    const text = serializeAccount(acc);
    const db = await this.db;
    let ok = false;
    if (db) { try { await idbPut(db, text); ok = true; } catch { ok = false; } }
    if (!ok) { try { localStorage.setItem(LS_KEY, text); } catch { /* 保存できない環境 */ } }
  }

  async clear(): Promise<void> {
    const db = await this.db;
    if (db) { try { await idbPut(db, null); } catch { /* noop */ } }
    try { localStorage.removeItem(LS_KEY); } catch { /* noop */ }
  }
}
