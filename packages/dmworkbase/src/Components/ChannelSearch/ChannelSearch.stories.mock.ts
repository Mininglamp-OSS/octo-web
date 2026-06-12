import type {
  ChannelSearchDataSource,
  ChannelSearchItem,
  ChannelSearchQuery,
  ChannelSearchSender,
  ChannelSearchTab,
} from "./types";

const toSeconds = (value: string) =>
  Math.floor(new Date(value).getTime() / 1000);

const figmaMediaThumbs = [
  new URL("./assets/figma-media-01.png", import.meta.url).href,
  new URL("./assets/figma-media-02.png", import.meta.url).href,
  new URL("./assets/figma-media-03.png", import.meta.url).href,
  new URL("./assets/figma-media-04.png", import.meta.url).href,
  new URL("./assets/figma-media-05.png", import.meta.url).href,
  new URL("./assets/figma-media-06.png", import.meta.url).href,
  new URL("./assets/figma-media-07.png", import.meta.url).href,
  new URL("./assets/figma-media-08.png", import.meta.url).href,
];

const figmaPdfIcon = new URL("./assets/figma-file-pdf.png", import.meta.url)
  .href;
const figmaMdIcon = new URL("./assets/figma-file-md.png", import.meta.url).href;
const figmaInlineImage = new URL(
  "./assets/figma-inline-image-01.png",
  import.meta.url
).href;
const figmaInlineVideo = new URL(
  "./assets/figma-inline-video-01.png",
  import.meta.url
).href;
const figmaAvatarLiubo = new URL(
  "./assets/figma-avatar-liubo.png",
  import.meta.url
).href;
const figmaAvatarLiuhaier = new URL(
  "./assets/figma-avatar-liuhaier.png",
  import.meta.url
).href;
const figmaAvatarLiuba = new URL(
  "./assets/figma-avatar-liuba.png",
  import.meta.url
).href;

export const mockChannelSearchSenders: ChannelSearchSender[] = [
  { uid: "liubo", name: "刘波", avatarUrl: figmaAvatarLiubo },
  { uid: "liuhaier", name: "刘海儿", avatarUrl: figmaAvatarLiuhaier },
  { uid: "liuba", name: "刘疤", avatarUrl: figmaAvatarLiuba },
  { uid: "zhangxingchao", name: "张兴朝", avatarUrl: figmaAvatarLiuhaier },
  { uid: "lilei", name: "李磊", avatarUrl: figmaAvatarLiubo },
  { uid: "litian", name: "李天天", avatarUrl: figmaAvatarLiuhaier },
  { uid: "wangduoyu", name: "王多鱼在哪里", avatarUrl: figmaAvatarLiuba },
  {
    uid: "jokequeen",
    name: "冷笑话女王是1章章...",
    avatarUrl: figmaAvatarLiuhaier,
  },
  { uid: "director", name: "大导演", avatarUrl: figmaAvatarLiubo },
  { uid: "zhanghui", name: "张慧", avatarUrl: figmaAvatarLiuba },
];

export const mockChannelSearchItems: ChannelSearchItem[] = [
  {
    id: "msg-1",
    messageId: "m-61001",
    messageSeq: 61001,
    senderUid: "liubo",
    timestamp: toSeconds("2026-06-03T15:06:00+08:00"),
    kind: "text",
    text: "哈哈哈哈哈哈有趣有趣",
  },
  {
    id: "msg-2",
    messageId: "m-61002",
    messageSeq: 61002,
    senderUid: "liuhaier",
    timestamp: toSeconds("2026-06-03T15:05:00+08:00"),
    kind: "image",
    media: {
      thumbUrl: figmaMediaThumbs[0],
      inlineThumbUrl: figmaInlineImage,
      tone: "cool",
    },
  },
  {
    id: "msg-11",
    messageId: "m-61011",
    messageSeq: 61011,
    senderUid: "liubo",
    timestamp: toSeconds("2026-06-01T15:04:30+08:00"),
    kind: "image",
    media: {
      thumbUrl: figmaMediaThumbs[5],
      tone: "warm",
    },
  },
  {
    id: "msg-12",
    messageId: "m-61012",
    messageSeq: 61012,
    senderUid: "zhangxingchao",
    timestamp: toSeconds("2026-06-01T15:04:10+08:00"),
    kind: "video",
    media: {
      thumbUrl: figmaMediaThumbs[6],
      duration: 62,
      tone: "purple",
    },
  },
  {
    id: "msg-3",
    messageId: "m-61003",
    messageSeq: 61003,
    senderUid: "liuba",
    timestamp: toSeconds("2026-06-03T15:04:00+08:00"),
    kind: "text",
    text: "哈哈哈哈哈哈哈哈哈哈哈哈很好看，哈哈太好看了很好看",
  },
  {
    id: "msg-4",
    messageId: "m-61004",
    messageSeq: 61004,
    senderUid: "liuhaier",
    timestamp: toSeconds("2026-06-03T15:03:00+08:00"),
    kind: "file",
    file: {
      name: "一个名叫哈哈帮的文件.pdf",
      size: 2411724,
      iconUrl: figmaPdfIcon,
      url: "",
    },
  },
  {
    id: "msg-5",
    messageId: "m-61005",
    messageSeq: 61005,
    senderUid: "liuhaier",
    timestamp: toSeconds("2026-06-02T18:10:00+08:00"),
    kind: "video",
    media: {
      thumbUrl: figmaMediaThumbs[1],
      inlineThumbUrl: figmaInlineVideo,
      duration: 46,
      tone: "orange",
    },
  },
  {
    id: "msg-6",
    messageId: "m-61006",
    messageSeq: 61006,
    senderUid: "liuba",
    timestamp: toSeconds("2026-06-02T14:20:00+08:00"),
    kind: "merge_forward",
    matchReason: "转发聊天记录含“哈哈”",
    forward: {
      title: "牛爷爷和噜噜的聊天记录",
      snippets: [
        "牛爷爷：👌好的，需求 1 和 3 我觉得优先级高。",
        "噜噜：[图片]",
        "噜噜：先帮忙分析一下 Thread 功能的技术可行性🙏🙏？",
        "牛爷爷：[视频]",
      ],
    },
  },
  {
    id: "msg-7",
    messageId: "m-61007",
    messageSeq: 61007,
    senderUid: "zhangxingchao",
    timestamp: toSeconds("2026-06-01T10:24:00+08:00"),
    kind: "image",
    media: {
      thumbUrl: figmaMediaThumbs[2],
      tone: "green",
    },
  },
  {
    id: "msg-8",
    messageId: "m-61008",
    messageSeq: 61008,
    senderUid: "liubo",
    timestamp: toSeconds("2026-06-01T09:46:00+08:00"),
    kind: "video",
    media: {
      thumbUrl: figmaMediaThumbs[3],
      duration: 88,
      tone: "purple",
    },
  },
  {
    id: "msg-9",
    messageId: "m-61009",
    messageSeq: 61009,
    senderUid: "liuhaier",
    timestamp: toSeconds("2026-05-02T16:32:00+08:00"),
    kind: "file",
    file: {
      name: "文件名称文件名称文件名称.md",
      size: 2411724,
      iconUrl: figmaMdIcon,
      url: "",
    },
  },
  {
    id: "msg-13",
    messageId: "m-61013",
    messageSeq: 61013,
    senderUid: "liubo",
    timestamp: toSeconds("2026-05-01T11:18:00+08:00"),
    kind: "image",
    media: {
      thumbUrl: figmaMediaThumbs[7],
      tone: "cool",
    },
  },
  {
    id: "msg-14",
    messageId: "m-61014",
    messageSeq: 61014,
    senderUid: "liuhaier",
    timestamp: toSeconds("2026-05-20T16:30:00+08:00"),
    kind: "video",
    media: {
      thumbUrl: figmaMediaThumbs[1],
      duration: 38,
      tone: "orange",
    },
  },
  {
    id: "msg-15",
    messageId: "m-61015",
    messageSeq: 61015,
    senderUid: "liubo",
    timestamp: toSeconds("2026-05-12T13:10:00+08:00"),
    kind: "image",
    media: {
      thumbUrl: figmaMediaThumbs[2],
      tone: "green",
    },
  },
  {
    id: "msg-16",
    messageId: "m-61016",
    messageSeq: 61016,
    senderUid: "liuba",
    timestamp: toSeconds("2026-05-06T19:12:00+08:00"),
    kind: "image",
    media: {
      thumbUrl: figmaMediaThumbs[3],
      tone: "purple",
    },
  },
  {
    id: "msg-10",
    messageId: "m-61010",
    messageSeq: 61010,
    senderUid: "liuba",
    timestamp: toSeconds("2026-04-18T12:00:00+08:00"),
    kind: "image",
    media: {
      thumbUrl: figmaMediaThumbs[4],
      tone: "warm",
    },
  },
];

const tabKinds: Record<ChannelSearchTab, ChannelSearchItem["kind"][]> = {
  all: ["text", "file", "merge_forward"],
  message: ["text", "merge_forward"],
  media: ["image", "video"],
  file: ["file"],
};

const containsKeyword = (value: string | undefined, keyword: string) => {
  if (!keyword.trim()) return true;
  return (value || "").toLowerCase().includes(keyword.trim().toLowerCase());
};

const itemMatchesKeyword = (item: ChannelSearchItem, keyword: string) => {
  if (!keyword.trim()) return true;
  if (item.kind === "image" || item.kind === "video") return true;
  return [
    item.text,
    item.matchReason,
    item.file?.name,
    item.forward?.title,
    ...(item.forward?.snippets || []),
  ].some((value) => containsKeyword(value, keyword));
};

const itemMatchesDate = (
  item: ChannelSearchItem,
  query: ChannelSearchQuery
) => {
  const { startAt, endAt } = query.filters;
  if (startAt && item.timestamp < startAt) return false;
  if (endAt && item.timestamp > endAt) return false;
  return true;
};

export const mockChannelSearchDataSource: ChannelSearchDataSource = {
  getSenders: () => mockChannelSearchSenders,
  getSender: (uid) =>
    mockChannelSearchSenders.find((sender) => sender.uid === uid) || {
      uid,
      name: uid,
    },
  searchMessages: async (query) => {
    const senderFilter = new Set(query.filters.senderUids);
    const filtered = mockChannelSearchItems
      .filter((item) => tabKinds[query.tab].includes(item.kind))
      .filter((item) =>
        senderFilter.size > 0 ? senderFilter.has(item.senderUid) : true
      )
      .filter((item) => itemMatchesDate(item, query))
      .filter((item) =>
        query.tab === "media" ? true : itemMatchesKeyword(item, query.keyword)
      )
      .sort((left, right) =>
        query.filters.sort === "time_asc"
          ? left.timestamp - right.timestamp
          : right.timestamp - left.timestamp
      );

    const limit = Math.max(query.limit, 1);
    const offset = query.cursor ? Number(query.cursor) || 0 : 0;
    const items = filtered.slice(offset, offset + limit);
    const nextOffset = offset + items.length;

    await new Promise((resolve) => setTimeout(resolve, 120));

    return {
      items,
      nextCursor: nextOffset < filtered.length ? String(nextOffset) : undefined,
      hasMore: nextOffset < filtered.length,
    };
  },
};
