import { describe, expect, it } from "vitest";

import {
  DEFAULT_MESSAGE_REACTION_CAPABILITY,
  messageReactionCapabilityEqual,
  parseMessageReactionCapability,
} from "../MessageReactionConfig";

describe("parseMessageReactionCapability", () => {
  it("falls back to read-only when the appconfig field is absent or malformed", () => {
    expect(parseMessageReactionCapability(undefined)).toEqual(
      DEFAULT_MESSAGE_REACTION_CAPABILITY
    );
    expect(parseMessageReactionCapability(null)).toEqual(
      DEFAULT_MESSAGE_REACTION_CAPABILITY
    );
    expect(parseMessageReactionCapability("invalid")).toEqual(
      DEFAULT_MESSAGE_REACTION_CAPABILITY
    );
  });

  it("parses read-write and read-only capabilities", () => {
    expect(
      parseMessageReactionCapability({ read: true, write: true })
    ).toEqual({ read: true, write: true });
    expect(
      parseMessageReactionCapability({ read: true, write: false })
    ).toEqual({ read: true, write: false });
  });

  it("falls back field-by-field for partial objects", () => {
    expect(parseMessageReactionCapability({ read: false })).toEqual({
      read: false,
      write: false,
    });
    expect(parseMessageReactionCapability({ write: true })).toEqual({
      read: true,
      write: true,
    });
  });

  it("never enables write when read is disabled", () => {
    expect(
      parseMessageReactionCapability({ read: false, write: true })
    ).toEqual({ read: false, write: false });
  });

  it("accepts the appconfig boolean encodings used by existing remote fields", () => {
    expect(
      parseMessageReactionCapability({ read: "true", write: 1 })
    ).toEqual({ read: true, write: true });
  });
});

describe("messageReactionCapabilityEqual", () => {
  it("compares both capability dimensions", () => {
    expect(
      messageReactionCapabilityEqual(
        { read: true, write: false },
        { read: true, write: false }
      )
    ).toBe(true);
    expect(
      messageReactionCapabilityEqual(
        { read: true, write: false },
        { read: true, write: true }
      )
    ).toBe(false);
    expect(
      messageReactionCapabilityEqual(
        { read: true, write: false },
        { read: false, write: false }
      )
    ).toBe(false);
  });
});
