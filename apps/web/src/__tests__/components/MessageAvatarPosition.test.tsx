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

    it("senderAvatar should be a flex item aligned by the message row", () => {
        // Extract the .senderAvatar rule
        const senderAvatarMatch = cssContent.match(
            /\.senderAvatar\s*\{[^}]+\}/
        );
        expect(senderAvatarMatch).not.toBeNull();

        const senderAvatarRule = senderAvatarMatch![0];

        expect(senderAvatarRule).toMatch(/flex-shrink:\s*0/);
        expect(senderAvatarRule).not.toMatch(/position:\s*absolute/);
    });

    it("senderAvatar should not use absolute positioning", () => {
        const senderAvatarMatch = cssContent.match(
            /\.senderAvatar\s*\{[^}]+\}/
        );
        expect(senderAvatarMatch).not.toBeNull();

        const senderAvatarRule = senderAvatarMatch![0];

        expect(senderAvatarRule).not.toMatch(/position:\s*absolute/);
    });

    it("senderAvatar should have correct dimensions", () => {
        const senderAvatarMatch = cssContent.match(
            /\.senderAvatar\s*\{[^}]+\}/
        );
        expect(senderAvatarMatch).not.toBeNull();

        const senderAvatarRule = senderAvatarMatch![0];

        expect(senderAvatarRule).toMatch(/width:\s*32px/);
        expect(senderAvatarRule).toMatch(/height:\s*32px/);
    });
});
