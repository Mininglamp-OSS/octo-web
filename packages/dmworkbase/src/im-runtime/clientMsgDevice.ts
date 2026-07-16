export interface ClientMsgDeviceRecord {
  id?: string;
}

export interface SyncClientMsgDeviceIdDeps {
  deviceId: string;
  fetchDevice: (path: string) => Promise<ClientMsgDeviceRecord>;
  setClientMsgDeviceId: (id: string) => void;
  warn?: (message: string, context: unknown) => void;
}

export function syncClientMsgDeviceId(deps: SyncClientMsgDeviceIdDeps) {
  return deps
    .fetchDevice(`/user/devices/${deps.deviceId}`)
    .then((res) => {
      if (res.id) {
        deps.setClientMsgDeviceId(res.id);
      }
    })
    .catch((err) => {
      const notFound = err?.status === 400;
      const warn = deps.warn ?? console.warn;
      warn(
        `[startMain] fetch device record failed${notFound ? " (device not found)" : ""}`,
        { deviceId: deps.deviceId, status: err?.status, code: err?.code }
      );
    });
}
