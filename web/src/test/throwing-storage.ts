import { vi } from "vitest";

/**
 * Makes every localStorage read, write, removal and key lookup throw, as in
 * private mode, with a full quota or with storage blocked by the browser.
 * `clear` keeps working so test cleanup still runs. Undo it with
 * `vi.restoreAllMocks()`.
 */
export function throwOnLocalStorage(): void {
  const blocked = () => {
    throw new DOMException("The operation is insecure.", "SecurityError");
  };
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(blocked);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(blocked);
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(blocked);
  vi.spyOn(Storage.prototype, "key").mockImplementation(blocked);
}
