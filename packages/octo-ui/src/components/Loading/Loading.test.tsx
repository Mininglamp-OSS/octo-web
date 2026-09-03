import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Loading from "./index";

describe("Loading", () => {
  it("renders the medium ring-only design by default", () => {
    const html = renderToStaticMarkup(<Loading />);

    expect(html).toContain("octo-ui-loading--md");
    expect(html).toContain("octo-ui-loading--inline");
    expect(html).toContain("octo-ui-loading__spinner");
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Loading"');
  });

  it("renders text in the requested size and layout", () => {
    const html = renderToStaticMarkup(
      <Loading size="lg" layout="vertical" text="Loading data" />
    );

    expect(html).toContain("octo-ui-loading--lg");
    expect(html).toContain("octo-ui-loading--vertical");
    expect(html).toContain("octo-ui-loading__text");
    expect(html).toContain("Loading data");
    expect(html).not.toContain('aria-label="Loading"');
  });

  it("forwards native span attributes and custom accessibility labels", () => {
    const html = renderToStaticMarkup(
      <Loading
        aria-label="Synchronizing"
        className="custom-loading"
        data-testid="loading"
      />
    );

    expect(html).toContain('aria-label="Synchronizing"');
    expect(html).toContain("custom-loading");
    expect(html).toContain('data-testid="loading"');
  });
});
