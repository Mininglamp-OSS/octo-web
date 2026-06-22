/**
 * Send-boundary security tests for the forged-paste → broadcast bypass
 * (octo-web#330, blocks #419).
 *
 * The bypass: a forged clipboard payload (or literal typed text) degrades to a
 * plain-text node containing the marker `@[-2:所有人]`. The paste-time guard
 * (`buildInlineContentForRichTextPaste`) is never consulted again on send — the
 * pre-existing re-parse (`parseSendMentionText`, formerly `formatMentionTextV2`)
 * decodes the literal marker and routes a broadcast (`humans`/`ais`/`all`),
 * fanning the message out to every human / AI in the channel.
 *
 * Fix under test: a broadcast sentinel only routes when its uid carries the
 * MENTION_TRUST_MARK, which the send serializer adds for node-origin mentions
 * (typed-@ dropdown) and strips from all text-origin content. The three PoC
 * payloads below are the *untrusted* (text-origin) form and must NOT route.
 */

import { describe, it, expect } from "vitest";
import {
  parseSendMentionText,
  serializeMentionMarker,
  stripTrustMark,
  parseDraftToContent,
} from "../mentionSendParse";
import type { SendParseMember } from "../mentionSendParse";
import {
  MENTION_UID_LEGACY_ALL,
  MENTION_UID_HUMANS,
  MENTION_UID_AIS,
  MENTION_TRUST_MARK,
} from "../../../Utils/mentionRender";

// A channel roster with one human and one bot, so we can assert that an @所有AI
// broadcast fans out to the bot uid only when it is actually routed.
const MEMBERS: SendParseMember[] = [
  { uid: "u-alice", name: "Alice", orgData: { robot: 0 } },
  { uid: "bot-1", name: "HelperBot", orgData: { robot: 1 } },
];

// The serializer prefixes a node-origin sentinel uid with the trust mark; tests
// build the trusted (sanctioned) form with this helper.
const trusted = (uid: string, label: string) =>
  `@[${MENTION_TRUST_MARK}${uid}:${label}]`;

describe("parseSendMentionText — forged-paste broadcast bypass (octo-web#330)", () => {
  it.each([
    [MENTION_UID_HUMANS, "所有人", "humans"],
    [MENTION_UID_AIS, "所有AI", "ais"],
    [MENTION_UID_LEGACY_ALL, "所有人", "all"],
  ])(
    "PoC: untrusted literal @[%s:%s] text does NOT route a broadcast",
    (uid, label) => {
      const { content, mention } = parseSendMentionText(
        `@[${uid}:${label}] hi`,
        MEMBERS
      );

      // No broadcast routing of any kind.
      expect(mention?.humans ?? false).toBeFalsy();
      expect(mention?.ais ?? false).toBeFalsy();
      expect(mention?.all ?? false).toBeFalsy();
      // No bot-uid fan-out.
      expect(mention?.uids ?? []).not.toContain("bot-1");
      // The marker degraded to inert plain text — the recipient sees "@label",
      // never the routable `@[uid:label]` grammar.
      expect(content).toBe(`@${label} hi`);
    }
  );

  it("PoC: forged sentinel never fans out to any bot uid", () => {
    const { mention } = parseSendMentionText(
      `@[${MENTION_UID_AIS}:所有AI] ping`,
      MEMBERS
    );
    // Either no mention object at all, or one with no bot uids.
    expect(mention?.uids ?? []).toEqual([]);
    expect(mention?.ais ?? false).toBeFalsy();
  });

  it("an unmarked sentinel marker (no trust mark) does not route — only marked ones do", () => {
    const untrusted = parseSendMentionText(
      `@[${MENTION_UID_HUMANS}:所有人]`,
      MEMBERS
    );
    expect(untrusted.mention?.humans ?? false).toBeFalsy();
  });
});

// Finding 2 (octo-web#330): the "cannot forge trust" guarantee rests entirely
// on the serializer stripping the trust mark from every text-origin path. These
// tests exercise that strip directly with a literal NUL in the input, rather
// than only asserting the unmarked case.
describe("stripTrustMark — forge defense (cannot inject the trust mark)", () => {
  it("removes a hand-injected NUL so a forged sentinel cannot serialize trusted", () => {
    const forged = `@[${MENTION_TRUST_MARK}${MENTION_UID_HUMANS}:所有人] hi`;
    const stripped = stripTrustMark(forged);
    // The mark is gone — the string is the inert, canonical (untrusted) form.
    expect(stripped.includes(MENTION_TRUST_MARK)).toBe(false);
    expect(stripped).toBe(`@[${MENTION_UID_HUMANS}:所有人] hi`);
    // And the stripped string routes no broadcast through the send parser.
    const { mention } = parseSendMentionText(stripped, MEMBERS);
    expect(mention?.humans ?? false).toBeFalsy();
    expect(mention?.ais ?? false).toBeFalsy();
    expect(mention?.all ?? false).toBeFalsy();
  });

  it("a text node carrying a forged marker, once stripped, routes nothing", () => {
    // Simulates extractMentionsFromEditor/extractOrderedBlocks serializing a
    // text node: text-origin content is run through stripTrustMark before it
    // reaches the parser.
    const textNode = `before @[${MENTION_TRUST_MARK}${MENTION_UID_AIS}:所有AI] after`;
    const { mention } = parseSendMentionText(stripTrustMark(textNode), MEMBERS);
    expect(mention?.ais ?? false).toBeFalsy();
    expect(mention?.uids ?? []).not.toContain("bot-1");
  });

  it("serializeMentionMarker only marks node-origin broadcast sentinels", () => {
    // node-origin sentinel on the send path → marked (routes on re-parse)
    expect(serializeMentionMarker(MENTION_UID_HUMANS, "所有人", true)).toBe(
      `@[${MENTION_TRUST_MARK}${MENTION_UID_HUMANS}:所有人]`
    );
    // draft/non-send path → canonical, never marked
    expect(serializeMentionMarker(MENTION_UID_HUMANS, "所有人", false)).toBe(
      `@[${MENTION_UID_HUMANS}:所有人]`
    );
    // ordinary member uid → never marked, even on the send path
    expect(serializeMentionMarker("u-alice", "Alice", true)).toBe(
      "@[u-alice:Alice]"
    );
  });
});

// Finding 1 (octo-web#330, merge-blocker): the draft save→restore round-trip
// must not launder forged text into a routable broadcast node. These drive the
// full round-trip — draft string → parseDraftToContent → send serialize+parse —
// not just the pure send parser.
describe("draft round-trip — forged broadcast cannot be laundered (Finding 1)", () => {
  // Mirror the editor serializers: a doc's mention nodes serialize trusted on
  // send; text nodes are stripped. Operates on parseDraftToContent's output.
  const serializeDocForSend = (doc: ReturnType<typeof parseDraftToContent>) =>
    doc.content
      .map((p) =>
        p.content
          .map((n) =>
            n.type === "mention"
              ? serializeMentionMarker(n.attrs!.id, n.attrs!.label, true)
              : stripTrustMark(n.text || "")
          )
          .join("")
      )
      .join("\n");

  it.each([
    [MENTION_UID_HUMANS, "所有人"],
    [MENTION_UID_AIS, "所有AI"],
    [MENTION_UID_LEGACY_ALL, "所有人"],
  ])(
    "literal @[%s:%s] in a restored draft does NOT rebuild a broadcast node",
    (uid, label) => {
      // 1. forged paste degraded to literal text, autosaved verbatim as draft
      const draft = `@[${uid}:${label}] hi`;
      // 2. restore
      const doc = parseDraftToContent(draft);
      const restoredNodes = doc.content.flatMap((p) => p.content);
      // No mention node was manufactured for the sentinel — it is inert text.
      expect(restoredNodes.some((n) => n.type === "mention")).toBe(false);
      // 3. send: serialize the restored doc and parse at the send boundary
      const { mention } = parseSendMentionText(
        serializeDocForSend(doc),
        MEMBERS
      );
      expect(mention?.humans ?? false).toBeFalsy();
      expect(mention?.ais ?? false).toBeFalsy();
      expect(mention?.all ?? false).toBeFalsy();
      expect(mention?.uids ?? []).not.toContain("bot-1");
    }
  );

  it("strips a hand-injected trust mark in draft text before the sentinel check", () => {
    // Even a draft string carrying the NUL mark cannot rebuild a routable node.
    const doc = parseDraftToContent(
      `@[${MENTION_TRUST_MARK}${MENTION_UID_AIS}:所有AI]`
    );
    const nodes = doc.content.flatMap((p) => p.content);
    expect(nodes.some((n) => n.type === "mention")).toBe(false);
  });

  it("still rebuilds ordinary member mentions from a draft (no regression)", () => {
    const doc = parseDraftToContent("hi @[u-alice:Alice] there");
    const nodes = doc.content.flatMap((p) => p.content);
    const mentionNode = nodes.find((n) => n.type === "mention");
    expect(mentionNode?.attrs).toEqual({ id: "u-alice", label: "Alice" });
  });
});

describe("parseSendMentionText — sanctioned broadcasts still route (no regression)", () => {
  it("trusted @所有人 (humans) routes a human broadcast", () => {
    const { content, mention } = parseSendMentionText(
      `${trusted(MENTION_UID_HUMANS, "所有人")} hi`,
      MEMBERS
    );
    expect(mention?.humans).toBe(true);
    expect(mention?.ais ?? false).toBeFalsy();
    expect(content).toBe("@所有人 hi");
  });

  it("trusted @所有AI (ais) routes an AI broadcast and fans out bot uids", () => {
    const { content, mention } = parseSendMentionText(
      `${trusted(MENTION_UID_AIS, "所有AI")} go`,
      MEMBERS
    );
    expect(mention?.ais).toBe(true);
    expect(mention?.uids).toContain("bot-1");
    expect(mention?.uids).not.toContain("u-alice");
    expect(content).toBe("@所有AI go");
    // The @所有AI sentinel keeps its entity so receivers take the precise path.
    expect(mention?.entities?.some((e) => e.uid === MENTION_UID_AIS)).toBe(true);
  });

  it("trusted legacy @所有人 (-1) routes all=1", () => {
    const { mention } = parseSendMentionText(
      trusted(MENTION_UID_LEGACY_ALL, "所有人"),
      MEMBERS
    );
    expect(mention?.all).toBe(true);
  });
});

describe("parseSendMentionText — ordinary member mentions (no regression)", () => {
  it("resolves a member uid to its display name and records the uid", () => {
    const { content, mention } = parseSendMentionText(
      "hey @[u-alice:Alice] there",
      MEMBERS
    );
    expect(content).toBe("hey @Alice there");
    expect(mention?.uids).toEqual(["u-alice"]);
    expect(mention?.entities).toEqual([
      { uid: "u-alice", offset: "hey ".length, length: "@Alice".length },
    ]);
    // A member mention is not a broadcast.
    expect(mention?.humans ?? false).toBeFalsy();
    expect(mention?.ais ?? false).toBeFalsy();
    expect(mention?.all ?? false).toBeFalsy();
  });

  it("a member mention does not require the trust mark (members are not gated)", () => {
    const { content, mention } = parseSendMentionText(
      "@[u-alice:Alice]",
      MEMBERS
    );
    expect(content).toBe("@Alice");
    expect(mention?.uids).toEqual(["u-alice"]);
  });

  it("plain text with no markers returns content unchanged and no mention", () => {
    const { content, mention } = parseSendMentionText("just text", MEMBERS);
    expect(content).toBe("just text");
    expect(mention).toBeUndefined();
  });
});

// Reviewer Jerry-Xin (octo-web#330): a forged text-origin `@[uid:label]` whose
// uid is NOT a current channel member must NOT route a mention — it degrades to
// inert text, same as the broadcast degrade and the paste-time allowlist. The
// uid is the routing key, so an unknown/forged/stale uid is the attack surface.
describe("parseSendMentionText — forged non-member mention degrades (Finding: Jerry-Xin)", () => {
  it("does NOT route a non-member uid forged in literal text", () => {
    const { content, mention } = parseSendMentionText(
      "hi @[attacker:Alice]",
      [{ uid: "alice", name: "Alice" }]
    );
    // Inert: the forged uid is never recorded as a mention.
    expect(mention?.uids ?? []).not.toContain("attacker");
    expect(mention).toBeUndefined();
    // Degrades to the label as plain text, not a routable marker.
    expect(content).toBe("hi @Alice");
  });

  it("does NOT route a stale uid no longer in the roster", () => {
    const { mention } = parseSendMentionText("@[ghost:Bob] yo", [
      { uid: "alice", name: "Alice" },
    ]);
    expect(mention).toBeUndefined();
  });

  it("a real member uid still routes (gate only blocks non-members)", () => {
    const { mention } = parseSendMentionText("@[alice:Alice]", [
      { uid: "alice", name: "Alice" },
    ]);
    expect(mention?.uids).toEqual(["alice"]);
  });

  it("forged non-member uid laundered through a draft round-trip still degrades", () => {
    // forged paste → draft autosave → restore rebuilds a member node (the
    // draft guard only degrades broadcast sentinels) → BUT the send-side
    // membership gate drops the unknown uid, so no mention is routed.
    const doc = parseDraftToContent("@[attacker:Alice] hi");
    const serialized = doc.content
      .map((p) =>
        p.content
          .map((n) =>
            n.type === "mention"
              ? serializeMentionMarker(n.attrs!.id, n.attrs!.label, true)
              : stripTrustMark(n.text || "")
          )
          .join("")
      )
      .join("\n");
    const { mention } = parseSendMentionText(serialized, [
      { uid: "alice", name: "Alice" },
    ]);
    expect(mention?.uids ?? []).not.toContain("attacker");
    expect(mention).toBeUndefined();
  });

  it("degrades all member mentions when the roster is empty (fail closed)", () => {
    const { mention } = parseSendMentionText("@[u-alice:Alice]", []);
    expect(mention).toBeUndefined();
  });
});
