import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../APIClient", () => ({
    default: {
        shared: {
            get: vi.fn(),
            post: vi.fn(),
            put: vi.fn(),
            delete: vi.fn(),
        },
    },
}));

import APIClient from "../APIClient";
import { IncomingWebhookService } from "../IncomingWebhook";

const client = APIClient.shared as unknown as {
    get: ReturnType<typeof vi.fn>;
    post: ReturnType<typeof vi.fn>;
    put: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
};

beforeEach(() => vi.clearAllMocks());

describe("IncomingWebhookService", () => {
    it("keeps group and thread collection paths distinct", () => {
        expect(IncomingWebhookService.basePath("group 1")).toBe("groups/group%201/incoming-webhooks");
        expect(IncomingWebhookService.basePath("group 1", "thread/1")).toBe(
            "groups/group%201/threads/thread%2F1/incoming-webhooks"
        );
    });

    it("normalizes supported list envelopes", async () => {
        client.get.mockResolvedValueOnce({ list: [{ webhook_id: "a" }] });
        await expect(IncomingWebhookService.list("g1")).resolves.toEqual([{ webhook_id: "a" }]);

        client.get.mockResolvedValueOnce([{ webhook_id: "b" }]);
        await expect(IncomingWebhookService.list("g1", "t1")).resolves.toEqual([{ webhook_id: "b" }]);
        expect(client.get).toHaveBeenLastCalledWith("groups/g1/threads/t1/incoming-webhooks");
    });

    it("routes create, update, delete, regenerate and test through APIClient", async () => {
        const req = { name: "ci" };
        await IncomingWebhookService.create("g1", req, "t1");
        await IncomingWebhookService.update("g1", "wh/1", { status: 1 }, "t1");
        await IncomingWebhookService.delete("g1", "wh/1", "t1");
        await IncomingWebhookService.regenerate("g1", "wh/1", "t1");
        await IncomingWebhookService.test("g1", "wh/1", "t1");

        const base = "groups/g1/threads/t1/incoming-webhooks";
        expect(client.post).toHaveBeenCalledWith(base, req);
        expect(client.put).toHaveBeenCalledWith(`${base}/wh%2F1`, { status: 1 });
        expect(client.delete).toHaveBeenCalledWith(`${base}/wh%2F1`);
        expect(client.post).toHaveBeenCalledWith(`${base}/wh%2F1/regenerate`);
        expect(client.post).toHaveBeenCalledWith(`${base}/wh%2F1/test`);
    });
});
