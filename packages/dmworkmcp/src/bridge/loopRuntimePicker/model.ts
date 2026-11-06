import { t } from "@octo/base";
import type { LoopRuntime } from "../../api/expertService";
import type { RuntimeGroup } from "../../ui/LoopRuntimePicker/types";

const text = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

/** owner=me is the primary filter; an explicit negative ownership flag fails closed.
 * Missing status/canBind remains compatible with older Fleet responses. */
export function isRuntimeReady(rt: LoopRuntime): boolean {
  if (
    rt.canBind === false ||
    rt.metadata?.runtime_profile_registration_error === true
  )
    return false;
  return (
    !rt.status ||
    ["online", "ready", "running", "active"].includes(
      text(rt.status).toLowerCase()
    )
  );
}

/** All-scope rows need explicit health and a positive ownership/sharing basis. */
export function canInstallRuntime(
  rt: LoopRuntime,
  ownedIds: ReadonlySet<string>
): boolean {
  if (ownedIds.has(rt.id) && rt.canBind !== false) return isRuntimeReady(rt);
  return (
    rt.visibility === "workspace" &&
    !!rt.status &&
    isRuntimeReady({ ...rt, canBind: true })
  );
}

function runtimeName(rt: LoopRuntime): string {
  const provider = text(rt.provider);
  const name = text(rt.name);
  if (!text(rt.profileId))
    return provider
      ? provider.charAt(0).toUpperCase() + provider.slice(1)
      : name;
  const host = text(rt.deviceInfo).split("·")[0].trim();
  const suffix = host ? ` (${host})` : "";
  return (
    (rt.metadata?.runtime_profile_registration_error !== true &&
    suffix &&
    name.endsWith(suffix)
      ? name.slice(0, -suffix.length).trim()
      : name) || provider
  );
}

/** Expand colliding short IDs until they are distinguishable. Never identify by hostname. */
function shortId(id: string, peers: string[]): string {
  let length = Math.min(8, id.length);
  while (
    length < id.length &&
    peers.some(
      (other) => other !== id && other.slice(-length) === id.slice(-length)
    )
  )
    length++;
  return id.slice(-length);
}

export function buildRuntimeGroups(
  runtimes: LoopRuntime[],
  options?: { ownedIds: ReadonlySet<string>; scope: "mine" | "all" }
): RuntimeGroup[] {
  const ownedIds =
    options?.ownedIds ??
    new Set(runtimes.filter((r) => r.canBind !== false).map((r) => r.id));
  const scope = options?.scope ?? "mine";
  const machines = new Map<string, LoopRuntime[]>();
  for (const rt of runtimes.filter(
    (r) => scope === "all" || (ownedIds.has(r.id) && r.canBind !== false)
  )) {
    const key = JSON.stringify([text(rt.ownerId), text(rt.daemonId) || rt.id]);
    machines.set(key, [...(machines.get(key) ?? []), rt]);
  }
  const identities = [...machines.values()].map(
    (rows) => text(rows[0].daemonId) || rows[0].id
  );
  return [...machines]
    .map(([key, rows]) => {
      const rt = rows[0];
      const machine =
        rows.map((r) => text(r.customName)).find(Boolean) ||
        text(rt.deviceInfo).split("·")[0].trim() ||
        t("mcp.runtimePicker.unknownMachine");
      const id = text(rt.daemonId) || rt.id;
      const names = rows.map(runtimeName);
      return {
        key,
        label: `${machine} · ${shortId(id, identities)}`,
        items: rows.map((runtime, index) => {
          const name = names[index];
          const duplicate = names.filter((n) => n === name).length > 1;
          const failed =
            runtime.metadata?.runtime_profile_registration_error === true;
          const owned = ownedIds.has(runtime.id) && runtime.canBind !== false;
          const available =
            (owned || !!runtime.status) &&
            isRuntimeReady({ ...runtime, canBind: true });
          const selectable = canInstallRuntime(runtime, ownedIds);
          const version =
            text(runtime.metadata?.version) ||
            text(runtime.deviceInfo)
              .split("·")
              .slice(1)
              .map((s) => s.trim())
              .filter(Boolean)
              .join(" · ") ||
            text(runtime.launchHeader);
          return {
            id: runtime.id,
            name: duplicate
              ? `${name} · ${shortId(
                  runtime.id,
                  rows.map((r) => r.id)
                )}`
              : name,
            provider: text(runtime.provider),
            version,
            available,
            selectable,
            owned,
            reason: available
              ? selectable
                ? ""
                : t(
                    runtime.visibility === "private"
                      ? "mcp.runtimePicker.notOwned"
                      : "mcp.runtimePicker.permissionUnknown"
                  )
              : failed
              ? text(runtime.metadata?.runtime_profile_failure_reason) ||
                t("mcp.runtimePicker.registrationFailed")
              : text(runtime.status) === "offline"
              ? t("mcp.runtimePicker.offline")
              : text(runtime.status) ||
                t("mcp.runtimePicker.unavailableStatus"),
            visibility: ["private", "workspace"].includes(
              text(runtime.visibility)
            )
              ? runtime.visibility
              : undefined,
            cloud: runtime.runtimeMode === "cloud",
          };
        }),
      };
    })
    .sort(
      (a, b) =>
        Number(b.items.some((r) => r.available)) -
        Number(a.items.some((r) => r.available))
    );
}
