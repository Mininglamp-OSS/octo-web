/**
 * Stable data-testid constants for Summary e2e tests.
 * Mirrors packages/dmworksummary/src/utils/testIds.ts — keep in sync.
 */
export const T = {
    // List page
    list: "summary-list",
    listContent: "summary-list-content",
    listSearch: "summary-list-search",
    listStatusFilter: "summary-list-status-filter",
    listCreate: "summary-list-create",
    createEntry: "summary-create-entry",

    // Card (per-task)
    card: (taskId: number) => `summary-card-${taskId}`,
    cardMenu: (taskId: number) => `summary-card-menu-${taskId}`,
    cardAcceptBtn: (taskId: number) => `summary-card-accept-${taskId}`,
    cardRejectBtn: (taskId: number) => `summary-card-reject-${taskId}`,

    // Create page
    create: "summary-create",
    createTopic: "summary-create-topic",
    createSelectChat: "summary-create-select-chat",
    createSelectMembers: "summary-create-select-members",
    createSubmit: "summary-create-submit",
    createAgentTab: "summary-create-agent-tab",
    createNormalTab: "summary-create-normal-tab",
    createPanelStartBtn: "summary-create-panel-start-btn",

    // Chat/member selector modal
    chatSelectorModal: "summary-chat-selector-modal",
    chatSelectorAllGroupsTab: "summary-chat-selector-all-groups-tab",
    chatSelectorConfirmBtn: "summary-chat-selector-confirm-btn",
    chatSelectorSearchInput: "summary-chat-selector-search-input",
    memberSelectorConfirmBtn: "summary-member-selector-confirm-btn",

    // Detail page
    detail: (taskId: number) => `summary-detail-${taskId}`,
    detailPage: "summary-detail-page",
    detailTitle: "summary-detail-title",
    detailRegenerateBtn: "summary-detail-regenerate-btn",
    detailRetryBtn: "summary-detail-retry-btn",
    detailDeleteBtn: "summary-detail-delete-btn",
    detailVersionTrigger: "summary-detail-version-trigger",
    detailContinueRefineBtn: "summary-detail-continue-refine-btn",
    detailEditBtn: "summary-detail-edit-btn",
    detailMembersSection: "summary-detail-members",
    detailMemberRow: (userId: string) => `summary-detail-member-row-${userId}`,
    detailMyPendingRow: "summary-detail-my-pending-row",
    detailSubmitMyBtn: "summary-detail-submit-my-btn",
    detailMyDraftEditBtn: "summary-detail-my-draft-edit-btn",

    // Inline editor footer
    editorSaveBtn: "summary-editor-save-btn",
    editorCancelBtn: "summary-editor-cancel-btn",
    editorTextarea: "summary-editor-textarea",

    // Regenerate modal
    regenerateInput: "summary-regenerate-input",
    regenerateSubmitBtn: "summary-regenerate-submit-btn",
    regenerateCancelBtn: "summary-regenerate-cancel-btn",
    regenerateModal: "summary-regenerate-modal",

    // Delete confirmation
    deleteConfirmOkBtn: "summary-delete-confirm-ok-btn",
    deleteConfirmDialog: "summary-delete-confirm-dialog",

    // Version panel
    versionPanel: "summary-version-panel",
    versionCard: (v: number | string) => `summary-version-card-${v}`,
    versionRestoreBtn: "summary-version-restore-btn",

    // Agent chat panel
    agentPanel: "summary-agent-panel",
    agentInput: "summary-agent-input",
    agentSendBtn: "summary-agent-send-btn",
    agentSaveBtn: "summary-agent-save-btn",
    agentNewSessionBtn: "summary-agent-new-session-btn",
    agentSaveDialog: "summary-agent-save-dialog",
    agentSaveTitleInput: "summary-agent-save-title-input",
    agentSaveConfirmBtn: "summary-agent-save-confirm-btn",
    agentRefEntry: "summary-agent-ref-entry",
    agentRefSearchInput: "summary-agent-ref-search-input",
    agentRefCard: "summary-agent-ref-card",
    agentRefRemoveBtn: "summary-agent-ref-remove-btn",
    agentRefSidePanel: "summary-agent-ref-side-panel",
    agentRefSideTitle: "summary-agent-ref-side-title",
    agentRefSideBody: "summary-agent-ref-side-body",
    agentRefSideCloseBtn: "summary-agent-ref-side-close-btn",

    // In-chat summary panel
    chatPanel: "summary-chat-panel",
    chatPanelHeaderBtn: "summary-chat-panel-header-btn",
    chatPanelDetailInPanel: "summary-chat-panel-detail",
    chatPanelStartBtn: "summary-chat-panel-start-btn",
    chatPanelTopicInput: "summary-chat-panel-topic-input",
    chatPanelBackBtn: "summary-chat-panel-back-btn",
} as const;
