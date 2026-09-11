import React, { useContext } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ImageGalleryProvider } from "../ImageGalleryProvider";
import { ImageGalleryContext } from "../ImageGalleryContext";
import type { GalleryImage } from "../imageGallery";

vi.mock("../../../App", () => ({ default: {} }));
vi.mock("../../../Utils/download", () => ({ downloadFile: vi.fn() }));
vi.mock("../../../Utils/clipboard", () => ({ copyImageToClipboard: vi.fn() }));

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});
afterAll(() => vi.unstubAllGlobals());

const images: GalleryImage[] = ["a", "b", "c"].map((key) => ({
  key,
  src: `${key}.png`,
  filename: key,
}));
function Opener() {
  const gallery = useContext(ImageGalleryContext)!;
  return <button onClick={() => gallery.openImage("b")}>open b</button>;
}
function Example({
  items = images,
  scope = "group",
}: {
  items?: GalleryImage[];
  scope?: string;
}) {
  return (
    <ImageGalleryProvider images={items} scopeKey={scope}>
      <Opener />
    </ImageGalleryProvider>
  );
}

describe("gallery with the real lightbox state machine", () => {
  it("anchors the visible image through list changes and closes when that image is removed", async () => {
    const view = render(<Example />);
    fireEvent.click(screen.getByText("open b"));
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe("2 / 3")
    );
    view.rerender(
      <Example
        items={[
          { key: "older", src: "older.png" },
          ...images,
          { key: "new", src: "new.png" },
        ]}
      />
    );
    expect(screen.getByRole("status").textContent).toBe("2 / 3");
    view.rerender(<Example items={images.slice(1)} />);
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe("1 / 2")
    );
    const current = screen.getByRole("group", { name: "1 of 2" });
    expect(current.querySelector("img")?.getAttribute("src")).toBe("b.png");
    fireEvent.click(screen.getByRole("button", { name: /下一张|Next image/ }));
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe("2 / 2")
    );
    expect(
      screen
        .getByRole("group", { name: "2 of 2" })
        .querySelector("img")
        ?.getAttribute("src")
    ).toBe("c.png");
    view.rerender(<Example items={images.slice(0, 2)} />);
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    view.rerender(<Example />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("keeps Escape in the preview instead of delivering it to a parent modal", async () => {
    const parentKeyDown = vi.fn();
    document.addEventListener("keydown", parentKeyDown);
    try {
      render(<Example />);
      fireEvent.click(screen.getByText("open b"));
      await waitFor(() => expect(screen.getByRole("status")).toBeTruthy());
      fireEvent.keyDown(
        screen.getByRole("button", { name: /下一张|Next image/ }),
        { key: "Escape", code: "Escape" }
      );
      await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
      expect(parentKeyDown).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", parentKeyDown);
    }
  });
});
