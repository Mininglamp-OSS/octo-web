import { splitTrailingUrlPunctuation } from "../../Utils/linkify";
import { isSafeUrl } from "../../Utils/security";

// Only the mdast fields used here; no additional parser dependency is needed.
interface MarkdownNode {
  type: string;
  value?: string;
  url?: string;
  children?: MarkdownNode[];
  position?: {
    start: { offset?: number };
    end: { offset?: number };
  };
}

function splitAutolink(node: MarkdownNode, source: string) {
  if (node.type !== "link" || node.children?.length !== 1) return;
  const label = node.children[0];
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (
    label.type !== "text" ||
    typeof label.value !== "string" ||
    typeof node.url !== "string" ||
    typeof start !== "number" ||
    typeof end !== "number"
  )
    return;

  // Source syntax distinguishes bare URLs from [label](url), <url> and
  // references. Require an exact match so escaped/entity text, synthetic
  // nodes and author-specified destinations are never guessed or rewritten.
  const raw = source.slice(start, end);
  if (
    !/^(?:https?:\/\/|www\.)/i.test(raw) ||
    raw !== label.value ||
    (node.url !== raw && node.url !== `http://${raw}`)
  )
    return;

  const { linkText, trailingText } = splitTrailingUrlPunctuation(raw);
  if (!trailingText) return;
  const url = node.url.slice(0, -trailingText.length);
  if (!isSafeUrl(url)) return;

  return [
    { ...node, url, children: [{ ...label, value: linkText }] },
    { type: "text", value: trailingText },
  ];
}

/** Apply chat punctuation boundaries after Markdown/math parsing has finished. */
export default function remarkAutolinkPunctuation() {
  return (
    tree: MarkdownNode,
    file: { value?: unknown; data?: { mathScanSource?: unknown } }
  ) => {
    // escapeMaskPlugin may reparse a shorter source (e.g. \\% becomes one
    // sentinel). Positions then refer to that source, not the original input.
    // Autolink ranges are excluded from masking, so their text remains exact.
    const source = file.data?.mathScanSource ?? file.value;
    if (typeof source !== "string") return;
    const visit = (node: MarkdownNode) => {
      // Explicit links (including their labels) and code remain untouched.
      if (
        node.type === "link" ||
        node.type === "linkReference" ||
        node.type === "code" ||
        node.type === "inlineCode" ||
        !node.children
      )
        return;
      node.children = node.children.flatMap((child) => {
        const split = splitAutolink(child, source);
        if (split) return split;
        visit(child);
        return [child];
      });
    };
    visit(tree);
  };
}
