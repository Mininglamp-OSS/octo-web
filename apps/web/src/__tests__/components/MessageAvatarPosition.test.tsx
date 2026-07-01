import fs from "fs";
import path from "path";

describe("MessageBase Avatar Position", () => {
    const cssPath = path.resolve(
        __dirname,
        "../../../../../packages/dmworkbase/src/Messages/Base/index.css"
    );

    let cssContent: string;

    beforeAll(() => {
        cssContent = fs.readFileSync(cssPath, "utf-8");
    });

    // NOTE (layout migration): `.senderAvatar` was refactored from an
    // absolute-positioned box (position:absolute; top:0; left:0; 34px) into a
    // flex item inside the `.wk-message-base-box` flex row (32px, flex-shrink:0,
    // no positioning). The avatar still renders top-aligned at the start of the
    // row — the parent uses `display:flex; align-items:flex-start` — only the
    // layout mechanism changed. These assertions are updated to the flex model.

    it("senderAvatar is a flex item, not absolutely positioned", () => {
        const senderAvatarMatch = cssContent.match(
            /\.senderAvatar\s*\{[^}]+\}/
        );
        expect(senderAvatarMatch).not.toBeNull();

        const senderAvatarRule = senderAvatarMatch![0];

        // New layout: flex item that does not shrink, no absolute positioning
        // and no top/bottom offsets (those belonged to the old absolute model).
        expect(senderAvatarRule).toMatch(/flex-shrink:\s*0/);
        expect(senderAvatarRule).not.toMatch(/position:\s*absolute/);
        expect(senderAvatarRule).not.toMatch(/top:\s*\d+px/);
        expect(senderAvatarRule).not.toMatch(/bottom:\s*\d+px/);
    });

    it("the message row top-aligns the avatar via flexbox", () => {
        // Top alignment is now provided by the parent flex container instead of
        // `top: 0` on the avatar itself.
        const boxMatch = cssContent.match(
            /\.wk-message-base-box\s*\{[^}]+\}/
        );
        expect(boxMatch).not.toBeNull();
        const boxRule = boxMatch![0];
        expect(boxRule).toMatch(/display:\s*flex/);
        expect(boxRule).toMatch(/align-items:\s*flex-start/);
    });

    it("senderAvatar should have correct dimensions", () => {
        const senderAvatarMatch = cssContent.match(
            /\.senderAvatar\s*\{[^}]+\}/
        );
        expect(senderAvatarMatch).not.toBeNull();

        const senderAvatarRule = senderAvatarMatch![0];

        // Avatar dimensions are now 32px (was 34px in the absolute layout).
        expect(senderAvatarRule).toMatch(/width:\s*32px/);
        expect(senderAvatarRule).toMatch(/height:\s*32px/);
    });
});
