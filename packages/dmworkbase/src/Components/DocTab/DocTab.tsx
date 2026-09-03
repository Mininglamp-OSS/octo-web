/**
 * DocTab — OCT-138 Stage A 骨架
 *
 * 群 / 子区 / Space 详情页的"文档" tab：把 octo-docs-html 渲染的文档以
 * iframe 内嵌进来。Stage A 只交付可挂载的组件 + 加载空态；实际把它接到
 * 聊天详情面板由后续 UI 单负责（不侵入 Chat/index.tsx 的巨型组件）。
 *
 * 边界（务必）：
 *   - iframe src 必须由调用方拼装为 doc 服务的可访问 URL；组件不猜 origin，
 *     也不做 URL 编码之外的处理，避免误注入 slug/query。
 *   - sandbox 放开 allow-scripts + allow-same-origin + allow-forms + allow-popups：
 *     same-origin 是刚需（doc 页面 JS 通过同源 fetch 拿 HttpOnly capability cookie，
 *     见 octo-docs-html handlers_auth）；forms/popups 供后续文档内表单和新窗口分享用。
 *   - 明确不放 allow-top-navigation：防恶意 doc 用 top.location 劫持宿主 tab。
 *     vitest 里有反向断言锁住这一条，别顺手加。
 *   - Stage B（等 OCT-150 登录合入）再补 postMessage 传 X-Octo-Token；此处
 *     不埋 TODO 注释，见 issue comment。
 */
import React, { useRef, useState } from "react";
// 只引 i18n 叶子实例（instance.ts 仅依赖 I18nService + JSON，不触达 React /
// @douyinfe/semi-ui / lottie 重链），保持 DocTab 作为纯骨架叶子组件——与本仓
// "避免引入 lottie 链" 的既有约定一致，不污染 DocTab.test 的 import 图。
import { t } from "../../i18n/instance";
import { Loading } from "@octo/ui";

export interface DocTabProps {
  /** doc 服务渲染 URL，如 https://d.example.com/d/<slug>/v/1 或首页 /me。 */
  src?: string;
  /** 空态提示文本；调用方 i18n 后传入。 */
  emptyText?: string;
  /** 加载态提示文本。 */
  loadingText?: string;
  /** 附加类名。 */
  className?: string;
  /** 便于父组件测试探测的 title。 */
  title?: string;
}

/**
 * 文档 tab 面板：src 空 → 空态；否则挂 iframe，加载中显示 loading 遮罩。
 */
const DocTab: React.FC<DocTabProps> = ({
  src,
  emptyText,
  loadingText,
  className,
  title = "octo-doc",
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loading, setLoading] = useState(true);

  const rootCls = ["wk-doc-tab", className].filter(Boolean).join(" ");

  if (!src) {
    return (
      <div className={`${rootCls} wk-doc-tab--empty`} data-testid="doc-tab-empty">
        {emptyText ?? t("base.docTab.empty")}
      </div>
    );
  }

  return (
    <div className={rootCls} data-testid="doc-tab">
      {loading && (
        <div className="wk-doc-tab__loading" data-testid="doc-tab-loading">
          <Loading text={loadingText ?? t("base.docTab.loading")} layout="vertical" />
        </div>
      )}
      <iframe
        ref={iframeRef}
        src={src}
        title={title}
        data-testid="doc-tab-iframe"
        className="wk-doc-tab__iframe"
        onLoad={() => setLoading(false)}
        // same-origin 是必需的：doc 页面 JS 通过同源 fetch 拿 capability cookie。
        // 不给 allow-top-navigation，避免恶意 doc 劫持宿主 tab。
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        // 禁用 legacy 属性：现代浏览器认 sandbox 就够，X-Frame-Options 由服务端出。
        loading="lazy"
      />
    </div>
  );
};

export default DocTab;
export { DocTab };
