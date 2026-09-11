import { linkifySafeUrls } from "../../Utils/linkify";

// Only the mdast fields used here; no additional parser dependency is needed.
interface MarkdownNode {
  type: string;
  value?: string;
  url?: string;
  children?: MarkdownNode[];
  data?: { hProperties?: Record<string, unknown>; [key: string]: unknown };
  position?: {
    start: { offset?: number };
    end: { offset?: number };
  };
}

function markAutolink(node: MarkdownNode): MarkdownNode {
  return {
    ...node,
    data: {
      ...node.data,
      hProperties: { ...node.data?.hProperties, dataOctoAutolink: "true" },
    },
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

  // GFM can consume several URLs and intervening Chinese prose as one link.
  // Segment the entire candidate so links after a prose boundary survive too.
  const segments = linkifySafeUrls(raw);
  if (segments.length === 1 && segments[0].type === "link")
    return [markAutolink(node)];
  return segments.map((segment) => {
    if (segment.type === "text")
      return { type: "text", value: segment.content };
    return markAutolink({
      ...node,
      // Retain GFM's existing www scheme (plain-text consumers use https).
      url: /^www\./i.test(segment.text)
        ? `http://${segment.text}`
        : segment.href,
      children: [{ ...label, value: segment.text }],
    });
  });
}

/** Apply chat punctuation boundaries after Markdown/math parsing has finished. */
export default function remarkAutolinkPunctuation(
  options: { generatedLinks?: boolean } = {}
) {
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
        // Plain-text mode has already escaped the source and generated every
        // link through linkifySafeUrls. Preserve that provenance for copying.
        if (options.generatedLinks && child.type === "link")
          return [markAutolink(child)];
        const split = splitAutolink(child, source);
        if (split) return split;
        visit(child);
        return [child];
      });
    };
    visit(tree);
  };
}
