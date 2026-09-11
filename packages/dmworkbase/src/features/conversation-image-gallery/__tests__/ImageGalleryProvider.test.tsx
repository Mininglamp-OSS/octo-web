import React, { useContext } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ImageGalleryProvider } from "../ImageGalleryProvider";
import { ImageGalleryContext } from "../ImageGalleryContext";
import type { GalleryImage } from "../imageGallery";

vi.mock("../../../Messages/Image/ImagePreview", () => ({
  ImagePreviewLightbox: ({ open, slides, index, onView, close }: any) =>
    open ? (
      <div data-testid="preview">
        <span data-testid="current">{slides[index]?.key}</span>
        <span data-testid="position">
          {index + 1}/{slides.length}
        </span>
        <button onClick={() => onView(index + 1)}>next</button>
        <button onClick={close}>close</button>
      </div>
    ) : null,
}));

const images: GalleryImage[] = ["a", "b", "c"].map((key) => ({
  key,
  src: `${key}.png`,
}));
function Opener({ imageKey = "b" }: { imageKey?: string }) {
  const gallery = useContext(ImageGalleryContext)!;
  return (
    <button onClick={() => gallery.openImage(imageKey)}>open {imageKey}</button>
  );
}
function Example({
  items = images,
  scope = "group",
  mounted = true,
}: {
  items?: GalleryImage[];
  scope?: string;
  mounted?: boolean;
}) {
  return (
    <ImageGalleryProvider images={items} scopeKey={scope}>
      {mounted && <Opener />}
    </ImageGalleryProvider>
  );
}

describe("ImageGalleryProvider", () => {
  it("opens the clicked image and freezes membership until the next open", () => {
    const view = render(<Example />);
    fireEvent.click(screen.getByText("open b"));
    expect(screen.getByTestId("position").textContent).toBe("2/3");
    const expanded = [
      { key: "older", src: "older.png" },
      ...images,
      { key: "new", src: "new.png" },
    ];
    view.rerender(<Example items={expanded} />);
    expect(screen.getByTestId("current").textContent).toBe("b");
    expect(screen.getByTestId("position").textContent).toBe("2/3");
    fireEvent.click(screen.getByText("next"));
    expect(screen.getByTestId("current").textContent).toBe("c");
    fireEvent.click(screen.getByText("close"));
    fireEvent.click(screen.getByText("open b"));
    expect(screen.getByTestId("position").textContent).toBe("3/5");
  });

  it("keeps the visible image anchored when an earlier image is removed", () => {
    const view = render(<Example />);
    fireEvent.click(screen.getByText("open b"));
    view.rerender(<Example items={images.slice(1)} />);
    expect(screen.getByTestId("current").textContent).toBe("b");
    expect(screen.getByTestId("position").textContent).toBe("1/2");
    fireEvent.click(screen.getByText("next"));
    expect(screen.getByTestId("current").textContent).toBe("c");
  });

  it("closes immediately if the currently viewed image is removed, and never revives the old session", () => {
    const view = render(<Example />);
    fireEvent.click(screen.getByText("open b"));
    fireEvent.click(screen.getByText("next"));
    view.rerender(<Example items={images.slice(0, 2)} />);
    expect(screen.queryByTestId("preview")).toBeNull();
    view.rerender(<Example />);
    expect(screen.queryByTestId("preview")).toBeNull();
  });

  it("does not keep showing an old URL when the same message attachment is replaced", () => {
    const view = render(<Example />);
    fireEvent.click(screen.getByText("open b"));
    view.rerender(
      <Example
        items={images.map((image) =>
          image.key === "b" ? { ...image, src: "replacement.png" } : image
        )}
      />
    );
    expect(screen.queryByTestId("preview")).toBeNull();
  });

  it("closes on channel or Space change even when the image identities are the same", () => {
    const view = render(<Example />);
    fireEvent.click(screen.getByText("open b"));
    view.rerender(<Example scope="other-space" />);
    expect(screen.queryByTestId("preview")).toBeNull();
    view.rerender(<Example />);
    expect(screen.queryByTestId("preview")).toBeNull();
  });

  it("survives the clicked message row unmounting", () => {
    const view = render(<Example />);
    fireEvent.click(screen.getByText("open b"));
    view.rerender(<Example mounted={false} />);
    expect(screen.getByTestId("current").textContent).toBe("b");
  });

  it("does not open missing images or cross into an adjacent conversation", () => {
    render(
      <>
        <ImageGalleryProvider images={images} scopeKey="main">
          <Opener />
        </ImageGalleryProvider>
        <ImageGalleryProvider
          images={[{ key: "thread", src: "thread.png" }]}
          scopeKey="thread"
        >
          <Opener imageKey="missing" />
        </ImageGalleryProvider>
      </>
    );
    fireEvent.click(screen.getByText("open missing"));
    expect(screen.queryByTestId("preview")).toBeNull();
    fireEvent.click(screen.getByText("open b"));
    expect(screen.getAllByTestId("preview")).toHaveLength(1);
    expect(screen.getByTestId("position").textContent).toBe("2/3");
  });
});
