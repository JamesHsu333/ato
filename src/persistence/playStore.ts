/**
 * Local-first play library in IndexedDB (spec §47). No backend: plays live in the
 * user's browser. Stored as YAML, the human authoring format.
 */
export interface SavedPlay {
  id: string;
  name: string;
  yaml: string;
  updatedAt: number;
}

const DB_NAME = 'ato';
const STORE = 'plays';

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const req = run(d.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export async function listPlays(): Promise<SavedPlay[]> {
  try {
    const all = await tx<SavedPlay[]>('readonly', (s) => s.getAll() as IDBRequest<SavedPlay[]>);
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return []; // private mode / storage disabled: the editor still works, just without a library
  }
}

export async function savePlay(p: Omit<SavedPlay, 'updatedAt'>): Promise<SavedPlay> {
  const rec = { ...p, updatedAt: Date.now() };
  await tx('readwrite', (s) => s.put(rec));
  return rec;
}

export async function deletePlay(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id));
}
