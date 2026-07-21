# C25 · loop 评论发送 (@edge)
详情底部 CommentComposer (tiptap) → 输入 → 点发送 aria-label="发送" → toast "评论已添加".
Mock: POST /issues/:id/comments (echo content) + POST comments/trigger-preview (agents:[]).
@edge tag: 非主流程 (tiptap 富编辑器涉及, 优先级低于 issue create/status 等).
