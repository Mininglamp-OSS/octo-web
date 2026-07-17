import type { RuntimeDevice } from "../api/types";

export interface Device {
  key: string;
  name: string;
  // Machine display override shared by the daemon's runtimes; null falls back to name.
  customName?: string | null;
  // Whether the current member owns runtimes on this machine (can_bind is
  // owner-only, server-computed) — gates the rename entry.
  ownedByMe: boolean;
  runtimes: RuntimeDevice[];
}

export function deviceName(r: RuntimeDevice): string {
  const info = r.device_info || "";
  const head = info.split("·")[0]?.trim();
  return head || r.name;
}

/** Group runtimes into machines. Keyed by daemon_id, falling back to hostname
 *  when a daemon reports none (legacy/headless). The label and the rename
 *  target are both derived from the SAME owned (can_bind) runtime so a
 *  shared-hostname fallback group (no daemon_id, mixed owners) can't show one
 *  machine's name over a pencil that renames a different owned machine.
 *  Non-owned groups fall back to any custom_name for display (no rename entry). */
export function groupRuntimesIntoDevices(runtimes: RuntimeDevice[]): Device[] {
  const map = new Map<string, Device>();
  for (const r of runtimes) {
    const key = r.daemon_id || deviceName(r);
    let d = map.get(key);
    if (!d) {
      d = { key, name: deviceName(r), customName: null, ownedByMe: false, runtimes: [] };
      map.set(key, d);
    }
    d.runtimes.push(r);
    if (r.can_bind === true) d.ownedByMe = true;
  }
  for (const d of map.values()) {
    const owned = d.runtimes.find((r) => r.can_bind === true);
    // Derive the ENTIRE displayed identity (name + custom name) from the owned
    // (can_bind) runtime — the same runtime the rename pencil targets — so the
    // header can never show one machine's label over a pencil that renames a
    // different one. This closes both the custom_name path and the base-name
    // fallback for a shared-hostname mixed-owner group. Non-owned groups (no
    // rename entry) keep the first row's name and any custom_name for display.
    if (owned) {
      d.name = deviceName(owned);
      d.customName = owned.custom_name || null;
    } else {
      d.customName = d.runtimes.find((r) => r.custom_name)?.custom_name || null;
    }
  }
  return Array.from(map.values());
}
