import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SpaceSettings from "../index";
import type { Space } from "../../../Service/SpaceService";
import {
  SPACE_ROLE_ADMIN,
  SPACE_ROLE_MEMBER,
  SPACE_ROLE_OWNER,
} from "../../../Service/SpaceService";

// Pulled in transitively and resolves its own nested React copy, which breaks
// the suite's jsx-runtime alias. Stubbed for the same reason as in
// `Components/__tests__/lowCoverageComponents.test.tsx`.
vi.mock("react-virtuoso", () => ({
  TableVirtuoso: () => null,
  Virtuoso: () => null,
  VirtuosoGrid: () => null,
}));

// The voice button reaches for recorder/permission APIs jsdom does not provide,
// and none of the role gating below runs through it.
vi.mock("../../VoiceInputButton", () => ({
  __esModule: true,
  default: () => null,
  ReplaceMode: {},
  SelectionRange: {},
}));

// No assertion here writes, so the service only needs to exist. Leaving the
// real one in place would let a mis-gated control fire a network call.
vi.mock("../../../Service/SpaceService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../Service/SpaceService")>();
  return {
    ...actual,
    SpaceService: {
      shared: {
        updateSpace: vi.fn(),
        leaveSpace: vi.fn(),
        disbandSpace: vi.fn(),
        createInvite: vi.fn(),
      },
    },
  };
});

// The `t` stub may echo the key when no locale is loaded, so every matcher
// accepts both the translated copy and the raw key — the idiom used by the
// market suites.
const saveName = /保存修改|base\.spaceSettings\.saveChanges/;
const disbandName = /解散组织|base\.spaceSettings\.disbandAction/;
const leaveName = /离开组织|base\.spaceSettings\.leaveAction/;

function space(role: number): Space {
  return {
    space_id: "space-a",
    name: "Space A",
    description: "desc",
    role,
  } as Space;
}

function renderAs(role: number) {
  return render(
    <SpaceSettings
      space={space(role)}
      onClose={vi.fn()}
      onMembersClick={vi.fn()}
      onSpaceUpdated={vi.fn()}
    />
  );
}

/**
 * `updateSpace` on the server admits `member.Role >= 1`
 * (`octo-server/modules/space/api.go:426`), i.e. admin AND owner — and its doc
 * comment describes the endpoint as owner/admin self-service. Gating the name /
 * description / 保存修改 controls on owner alone contradicted that and removed an
 * action admins could perform before the Space review work.
 *
 * 解散组织 is the boundary that must NOT move: it is owner-only.
 */
describe("SpaceSettings role gating", () => {
  it("lets an admin edit the name, description and save", () => {
    const { container } = renderAs(SPACE_ROLE_ADMIN);

    expect(container.querySelector("input")).not.toBeDisabled();
    expect(container.querySelector("textarea")).not.toBeDisabled();
    expect(screen.getByRole("button", { name: saveName })).toBeInTheDocument();
  });

  it("still reserves 解散组织 for the owner", () => {
    renderAs(SPACE_ROLE_ADMIN);

    expect(screen.queryByRole("button", { name: disbandName })).not.toBeInTheDocument();
    // Sanity: the danger zone did render, so the absence above is the gate and
    // not a section that failed to mount.
    expect(screen.getByRole("button", { name: leaveName })).toBeInTheDocument();
  });

  it("gives the owner both editing and 解散组织", () => {
    const { container } = renderAs(SPACE_ROLE_OWNER);

    expect(container.querySelector("input")).not.toBeDisabled();
    expect(screen.getByRole("button", { name: saveName })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: disbandName })).toBeInTheDocument();
  });

  it("keeps a plain member read-only", () => {
    const { container } = renderAs(SPACE_ROLE_MEMBER);

    expect(container.querySelector("input")).toBeDisabled();
    expect(container.querySelector("textarea")).toBeDisabled();
    expect(screen.queryByRole("button", { name: saveName })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: disbandName })).not.toBeInTheDocument();
  });
});
