import APIClient from "./APIClient";
import { AttachmentError } from "../features/html-attachment/types";
import { httpAttachmentURL } from "../features/html-attachment/references";

const AttachmentFileService = {
  async getDownloadLink(
    path: string,
    filename: string,
    spaceId: string,
    signal?: AbortSignal
  ): Promise<string> {
    const result = await APIClient.shared.get("file/download/url", {
      param: { path, filename, disposition: "attachment" },
      headers: { "X-Space-Id": spaceId },
      signal,
      suppressAuthExpiredLogout: true,
    });
    if (typeof result?.url !== "string" || !/^https?:\/\//.test(result.url)) {
      throw new AttachmentError("downloadFailed");
    }
    return httpAttachmentURL(result.url);
  },
};

export default AttachmentFileService;
