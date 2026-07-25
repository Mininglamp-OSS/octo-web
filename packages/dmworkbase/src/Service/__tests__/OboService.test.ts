import { beforeEach, describe, expect, it, vi } from "vitest";

import APIClient from "../APIClient";
import {
  createOboGrant,
  createOboScope,
  deleteOboGrant,
  deleteOboScope,
  listOboGrants,
  listOboGrantScopes,
  updateOboGrant,
} from "../OboService";

vi.mock("../APIClient", () => ({
  default: {
    shared: {
      delete: vi.fn(() => Promise.resolve()),
      get: vi.fn(() => Promise.resolve([])),
      post: vi.fn(() => Promise.resolve()),
      put: vi.fn(() => Promise.resolve()),
    },
  },
}));

const apiDelete = APIClient.shared.delete as unknown as ReturnType<typeof vi.fn>;
const apiGet = APIClient.shared.get as unknown as ReturnType<typeof vi.fn>;
const apiPost = APIClient.shared.post as unknown as ReturnType<typeof vi.fn>;
const apiPut = APIClient.shared.put as unknown as ReturnType<typeof vi.fn>;

describe("OboService", () => {
  beforeEach(() => {
    apiDelete.mockClear();
    apiGet.mockClear();
    apiPost.mockClear();
    apiPut.mockClear();
    apiDelete.mockResolvedValue(undefined);
    apiGet.mockResolvedValue([]);
    apiPost.mockResolvedValue(undefined);
    apiPut.mockResolvedValue(undefined);
  });

  it("lists OBO grants from array responses", async () => {
    apiGet.mockResolvedValue([{ id: 1, active: true }]);

    const grants = await listOboGrants();

    expect(apiGet).toHaveBeenCalledWith("obo/grants");
    expect(grants).toEqual([{ id: 1, active: true }]);
  });

  it("lists OBO grant scopes from items responses", async () => {
    apiGet.mockResolvedValue({ items: [{ id: 7, grant_id: 1 }] });

    const scopes = await listOboGrantScopes(1);

    expect(apiGet).toHaveBeenCalledWith("obo/grants/1/scopes");
    expect(scopes).toEqual([{ id: 7, grant_id: 1 }]);
  });

  it("creates and deletes OBO scopes", async () => {
    const request = {
      grant_id: 1,
      channel_id: "ch-1",
      channel_type: 2,
      enabled: false,
    };

    await createOboScope(request);
    await deleteOboScope(7);

    expect(apiPost).toHaveBeenCalledWith("obo/scopes", request);
    expect(apiDelete).toHaveBeenCalledWith("obo/scopes/7");
  });

  it("creates, updates, and deletes OBO grants", async () => {
    const request = {
      grantee_bot_uid: "bot-1",
      mode: "auto" as const,
      global_enabled: false,
      persona_prompt: "friendly",
    };

    await createOboGrant(request);
    await updateOboGrant(3, { active: true });
    await deleteOboGrant(3);

    expect(apiPost).toHaveBeenCalledWith("obo/grants", request);
    expect(apiPut).toHaveBeenCalledWith("obo/grants/3", { active: true });
    expect(apiDelete).toHaveBeenCalledWith("obo/grants/3");
  });
});
