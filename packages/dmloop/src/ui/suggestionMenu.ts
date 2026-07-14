// Dependency-free, keyboard-navigable @-mention popup for the comment composer:
// grouped sections (Users / Issues), type badges, issue title/status, avatars. No
// tippy/floating-ui/React so it's driven straight from the tiptap suggestion lifecycle.

export interface LoopMentionItem {
  id: string;
  label: string;
  type: "member" | "agent" | "squad" | "issue" | "all";
  description?: string;
  // real avatar URL for octo members (falls back to a letter circle when absent)
  avatarUrl?: string;
  // issue status color, drives the status-ring on issue rows
  statusHex?: string;
  // whether the issue status is a closed/terminal one (filled ring vs hollow)
  statusFilled?: boolean;
  // agent online-status dot color (agents only; absent = no dot)
  dotColor?: string;
}

export interface MentionMenuLabels {
  users: string;
  issues: string;
}

export interface MentionMenuProps {
  items: LoopMentionItem[];
  command: (item: LoopMentionItem) => void;
  clientRect?: (() => DOMRect | null) | null;
}

export interface MentionMenuRenderer {
  onStart: (props: MentionMenuProps) => void;
  onUpdate: (props: MentionMenuProps) => void;
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
  onExit: () => void;
}

function groupOf(item: LoopMentionItem): "users" | "issues" {
  return item.type === "issue" ? "issues" : "users";
}

export function createMentionMenu(labels: MentionMenuLabels): MentionMenuRenderer {
  let el: HTMLDivElement | null = null;
  let items: LoopMentionItem[] = [];
  let selected = 0;
  let cmd: ((item: LoopMentionItem) => void) | null = null;
  let closed = false;
  let onOutside: ((e: MouseEvent) => void) | null = null;

  function row(item: LoopMentionItem, idx: number): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "loop-suggest-item" + (idx === selected ? " is-selected" : "");

    const ava = document.createElement("span");
    ava.className = `loop-suggest-ava loop-suggest-ava--${item.type}`;
    if (item.type === "issue") {
      ava.classList.add("loop-suggest-ava--ring");
      if (item.statusHex) {
        ava.style.color = item.statusHex;
        if (item.statusFilled) ava.style.background = item.statusHex;
      }
    } else if (item.avatarUrl) {
      const img = document.createElement("img");
      img.className = "loop-suggest-ava-img";
      img.src = item.avatarUrl;
      img.alt = "";
      ava.appendChild(img);
    } else {
      ava.textContent = item.type === "all" ? "@" : (item.label[0] ?? "?").toUpperCase();
    }
    if (item.dotColor) {
      const dot = document.createElement("i");
      dot.className = "loop-suggest-dot";
      dot.style.background = item.dotColor;
      ava.appendChild(dot);
    }
    btn.appendChild(ava);

    const text = document.createElement("span");
    text.className = "loop-suggest-text";
    const name = document.createElement("span");
    name.className = "loop-suggest-name";
    name.textContent = item.label;
    text.appendChild(name);
    if (item.description) {
      const desc = document.createElement("span");
      desc.className = "loop-suggest-desc";
      desc.textContent = item.description;
      text.appendChild(desc);
    }
    btn.appendChild(text);

    if (item.type === "agent" || item.type === "squad") {
      const badge = document.createElement("span");
      badge.className = "loop-suggest-badge";
      badge.textContent = item.type === "agent" ? "Agent" : "Squad";
      btn.appendChild(badge);
    }

    btn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      cmd?.(item);
    });
    return btn;
  }

  function paint() {
    if (!el) return;
    el.innerHTML = "";
    let lastGroup = "";
    items.forEach((item, idx) => {
      const group = groupOf(item);
      if (group !== lastGroup) {
        const header = document.createElement("div");
        header.className = "loop-suggest-group";
        header.textContent = group === "issues" ? labels.issues : labels.users;
        el!.appendChild(header);
        lastGroup = group;
      }
      el!.appendChild(row(item, idx));
    });
  }

  function position(rect: DOMRect | null | undefined) {
    if (!el || !rect) return;
    el.style.position = "absolute";
    el.style.left = `${rect.left}px`;
    el.style.top = `${rect.bottom + 4}px`;
  }

  function destroy() {
    if (onOutside) {
      document.removeEventListener("mousedown", onOutside, true);
      onOutside = null;
    }
    el?.remove();
    el = null;
  }

  function mount() {
    if (el) return;
    el = document.createElement("div");
    el.className = "loop-mention-menu";
    document.body.appendChild(el);
    onOutside = (e) => {
      if (el && (!(e.target instanceof Node) || !el.contains(e.target))) {
        closed = true;
        destroy();
      }
    };
    document.addEventListener("mousedown", onOutside, true);
  }

  function sync(clientRect?: (() => DOMRect | null) | null) {
    if (closed) return;
    if (items.length === 0) {
      destroy();
      return;
    }
    mount();
    paint();
    position(clientRect?.());
  }

  return {
    onStart: (props) => {
      items = props.items;
      selected = 0;
      cmd = props.command;
      closed = false;
      sync(props.clientRect);
    },
    onUpdate: (props) => {
      items = props.items;
      cmd = props.command;
      selected = Math.min(selected, Math.max(0, items.length - 1));
      sync(props.clientRect);
    },
    onKeyDown: (props) => {
      const { key } = props.event;
      if (key === "Escape") {
        if (!el) return false;
        closed = true;
        destroy();
        return true;
      }
      if (!items.length || !el) return false;
      if (key === "ArrowDown") {
        selected = (selected + 1) % items.length;
        paint();
        return true;
      }
      if (key === "ArrowUp") {
        selected = (selected - 1 + items.length) % items.length;
        paint();
        return true;
      }
      if (key === "Enter") {
        cmd?.(items[selected]);
        return true;
      }
      return false;
    },
    onExit: () => {
      closed = false;
      destroy();
    },
  };
}
