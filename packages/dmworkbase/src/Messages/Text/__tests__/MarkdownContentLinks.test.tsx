// @vitest-environment jsdom

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../App", () => ({
  default: {
    dataSource: { commonDataSource: { getImageURL: (src: string) => src } },
  },
}));
vi.mock("../../../i18n", () => ({ t: (key: string) => key }));

import MarkdownContent from "../MarkdownContent";
import MixedContent from "../../../ui/message/MixedContent";
import ReplyBlock from "../../../ui/message/ReplyBlock";

function render(element: React.ReactElement) {
  const root = document.createElement("div");
  root.innerHTML = renderToStaticMarkup(element);
  return root;
}

function hrefs(root: HTMLElement) {
  return Array.from(root.querySelectorAll("a"), (a) => a.getAttribute("href"));
}

const urls = [
  "https://example.com/repo-a/-/merge_requests/111",
  "https://example.com/repo-b/-/merge_requests/222",
  "https://example.com/repo-c/pull/333",
];

const modes = [
  { name: "chat Markdown", props: {} },
  { name: "Markdown without math", props: { enableMath: false } },
  {
    name: "Markdown with explicit math",
    props: { allowSingleDollarMath: true },
  },
  { name: "plain text", props: { enableMarkdown: false } },
];

describe.each(modes)("MarkdownContent links — $name", ({ props }) => {
  it.each([",", ";", ":", "!", "?", ".", "，", "。", "；", "：", "！", "？"])(
    "keeps line-final %s outside every automatic URL (#1651)",
    (punctuation) => {
      const content = `${urls[0]}${punctuation}\n${urls[1]}${punctuation}\n${urls[2]}`;
      const root = render(<MarkdownContent content={content} {...props} />);
      expect(hrefs(root)).toEqual(urls);
      expect(root.textContent).toBe(content);
      expect(root.querySelectorAll("br")).toHaveLength(2);
      expect(
        Array.from(root.querySelectorAll("a"), (a) => a.textContent)
      ).toEqual(urls);
    }
  );

  it("preserves paired parentheses, query punctuation and encoded suffixes", () => {
    const addresses = [
      "https://example.com/wiki/Foo_(bar)",
      "https://example.com/a?ids=1,2&next=/x:y#part",
      "https://example.com/a%2C",
      "https://example.com/a%29",
    ];
    const content = addresses.map((url) => `${url}，`).join("\n");
    const root = render(<MarkdownContent content={content} {...props} />);
    expect(hrefs(root)).toEqual(addresses);
    expect(root.textContent).toBe(content);
  });

  it("keeps only the enclosing right parenthesis outside the URL", () => {
    const url = "https://example.com/wiki/Foo_(bar)";
    const content = `(${url})，`;
    const root = render(<MarkdownContent content={content} {...props} />);
    expect(hrefs(root)).toEqual([url]);
    expect(root.textContent).toBe(content);
  });

  it("preserves the existing scheme for www links while trimming punctuation", () => {
    const root = render(
      <MarkdownContent content="www.example.com/docs。" {...props} />
    );
    const scheme = "enableMarkdown" in props ? "https" : "http";
    expect(hrefs(root)).toEqual([`${scheme}://www.example.com/docs`]);
    expect(root.textContent).toBe("www.example.com/docs。");
  });
});

describe.each(modes.slice(0, 3))(
  "Markdown link intent — $name",
  ({ props }) => {
    it("preserves explicit, angle-bracket and reference link destinations", () => {
      const content = [
        "[label](https://example.com/a,)",
        "[https://example.com/b，](https://example.com/b，)",
        "<https://example.com/c,>",
        "[reference][target]",
        "",
        "[target]: https://example.com/d;",
      ].join("\n");
      const root = render(<MarkdownContent content={content} {...props} />);
      expect(hrefs(root)).toEqual([
        "https://example.com/a,",
        "https://example.com/b%EF%BC%8C",
        "https://example.com/c,",
        "https://example.com/d;",
      ]);
    });

    it("leaves code literal and still fixes automatic links in lists and tables", () => {
      const root = render(
        <MarkdownContent
          {...props}
          content={[
            "`https://example.com/code，`",
            "",
            "```text",
            "https://example.com/fence,",
            "```",
            "",
            "- https://example.com/list，",
            "",
            "| URL |",
            "| --- |",
            "| https://example.com/table。 |",
          ].join("\n")}
        />
      );
      expect(hrefs(root)).toEqual([
        "https://example.com/list",
        "https://example.com/table",
      ]);
      expect(
        Array.from(root.querySelectorAll("code"), (code) => code.textContent)
      ).toEqual(["https://example.com/code，", "https://example.com/fence,\n"]);
      expect(root.querySelector("li")?.textContent).toBe(
        "https://example.com/list，"
      );
      expect(root.querySelector("td")?.textContent).toBe(
        "https://example.com/table。"
      );
    });

    it("keeps URL-looking labels inside explicit links unchanged", () => {
      const content =
        "[https://example.com/label，](https://example.com/target)";
      const root = render(<MarkdownContent content={content} {...props} />);
      expect(hrefs(root)).toEqual(["https://example.com/target"]);
      expect(root.querySelector("a")?.textContent).toBe(
        "https://example.com/label，"
      );
    });
  }
);

describe("shared message link consumers", () => {
  it("trims links correctly after the math escape-mask pass", () => {
    const root = render(
      <MarkdownContent
        content={"$50\\% \\times x^2$ https://example.com/a，"}
      />
    );
    expect(root.querySelector(".katex")).not.toBeNull();
    expect(hrefs(root)).toEqual(["https://example.com/a"]);
    expect(root.querySelector("a")?.nextSibling?.textContent).toBe("，");
  });

  it("uses the same boundaries in rich-text blocks and reply previews", () => {
    const url = "https://example.com/wiki/Foo_(bar)";
    const content = `${urls[0]},\n(${url})。\n${urls[2]}`;
    const richText = render(
      <MixedContent blocks={[{ id: "text", type: "text", content }]} />
    );
    const reply = render(<ReplyBlock fromName="Alice" digest={content} />);
    expect(hrefs(richText)).toEqual([urls[0], url, urls[2]]);
    expect(hrefs(reply)).toEqual([urls[0], url, urls[2]]);
    expect(richText.textContent).toBe(content);
    expect(reply.querySelector(".wk-reply-block__digest")?.textContent).toBe(
      content
    );
  });

  it("preserves mention handling next to an automatic link", () => {
    const content = "@Alice https://example.com/a，";
    const root = render(
      <MarkdownContent
        content={content}
        mentions={[{ name: "@Alice", uid: "alice" }]}
      />
    );
    expect(hrefs(root)).toEqual(["https://example.com/a"]);
    expect(root.textContent).toBe(content);
  });
});
