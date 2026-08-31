import { describe, expect, it } from "vitest"
import { FileContent } from "../FileContent"

describe("FileContent serialization", () => {
  it("decodes and encodes optional metadata", () => {
    const content = new FileContent(undefined, "draft", "txt", 3)
    expect(content).toMatchObject({ name: "draft", extension: "txt", size: 3 })
    content.decodeJSON({ name: "report", extension: "pdf", size: 42, url: "/report.pdf", caption: "See", mention_uids: ["u1"] })
    expect(content.remoteUrl).toBe("/report.pdf")
    expect(content.encodeJSON()).toEqual({ name: "report", extension: "pdf", size: 42, url: "/report.pdf", caption: "See", mention_uids: ["u1"] })
    expect(content.contentType).toBeTruthy()
    expect(content.conversationDigest).toBeTruthy()
  })

  it("uses safe defaults when optional fields are absent", () => {
    const content = new FileContent()
    content.decodeJSON({})
    expect(content.encodeJSON()).toEqual({ name: "", extension: "", size: 0, url: "" })
  })
})
