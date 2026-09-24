# Conversation image gallery

`collectGalleryImages` converts already ordered, visibility-filtered ordinary image messages and RichText (type 14) image blocks into image slides. Rich-text images retain their original block positions, so empty blocks and repeated URLs do not change click identity. The caller owns channel/Space filtering and URL resolution; the collector excludes unavailable live transfers, revoked/deleted messages, and burn-after-reading images. Forwarded archives use their own message order and do not have live delivery status.

`ImageGalleryProvider` owns one viewer for one scope. Message renderers call `ImageGalleryContext.openImage` with an `imageGalleryKey`. Opening freezes the selected image set; subsequent message updates can remove invalid images but cannot append or reorder the open selection. Removing the current image closes it. The shared viewer owns keyboard navigation, zoom, rotation, copying, and downloading.

The conversation integration uses `vm.messages`, **not** `vm.messagesOfOrigin`, because the former has already applied Space filtering. Each merge-forward navigation level has its own provider. The provider is independent of message-row mounting, and no singleton/event bus is used for opening a gallery.

Rich-text integration and verification: [implementation note](../../../../../docs/implementation-notes/richtext-image-gallery.md). Markdown text-message images, file attachments, and standalone GIF messages are outside the gallery scope.

Original scope and verification: [implementation note](../../../../../docs/implementation-notes/1661-conversation-image-gallery.md).
