/**
 * @vitest-environment jsdom
 */

import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { fireEvent } from "@testing-library/dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    isBot: vi.fn(),
    showConversation: vi.fn(),
}));

// Render every data item directly — no viewport virtualization.
vi.mock("react-virtuoso", () => ({
    Virtuoso: ({ data, itemContent }: any) => (
        <div data-testid="virtuoso">
            {(data ?? []).map((item: any, i: number) => (
                <div key={i}>{itemContent(i, item)}</div>
            ))}
        </div>
    ),
}));

// BotDetailModal exposes a "发送消息" button (when visible) that fires onChat.
vi.mock("../../BotDetailModal", () => ({
    default: ({ visible, onChat }: any) =>
        visible ? (
            <button data-testid="bot-send" onClick={() => onChat({})}>
                发送消息
            </button>
        ) : null,
}));

// isBot is imported from ../WKAvatar in tab-contacts.tsx; keep WKAvatar/AiBadge light.
vi.mock("../../WKAvatar", () => ({
    isBot: mocks.isBot,
    default: () => <div data-testid="wk-avatar" />,
}));

vi.mock("../../AiBadge", () => ({
    default: () => <span data-testid="ai-badge">AI</span>,
}));

vi.mock("../../../App", () => ({
    default: {
        endpoints: {
            showConversation: mocks.showConversation,
        },
        shared: {
            avatarUser: vi.fn(() => "avatar.png"),
        },
    },
}));

vi.mock("wukongimjssdk", () => {
    class Channel {
        channelID: string;
        channelType: number;
        constructor(channelID: string, channelType: number) {
            this.channelID = channelID;
            this.channelType = channelType;
        }
    }
    return {
        default: {
            shared: () => ({
                channelManager: {
                    addListener: vi.fn(),
                    removeListener: vi.fn(),
                    getChannelInfo: vi.fn(() => undefined),
                    fetchChannelInfo: vi.fn(),
                },
            }),
        },
        Channel,
        ChannelTypePerson: 1,
    };
});

import TabContacts from "../tab-contacts";

const FRIEND = { channel_id: "bot-1", channel_name: "Bot One" };

let container: HTMLDivElement;

beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
});

afterEach(() => {
    act(() => {
        ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
});

function renderTab(props: any) {
    act(() => {
        ReactDOM.render(<TabContacts friends={[FRIEND]} {...props} />, container);
    });
}

function friendItem(): HTMLElement {
    // ItemContacts renders the name via dangerouslySetInnerHTML; find by text.
    const el = Array.from(container.querySelectorAll(".wk-item-contacts")).find(
        (node) => node.textContent?.includes("Bot One")
    );
    return el as HTMLElement;
}

describe("TabContacts #397 close outer GlobalSearch on bot send", () => {
    it("bot path: send message calls showConversation and onClose, not onClick", () => {
        mocks.isBot.mockReturnValue(true);
        const onClick = vi.fn();
        const onClose = vi.fn();

        renderTab({ onClick, onClose });

        // Click the friend item -> opens the bot detail card.
        act(() => {
            fireEvent.click(friendItem());
        });
        // Trigger the card's "发送消息".
        const sendBtn = container.querySelector(
            '[data-testid="bot-send"]'
        ) as HTMLElement;
        act(() => {
            fireEvent.click(sendBtn);
        });

        expect(mocks.showConversation).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(onClick).not.toHaveBeenCalled();
    });

    it("normal contact path: click calls onClick once and never onClose", () => {
        mocks.isBot.mockReturnValue(false);
        const onClick = vi.fn();
        const onClose = vi.fn();

        renderTab({ onClick, onClose });

        act(() => {
            fireEvent.click(friendItem());
        });

        expect(onClick).toHaveBeenCalledTimes(1);
        expect(onClose).not.toHaveBeenCalled();
    });
});
