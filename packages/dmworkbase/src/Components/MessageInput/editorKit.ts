import StarterKit from "@tiptap/starter-kit";
import { isSafeUrl } from "../../Utils/security";

/** Plain composer schema that still preserves explicitly pasted HTML links. */
export function createComposerStarterKit() {
  return StarterKit.configure({
    bold: false,
    italic: false,
    code: false,
    heading: false,
    blockquote: false,
    horizontalRule: false,
    codeBlock: false,
    strike: false,
    link: {
      autolink: false,
      linkOnPaste: false,
      openOnClick: false,
      shouldAutoLink: () => false,
      isAllowedUri: (url) => isSafeUrl(url),
    },
  });
}
