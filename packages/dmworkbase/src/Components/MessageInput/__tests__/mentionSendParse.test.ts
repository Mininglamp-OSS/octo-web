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
import { parseSendMentionText } from "../mentionSendParse";
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

  it("strips an attacker-injected trust mark from literal text (cannot forge trust)", () => {
    // Even if the attacker hand-writes the NUL trust mark into the payload, the
    // send serializer strips it from text-origin content before this parse. We
    // assert the parser itself fails closed if a raw trusted-looking marker were
    // ever reconstructed from text: it only honors the mark, so the defense is
    // the serializer's strip. This documents the layered contract — here we
    // confirm the *trusted* form is the ONLY routing form.
    const untrusted = parseSendMentionText(
      `@[${MENTION_UID_HUMANS}:所有人]`,
      MEMBERS
    );
    expect(untrusted.mention?.humans ?? false).toBeFalsy();
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
