/**
 * localStorage access that never throws.
 *
 * Private mode, a full quota or a browser that blocks storage make the
 * Storage API throw, and so does reading `window.localStorage` itself. Each
 * function here turns that exception into a return value, so a game keeps
 * playing without its save. On the server there is no `window`, which reads
 * as unavailable storage too.
 *
 * Keys, the stored format, parsing and validation stay with each caller.
 */

/** A read that tells a missing key (`value: null`) from unusable storage. */
export type LocalStorageRead = { status: "ok"; value: string | null } | { status: "unavailable" };

export function readLocalStorage(key: string): LocalStorageRead {
  try {
    return { status: "ok", value: window.localStorage.getItem(key) };
  } catch {
    return { status: "unavailable" };
  }
}

/** The stored value, or null when the key is missing or storage is unusable. */
export function getLocalStorageItem(key: string): string | null {
  const read = readLocalStorage(key);
  return read.status === "ok" ? read.value : null;
}

/** Whether the value was stored. */
export function setLocalStorageItem(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** Whether the key is gone, including when it was never stored. */
export function removeLocalStorageItem(key: string): boolean {
  try {
    window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/** Every stored key, in storage order; none when storage is unusable. */
export function listLocalStorageKeys(): string[] {
  try {
    const storage = window.localStorage;
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key !== null) keys.push(key);
    }
    return keys;
  } catch {
    return [];
  }
}
