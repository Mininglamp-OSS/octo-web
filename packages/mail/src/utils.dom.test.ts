// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MessageDetail } from "./bridge/types";
import { downloadBlob, getMessageText } from "./utils";

function htmlMessage(bodyHtml: string): MessageDetail {
  return {
    id: "E1",
    mailbox: "Inbox",
    subject: "HTML message",
    from: "sender@example.com",
    to: ["owner@example.com"],
    preview: "Preview fallback",
    receivedAt: "2026-08-11T00:00:00Z",
    size: bodyHtml.length,
    keywords: [],
    unread: false,
    bodyHtml,
  };
}

describe("getMessageText", () => {
  it("keeps readable boundaries between HTML blocks and line breaks", () => {
    expect(
      getMessageText(
        htmlMessage("<p>Line1</p><p>Line2<br>Next</p><div>Line3</div>")
      )
    ).toBe("Line1\nLine2\nNext\nLine3");
  });

  it("drops non-message script, style, head, and template contents", () => {
    expect(
      getMessageText(
        htmlMessage(
          "<head><title>Hidden</title></head><div>Hi</div><style>.a{color:red}</style><script>alert(1)</script><template>Draft</template><p>Bye</p>"
        )
      )
    ).toBe("Hi\nBye");
  });

  it.each([
    ["the hidden attribute", "<div hidden>SECRET</div>"],
    ["display none", '<div style="display:none">SECRET</div>'],
    ["hidden visibility", '<div style="visibility:hidden">SECRET</div>'],
    ["collapsed visibility", '<div style="visibility:collapse">SECRET</div>'],
  ])("drops content hidden with %s", (_name, hiddenHtml) => {
    expect(
      getMessageText(htmlMessage(`${hiddenHtml}<p>Visible message</p>`))
    ).toBe("Visible message");
  });

  it("keeps descendants that explicitly restore hidden visibility", () => {
    expect(
      getMessageText(
        htmlMessage(
          '<div style="visibility:hidden">Hidden <span style="visibility:visible">Shown</span></div>'
        )
      )
    ).toBe("Shown");
  });

  it("does not emit line breaks from visibility-hidden descendants", () => {
    expect(
      getMessageText(
        htmlMessage(
          'Before<span style="visibility:hidden"><br>Hidden</span>After'
        )
      )
    ).toBe("BeforeAfter");
  });

  it("separates table cells instead of running their text together", () => {
    expect(
      getMessageText(
        htmlMessage("<table><tr><td>Total</td><td>100</td></tr></table>")
      )
    ).toBe("Total\n100");
  });

  it("keeps Gmail-style nested block boundaries", () => {
    expect(
      getMessageText(htmlMessage("<div>Regards,<div>Alice</div></div>"))
    ).toBe("Regards,\nAlice");
  });

  it("keeps a nested table separate from preceding text", () => {
    expect(
      getMessageText(
        htmlMessage("<div>Total: 100<table><tr><td>A</td></tr></table></div>")
      )
    ).toBe("Total: 100\nA");
  });

  it("preserves indentation inside preformatted blocks", () => {
    expect(getMessageText(htmlMessage("<pre>  a\n  b</pre>"))).toBe("  a\n  b");
  });

  it.each([
    ["adjacent spans", "<span>Hello </span><span> world</span>", "Hello world"],
    [
      "nested inline markup",
      "<div><b>Bold </b> <i> italic</i></div>",
      "Bold italic",
    ],
    [
      "linked inline markup",
      '<p>Click <a href="#">here </a> <span> now</span></p>',
      "Click here now",
    ],
  ])("collapses whitespace across %s", (_name, html, expected) => {
    expect(getMessageText(htmlMessage(html))).toBe(expected);
  });

  it.each([
    ["consecutive line breaks", "Line A<br><br>Line B", "Line A\n\nLine B"],
    [
      "signature separation",
      "<p>Body</p><br><br>--<br>Alice",
      "Body\n\n--\nAlice",
    ],
  ])("preserves intentional blank lines from %s", (_name, html, expected) => {
    expect(getMessageText(htmlMessage(html))).toBe(expected);
  });

  it.each([
    [
      "hard-wrapped inline source",
      "<p>This is a long sentence that the\nauthoring tool wrapped for readability.</p>",
      "This is a long sentence that the authoring tool wrapped for readability.",
    ],
    [
      "indented inline markup",
      "<div>\n  <span>Hello</span>\n\n  <span>world</span>\n</div>",
      "Hello world",
    ],
    [
      "pretty-printed table markup",
      "<table>\n  <tr>\n    <td>Order</td>\n    <td>#12345</td>\n  </tr>\n</table>",
      "Order\n#12345",
    ],
  ])("ignores insignificant whitespace from %s", (_name, html, expected) => {
    expect(getMessageText(htmlMessage(html))).toBe(expected);
  });

  it("preserves explicit line breaks inside preformatted blocks", () => {
    expect(getMessageText(htmlMessage("<pre>a<br>b</pre>"))).toBe("a\nb");
  });

  it.each([
    [
      "pre-wrap",
      '<div style="white-space: pre-wrap">first\nsecond</div>',
      "first\nsecond",
    ],
    [
      "pre",
      '<div style="white-space: pre">first  value\nsecond</div>',
      "first  value\nsecond",
    ],
    [
      "pre-line",
      '<div style="white-space: pre-line">first  value\nsecond</div>',
      "first value\nsecond",
    ],
    [
      "break-spaces",
      '<div style="white-space: break-spaces">first  value\nsecond</div>',
      "first  value\nsecond",
    ],
  ])("applies CSS %s whitespace semantics", (_mode, html, expected) => {
    expect(getMessageText(htmlMessage(html))).toBe(expected);
  });

  it.each([
    [
      "inherits a preserving mode",
      '<div style="white-space: pre-wrap"><span>first\n  second</span></div>',
      "first\n  second",
    ],
    [
      "honors an explicit normal override",
      '<pre style="white-space: normal">first\n  second</pre>',
      "first second",
    ],
  ])("%s across nested elements", (_name, html, expected) => {
    expect(getMessageText(htmlMessage(html))).toBe(expected);
  });

  it("preserves diagnostic formatting under pre-wrap", () => {
    expect(
      getMessageText(
        htmlMessage(
          '<p style="white-space: pre-wrap">Traceback:\n  File "x.py"\n    boom\nValueError</p>'
        )
      )
    ).toBe('Traceback:\n  File "x.py"\n    boom\nValueError');
  });

  it("preserves textarea whitespace", () => {
    expect(getMessageText(htmlMessage("<textarea>t1\nt2</textarea>"))).toBe(
      "t1\nt2"
    );
  });

  it.each([
    ["block children", "<pre><div>a</div><div>b</div></pre>", "a\nb"],
    [
      "nested pre elements",
      "<pre>outer<pre>inner</pre>tail</pre>",
      "outer\ninner\ntail",
    ],
  ])("keeps boundaries between %s", (_name, html, expected) => {
    expect(getMessageText(htmlMessage(html))).toBe(expected);
  });

  it.each([
    ["nested blocks in pre", "<pre><div><div>a</div></div></pre>", "a"],
    [
      "nested blocks in pre-wrap",
      '<div style="white-space: pre-wrap"><div><div>a</div></div></div>',
      "a",
    ],
    [
      "an empty preserved inline",
      'A <span style="white-space: pre-wrap"></span> B',
      "A B",
    ],
    [
      "an empty preserved inline between breaks",
      'A<br><br><span style="white-space: pre"></span><br><br>B',
      "A\n\nB",
    ],
    [
      "a nested pre with adjacent source breaks",
      '<div style="white-space: pre-wrap">A\n<pre>B\nC</pre>\nD</div>',
      "A\nB\nC\nD",
    ],
    [
      "a normal block inside pre",
      '<pre>A<div style="white-space: normal">  B  </div>C</pre>',
      "A\nB\nC",
    ],
  ])(
    "does not leak synthetic boundaries around %s",
    (_name, html, expected) => {
      expect(getMessageText(htmlMessage(html))).toBe(expected);
    }
  );

  it("does not accumulate synthetic whitespace across deeply nested modes", () => {
    let html = "x";
    for (let index = 0; index < 40; index += 1) {
      const mode = index % 2 === 0 ? "pre-wrap" : "normal";
      html = `<div style="white-space: ${mode}">L${index}\n${html}</div>`;
    }

    const text = getMessageText(htmlMessage(html));
    expect(text.startsWith("\n")).toBe(false);
    expect(text.endsWith("\n")).toBe(false);
    expect(text).not.toContain("octo-mail-pre");
    expect(text).toContain("L0");
    expect(text.endsWith("x")).toBe(true);
  });

  it("falls back to the preview for whitespace-only preserved content", () => {
    expect(
      getMessageText(
        htmlMessage('<div style="white-space: pre-wrap">   \n  </div>')
      )
    ).toBe("Preview fallback");
  });

  it("extracts MathML nodes that do not expose an inline style object", () => {
    expect(
      getMessageText(
        htmlMessage("<div>before</div><math><mi>x</mi></math><div>after</div>")
      )
    ).toBe("before\nx\nafter");
  });

  it("does not confuse message text with preformatted placeholders", () => {
    expect(
      getMessageText(
        htmlMessage(
          "<div>\uE000octo-mail-pre-0\uE001</div><pre>  real\n  pre</pre>"
        )
      )
    ).toBe("\uE000octo-mail-pre-0\uE001\n  real\n  pre");
  });

  it("restores many preformatted blocks without leaking placeholders", () => {
    const html = Array.from(
      { length: 200 },
      (_, index) => `<pre>line ${index}\n  detail</pre>`
    ).join("");
    const text = getMessageText(htmlMessage(html));

    expect(text).not.toContain("octo-mail-pre");
    expect(text).toContain("line 0\n  detail");
    expect(text).toContain("line 199\n  detail");
  });
});

describe("downloadBlob", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("clicks an attached anchor before revoking the object URL", () => {
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:mail");
    const revokeObjectURL = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined);
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        expect(document.body.contains(this)).toBe(true);
      });

    downloadBlob(new Blob(["mail"]), "message.eml");

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mail");
  });
});
