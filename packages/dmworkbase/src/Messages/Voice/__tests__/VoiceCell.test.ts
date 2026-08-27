import { describe, expect, it, vi } from "vitest"

vi.mock("benz-amr-recorder", () => ({ default: class {
  playCallback: any
  endCallback: any
  isPlaying() { return false }
  stop() {}
  initWithArrayBuffer() { return Promise.resolve() }
  play() {}
  onPlay(callback: any) { this.playCallback = callback }
  onEnded(callback: any) { this.endCallback = callback }
  getCurrentPosition() { return 1 }
  getDuration() { return 2 }
} }))
vi.mock("../../../App", () => ({ default: { config: { themeColor: "blue" }, dataSource: { commonDataSource: { getFileURL: (url: string) => url } } } }))
vi.mock("../../../i18n", () => ({ t: (key: string) => key }))
vi.mock("../../../Components/WaveCanvas", () => ({ default: () => null }))
vi.mock("../../Base", () => ({ default: ({ children }: any) => children, tail: () => null }))
vi.mock("../../Base/tail", () => ({ default: () => null }))
vi.mock("../../MessageCell", () => ({ MessageCell: class { props: any; state: any; constructor(props: any) { this.props = props } setState(v: any) { this.state = { ...this.state, ...v } } componentWillUnmount() {} } }))

import { VoiceCell, VoiceContent } from "../index"
import { MessageContentTypeConst } from "../../../Service/Const"

describe("VoiceContent and VoiceCell", () => {
  it("decodes voice content and exposes digest/type", () => {
    const content = new VoiceContent()
    content.decodeJSON({ url: "/voice.amr", timeTrad: 61.2, waveform: "AQI=" })
    expect(content.url).toBe("/voice.amr")
    expect(content.timeTrad).toBe(61.2)
    expect(content.waveform).toBe("AQI=")
    expect(content.contentType).toBe(MessageContentTypeConst.voice)
    expect(content.conversationDigest).toBe("base.message.digest.voice")
  })

  it("formats durations and handles invalid waveform payloads", () => {
    const valid: any = new VoiceCell({ message: { content: { timeTrad: 61.2, waveform: "AQI=" } } })
    expect(valid.formatSecond(0)).toBe("00:00")
    expect(valid.formatSecond(61.2)).toBe("01:02")
    expect(valid.formatSecond(600)).toBe("10:00")
    expect(valid.waveform).toEqual(new Uint8Array([1, 2]))

    const invalid: any = new VoiceCell({ message: { content: { timeTrad: 1, waveform: "%%%" } } })
    expect(invalid.waveform).toEqual(new Uint8Array(0))
    expect(invalid.getPlayStatusClassname()).toBe("")
    invalid.state.playStatus = 2
    expect(invalid.getPlayStatusClassname()).toBe("voicePlaying")
    invalid.state.playStatus = 3
    expect(invalid.getPlayStatusClassname()).toBe("voiceDownloading")
  })

  it("handles buffered playback callbacks and cleanup", async () => {
    const message: any = { content: { timeTrad: 2, waveform: "AQI=" }, voiceBuff: new ArrayBuffer(2), message: { send: true } }
    const cell: any = new VoiceCell({ message })
    cell.lightWavformRef.current = { style: {} }
    cell.timeRef.current = { innerText: "" }
    cell.timer = setInterval(() => {}, 1000)
    cell.clearTimer()
    cell.componentWillUnmount()
    expect(cell.timer).toBeUndefined()
    expect(cell.getPlayStatusClassname()).toBe("")
  })
})
