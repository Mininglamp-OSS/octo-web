import React from "react";
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const service = vi.hoisted(() => ({
  getAllMembers: vi.fn(),
}));

vi.mock("../../../Service/SpaceService", () => ({
  SpaceService: { shared: { getAllMembers: service.getAllMembers } },
}));

import type { SpaceMember } from "../../../Service/SpaceService";
import useSpaceMembers from "../useSpaceMembers";
import type { UseSpaceMembersOptions, UseSpaceMembersResult } from "../types";

function member(
  uid: string,
  overrides: Partial<SpaceMember> = {}
): SpaceMember {
  return {
    uid,
    name: uid,
    avatar: "",
    role: 3,
    robot: 0,
    created_at: "",
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("useSpaceMembers", () => {
  let latest: UseSpaceMembersResult | undefined;

  function Probe({ options }: { options: UseSpaceMembersOptions }) {
    latest = useSpaceMembers(options);
    return null;
  }

  beforeEach(() => {
    latest = undefined;
    service.getAllMembers.mockReset();
  });

  it("loads unique human member options by default", async () => {
    service.getAllMembers.mockResolvedValue([
      member("u1", { name: "Alice", avatar: "alice.png" }),
      member("u1", { name: "Duplicate" }),
      member("bot1", { robot: 1 }),
      member(""),
    ]);

    render(<Probe options={{ spaceId: "space-1" }} />);
    await act(flushMicrotasks);

    expect(service.getAllMembers).toHaveBeenCalledWith("space-1");
    expect(latest).toMatchObject({
      isLoading: false,
      error: null,
      members: [{ uid: "u1", name: "Alice", avatar: "alice.png" }],
    });
  });

  it("can include bots without loading the space again", async () => {
    service.getAllMembers.mockResolvedValue([
      member("u1"),
      member("bot1", { robot: 1 }),
    ]);

    const view = render(<Probe options={{ spaceId: "space-1" }} />);
    await act(flushMicrotasks);
    view.rerender(
      <Probe options={{ spaceId: "space-1", includeBots: true }} />
    );

    expect(service.getAllMembers).toHaveBeenCalledTimes(1);
    expect(latest?.members.map((option) => option.uid)).toEqual(["u1", "bot1"]);
  });

  it("ignores a stale request after the space changes", async () => {
    const first = deferred<SpaceMember[]>();
    const second = deferred<SpaceMember[]>();
    service.getAllMembers.mockImplementation((spaceId: string) =>
      spaceId === "space-1" ? first.promise : second.promise
    );

    const view = render(<Probe options={{ spaceId: "space-1" }} />);
    view.rerender(<Probe options={{ spaceId: "space-2" }} />);

    await act(async () => {
      second.resolve([member("u2")]);
      await flushMicrotasks();
    });
    await act(async () => {
      first.resolve([member("u1")]);
      await flushMicrotasks();
    });

    expect(latest?.members.map((option) => option.uid)).toEqual(["u2"]);
  });

  it("exposes failures and can reload", async () => {
    const failure = new Error("load failed");
    service.getAllMembers
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce([member("u1")]);

    render(<Probe options={{ spaceId: "space-1" }} />);
    await act(flushMicrotasks);
    expect(latest?.error).toBe(failure);

    await act(async () => {
      latest?.reload();
      await flushMicrotasks();
    });

    expect(service.getAllMembers).toHaveBeenCalledTimes(2);
    expect(latest).toMatchObject({
      members: [{ uid: "u1", name: "u1", avatar: undefined }],
      isLoading: false,
      error: null,
    });
  });
});
