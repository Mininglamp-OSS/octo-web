// @octo/loop — 附件 API(上传走后端 /api/upload-file,multipart)。
import type { Attachment } from "./types";
import { httpPost, httpGetBlob } from "./http";

// 上传单个文件。可选 issueId/commentId 在上传时直接绑定(需目标已存在);
// 否则拿返回的 id,通过 create/update issue|comment 的 attachment_ids 绑定(如新评论)。
// 走现成 http client:axios 对 FormData 自动设 multipart 边界,鉴权/workspace header 由拦截器注入。
export function uploadAttachment(
  file: File,
  opts?: { issueId?: string; commentId?: string },
): Promise<Attachment> {
  const form = new FormData();
  form.append("file", file);
  if (opts?.issueId) form.append("issue_id", opts.issueId);
  if (opts?.commentId) form.append("comment_id", opts.commentId);
  return httpPost<Attachment>("/upload-file", form);
}

// Fetch an attachment's bytes through the authenticated loop client. The
// download endpoint is auth-only, so it cannot be used as a native <img>/<a>
// src (those carry no auth headers). The loop client base is `/fleet/api/v1`,
// which the deployment's rewrite layer (nginx in prod, the vite proxy in dev)
// maps to the backend the same way it does for every other loop call — so this
// relative path resolves to the attachment endpoint with auth headers attached.
// Callers wrap the Blob in an object URL for <img>/<a> and revoke it when done.
export function fetchAttachmentBlob(id: string): Promise<Blob> {
  return httpGetBlob(`/attachments/${id}/download`);
}
