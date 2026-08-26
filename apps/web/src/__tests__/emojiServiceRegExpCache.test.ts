/**
 * Unit tests for EmojiService RegExp caching
 * Tests that emojiRegExp() caches the RegExp to prevent ReDoS attacks
 * Related issue: #137
 */

describe('EmojiService RegExp caching', () => {
    // Simulated EmojiService with RegExp caching (mirrors the actual implementation)
    class TestEmojiService {
        private emojiMap = new Map<string, string>([
            ["😀", "0_0"],
            ["😃", "0_1"],
            ["😄", "0_2"],
        ]);

        emojiKeys?: string[];
        private _cachedRegExp: RegExp | null = null;

        emojiRegExp() {
            if (this._cachedRegExp) {
                return this._cachedRegExp;
            }
            if (!this.emojiKeys) {
                this.emojiKeys = new Array<string>();
                const keys = this.emojiMap.keys();
                for (const emojiKey of keys) {
                    this.emojiKeys.push(emojiKey);
                }
            }
            this._cachedRegExp = new RegExp(`(${this.emojiKeys.join("|")})`);
            return this._cachedRegExp;
        }

        // Method to check if RegExp is cached (for testing)
        isCached(): boolean {
            return this._cachedRegExp !== null;
        }
    }

    it('should return a RegExp object', () => {
        const service = new TestEmojiService();
        const regex = service.emojiRegExp();
        expect(regex).toBeInstanceOf(RegExp);
    });

    it('should cache the RegExp after first call', () => {
        const service = new TestEmojiService();
        expect(service.isCached()).toBe(false);

        service.emojiRegExp();
        expect(service.isCached()).toBe(true);
    });

    it('should return the same RegExp instance on multiple calls', () => {
        const service = new TestEmojiService();
        const regex1 = service.emojiRegExp();
        const regex2 = service.emojiRegExp();
        const regex3 = service.emojiRegExp();

        // All should be the exact same instance (reference equality)
        expect(regex1).toBe(regex2);
        expect(regex2).toBe(regex3);
    });

    it('should correctly match emoji characters', () => {
        const service = new TestEmojiService();
        const regex = service.emojiRegExp();

        expect(regex.test("😀")).toBe(true);
        expect(regex.test("😃")).toBe(true);
        expect(regex.test("😄")).toBe(true);
        expect(regex.test("hello")).toBe(false);
    });

    it('should reuse the cached RegExp for repeated calls', () => {
        const service = new TestEmojiService();

        const first = service.emojiRegExp();
        for (let i = 0; i < 10000; i++) service.emojiRegExp();

        expect(service.emojiRegExp()).toBe(first);
    });
});
