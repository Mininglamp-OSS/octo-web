/**
 * Regression test for octo-web#273 — silent fail when forwarding (合并转发)
 * a just-sent media message before the upload URL has been ack'd by the server.
 *
 * Root cause (proposed):
 *   `MergeforwardContent.messageToMap` falls back to `content.encodeJSON()`
 *   when `message.content.contentObj` is undefined (the case for locally-
 *   created messages that never went through SDK.decode()). For a
 *   `MessageImage` whose `url`/`remoteUrl` is still empty (upload in flight),
 *   `MessageImage.encodeJSON()` in wukongimjssdk@1.3.5 returns
 *   `{ width, height, url: "" }` — i.e. it does NOT throw, it silently emits
 *   an empty url. The mergeforward wire payload then nests this empty-url
 *   image; the wukongim broker accepts it (JSON is valid), routes it to the
 *   target channel, and the target client renders `<img src="">` — invisible
 *   to the user. No error is surfaced anywhere on the path.
 *
 * White-box approach:
 *   We inline `messageToMap` (10 lines, from packages/dmworkbase/src/Messages/
 *   Mergeforward/index.tsx:200-217) and the relevant `MessageImage.encodeJSON`
 *   shape (from wukongimjssdk@1.3.5 lib/wukongimjssdk.esm.js:2091-2097) so
 *   the test has zero UI/SDK module imports. If either implementation
 *   diverges from the snapshot below, this test rots — that is intentional:
 *   the failure mode IS the rot.
 *
 * Run:  cd packages/dmworkbase && ./node_modules/.bin/vitest run MergeforwardContent.imageEncode
 */

import { describe, it, expect } from "vitest";

// ── Snapshot: MergeforwardContent.messageToMap (current main, 2026-06-09) ──
// Source: packages/dmworkbase/src/Messages/Mergeforward/index.tsx:200-217
function messageToMap(message: any): any {
  let payload = message.content.contentObj;
  if (!payload) {
    payload = {
      ...message.content.encodeJSON(),
      type: message.content.contentType,
    };
  } else if (payload.type === undefined) {
    payload = { ...payload, type: message.content.contentType };
  }
  return {
    message_id: message.messageID,
    from_uid: message.fromUID ?? "",
    timestamp: message.timestamp,
    payload: payload,
  };
}

// ── Snapshot: wukongimjssdk@1.3.5 MessageImage.encodeJSON shape ──
// Source: wukongimjssdk/lib/wukongimjssdk.esm.js:2091-2097
// NOTE: returns url:"" silently when both remoteUrl and url are empty
class FakeMessageImageNoUrl {
  contentObj: any = undefined; // ← critical: triggers messageToMap fallback
  contentType = 2; // MessageContentType.image
  width = 0;
  height = 0;
  url: string | undefined = undefined;
  remoteUrl: string | undefined = undefined;
  encodeJSON() {
    let ul = this.remoteUrl;
    if (!ul || ul.length === 0) {
      ul = this.url;
    }
    return {
      width: this.width || 0,
      height: this.height || 0,
      url: ul || "",
    };
  }
}

describe("MergeforwardContent — issue #273 (silent forward fail for in-flight images)", () => {
  it("[BUG] emits empty `url` when forwarding a not-yet-acked image (root cause)", () => {
    // Simulate: user just sent an image; upload still in flight; user immediately
    // selects the bubble + a text message and triggers 合并转发.
    const image = new FakeMessageImageNoUrl();
    const innerMsg = {
      messageID: "msg_image_in_flight",
      timestamp: 1717900000,
      fromUID: "u_alpha",
      content: image,
    };

    const inner = messageToMap(innerMsg);

    // The smoking gun: empty url silently emitted.
    expect(inner.payload.type).toBe(2); // image
    expect(inner.payload.url).toBe("");
    expect(inner.payload.width).toBe(0);
    expect(inner.payload.height).toBe(0);

    // No exception, no warning, no marker that this message is broken.
    // The wukongim broker accepts JSON-valid payloads → routes to target →
    // target client renders <img src=""> → user sees nothing → silent fail.
  });

  it("[CONTROL] emits real url when image upload already ack'd", () => {
    const image = new FakeMessageImageNoUrl();
    image.width = 800;
    image.height = 600;
    image.url = "https://cdn.example.com/img/abc.jpg";
    image.remoteUrl = "https://cdn.example.com/img/abc.jpg";

    const innerMsg = {
      messageID: "msg_image_acked",
      timestamp: 1717900100,
      fromUID: "u_alpha",
      content: image,
    };

    const inner = messageToMap(innerMsg);

    expect(inner.payload.url).toBe("https://cdn.example.com/img/abc.jpg");
    expect(inner.payload.width).toBe(800);
    expect(inner.payload.height).toBe(600);
  });

  it("[CONTROL] message-from-server path uses contentObj directly (no fallback)", () => {
    // When a message arrives via SDK.decode(), contentObj is populated from the
    // server's wire payload and messageToMap uses it directly — no fallback,
    // no risk of stale/empty fields.
    const image = new FakeMessageImageNoUrl();
    image.contentObj = {
      type: 2,
      width: 1024,
      height: 768,
      url: "https://cdn.example.com/img/from-server.jpg",
    };
    // Note: image.url/remoteUrl deliberately left empty to prove contentObj
    // wins over encodeJSON() when present.

    const innerMsg = {
      messageID: "msg_from_server",
      timestamp: 1717900200,
      fromUID: "u_alpha",
      content: image,
    };

    const inner = messageToMap(innerMsg);

    expect(inner.payload.url).toBe(
      "https://cdn.example.com/img/from-server.jpg"
    );
    expect(inner.payload.width).toBe(1024);
  });
});

// ── Snapshot: fix-direction messageToMap (post-fix behaviour) ──
// Returns null for media content with empty url; encodeJSON filters nulls.
function messageToMapAfterFix(message: any): any | null {
  let payload = message.content.contentObj;
  if (!payload) {
    payload = {
      ...message.content.encodeJSON(),
      type: message.content.contentType,
    };
  } else if (payload.type === undefined) {
    payload = { ...payload, type: message.content.contentType };
  }

  // Defense: skip media payloads with empty url (in-flight uploads).
  const MEDIA_TYPES = new Set([2, 4, 5]); // image, voice, smallVideo
  const FILE_TYPE = 8;
  if (
    (MEDIA_TYPES.has(payload.type) || payload.type === FILE_TYPE) &&
    (!payload.url || payload.url === "")
  ) {
    return null;
  }

  return {
    message_id: message.messageID,
    from_uid: message.fromUID ?? "",
    timestamp: message.timestamp,
    payload: payload,
  };
}

describe("MergeforwardContent — #273 after fix", () => {
  it("[FIX] messageToMap returns null for image with empty url", () => {
    const image = new FakeMessageImageNoUrl();
    const result = messageToMapAfterFix({
      messageID: "m1",
      timestamp: 1,
      fromUID: "u",
      content: image,
    });
    expect(result).toBeNull();
  });

  it("[FIX] messageToMap returns normal map for image with real url", () => {
    const image = new FakeMessageImageNoUrl();
    image.url = "https://cdn.example.com/x.jpg";
    image.remoteUrl = image.url;
    const result = messageToMapAfterFix({
      messageID: "m2",
      timestamp: 1,
      fromUID: "u",
      content: image,
    });
    expect(result).not.toBeNull();
    expect(result.payload.url).toBe("https://cdn.example.com/x.jpg");
  });

  it("[FIX] messageToMap returns map for text (non-media) even with empty content", () => {
    // Text content has no concept of "url" — must not be filtered.
    const textContent = {
      contentObj: undefined,
      contentType: 1, // text
      encodeJSON: () => ({ content: "" }),
    };
    const result = messageToMapAfterFix({
      messageID: "m3",
      timestamp: 1,
      fromUID: "u",
      content: textContent,
    });
    expect(result).not.toBeNull();
    expect(result.payload.content).toBe("");
  });

  it("[FIX] messageToMap returns null for file (type 8) with empty url", () => {
    const fileContent = {
      contentObj: undefined,
      contentType: 8, // file
      encodeJSON: () => ({ name: "doc.pdf", size: 1234, url: "" }),
    };
    const result = messageToMapAfterFix({
      messageID: "m4",
      timestamp: 1,
      fromUID: "u",
      content: fileContent,
    });
    expect(result).toBeNull();
  });
});
