import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { throwOnLocalStorage } from "../test/throwing-storage";
import {
  getLocalStorageItem,
  listLocalStorageKeys,
  readLocalStorage,
  removeLocalStorageItem,
  setLocalStorageItem,
} from "./local-storage";

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("local storage access", () => {
  it("reads, writes, lists and removes like the Storage API", () => {
    expect(readLocalStorage("kpop-test")).toEqual({ status: "ok", value: null });
    expect(getLocalStorageItem("kpop-test")).toBeNull();
    expect(setLocalStorageItem("kpop-test", "1")).toBe(true);
    expect(localStorage.getItem("kpop-test")).toBe("1");
    expect(readLocalStorage("kpop-test")).toEqual({ status: "ok", value: "1" });
    expect(getLocalStorageItem("kpop-test")).toBe("1");
    expect(listLocalStorageKeys()).toEqual(["kpop-test"]);
    expect(removeLocalStorageItem("kpop-test")).toBe(true);
    expect(localStorage.getItem("kpop-test")).toBeNull();
    expect(removeLocalStorageItem("kpop-test")).toBe(true);
  });

  it("keeps an empty string apart from a missing key", () => {
    setLocalStorageItem("kpop-test", "");
    expect(readLocalStorage("kpop-test")).toEqual({ status: "ok", value: "" });
    expect(getLocalStorageItem("kpop-test")).toBe("");
  });

  it("turns a throwing read, write, removal and key lookup into a return value", () => {
    localStorage.setItem("kpop-test", "1");
    throwOnLocalStorage();
    expect(readLocalStorage("kpop-test")).toEqual({ status: "unavailable" });
    expect(getLocalStorageItem("kpop-test")).toBeNull();
    expect(setLocalStorageItem("kpop-test", "2")).toBe(false);
    expect(removeLocalStorageItem("kpop-test")).toBe(false);
    expect(listLocalStorageKeys()).toEqual([]);
    vi.restoreAllMocks();
    expect(localStorage.getItem("kpop-test")).toBe("1");
  });

  it("treats a quota error on write as a failed write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    expect(setLocalStorageItem("kpop-test", "1")).toBe(false);
    expect(getLocalStorageItem("kpop-test")).toBeNull();
  });

  it("treats a blocked localStorage property as unavailable storage", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    });
    expect(readLocalStorage("kpop-test")).toEqual({ status: "unavailable" });
    expect(setLocalStorageItem("kpop-test", "1")).toBe(false);
    expect(removeLocalStorageItem("kpop-test")).toBe(false);
    expect(listLocalStorageKeys()).toEqual([]);
  });

  it("reads as unavailable storage on the server, where there is no window", () => {
    vi.stubGlobal("window", undefined);
    expect(readLocalStorage("kpop-test")).toEqual({ status: "unavailable" });
    expect(getLocalStorageItem("kpop-test")).toBeNull();
    expect(setLocalStorageItem("kpop-test", "1")).toBe(false);
    expect(removeLocalStorageItem("kpop-test")).toBe(false);
    expect(listLocalStorageKeys()).toEqual([]);
  });
});
