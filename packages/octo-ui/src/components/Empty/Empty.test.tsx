// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Empty from "./index";

describe("Empty", () => {
  it("renders title, description, default illustration, and action slot", () => {
    const html = renderToStaticMarkup(
      <Empty
        title="暂无数据"
        description="当前还没有任何内容"
        action={<button type="button">新建</button>}
      />
    );

    expect(html).toContain("octo-ui-empty");
    expect(html).toContain("octo-ui-empty__illustration");
    expect(html).toContain("octo-ui-empty__title");
    expect(html).toContain("暂无数据");
    expect(html).toContain("当前还没有任何内容");
    expect(html).toContain("<button");
  });

  it("supports text-only inline empty state without illustration", () => {
    const html = renderToStaticMarkup(
      <Empty
        illustration={false}
        title="暂无数据"
        description="当前还没有任何内容"
      />
    );

    expect(html).not.toContain("octo-ui-empty__illustration");
    expect(html).toContain("octo-ui-empty__title");
    expect(html).toContain("octo-ui-empty__description");
  });

  it("forwards html attributes and custom className", () => {
    const html = renderToStaticMarkup(
      <Empty className="custom-empty" data-testid="empty" title="Empty" />
    );

    expect(html).toContain("octo-ui-empty custom-empty");
    expect(html).toContain('data-testid="empty"');
  });
});
