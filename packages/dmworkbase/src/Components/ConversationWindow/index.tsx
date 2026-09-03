import React, {
  useCallback,
  useEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from "react";
import type { ChatClient } from "@octo/chat-core";
import {
  ChatProvider,
  ConversationWindow as ChatConversationBoundary,
  type ChatHostCapabilities,
} from "@octo/chat-react";
import classNames from "classnames";
import { Channel } from "wukongimjssdk";
import { Conversation, type ConversationProps } from "../Conversation";
import type ConversationContext from "../Conversation/context";
import { ErrorBoundary } from "../ErrorBoundary";
import { useI18n } from "../../i18n";
import "./index.css";

export type ConversationWindowMode = "primary" | "auxiliary";

export interface ConversationWindowHeaderModel {
  avatar?: ReactNode;
  title: ReactNode;
  titleClassName?: string;
  onBack?: () => void;
  actions?: ReactNode;
}

export interface ConversationWindowSelectionModel {
  active: boolean;
  count: number;
  label: ReactNode;
  cancelLabel: ReactNode;
  onCancel: () => void;
}

export interface ConversationWindowProps {
  client: ChatClient;
  channel: Channel;
  header: ConversationWindowHeaderModel;
  selection?: ConversationWindowSelectionModel;
  hostCapabilities?: ChatHostCapabilities;
  mode?: ConversationWindowMode;
  className?: string;
  style?: CSSProperties;
  surfaceRef?: Ref<HTMLDivElement>;
  inactive?: boolean;
  errorModuleName: string;
  bindConversationContext?: (context: ConversationContext) => () => void;
  conversationProps?: Omit<
    ConversationProps,
    "channel" | "isAuxiliary" | "shouldShowHistorySplit"
  >;
}

export interface ConversationSurfaceProps {
  client: ChatClient;
  channel: Channel;
  hostCapabilities?: ChatHostCapabilities;
  mode?: ConversationWindowMode;
  className?: string;
  style?: CSSProperties;
  errorModuleName: string;
  bindConversationContext?: (context: ConversationContext) => () => void;
  conversationProps?: Omit<
    ConversationProps,
    "channel" | "isAuxiliary" | "shouldShowHistorySplit"
  >;
}

interface ConversationSurfaceContentProps {
  channel: Channel;
  mode: ConversationWindowMode;
  errorModuleName: string;
  conversationProps?: ConversationSurfaceProps["conversationProps"];
  onContext: (context: ConversationContext) => void;
  onUnmount: () => void;
}

function ConversationSurfaceContent({
  channel,
  mode,
  errorModuleName,
  conversationProps,
  onContext,
  onUnmount,
}: ConversationSurfaceContentProps): JSX.Element {
  useEffect(() => () => onUnmount(), [onUnmount]);

  return (
    <ErrorBoundary
      key={`${channel.channelID}-${channel.channelType}`}
      moduleName={errorModuleName}
      onError={onUnmount}
    >
      <Conversation
        {...conversationProps}
        key={`${channel.channelID}-${channel.channelType}`}
        channel={channel}
        isAuxiliary={mode === "auxiliary"}
        shouldShowHistorySplit={mode !== "auxiliary"}
        onContext={onContext}
      />
    </ErrorBoundary>
  );
}

export function ConversationSurface({
  client,
  channel,
  hostCapabilities,
  mode = "primary",
  className,
  style,
  errorModuleName,
  bindConversationContext,
  conversationProps,
}: ConversationSurfaceProps): JSX.Element {
  const { t } = useI18n();
  const unbindConversationContextRef = useRef<(() => void) | undefined>();

  const releaseConversationContext = useCallback(() => {
    unbindConversationContextRef.current?.();
    unbindConversationContextRef.current = undefined;
  }, []);

  useEffect(() => releaseConversationContext, [releaseConversationContext]);

  const handleConversationContext = useCallback((context: ConversationContext) => {
    releaseConversationContext();
    unbindConversationContextRef.current = bindConversationContext?.(context);
    conversationProps?.onContext?.(context);
  }, [bindConversationContext, conversationProps?.onContext, releaseConversationContext]);

  return (
    <ChatProvider client={client} host={hostCapabilities}>
      <ChatConversationBoundary
        channel={{
          channelId: channel.channelID,
          channelType: channel.channelType,
        }}
        activate={mode === "primary"}
        className={classNames("wk-chat-conversation-surface", className)}
        style={style}
      >
        {({ error, retry }) => error ? (
          <div className="wk-chat-conversation-open-error" role="alert">
            <span>{t("base.conversation.openFailed")}</span>
            <button type="button" onClick={retry}>
              {t("base.conversation.retry")}
            </button>
          </div>
        ) : (
          <ConversationSurfaceContent
            channel={channel}
            mode={mode}
            errorModuleName={errorModuleName}
            conversationProps={conversationProps}
            onContext={handleConversationContext}
            onUnmount={releaseConversationContext}
          />
        )}
      </ChatConversationBoundary>
    </ChatProvider>
  );
}

export function ConversationWindow({
  client,
  channel,
  header,
  selection,
  hostCapabilities,
  mode = "primary",
  className,
  style,
  surfaceRef,
  inactive = false,
  errorModuleName,
  bindConversationContext,
  conversationProps,
}: ConversationWindowProps): JSX.Element {
  const selectionActive = selection?.active === true;
  const inertProps = inactive ? ({ inert: "" } as Record<string, string>) : {};

  return (
    <div
      ref={surfaceRef}
      className={classNames(
        "wk-chat-content-chat",
        "wk-chat-capability-window",
        selectionActive && "wk-chat-content-chat-selection",
        className
      )}
      style={style}
      aria-hidden={inactive || undefined}
      {...inertProps}
    >
      <div
        className={classNames(
          "wk-chat-conversation-header",
          selectionActive && "wk-chat-conversation-header-selection"
        )}
      >
        <div className="wk-chat-conversation-header-content">
          <div className="wk-chat-conversation-header-left">
            {selectionActive && selection ? (
              <div className="wk-chat-conversation-selection-header">
                <div className="wk-chat-conversation-selection-title">
                  {selection.label}
                </div>
              </div>
            ) : (
              <>
                {header.onBack && (
                  <button
                    type="button"
                    className="wk-chat-conversation-header-back"
                    aria-label="Back"
                    onClick={(event) => {
                      event.stopPropagation();
                      header.onBack?.();
                    }}
                  >
                    <span className="wk-chat-conversation-header-back-icon" />
                  </button>
                )}
                <div className="wk-chat-conversation-header-channel">
                  {header.avatar && (
                    <div className="wk-chat-conversation-header-channel-avatar">
                      {header.avatar}
                    </div>
                  )}
                  <div className="wk-chat-conversation-header-channel-info">
                    <div
                      className={classNames(
                        "wk-chat-conversation-header-channel-info-name",
                        header.titleClassName
                      )}
                    >
                      {header.title}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
          <div className="wk-chat-conversation-header-right">
            {selectionActive && selection ? (
              <button
                type="button"
                className="wk-chat-conversation-selection-cancel"
                onClick={(event) => {
                  event.stopPropagation();
                  selection.onCancel();
                }}
              >
                {selection.cancelLabel}
              </button>
            ) : (
              header.actions
            )}
          </div>
        </div>
      </div>
      <div className="wk-chat-conversation">
        <ConversationSurface
          client={client}
          channel={channel}
          hostCapabilities={hostCapabilities}
          mode={mode}
          errorModuleName={errorModuleName}
          bindConversationContext={bindConversationContext}
          conversationProps={conversationProps}
        />
      </div>
    </div>
  );
}

export default ConversationWindow;
