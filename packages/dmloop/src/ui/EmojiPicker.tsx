import React, { useEffect, useRef } from "react";
import { useI18n } from "@octo/base";

/**
 * Emoji 选择器：包装开源 emoji-mart 的 vanilla Picker（set:"native"，纯系统字形、不下载图片、不碰 CDN）。
 * emoji-mart 与其数据都用动态 import 加载——Vite 会切成独立 chunk（~80KB gzip 数据 + ~33KB 库），
 * 首屏不加载，点开选择器时才拉本地 chunk。界面语言跟随 octo 的 useI18n().locale（zh 传中文 i18n，
 * 否则 emoji-mart 默认英文）；搜索关键词是 emoji-mart 自带的英文，故中文下可正常选、但需用英文词搜。
 */
export default function EmojiPicker({ onSelect }: { onSelect: (emoji: string) => void }) {
  const { locale } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    (async () => {
      const [emojiMart, dataMod, i18nMod] = await Promise.all([
        import("emoji-mart"),
        import("@emoji-mart/data"),
        locale.startsWith("zh")
          ? import("@emoji-mart/data/i18n/zh.json")
          : Promise.resolve(null),
      ]);
      if (cancelled || !container) return;
      const { Picker } = emojiMart as unknown as { Picker: new (opts: unknown) => Node };
      const picker = new Picker({
        data: (dataMod as { default: unknown }).default,
        i18n: i18nMod ? (i18nMod as { default: unknown }).default : undefined,
        onEmojiSelect: (e: { native: string }) => onSelectRef.current(e.native),
        theme: "auto",
        set: "native",
        previewPosition: "none",
        skinTonePosition: "search",
        maxFrequentRows: 2,
      });
      container.appendChild(picker);
    })();
    return () => {
      cancelled = true;
      container?.replaceChildren();
    };
  }, [locale]);

  return <div ref={containerRef} />;
}
