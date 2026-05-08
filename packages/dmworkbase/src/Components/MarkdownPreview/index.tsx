import React, { useState, useRef, useEffect, useMemo } from "react";
import { List } from "lucide-react";
import MarkdownContent from "../../Messages/Text/MarkdownContent";
import { extractTocItems, TocItem } from "../FilePreviewPanel/renderers/MarkdownToc";
import "./MarkdownPreview.css";

export interface MarkdownPreviewProps {
  /** Markdown 原始文本 */
  content: string;
  /** 是否默认展开目录（仅当目录存在时生效） */
  defaultTocOpen?: boolean;
}

/**
 * MarkdownPreview 组件
 * 
 * 功能：
 * - 渲染 Markdown 内容（复用 MarkdownContent）
 * - 当 h2 标题 ≥ 3 时，显示左侧目录
 * - 目录可点击跳转到对应标题
 * - 参考 NavRail 的侧边栏布局
 */
const MarkdownPreview: React.FC<MarkdownPreviewProps> = ({
  content,
  defaultTocOpen = true,
}) => {
  // 提取目录项
  const tocItems = useMemo(() => extractTocItems(content), [content]);
  const h2Count = tocItems.filter((item) => item.level === 2).length;
  const showToc = h2Count >= 3;

  const [isTocOpen, setIsTocOpen] = useState(defaultTocOpen && showToc);
  const contentRef = useRef<HTMLDivElement>(null);
  const [activeId, setActiveId] = useState<string | undefined>(undefined);

  // 点击目录项，滚动到对应标题
  const handleTocClick = (id: string) => {
    if (!contentRef.current) return;
    
    const heading = contentRef.current.querySelector(`[data-heading-id="${id}"]`);
    if (heading) {
      heading.scrollIntoView({ behavior: "smooth", block: "start" });
      setActiveId(id);
    }
  };

  // 监听滚动，更新当前激活的标题
  useEffect(() => {
    if (!showToc || !contentRef.current) return;

    const handleScroll = () => {
      if (!contentRef.current) return;

      const headings = Array.from(
        contentRef.current.querySelectorAll<HTMLElement>("[data-heading-id]")
      );

      // 找到当前视口中最靠近顶部的标题
      let currentId: string | undefined = undefined;
      const scrollTop = contentRef.current.scrollTop;
      const offset = 100; // 偏移量

      for (const heading of headings) {
        const rect = heading.getBoundingClientRect();
        const containerRect = contentRef.current.getBoundingClientRect();
        const relativeTop = rect.top - containerRect.top + scrollTop;

        if (relativeTop <= scrollTop + offset) {
          currentId = heading.dataset.headingId;
        } else {
          break;
        }
      }

      setActiveId(currentId);
    };

    const container = contentRef.current;
    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, [showToc, tocItems]);

  // 为 Markdown 内容添加标题 ID（用于锚点跳转）
  const contentWithIds = useMemo(() => {
    if (!showToc || tocItems.length === 0) return content;

    let result = content;
    tocItems.forEach((item) => {
      const regex = new RegExp(`^(#{${item.level}})\\s+${item.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'gm');
      result = result.replace(regex, (match, hashes) => {
        return `${match}\n<div data-heading-id="${item.id}" style="position: absolute; margin-top: -80px;"></div>`;
      });
    });

    return result;
  }, [content, showToc, tocItems]);

  return (
    <div className="wk-markdown-preview" data-testid="markdown-preview">
      {/* 左侧目录 */}
      {showToc && (
        <div className={`wk-markdown-preview__toc ${isTocOpen ? 'wk-markdown-preview__toc--open' : ''}`} data-testid="markdown-preview-toc">
          <div className="wk-markdown-preview__toc-header">
            <List size={14} />
            <span>目录</span>
            <button
              className="wk-markdown-preview__toc-toggle"
              onClick={() => setIsTocOpen(!isTocOpen)}
              aria-label={isTocOpen ? "收起目录" : "展开目录"}
              data-testid="toc-toggle-button"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d={isTocOpen ? "M15 18l-6-6 6-6" : "M9 18l6-6-6-6"} />
              </svg>
            </button>
          </div>

          {isTocOpen && (
            <nav className="wk-markdown-preview__toc-nav" data-testid="toc-nav">
              <ul className="wk-markdown-preview__toc-list">
                {tocItems.map((item) => (
                  <li
                    key={item.id}
                    className={`wk-markdown-preview__toc-item wk-markdown-preview__toc-item--h${item.level} ${
                      activeId === item.id ? 'wk-markdown-preview__toc-item--active' : ''
                    }`}
                    data-testid={`toc-item-${item.id}`}
                  >
                    <button
                      className="wk-markdown-preview__toc-link"
                      onClick={() => handleTocClick(item.id)}
                      title={item.text}
                    >
                      {item.text}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
          )}
        </div>
      )}

      {/* 右侧内容区 */}
      <div className="wk-markdown-preview__content" ref={contentRef} data-testid="markdown-preview-content">
        <MarkdownContent content={contentWithIds} enableMath={true} />
      </div>
    </div>
  );
};

export default MarkdownPreview;
