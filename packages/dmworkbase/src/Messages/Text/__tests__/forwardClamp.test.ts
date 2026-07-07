import { describe, it, expect } from "vitest"
import {
  URL_ELLIPSIS_THRESHOLD,
  isUrlLike,
  middleEllipsizeUrl,
  shouldEllipsizeLinkText,
  isForwardDocCard,
  type ParagraphChildKind,
} from "../forwardClamp"

describe("forwardClamp — URL middle-ellipsis (AC-13b, contract 5)", () => {
  it("leaves text at or below the threshold untouched", () => {
    const short = "https://octo.example.com/docs?doc=d_1"
    expect(short.length).toBeLessThanOrEqual(URL_ELLIPSIS_THRESHOLD)
    expect(middleEllipsizeUrl(short)).toBe(short)
  })

  it("middle-ellipsizes a long URL as head30…tail20 (href-length preserving semantics)", () => {
    const long = "https://octo.example.com/docs?space=demo&folder=f_default&doc=d_verylongidentifier12345"
    expect(long.length).toBeGreaterThan(URL_ELLIPSIS_THRESHOLD)
    const out = middleEllipsizeUrl(long)
    expect(out).toBe(`${long.slice(0, 30)}…${long.slice(long.length - 20)}`)
    expect(out).toContain("…")
    // The ellipsized text is shorter than the source but keeps the recognizable head + tail.
    expect(out.startsWith(long.slice(0, 30))).toBe(true)
    expect(out.endsWith(long.slice(long.length - 20))).toBe(true)
  })

  it("isUrlLike accepts http(s) URLs and rejects plain titles", () => {
    expect(isUrlLike("https://a.com/x")).toBe(true)
    expect(isUrlLike("http://a.com")).toBe(true)
    expect(isUrlLike("Quarterly planning doc")).toBe(false)
    expect(isUrlLike("ftp://a.com")).toBe(false)
  })

  it("only ellipsizes when the visible text IS the (long) href — a titled link is untouched", () => {
    const longUrl = "https://octo.example.com/docs?space=demo&folder=f_default&doc=d_verylongidentifier12345"
    // Bare URL link: text === href → ellipsize.
    expect(shouldEllipsizeLinkText(longUrl, longUrl)).toBe(true)
    // Titled link `[title](link)`: visible text is the title, not the URL → never ellipsize.
    expect(shouldEllipsizeLinkText("My document", longUrl)).toBe(false)
    // Short bare URL: no ellipsis.
    expect(shouldEllipsizeLinkText("https://a.com", "https://a.com")).toBe(false)
  })
})

describe("forwardClamp — forward-card structure detection (title clamp gate)", () => {
  const title = "Quarterly planning doc"
  const url = "https://octo.example.com/docs?space=demo&folder=f_default&doc=d_1"
  const strong: ParagraphChildKind = { isStrong: true, content: title }
  const link: ParagraphChildKind = { isLink: true, content: title }
  const urlLink: ParagraphChildKind = { isLink: true, content: url }
  const br: ParagraphChildKind = { isBreak: true }

  it("matches the original `**title**\\n[title](link)` shape (strong + break + link, label === title)", () => {
    expect(isForwardDocCard([strong, br, link])).toBe(true)
  })

  it("matches the current `**title**\\n[url](url)` shape (label is the real URL, not the title)", () => {
    // buildForwardMessageText now emits the real URL as the visible link label so the recipient can
    // see/click the destination — label !== title. The detector recognizes it via isUrlLike(label),
    // restoring the AC-13b title clamp / tooltip / `wk-markdown-forward-card` styling on the card.
    expect(url).not.toBe(title)
    expect(isForwardDocCard([strong, br, urlLink])).toBe(true)
  })

  it("ignores whitespace-only text runs around the forward shape", () => {
    expect(isForwardDocCard([{ text: "  " }, strong, br, link])).toBe(true)
    expect(isForwardDocCard([{ text: "  " }, strong, br, urlLink])).toBe(true)
  })

  it("does NOT match arbitrary bold text (bold only, no link) — no clamp regression", () => {
    expect(isForwardDocCard([strong, { text: " some bold intro" }])).toBe(false)
  })

  it("does NOT match a link that is not preceded by a leading bold title", () => {
    expect(isForwardDocCard([{ text: "see " }, link])).toBe(false)
    expect(isForwardDocCard([link, br, strong])).toBe(false)
  })

  // False-positive guard (B3): ordinary "bold-lead + link" messages must NOT be clamped.
  it("does NOT clamp a bold-intro message whose link label differs from the title", () => {
    // `**Note:** see [the docs](https://x)` → strong("Note:") + text("see") + link("the docs").
    // A text run separates bold and link (no break) AND the label is not the title → not a card.
    expect(
      isForwardDocCard([
        { isStrong: true, content: "Note:" },
        { text: " see " },
        { isLink: true, content: "the docs" },
      ]),
    ).toBe(false)
  })

  it("does NOT clamp `**bold** [link](url)` — strong+link adjacency without title-matching label", () => {
    // strong("bold") + whitespace + link("link"): even folding the space away, the link label
    // ("link") is not the bold title ("bold"), so this common shape stays a plain paragraph.
    expect(
      isForwardDocCard([
        { isStrong: true, content: "bold" },
        { text: " " },
        { isLink: true, content: "link" },
      ]),
    ).toBe(false)
  })

  it("does NOT clamp a strong+break+link whose label is neither the title nor a bare URL", () => {
    // Same skeleton as a real forward card, but the anchor text is ordinary prose ("open here"):
    // not the bold title AND not URL-like, so it is rejected —普通消息 with a titled link is safe.
    expect(
      isForwardDocCard([
        { isStrong: true, content: "Heading" },
        { isBreak: true },
        { isLink: true, content: "open here" },
      ]),
    ).toBe(false)
  })
})
