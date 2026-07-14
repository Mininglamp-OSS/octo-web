// @octo/loop — 附件 API(上传走后端 /api/upload-file,multipart)。
import type { Attachment } from "./types";
import { httpPost } from "./http";

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
