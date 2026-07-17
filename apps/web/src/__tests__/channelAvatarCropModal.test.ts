import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const sourcePath = path.resolve(
    __dirname,
    "../../../../packages/dmworkbase/src/Components/ChannelAvatar/index.tsx"
)
const source = fs.readFileSync(sourcePath, "utf8")
const editorPath = path.resolve(
    __dirname,
    "../../../../packages/dmworkbase/src/Components/WKAvatarEditor/index.tsx"
)
const editorSource = fs.readFileSync(editorPath, "utf8")

describe("ChannelAvatar crop presentation", () => {
    it("opens the shared modal instead of pushing another drawer route", () => {
        expect(source).toContain('className="wk-channelavatar-crop-modal"')
        expect(source).toContain("visible={!!cropFile}")
        expect(source).not.toContain("context.push(<WKAvatarEditor")
        expect(source).not.toContain("new RouteContextConfig")
    })

    it("keeps upload loading and close guards on the modal", () => {
        expect(source).toContain("isOkLoading: uploading")
        expect(source).toContain("maskClosable: !uploading")
        expect(source).toContain("closeOnEsc: !uploading")
    })

    it("keeps the crop canvas square instead of independently compressing its height", () => {
        expect(editorSource).toContain("style={EDITOR_CANVAS_STYLE}")
        expect(editorSource).toContain('height: "auto"')
        expect(editorSource).toContain('aspectRatio: "1 / 1"')
    })
})
