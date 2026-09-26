import type { Entry } from "./notus";
import { validCachedEntries } from "./directoryTree";
let database: Promise<IDBDatabase> | undefined;
function open() {
  return (database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("lotus-directories", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("directories");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Cache unavailable"));
  }).catch((error) => {
    database = undefined;
    throw error;
  }));
}
export async function cachedDirectory(
  root: string,
  path: string,
): Promise<Entry[] | undefined> {
  try {
    const db = await open();
    const value = await new Promise<unknown>((resolve, reject) => {
      const request = db
        .transaction("directories")
        .objectStore("directories")
        .get(JSON.stringify([root, path]));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return validCachedEntries(value) ? value : undefined;
  } catch {
    return undefined;
  }
}
export async function cacheDirectory(
  root: string,
  path: string,
  entries: Entry[],
) {
  try {
    const db = await open();
    const tx = db.transaction("directories", "readwrite");
    tx.objectStore("directories").put(
      entries.map((entry) => ({ ...entry, children: [] })),
      JSON.stringify([root, path]),
    );
    tx.onerror = () => {}; // Caching is optional, including quota failures.
  } catch {
    /* Private browsing and unavailable storage do not block startup. */
  }
}
