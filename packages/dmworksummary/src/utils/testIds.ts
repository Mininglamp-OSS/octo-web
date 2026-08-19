export const summaryTestIds = {
    // ── List page ──
    list: "summary-list",
    listContent: "summary-list-content",
    listSearch: "summary-list-search",
    listStatusFilter: "summary-list-status-filter",
    listCreate: "summary-list-create",
    createEntry: "summary-create-entry",
    // Mode-select dropdown on the list-page "+" entry (trigger + menu items)
    listModeSwitch: "summary-list-mode-switch",
    listNormalTab: "summary-list-normal-tab",
    listAgentTab: "summary-list-agent-tab",

    // ── Card (per-task) ──
    card: (taskId: number) => `summary-card-${taskId}`,
    cardMenu: (taskId: number) => `summary-card-menu-${taskId}`,
    cardAcceptBtn: (taskId: number) => `summary-card-accept-${taskId}`,
    cardRejectBtn: (taskId: number) => `summary-card-reject-${taskId}`,

    // ── Create page ──
    create: "summary-create",
    createTopic: "summary-create-topic",
    createSelectChat: "summary-create-select-chat",
    createSelectMembers: "summary-create-select-members",
    createSubmit: "summary-create-submit",

    // ── Chat selector modal ──
    chatSelectorModal: "summary-chat-selector-modal",
    chatSelectorAllGroupsTab: "summary-chat-selector-all-groups-tab",
    chatSelectorConfirmBtn: "summary-chat-selector-confirm-btn",
    chatSelectorSearchInput: "summary-chat-selector-search-input",
    memberSelectorConfirmBtn: "summary-member-selector-confirm-btn",

    // ── Detail page ──
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

    // ── Editor footer (inline edit save/cancel) ──
    editorSaveBtn: "summary-editor-save-btn",
    editorCancelBtn: "summary-editor-cancel-btn",
    editorTextarea: "summary-editor-textarea",

    // ── Regenerate modal ──
    regenerateInput: "summary-regenerate-input",
    regenerateSubmitBtn: "summary-regenerate-submit-btn",
    regenerateCancelBtn: "summary-regenerate-cancel-btn",
    regenerateModal: "summary-regenerate-modal",

    // ── Delete confirmation ──
    deleteConfirmOkBtn: "summary-delete-confirm-ok-btn",
    deleteConfirmDialog: "summary-delete-confirm-dialog",

    // ── Version panel ──
    versionPanel: "summary-version-panel",
    versionCard: (versionNum: number | string) => `summary-version-card-${versionNum}`,
    versionRestoreBtn: "summary-version-restore-btn",

    // ── Agent chat panel (in create page / continue-refine) ──
    agentPanel: "summary-agent-panel",
    agentInput: "summary-agent-input",
    agentSendBtn: "summary-agent-send-btn",
    agentSaveBtn: "summary-agent-save-btn",
    agentNewSessionBtn: "summary-agent-new-session-btn",
    agentSaveDialog: "summary-agent-save-dialog",
    agentSaveTitleInput: "summary-agent-save-title-input",
    agentSaveConfirmBtn: "summary-agent-save-confirm-btn",
    // Reference picker entry + card (agent mode)
    agentRefEntry: "summary-agent-ref-entry",
    agentRefSearchInput: "summary-agent-ref-search-input",
    agentRefCard: "summary-agent-ref-card",
    agentRefRemoveBtn: "summary-agent-ref-remove-btn",
    agentRefSidePanel: "summary-agent-ref-side-panel",
    agentRefSideTitle: "summary-agent-ref-side-title",
    agentRefSideBody: "summary-agent-ref-side-body",
    agentRefSideCloseBtn: "summary-agent-ref-side-close-btn",

    // ── Chat summary panel (in-chat panel) ──
    chatPanel: "summary-chat-panel",
    chatPanelHeaderBtn: "summary-chat-panel-header-btn",
    chatPanelDetailInPanel: "summary-chat-panel-detail",
    chatPanelStartBtn: "summary-chat-panel-start-btn",
    chatPanelTopicInput: "summary-chat-panel-topic-input",
    chatPanelBackBtn: "summary-chat-panel-back-btn",
} as const;
