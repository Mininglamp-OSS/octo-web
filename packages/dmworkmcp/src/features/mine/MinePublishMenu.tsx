import React, { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  Plug,
  Sparkles,
  Upload,
  UserRound,
  Users,
} from "lucide-react";
import { Toast } from "@douyinfe/semi-ui";
import { Dap, t, useI18n, WKApp, WKButton } from "@octo/base";
import {
  BotPublishModal,
  getCategories,
  NewSkillModal,
  type Category,
} from "@dmwork/skillmarket";
import ExpertBotPublishModal from "../../components/ExpertBotPublishModal";
import McpBotPublishModal from "../../components/McpBotPublishModal";
import McpCreateModal from "../../components/McpCreateModal";

type PublishFlow =
  | "skill-bot"
  | "skill-manual"
  | "connector-bot"
  | "connector-manual"
  | "expert-bot"
  | "squad-bot"
  | null;

interface MinePublishMenuProps {
  onChanged: () => void;
}

/** The single publish entry owned by MyAssetsPage. It stays mounted while the
 * user moves between type tabs, and delegates to the same authoring modals the
 * individual market pages use. */
export default function MinePublishMenu({ onChanged }: MinePublishMenuProps) {
  useI18n();
  const [open, setOpen] = useState(false);
  const [flow, setFlow] = useState<PublishFlow>(null);
  const [skillCategories, setSkillCategories] = useState<Category[]>([]);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectionRequestRef = useRef(0);

  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  useEffect(() => {
    const closeForSpace = () => {
      selectionRequestRef.current += 1;
      setOpen(false);
      setFlow(null);
      setSkillCategories([]);
    };
    WKApp.mittBus.on("space-changed", closeForSpace);
    return () => {
      selectionRequestRef.current += 1;
      WKApp.mittBus.off("space-changed", closeForSpace);
    };
  }, []);

  const choose = async (next: Exclude<PublishFlow, null>) => {
    // Every selection invalidates any earlier async selection. Otherwise a slow
    // Skill category request can resolve after the user chose another flow and
    // replace the modal they are already using.
    const request = ++selectionRequestRef.current;
    setOpen(false);
    if (next === "skill-manual" && skillCategories.length === 0) {
      try {
        const categories = await getCategories();
        if (request !== selectionRequestRef.current) return;
        setSkillCategories(categories);
      } catch (error) {
        if (request !== selectionRequestRef.current) return;
        Toast.error(
          error instanceof Error
            ? error.message
            : t("skillMarket.common.loadFailed")
        );
        return;
      }
    }
    if (request !== selectionRequestRef.current) return;
    if (next === "skill-manual") {
      Dap.shared.track("market_manual_publish_dialog_opened", {
        market_type: "skill",
      });
    }
    if (next === "connector-manual") {
      Dap.shared.track("market_manual_publish_dialog_opened", {
        market_type: "mcp",
      });
    }
    setFlow(next);
  };

  const items: Array<{
    flow: Exclude<PublishFlow, null>;
    icon: React.ReactNode;
    titleKey: string;
    hintKey: string;
  }> = [
    {
      flow: "skill-bot",
      icon: <Sparkles size={16} aria-hidden="true" />,
      titleKey: "mcp.mine.publishSkillBot",
      hintKey: "mcp.mine.publishSkillBotHint",
    },
    {
      flow: "skill-manual",
      icon: <Upload size={16} aria-hidden="true" />,
      titleKey: "mcp.mine.publishSkillManual",
      hintKey: "mcp.mine.publishSkillManualHint",
    },
    {
      flow: "connector-bot",
      icon: <Plug size={16} aria-hidden="true" />,
      titleKey: "mcp.mine.publishConnectorBot",
      hintKey: "mcp.mine.publishConnectorBotHint",
    },
    {
      flow: "connector-manual",
      icon: <Upload size={16} aria-hidden="true" />,
      titleKey: "mcp.mine.publishConnectorManual",
      hintKey: "mcp.mine.publishConnectorManualHint",
    },
    {
      flow: "expert-bot",
      icon: <UserRound size={16} aria-hidden="true" />,
      titleKey: "mcp.mine.publishExpertBot",
      hintKey: "mcp.mine.publishExpertBotHint",
    },
    {
      flow: "squad-bot",
      icon: <Users size={16} aria-hidden="true" />,
      titleKey: "mcp.mine.publishSquadBot",
      hintKey: "mcp.mine.publishSquadBotHint",
    },
  ];

  return (
    <>
      <div className="wk-mcp-mine-publish" ref={rootRef}>
        <WKButton
          variant="primary"
          data-testid="mine-publish-entry"
          icon={<Upload size={15} aria-hidden="true" />}
          onClick={() => setOpen((value) => !value)}
          aria-haspopup="menu"
          aria-expanded={open}
        >
          {t("mcp.mine.publish")}
          <ChevronDown size={14} aria-hidden="true" />
        </WKButton>
        {open && (
          <div
            className="wk-mcp-mine-publish__panel"
            role="menu"
            aria-label={t("mcp.mine.publishMenuAriaLabel")}
          >
            {items.map((item) => (
              <button
                key={item.flow}
                type="button"
                role="menuitem"
                data-testid={`mine-publish-${item.flow}`}
                onClick={() => void choose(item.flow)}
              >
                {item.icon}
                <span>
                  <strong>{t(item.titleKey)}</strong>
                  <small>{t(item.hintKey)}</small>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <BotPublishModal
        visible={flow === "skill-bot"}
        onClose={() => setFlow(null)}
      />
      <NewSkillModal
        visible={flow === "skill-manual"}
        categories={skillCategories}
        onClose={() => setFlow(null)}
        onCreated={(message) => {
          Toast.success(message ?? t("skillMarket.list.created"));
          onChanged();
          setFlow(null);
        }}
      />
      <McpBotPublishModal
        visible={flow === "connector-bot"}
        onClose={() => setFlow(null)}
      />
      <McpCreateModal
        visible={flow === "connector-manual"}
        onClose={() => setFlow(null)}
        onSaved={() => {
          onChanged();
          setFlow(null);
        }}
        onPublished={(message) => {
          Toast.success(message);
          onChanged();
          setFlow(null);
        }}
      />
      <ExpertBotPublishModal
        visible={flow === "expert-bot" || flow === "squad-bot"}
        kind={flow === "squad-bot" ? "squad" : "agent"}
        mode="create"
        onClose={() => setFlow(null)}
        onToast={(message) => Toast.success(message)}
      />
    </>
  );
}
