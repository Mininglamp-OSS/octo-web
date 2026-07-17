import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { useEditor, EditorContent, Extension, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { useI18n } from "@octo/base";
import type { AssigneeCandidate } from "../api/types";
import { buildLoopMention, mentionToToken } from "./mentionExtension";
import "./composer.css";

export interface CommentComposerHandle {
  clear: () => void;
}

interface CommentComposerProps {
  candidates: AssigneeCandidate[];
  placeholder: string;
  onChange: (markdown: string) => void;
  onSubmit: () => void;
  // reply: Enter submits, Shift+Enter = newline. new comment: only Mod/Ctrl+Enter submits.
  submitOnEnter?: boolean;
  disabled?: boolean;
  // focus the editor on mount (used when a reply box is lazily mounted on click).
  autoFocus?: boolean;
  // rendered inside the composer card's bottom bar (left = trigger chips, right = attach/send).
  footerLeft?: React.ReactNode;
  footerRight?: React.ReactNode;
}

// Serialize the doc to the markdown the backend expects: mentions become the
// contract token, everything else is plain text (markdown authored as text).
function toMarkdown(editor: Editor): string {
  return editor
    .getText({
      blockSeparator: "\n",
      textSerializers: {
        mention: ({ node }) => mentionToToken(node.attrs as { id: string; label: string; type: string }),
      },
    })
    .trim();
}

const CommentComposer = forwardRef<CommentComposerHandle, CommentComposerProps>(function CommentComposer(
  { candidates, placeholder, onChange, onSubmit, submitOnEnter, disabled, autoFocus, footerLeft, footerRight },
  ref,
) {
  const candidatesRef = useRef(candidates);
  candidatesRef.current = candidates;
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;
  const submitOnEnterRef = useRef(submitOnEnter);
  submitOnEnterRef.current = submitOnEnter;
  const { t } = useI18n();
  const labels = useMemo(
    () => ({
      users: t("loop.mention.groupUsers"),
      issues: t("loop.mention.groupIssues"),
      allMembers: t("loop.mention.allMembers"),
      agent: t("loop.assignee.agent"),
      squad: t("loop.assignee.squad"),
    }),
    [t],
  );

  const extensions = useMemo(
    () => [
      // Marks / block input-rules disabled: this is a markdown *source* box, so typed
      // "**x**" / "## x" must stay literal text (LoopMarkdown renders them), not auto-format
      // into nodes that getText() would flatten and lose.
      StarterKit.configure({
        bold: false, italic: false, strike: false, code: false, codeBlock: false,
        heading: false, blockquote: false, bulletList: false, orderedList: false,
        listItem: false, horizontalRule: false,
      }),
      Placeholder.configure({ placeholder }),
      buildLoopMention(() => candidatesRef.current, labels),
      Extension.create({
        name: "loopSubmit",
        // When the mention popup is open its plugin consumes Enter first (returns true),
        // so these only fire for a real submit.
        addKeyboardShortcuts() {
          return {
            "Mod-Enter": () => { onSubmitRef.current(); return true; },
            Enter: () => {
              if (!submitOnEnterRef.current) return false;
              onSubmitRef.current();
              return true;
            },
          };
        },
      }),
    ],
    // Built once: candidates + submit are ref-forwarded; buildLoopMention (which fetches
    // agent status) must NOT re-run per render, so keep this dep list empty.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const editor = useEditor(
    {
      editable: !disabled,
      autofocus: autoFocus ? "end" : false,
      extensions,
      onUpdate: ({ editor }) => onChange(toMarkdown(editor)),
    },
    [],
  );

  useImperativeHandle(ref, () => ({
    clear: () => editor?.commands.clearContent(),
  }), [editor]);

  useEffect(() => { editor?.setEditable(!disabled); }, [disabled, editor]);

  return (
    <div className="loop-composer">
      <EditorContent editor={editor} className="loop-composer__editor" />
      {(footerLeft || footerRight) && (
        <div className="loop-composer__footer">
          <span className="loop-composer__footer-left">{footerLeft}</span>
          <span className="loop-composer__footer-right">{footerRight}</span>
        </div>
      )}
    </div>
  );
});

export default CommentComposer;
