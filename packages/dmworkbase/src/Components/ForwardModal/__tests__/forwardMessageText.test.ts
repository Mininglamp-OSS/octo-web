import { describe, it, expect } from "vitest"
import {
  escapeForwardTitle,
  escapeForwardLinkDestination,
  buildForwardMessageText,
} from "../forwardMessageText"

describe("forwardMessageText — title escaping (#511 review blocker)", () => {
  it("leaves a plain title unchanged in text", () => {
    expect(escapeForwardTitle("Quarterly plan")).toBe("Quarterly plan")
  })

  it("escapes markdown link-label / bold characters so a title cannot forge structure", () => {
    // A title trying to close the bold run and inject its own link.
    const evil = "x](http://evil.example)**[pwn"
    const escaped = escapeForwardTitle(evil)
    // Every bracket / paren / star is backslash-escaped → renders literally.
    expect(escaped).not.toContain("](")
    expect(escaped).toContain("\\]")
    expect(escaped).toContain("\\(")
    expect(escaped).toContain("\\*\\*")
  })

  it("collapses newlines to a single space (title stays one inline run)", () => {
    expect(escapeForwardTitle("line1\nline2\r\nline3")).toBe("line1 line2 line3")
  })

  it("escapes destination-terminating characters in the URL", () => {
    expect(escapeForwardLinkDestination("http://a/b>c\\d<e")).toBe(
      "http://a/b%3Ec%5Cd%3Ce"
    )
    expect(escapeForwardLinkDestination("http://a/b\nc")).toBe("http://a/bc")
  })

  it("builds the card shape with the visible link text = real URL (#511 problem 1, option A)", () => {
    const text = buildForwardMessageText("Weekly **notes**", "http://x/docs?doc=d1")
    // Bold title on top (escaped), then a link whose LABEL is the real URL itself,
    // pointing at the same URL — so the recipient sees and can click the true destination.
    expect(text).toBe(
      "**Weekly \\*\\*notes\\*\\***\n[http://x/docs?doc=d1](<http://x/docs?doc=d1>)"
    )
  })

  it("keeps a leading bold run + a single URL link (title cannot forge a second link)", () => {
    const text = buildForwardMessageText("Doc]title", "http://x/docs?doc=d1")
    expect(text.startsWith("**")).toBe(true)
    // The visible link label is the real URL, not the (escaped) title.
    expect(text).toContain("[http://x/docs?doc=d1](<http://x/docs?doc=d1>)")
    // Exactly one real link opener (the label bracket of the card link); the
    // title's own bracket is escaped and cannot open a second link.
    expect(text.match(/\]\(</g)?.length).toBe(1)
  })
})
