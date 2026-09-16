import { describe, expect, it, vi } from "vitest";
import {
  parseAttachmentPreviewCancel,
  parseAttachmentPreviewClosed,
  parseAttachmentPreviewRequest,
  parseAttachmentPreviewResult,
  parseAttachmentPreviewState,
  parseMessageAttachmentLocator,
} from "@octo/base/src/features/filePreview/attachmentHost";

const locator = {
  kind: "message-attachment", channelId: "group", channelType: 2,
  messageId: "9223372036854775807", messageSeq: 42, attachmentIndex: 0,
};
const state = { type: "filePreviewState", requestId: "r_1", phase: "error", error: "Denied" };
const closed = { type: "filePreviewClosed", requestId: "r_1" };
const contracts = [
  { name: "locator", parse: parseMessageAttachmentLocator, value: locator },
  { name: "request", parse: parseAttachmentPreviewRequest, value: { version: 1, requestId: "r_1", locator } },
  { name: "cancel", parse: parseAttachmentPreviewCancel, value: { version: 1, requestId: "r_1" } },
  { name: "result", parse: parseAttachmentPreviewResult, value: { status: "accepted" } },
  { name: "state", parse: parseAttachmentPreviewState, value: state },
  { name: "closed", parse: parseAttachmentPreviewClosed, value: closed },
];

describe("authoritative attachment contract records", () => {
  it.each(contracts)("$name requires own data fields on a plain record", ({ parse, value }) => {
    expect(() => parse(Object.create(value))).toThrow();
    expect(() => parse(Object.assign(Object.create({ extra: true }), value))).toThrow();
    expect(parse(Object.assign(Object.create(null), value))).toEqual(parse(value));
    for (const key of Object.keys(value).filter((key) => key !== "error")) {
      const missing = { ...value };
      Reflect.deleteProperty(missing, key);
      expect(() => parse(missing), `missing ${key}`).toThrow();
    }
  });

  it.each(contracts)("$name rejects extra keys and getters without executing them", ({ parse, value }) => {
    expect(() => parse({ ...value, extra: true })).toThrow();
    expect(() => parse({ ...value, [Symbol("extra")]: true })).toThrow();
    const getter = vi.fn(() => "untrusted");
    const accessor = Object.defineProperty({ ...value }, Object.keys(value)[0], { get: getter });
    expect(() => parse(accessor)).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });
});

describe("inbound attachment lifecycle commands", () => {
  it.each(["loading", "ready", "error"])("accepts and canonicalizes %s state", (phase) => {
    expect(parseAttachmentPreviewState({ ...state, phase })).toEqual({
      requestId: "r_1", phase, error: "Denied",
    });
    expect(parseAttachmentPreviewState({ type: state.type, requestId: "r_1", phase })).toEqual({
      requestId: "r_1", phase,
    });
  });

  it.each([
    { phase: "closed" }, { phase: {} }, { phase: undefined },
    { error: { evil: "object" } }, { error: 42 }, { error: null },
    { error: "x".repeat(1001) }, { error: "bad\nerror" }, { error: " denied " },
    { requestId: "" }, { requestId: "x".repeat(129) }, { requestId: "../other" },
    { requestId: 42 }, { type: "other" }, { url: "https://untrusted.invalid" },
  ])("rejects malformed state %j", (patch) => {
    expect(() => parseAttachmentPreviewState({ ...state, ...patch })).toThrow();
  });

  it.each([
    { requestId: "" }, { requestId: "x".repeat(129) }, { requestId: "bad id" },
    { requestId: {} }, { type: "filePreviewState" }, { phase: "ready" },
  ])("rejects malformed close %j", (patch) => {
    expect(() => parseAttachmentPreviewClosed({ ...closed, ...patch })).toThrow();
  });

  it("accepts the close envelope and copies state without retaining a mutable command", () => {
    expect(parseAttachmentPreviewClosed(closed)).toEqual({ requestId: "r_1" });
    const command = { ...state };
    const result = parseAttachmentPreviewState(command);
    command.error = "Changed";
    expect(result.error).toBe("Denied");
    expect(parseAttachmentPreviewState({ ...state, error: "x".repeat(1000) }).error).toHaveLength(1000);
  });
});
