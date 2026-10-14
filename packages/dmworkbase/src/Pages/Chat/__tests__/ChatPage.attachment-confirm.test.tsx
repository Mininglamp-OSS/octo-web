// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("react-virtuoso", () => ({ TableVirtuoso: () => null, Virtuoso: () => null, VirtuosoGrid: () => null }));
import ChatPage from "../index";
import WKModal, { type WKModalProps } from "../../../Components/WKModal";
import { t } from "../../../i18n";

function findModal(node: React.ReactNode): WKModalProps | undefined {
  if (!React.isValidElement<{ children?: React.ReactNode }>(node)) return;
  if (node.type === WKModal && (node.props as WKModalProps).title === t("base.chatPage.unsentAttachmentTitle")) return node.props as WKModalProps;
  for (const child of React.Children.toArray(node.props.children)) {
    const result = findModal(child);
    if (result) return result;
  }
}
afterEach(() => vi.restoreAllMocks());

it.each([false, true])("locks confirmation during cleanup and ignores stale navigation=%s", async replaced => {
  const page = new ChatPage({});
  vi.spyOn(page, "setState").mockImplementation(next => {
    page.state = { ...page.state, ...(typeof next === "function" ? next(page.state, page.props) : next) };
  });
  const vm = { selectedConversation: undefined, showAddPopover: false, conversations: [], filteredConversations: [],
    loading: false, findConversation: () => undefined, clearMessages: vi.fn(), reloadRequestConversationList: vi.fn(), notifyListener: vi.fn() };
  page.vm = vm as typeof page.vm;
  const provider = page.render();
  const modal = () => findModal(provider.props.render(vm))!;
  let release!: () => void;
  const proceed = vi.fn(), discard = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
  page.state = { ...page.state, pendingConfirm: { onOk: proceed, discard } };
  const pending = modal().footerConfig!.onOk!();
  expect(modal().footerConfig).toMatchObject({ isOkLoading: true, isCancelDisabled: true });
  expect(modal().options).toMatchObject({ maskClosable: false, closeOnEsc: false });
  modal().onCancel(); await modal().footerConfig!.onOk!();
  expect(page.state.pendingConfirm).not.toBeNull();
  expect(discard).toHaveBeenCalledOnce();
  expect(proceed).not.toHaveBeenCalled();
  if (replaced) page.state = { ...page.state, pendingConfirm: null };
  release(); await pending;
  expect(proceed).toHaveBeenCalledTimes(replaced ? 0 : 1);
  expect(page.state.attachmentDiscardPending).toBe(false);
});
