import { describe, expect, it } from "vitest";

import type { RuntimeDevice } from "../../api/types";
import { deviceVersion, runtimeVersion } from "../runtimeVersion";

// Minimal RuntimeDevice factory — only the fields the version helpers read.
function rt(over: Partial<RuntimeDevice>): RuntimeDevice {
  return {
    id: "r1",
    workspace_id: "w1",
    name: "n",
    runtime_mode: "builtin",
    provider: "claude",
    status: "online",
    device_info: "",
    visibility: "workspace",
    last_seen_at: null,
    created_at: "",
    updated_at: "",
    ...over,
  } as RuntimeDevice;
}

describe("deviceVersion (machine/daemon-level)", () => {
  it("returns the daemon cli_version, NOT any agent runtime's own version", () => {
    const runtimes = [
      rt({ provider: "hermes", metadata: { version: "Hermes Agent v0.16.0", cli_version: "v0.3.31-3895-g3532fa88" } }),
      rt({ provider: "claude", metadata: { version: "2.1.207 (Claude Code)", cli_version: "v0.3.31-3895-g3532fa88" } }),
    ];
    // The bug was returning the first runtime's agent version ("Hermes Agent ...").
    expect(deviceVersion(runtimes)).toBe("v0.3.31-3895-g3532fa88");
  });

  it("falls back to '-' when no runtime reports a daemon cli_version", () => {
    expect(deviceVersion([rt({ metadata: { version: "2.1.207 (Claude Code)" } })])).toBe("-");
    expect(deviceVersion([])).toBe("-");
  });
});

describe("runtimeVersion (per-agent)", () => {
  it("returns the agent's own CLI version from metadata.version", () => {
    expect(runtimeVersion(rt({ metadata: { version: "2.1.207 (Claude Code)" } }))).toBe("2.1.207 (Claude Code)");
  });

  it("derives from device_info when metadata.version is absent", () => {
    expect(runtimeVersion(rt({ device_info: "casterdeMacBook-Pro.local · codex-cli 0.142.5" }))).toBe("codex-cli 0.142.5");
  });

  it("returns '-' when nothing is available", () => {
    expect(runtimeVersion(rt({}))).toBe("-");
  });
});
