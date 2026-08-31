// @vitest-environment jsdom
import React from "react"
import { describe, expect, it, vi } from "vitest"
import { fireEvent, render } from "@testing-library/react"

vi.mock("../../../i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock("../ImageContent/SingleImage", () => ({ default: (props: any) => <button data-testid="single" onClick={props.onClick}>{props.src}</button> }))

import VideoContent from "../VideoContent"
import MergeforwardCard from "../MergeforwardCard"
import MultiImage from "../ImageContent/MultiImage"

describe("message media/card low coverage paths", () => {
  it("scales video dimensions, formats duration, and toggles fullscreen", () => {
    const requestFullscreen = vi.fn()
    const exitFullscreen = vi.fn()
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null })
    Object.defineProperty(document, "exitFullscreen", { configurable: true, value: exitFullscreen })
    const { container, rerender } = render(<VideoContent src="video.mp4" width={1320} height={448} duration={125} />)
    const video: any = container.querySelector("video")
    video.requestFullscreen = requestFullscreen
    fireEvent.doubleClick(video)
    expect(requestFullscreen).toHaveBeenCalled()
    expect(container.textContent).toContain("2:05")
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: video })
    fireEvent.doubleClick(video)
    expect(exitFullscreen).toHaveBeenCalled()
    rerender(<VideoContent src="small.mp4" width={100} height={80} />)
    expect(container.firstElementChild).toHaveStyle({ width: "100px", height: "80px" })
  })

  it("renders merge-forward previews with a four-item cap and click callback", () => {
    const onClick = vi.fn()
    const { container } = render(<MergeforwardCard title="History" onClick={onClick} previewMsgs={[1, 2, 3, 4, 5].map((i) => ({ fromUID: `${i}`, digest: `msg-${i}` }))} />)
    expect(container.querySelectorAll(".wk-mf-card__item")).toHaveLength(4)
    expect(container.textContent).toContain("base.message.mergeForward.chatRecord")
    fireEvent.click(container.firstElementChild!)
    expect(onClick).toHaveBeenCalled()
    render(<MergeforwardCard title="Empty" previewMsgs={[]} />)
  })

  it("passes per-image and fallback transfer state and click indexes", () => {
    const onImageClick = vi.fn()
    const { getAllByTestId } = render(<MultiImage transferState="uploading" onImageClick={onImageClick} images={[{ src: "a", width: 1, height: 2 }, { src: "b", width: 3, height: 4, transferState: "failed" }]} />)
    fireEvent.click(getAllByTestId("single")[1])
    expect(onImageClick).toHaveBeenCalledWith(1)
  })
})
