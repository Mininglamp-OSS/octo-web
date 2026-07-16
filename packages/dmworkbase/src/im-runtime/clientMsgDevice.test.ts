import { describe, expect, it, vi } from "vitest";
import { syncClientMsgDeviceId } from "./clientMsgDevice";

describe("syncClientMsgDeviceId", () => {
  it("fetches the device record and writes clientMsgDeviceId", async () => {
    const fetchDevice = vi.fn().mockResolvedValue({ id: "srv-dev-1" });
    const setClientMsgDeviceId = vi.fn();

    await syncClientMsgDeviceId({
      deviceId: "device-1",
      fetchDevice,
      setClientMsgDeviceId,
    });

    expect(fetchDevice).toHaveBeenCalledWith("/user/devices/device-1");
    expect(setClientMsgDeviceId).toHaveBeenCalledWith("srv-dev-1");
  });

  it("does not write clientMsgDeviceId when the device record has no id", async () => {
    const fetchDevice = vi.fn().mockResolvedValue({});
    const setClientMsgDeviceId = vi.fn();

    await syncClientMsgDeviceId({
      deviceId: "device-1",
      fetchDevice,
      setClientMsgDeviceId,
    });

    expect(setClientMsgDeviceId).not.toHaveBeenCalled();
  });

  it("warns without throwing when the device record request fails", async () => {
    const fetchDevice = vi.fn().mockRejectedValue({ status: 500, code: "E500" });
    const setClientMsgDeviceId = vi.fn();
    const warn = vi.fn();

    await syncClientMsgDeviceId({
      deviceId: "device-1",
      fetchDevice,
      setClientMsgDeviceId,
      warn,
    });

    expect(setClientMsgDeviceId).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith("[startMain] fetch device record failed", {
      deviceId: "device-1",
      status: 500,
      code: "E500",
    });
  });

  it("marks missing device records in the warning message", async () => {
    const fetchDevice = vi.fn().mockRejectedValue({ status: 400 });
    const warn = vi.fn();

    await syncClientMsgDeviceId({
      deviceId: "device-1",
      fetchDevice,
      setClientMsgDeviceId: vi.fn(),
      warn,
    });

    expect(warn).toHaveBeenCalledWith(
      "[startMain] fetch device record failed (device not found)",
      { deviceId: "device-1", status: 400, code: undefined }
    );
  });
});
