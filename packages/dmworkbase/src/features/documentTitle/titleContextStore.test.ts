import { describe, expect, it, vi } from "vitest";
import { TitleContextStore } from "./titleContextStore";

describe("TitleContextStore", () => {
  it("keeps contexts isolated by menu so hidden mounted modules cannot steal the title", () => {
    const store = new TitleContextStore();
    store.set("chat", { primaryTitle: "产品群" });
    store.set("docs", { primaryTitle: "年度经营计划", moduleTitle: "文档" });

    expect(store.get("chat")).toEqual({ primaryTitle: "产品群" });
    expect(store.get("docs")).toEqual({
      primaryTitle: "年度经营计划",
      moduleTitle: "文档",
    });
  });

  it("only clears the context owned by the same page instance", () => {
    const store = new TitleContextStore();
    const oldOwner = Symbol("old");
    const newOwner = Symbol("new");
    store.set(
      "docs",
      { primaryTitle: "旧文档", moduleTitle: "文档" },
      oldOwner
    );
    store.set(
      "docs",
      { primaryTitle: "新文档", moduleTitle: "文档" },
      newOwner
    );

    store.clear("docs", oldOwner);
    expect(store.get("docs")?.primaryTitle).toBe("新文档");

    store.clear("docs", newOwner);
    expect(store.get("docs")).toBeUndefined();
  });

  it("notifies subscribers only when the effective context changes", () => {
    const store = new TitleContextStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.set("chat", { primaryTitle: "产品群" });
    store.set("chat", { primaryTitle: "产品群" });
    store.clear("chat");
    unsubscribe();
    store.set("chat", { primaryTitle: "另一个群" });

    expect(listener).toHaveBeenCalledTimes(2);
  });
});
