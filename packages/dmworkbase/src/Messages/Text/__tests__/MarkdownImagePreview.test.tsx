// @vitest-environment jsdom

import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  previewProps: undefined as any,
}));

vi.mock("../../../App", () => ({
  default: {
    dataSource: {
      commonDataSource: {
        getImageURL: (src: string) => `https://cdn.example.com/${src}`,
      },
    },
  },
}));

vi.mock("../../Image/ImagePreview", () => ({
  ImagePreviewLightbox: (props: any) => {
    mocks.previewProps = props;
    return props.open ? <div data-testid="image-preview" /> : null;
  },
}));

vi.mock("../../../i18n", () => ({
  t: (key: string) => key,
}));

import { MarkdownImage } from "../MarkdownContent";

let container: HTMLDivElement | null = null;

afterEach(() => {
  if (!container) return;
  ReactDOM.unmountComponentAtNode(container);
  container.remove();
  container = null;
});

describe("MarkdownImage preview", () => {
  it("uses the shared image preview with the resolved source and filename", () => {
    container = document.createElement("div");
    document.body.appendChild(container);

    act(() => {
      ReactDOM.render(
        <MarkdownImage src="images/report.png" alt="report.png" />,
        container
      );
    });

    expect(mocks.previewProps.open).toBe(false);

    act(() => {
      container
        ?.querySelector("img")
        ?.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true })
        );
    });

    expect(mocks.previewProps).toMatchObject({
      open: true,
      filename: "report.png",
      slides: [
        {
          src: "https://cdn.example.com/images/report.png",
          alt: "report.png",
        },
      ],
    });
    expect(
      container.querySelector('[data-testid="image-preview"]')
    ).not.toBeNull();
  });
});
