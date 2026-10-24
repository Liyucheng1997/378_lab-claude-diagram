import type { FsDirHandle } from './scan';

// 文件夹句柄存在 IndexedDB（可结构化克隆），刷新页面后可一键重新授权，无需再次选择文件夹。

const DB = 'cd-code';
const STORE = 'handles';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function saveHandle(name: string, handle: FsDirHandle) {
  try {
    await tx('readwrite', (s) => s.put(handle, name));
  } catch (e) {
    console.warn('保存文件夹句柄失败', e);
  }
}

export async function getHandle(name: string): Promise<FsDirHandle | undefined> {
  try {
    return await tx<FsDirHandle | undefined>('readonly', (s) => s.get(name));
  } catch {
    return undefined;
  }
}

// ---------- 本机路径记忆（按项目名），新建分析时自动带出 ----------

const ROOTS = 'cd.code.roots';

export function recallRoot(name: string): string {
  try {
    return (JSON.parse(localStorage.getItem(ROOTS) ?? '{}') as Record<string, string>)[name] ?? '';
  } catch {
    return '';
  }
}

export function rememberRoot(name: string, path: string) {
  try {
    const all = JSON.parse(localStorage.getItem(ROOTS) ?? '{}') as Record<string, string>;
    if (path) all[name] = path;
    else delete all[name];
    localStorage.setItem(ROOTS, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}
