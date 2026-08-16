import { describe, expect, it, beforeEach } from "vitest";
import StorageService from "./StorageService";

describe("StorageService desktop session fields", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it("mirrors device_flag so a fresh desktop session keeps the device slot", () => {
    StorageService.shared.setItem("device_flag", "2");

    sessionStorage.clear();

    expect(StorageService.shared.getItem("device_flag")).toBe("2");
  });

  it("removes the mirrored device flag with the session", () => {
    StorageService.shared.setItem("device_flag", "2");

    StorageService.shared.removeItem("device_flag");

    expect(localStorage.getItem("device_flag")).toBeNull();
  });

  it("keeps lifecycle bookkeeping out of sessionStorage", () => {
    StorageService.shared.setPersistentItem("migration:sid-1", "1");
    sessionStorage.clear();

    expect(StorageService.shared.getPersistentItem("migration:sid-1")).toBe("1");
    expect(sessionStorage.getItem("migration:sid-1")).toBeNull();

    StorageService.shared.removePersistentItem("migration:sid-1");
    expect(StorageService.shared.getPersistentItem("migration:sid-1")).toBeNull();
  });
});
