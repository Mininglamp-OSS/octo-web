import { MediaMessageContent } from "wukongimjssdk";
import { MessageContentTypeConst } from "../../Service/Const";
import { t } from "../../i18n";

export class ImageContent extends MediaMessageContent {
  width!: number;
  height!: number;
  url!: string;
  imgData?: string;
  caption?: string;
  mentionUids?: string[];
  name?: string;

  constructor(
    file?: File,
    imgData?: string,
    width?: number,
    height?: number,
    caption?: string,
    mentionUids?: string[],
  ) {
    super();
    this.file = file;
    this.imgData = imgData;
    this.width = width || 0;
    this.height = height || 0;
    this.caption = caption;
    this.mentionUids = mentionUids;
    if (file) this.name = file.name;
  }

  decodeJSON(content: any) {
    this.width = content["width"] || 0;
    this.height = content["height"] || 0;
    this.url = content["url"] || "";
    this.caption = content["caption"] || "";
    this.mentionUids = content["mention_uids"] || [];
    this.name = content["name"] || undefined;
    this.remoteUrl = this.url;
  }

  encodeJSON() {
    const json: Record<string, unknown> = {
      width: this.width || 0,
      height: this.height || 0,
      url: this.remoteUrl || "",
    };
    if (this.caption) json["caption"] = this.caption;
    if (this.mentionUids && this.mentionUids.length > 0) {
      json["mention_uids"] = this.mentionUids;
    }
    if (this.name) json["name"] = this.name;
    return json;
  }

  get contentType() {
    return MessageContentTypeConst.image;
  }

  get conversationDigest() {
    return t("base.message.digest.image");
  }
}
