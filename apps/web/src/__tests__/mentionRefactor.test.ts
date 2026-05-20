/**
 * Tests for the mention refactor:
 * - formatMentionTextV2: converts @[uid:name] markup to @name + entities
 * - parseMentionWithEntities: renders mentions using entities (v2)
 * - parseMentionLegacy: renders mentions using uids + regex (v1 fallback)
 */

// Render-side helpers are now imported from the production module so the
// render-matrix tests exercise the same synthesis logic that ships in
// Conversation.getMessageMentions, instead of a hand-maintained mirror.
import {
    buildMessageMentions as productionBuildMessageMentions,
    readMentionFlags,
    buildMentionDropdownItems,
    MENTION_UID_HUMANS,
    MENTION_UID_AIS,
    MENTION_LABEL_HUMANS,
    MENTION_LABEL_AIS,
    type MentionRenderPart,
    type MentionRenderFlags,
    type MentionRenderInfo,
} from '../../../../packages/dmworkbase/src/Utils/mentionRender'

// ─── Type definitions ────────────────────────────────────────────

interface MentionEntity {
    uid: string;
    offset: number;
    length: number;
}

enum PartType {
    text,
    emoji,
    mention,
    link,
}

class Part {
    type!: PartType
    text!: string
    data?: any
    constructor(type: PartType, text: string, data?: any) {
        this.type = type
        this.text = text
        this.data = data
    }
}

class MentionModel {
    all: boolean = false
    uids?: Array<string>
    entities?: MentionEntity[]
}

// ─── Extracted functions (mirroring production code) ─────────────

function formatMentionTextV2(text: string): {
    content: string;
    mention: MentionModel | undefined;
} {
    const entities: MentionEntity[] = [];
    const uids: string[] = [];
    let result = '';
    let cursor = 0;
    let all = false;

    const placeholderPattern = /@\[([^:\]]+):([^\]]+)\]/g;
    let match;

    while ((match = placeholderPattern.exec(text)) !== null) {
        const uid = match[1];
        const name = match[2];

        result += text.substring(cursor, match.index);

        if (uid === '-1') {
            all = true;
            const atName = `@${name}`;
            result += atName;
        } else {
            const atName = `@${name}`;
            const offset = result.length;
            result += atName;

            entities.push({ uid, offset, length: atName.length });
            uids.push(uid);
        }

        cursor = match.index + match[0].length;
    }

    result += text.substring(cursor);

    if (all) {
        const mention = new MentionModel();
        mention.all = true;
        return { content: result, mention };
    }

    if (entities.length === 0) {
        return { content: result, mention: undefined };
    }

    const mention = new MentionModel();
    mention.uids = uids;
    mention.entities = entities;
    return { content: result, mention };
}

function parseMentionWithEntities(
    text: string,
    entities: Array<{ uid: string; offset: number; length: number }>
): Part[] | null {
    const validEntities = entities
        .filter(
            (e): e is { uid: string; offset: number; length: number } =>
                e != null &&
                typeof e === 'object' &&
                !Array.isArray(e) &&
                typeof e.uid === 'string' &&
                typeof e.offset === 'number' &&
                typeof e.length === 'number' &&
                Number.isFinite(e.offset) &&
                Number.isFinite(e.length) &&
                e.offset >= 0 &&
                e.length > 0 &&
                e.offset + e.length <= text.length
        )
        .sort((a, b) => a.offset - b.offset);

    if (validEntities.length === 0) {
        return null;
    }

    const deduped: Array<{ uid: string; offset: number; length: number }> = [];
    let lastEnd = 0;
    for (const entity of validEntities) {
        if (entity.offset >= lastEnd) {
            deduped.push(entity);
            lastEnd = entity.offset + entity.length;
        }
    }

    const parts: Part[] = [];
    let cursor = 0;

    for (const entity of deduped) {
        if (entity.offset > cursor) {
            parts.push(new Part(PartType.text, text.substring(cursor, entity.offset)));
        }

        const mentionText = text.substring(entity.offset, entity.offset + entity.length);

        if (!mentionText.startsWith('@')) {
            parts.push(new Part(PartType.text, mentionText));
            cursor = entity.offset + entity.length;
            continue;
        }

        parts.push(new Part(PartType.mention, mentionText, { uid: entity.uid }));
        cursor = entity.offset + entity.length;
    }

    if (cursor < text.length) {
        parts.push(new Part(PartType.text, text.substring(cursor)));
    }

    return parts;
}

function parseMentionLegacy(text: string, uids: string[]): Part[] {
    const parts: Part[] = [];
    const mentionRegex = /@[\w\u4e00-\u9fa5.\-]+/gm;
    let match: RegExpExecArray | null;
    let cursor = 0;
    let i = 0;

    while ((match = mentionRegex.exec(text)) !== null && i < uids.length) {
        const matchStart = match.index;
        const matchText = match[0];

        if (matchStart > 0) {
            const charBefore = text.charCodeAt(matchStart - 1);
            if (
                (charBefore >= 97 && charBefore <= 122) ||
                (charBefore >= 65 && charBefore <= 90) ||
                (charBefore >= 48 && charBefore <= 57) ||
                charBefore === 95
            ) {
                continue;
            }
        }

        if (matchStart > cursor) {
            parts.push(new Part(PartType.text, text.substring(cursor, matchStart)));
        }

        const data = i < uids.length ? { uid: uids[i] } : {};
        parts.push(new Part(PartType.mention, matchText, data));
        cursor = matchStart + matchText.length;
        i++;
    }

    if (cursor < text.length) {
        parts.push(new Part(PartType.text, text.substring(cursor)));
    }

    return parts;
}

// ─── parseMention dispatcher (mirrors Model.tsx logic) ──────────

function parseMention(
    text: string,
    mention?: { uids?: string[]; entities?: any[]; all?: boolean }
): Part[] {
    if (!mention) {
        return [new Part(PartType.text, text)];
    }

    if (mention.entities && Array.isArray(mention.entities)) {
        const result = parseMentionWithEntities(text, mention.entities);
        if (result !== null) return result;
    }

    if (mention.uids && Array.isArray(mention.uids) && mention.uids.length > 0) {
        return parseMentionLegacy(text, mention.uids);
    }

    return [new Part(PartType.text, text)];
}

// ═════════════════════════════════════════════════════════════════
// Tests
// ═════════════════════════════════════════════════════════════════

describe('formatMentionTextV2', () => {
    it('should convert @[uid:name] to @name and generate entities', () => {
        const input = '你好 @[uid_chen:陈皮皮] 请看下';
        const result = formatMentionTextV2(input);

        expect(result.content).toBe('你好 @陈皮皮 请看下');
        expect(result.mention?.entities).toEqual([
            { uid: 'uid_chen', offset: 3, length: 4 },
        ]);
        expect(result.mention?.uids).toEqual(['uid_chen']);
    });

    it('should handle multiple mentions', () => {
        const input = '你好 @[uid_chen:陈皮皮] 和 @[uid_bob:Bob] 请看下';
        const result = formatMentionTextV2(input);

        expect(result.content).toBe('你好 @陈皮皮 和 @Bob 请看下');
        expect(result.mention?.entities).toEqual([
            { uid: 'uid_chen', offset: 3, length: 4 },
            { uid: 'uid_bob', offset: 10, length: 4 },
        ]);
        expect(result.mention?.uids).toEqual(['uid_chen', 'uid_bob']);
    });

    it('should handle two same-name users with different uids', () => {
        const input = '你好 @[uid_a:陈皮皮] 和 @[uid_b:陈皮皮] ';
        const result = formatMentionTextV2(input);

        expect(result.content).toBe('你好 @陈皮皮 和 @陈皮皮 ');
        expect(result.mention?.entities).toEqual([
            { uid: 'uid_a', offset: 3, length: 4 },
            { uid: 'uid_b', offset: 10, length: 4 },
        ]);
        expect(result.mention?.uids).toEqual(['uid_a', 'uid_b']);
    });

    it('should handle @everyone (uid = -1)', () => {
        const input = '大家注意 @[-1:所有人] ';
        const result = formatMentionTextV2(input);

        expect(result.content).toBe('大家注意 @所有人 ');
        expect(result.mention?.all).toBe(true);
        expect(result.mention?.entities).toBeUndefined();
    });

    it('should return undefined mention when no mentions', () => {
        const input = '普通消息';
        const result = formatMentionTextV2(input);

        expect(result.content).toBe('普通消息');
        expect(result.mention).toBeUndefined();
    });

    it('should handle mention at end without trailing space', () => {
        const input = '你好 @[uid_chen:陈皮皮]';
        const result = formatMentionTextV2(input);

        expect(result.content).toBe('你好 @陈皮皮');
        expect(result.mention?.entities).toEqual([
            { uid: 'uid_chen', offset: 3, length: 4 },
        ]);
    });

    it('should handle mention at start', () => {
        const input = '@[uid_chen:陈皮皮] 你好';
        const result = formatMentionTextV2(input);

        expect(result.content).toBe('@陈皮皮 你好');
        expect(result.mention?.entities).toEqual([
            { uid: 'uid_chen', offset: 0, length: 4 },
        ]);
    });

    it('offset/length should match UTF-16 code units (JS string.length)', () => {
        const input = '@[uid_chen:陈皮皮] ok';
        const result = formatMentionTextV2(input);
        const entity = result.mention!.entities![0];

        expect(result.content.substring(entity.offset, entity.offset + entity.length)).toBe('@陈皮皮');
    });

    it('should handle mixed @everyone and normal mentions', () => {
        const input = '@[-1:所有人] @[uid_bob:Bob] ';
        const result = formatMentionTextV2(input);

        expect(result.content).toBe('@所有人 @Bob ');
        // When @everyone is present, mention.all = true takes priority
        expect(result.mention?.all).toBe(true);
    });
});

describe('parseMentionWithEntities', () => {
    it('should parse a single mention', () => {
        const text = '你好 @陈皮皮 请看下';
        const entities = [{ uid: 'uid_chen', offset: 3, length: 4 }];
        const parts = parseMentionWithEntities(text, entities);

        expect(parts).not.toBeNull();
        expect(parts).toHaveLength(3);
        expect(parts![0]).toEqual(new Part(PartType.text, '你好 '));
        expect(parts![1]).toEqual(new Part(PartType.mention, '@陈皮皮', { uid: 'uid_chen' }));
        expect(parts![2]).toEqual(new Part(PartType.text, ' 请看下'));
    });

    it('should parse multiple mentions', () => {
        const text = '你好 @陈皮皮 和 @Bob 请看下';
        const entities = [
            { uid: 'uid_chen', offset: 3, length: 4 },
            { uid: 'uid_bob', offset: 10, length: 4 },
        ];
        const parts = parseMentionWithEntities(text, entities);

        expect(parts).toHaveLength(5);
        expect(parts![1].data.uid).toBe('uid_chen');
        expect(parts![3].data.uid).toBe('uid_bob');
    });

    it('should handle same-name users with different uids', () => {
        const text = '请 @陈皮皮 和 @陈皮皮 一起看下';
        const entities = [
            { uid: 'uid_chen_a', offset: 2, length: 4 },
            { uid: 'uid_chen_b', offset: 9, length: 4 },
        ];
        const parts = parseMentionWithEntities(text, entities);

        expect(parts![1].data.uid).toBe('uid_chen_a');
        expect(parts![3].data.uid).toBe('uid_chen_b');
    });

    it('should skip entity with offset beyond text length', () => {
        const text = '你好';
        const entities = [{ uid: 'uid', offset: 100, length: 4 }];
        const result = parseMentionWithEntities(text, entities);

        expect(result).toBeNull();
    });

    it('should skip entity with length 0', () => {
        const text = '@Bob hello';
        const entities = [{ uid: 'uid', offset: 0, length: 0 }];
        const result = parseMentionWithEntities(text, entities);

        expect(result).toBeNull();
    });

    it('should skip entity with negative offset', () => {
        const text = '@Bob hello';
        const entities = [{ uid: 'uid', offset: -1, length: 4 }];
        const result = parseMentionWithEntities(text, entities);

        expect(result).toBeNull();
    });

    it('should skip entity with NaN offset', () => {
        const text = '@Bob hello';
        const entities = [{ uid: 'uid', offset: NaN, length: 4 }];
        const result = parseMentionWithEntities(text, entities);

        expect(result).toBeNull();
    });

    it('should skip entity with Infinity length', () => {
        const text = '@Bob hello';
        const entities = [{ uid: 'uid', offset: 0, length: Infinity }];
        const result = parseMentionWithEntities(text, entities);

        expect(result).toBeNull();
    });

    it('should skip null entries in entities array', () => {
        const text = '你好 @Bob';
        const entities = [null, { uid: 'uid', offset: 3, length: 4 }] as any;
        const result = parseMentionWithEntities(text, entities);

        expect(result).not.toBeNull();
        expect(result).toHaveLength(2);
        expect(result![1].data.uid).toBe('uid');
    });

    it('should keep first entity when overlapping', () => {
        const text = '@BobSmith hello';
        const entities = [
            { uid: 'uid1', offset: 0, length: 9 },
            { uid: 'uid2', offset: 4, length: 5 },
        ];
        const result = parseMentionWithEntities(text, entities);

        expect(result).toHaveLength(2);
        expect(result![0].data.uid).toBe('uid1');
    });

    it('should treat non-@ starting text as plain text', () => {
        const text = 'Hello World';
        const entities = [{ uid: 'uid', offset: 0, length: 5 }];
        const result = parseMentionWithEntities(text, entities);

        expect(result).toHaveLength(2);
        expect(result![0].type).toBe(PartType.text);
        expect(result![0].text).toBe('Hello');
    });

    it('should return null when all entities are invalid', () => {
        const text = '@Bob hello';
        const entities = [{}] as any;
        const result = parseMentionWithEntities(text, entities);

        expect(result).toBeNull();
    });

    it('should handle mention at start of text', () => {
        const text = '@Bob hello';
        const entities = [{ uid: 'uid_bob', offset: 0, length: 4 }];
        const result = parseMentionWithEntities(text, entities);

        expect(result).toHaveLength(2);
        expect(result![0]).toEqual(new Part(PartType.mention, '@Bob', { uid: 'uid_bob' }));
        expect(result![1]).toEqual(new Part(PartType.text, ' hello'));
    });

    it('should handle mention at end of text', () => {
        const text = 'hello @Bob';
        const entities = [{ uid: 'uid_bob', offset: 6, length: 4 }];
        const result = parseMentionWithEntities(text, entities);

        expect(result).toHaveLength(2);
        expect(result![0]).toEqual(new Part(PartType.text, 'hello '));
        expect(result![1]).toEqual(new Part(PartType.mention, '@Bob', { uid: 'uid_bob' }));
    });

    it('should handle offset+length exactly at text boundary', () => {
        const text = '@Bob';
        const entities = [{ uid: 'uid_bob', offset: 0, length: 4 }];
        const result = parseMentionWithEntities(text, entities);

        expect(result).toHaveLength(1);
        expect(result![0]).toEqual(new Part(PartType.mention, '@Bob', { uid: 'uid_bob' }));
    });

    it('should sort entities by offset', () => {
        const text = '@Alice and @Bob';
        const entities = [
            { uid: 'uid_bob', offset: 11, length: 4 },
            { uid: 'uid_alice', offset: 0, length: 6 },
        ];
        const result = parseMentionWithEntities(text, entities);

        expect(result).toHaveLength(3);
        expect(result![0].data.uid).toBe('uid_alice');
        expect(result![2].data.uid).toBe('uid_bob');
    });
});

describe('parseMentionLegacy', () => {
    it('should match Chinese usernames', () => {
        const text = '你好 @陈皮皮 请看下';
        const uids = ['uid_chen'];
        const parts = parseMentionLegacy(text, uids);

        expect(parts).toHaveLength(3);
        expect(parts[1]).toEqual(new Part(PartType.mention, '@陈皮皮', { uid: 'uid_chen' }));
    });

    it('should match usernames with dots', () => {
        const text = 'Hi @thomas.ford ok';
        const uids = ['uid_thomas'];
        const parts = parseMentionLegacy(text, uids);

        expect(parts[1].text).toBe('@thomas.ford');
        expect(parts[1].data.uid).toBe('uid_thomas');
    });

    it('should match usernames with hyphens', () => {
        const text = 'Hi @user-name ok';
        const uids = ['uid_user'];
        const parts = parseMentionLegacy(text, uids);

        expect(parts[1].text).toBe('@user-name');
    });

    it('should exclude email addresses', () => {
        const text = '发邮件到 user@company.com 看看';
        const uids = ['uid_fake'];
        const parts = parseMentionLegacy(text, uids);

        expect(parts.every((p) => p.type === PartType.text)).toBe(true);
    });

    it('should pair uids in order', () => {
        const text = '@Alice 和 @Bob';
        const uids = ['uid_alice', 'uid_bob'];
        const parts = parseMentionLegacy(text, uids);

        expect(parts[0].data.uid).toBe('uid_alice');
        expect(parts[2].data.uid).toBe('uid_bob');
    });

    it('should handle mention at end without trailing space', () => {
        const text = '你好 @Bob';
        const uids = ['uid_bob'];
        const parts = parseMentionLegacy(text, uids);

        expect(parts).toHaveLength(2);
        expect(parts[1]).toEqual(new Part(PartType.mention, '@Bob', { uid: 'uid_bob' }));
    });

    it('should handle mention at start', () => {
        const text = '@Alice hello';
        const uids = ['uid_alice'];
        const parts = parseMentionLegacy(text, uids);

        expect(parts[0]).toEqual(new Part(PartType.mention, '@Alice', { uid: 'uid_alice' }));
    });

    it('should stop pairing when uids exhausted', () => {
        const text = '@Alice @Bob @Charlie';
        const uids = ['uid_alice'];
        const parts = parseMentionLegacy(text, uids);

        const mentionParts = parts.filter((p) => p.type === PartType.mention);
        expect(mentionParts).toHaveLength(1);
        expect(mentionParts[0].data.uid).toBe('uid_alice');
    });
});

describe('parseMention dispatcher (v2 priority + v1 fallback)', () => {
    it('should use v2 path when valid entities exist', () => {
        const parts = parseMention('你好 @Bob', {
            uids: ['uid_bob'],
            entities: [{ uid: 'uid_bob', offset: 3, length: 4 }],
        });

        const mentionPart = parts.find((p) => p.type === PartType.mention);
        expect(mentionPart?.data?.uid).toBe('uid_bob');
    });

    it('should fallback to uids when entities are all invalid', () => {
        const parts = parseMention('你好 @Bob', {
            uids: ['uid_bob'],
            entities: [{}] as any,
        });

        const mentionPart = parts.find((p) => p.type === PartType.mention);
        expect(mentionPart?.data?.uid).toBe('uid_bob');
    });

    it('should fallback to uids when no entities', () => {
        const parts = parseMention('你好 @Bob', {
            uids: ['uid_bob'],
        });

        const mentionPart = parts.find((p) => p.type === PartType.mention);
        expect(mentionPart?.data?.uid).toBe('uid_bob');
    });

    it('should return plain text when no mention', () => {
        const parts = parseMention('你好世界', undefined);

        expect(parts).toHaveLength(1);
        expect(parts[0].type).toBe(PartType.text);
    });

    it('should return plain text when mention has no uids or entities', () => {
        const parts = parseMention('你好世界', {});

        expect(parts).toHaveLength(1);
        expect(parts[0].type).toBe(PartType.text);
    });
});

describe('v1 regex fix verification', () => {
    it('fixed regex should capture full Chinese name (not just last char)', () => {
        const regex = /@[\w\u4e00-\u9fa5.\-]+/gm;
        const match = regex.exec('@陈皮皮');
        expect(match).not.toBeNull();
        expect(match![0]).toBe('@陈皮皮');
    });

    it('old buggy regex quantifier issue: + outside capture group', () => {
        // The old regex: /@([\w\u4e00-\u9fa5])+/m
        // The + is outside the capture group, so match[1] is only the last char
        const oldRegex = /@([\w\u4e00-\u9fa5])+/m;
        const match = oldRegex.exec('@陈皮皮');
        // match[0] is correct (full match), but match[1] is only '皮' (bug)
        expect(match![0]).toBe('@陈皮皮');
        expect(match![1]).toBe('皮'); // demonstrates the old bug

        // The fixed regex doesn't need a capture group
        const fixedRegex = /@[\w\u4e00-\u9fa5.\-]+/gm;
        const fixedMatch = fixedRegex.exec('@陈皮皮');
        expect(fixedMatch![0]).toBe('@陈皮皮');
    });

    it('fixed regex should have /g flag for exec iteration', () => {
        const regex = /@[\w\u4e00-\u9fa5.\-]+/gm;
        const text = '@Alice and @Bob';
        const matches: string[] = [];
        let m;
        while ((m = regex.exec(text)) !== null) {
            matches.push(m[0]);
        }
        expect(matches).toEqual(['@Alice', '@Bob']);
    });

    it('fixed regex should match dots and hyphens in names', () => {
        const regex = /@[\w\u4e00-\u9fa5.\-]+/gm;
        expect(regex.exec('@thomas.ford')![0]).toBe('@thomas.ford');
        regex.lastIndex = 0;
        expect(regex.exec('@user-name')![0]).toBe('@user-name');
    });
});

describe('end-to-end: formatMentionTextV2 -> parseMentionWithEntities', () => {
    it('should produce entities that parseMentionWithEntities can render correctly', () => {
        const input = '你好 @[uid_chen:陈皮皮] 和 @[uid_bob:Bob] 请看下';
        const { content, mention } = formatMentionTextV2(input);

        const parts = parseMentionWithEntities(content, mention!.entities!);

        expect(parts).not.toBeNull();
        expect(parts).toHaveLength(5);
        expect(parts![1]).toEqual(new Part(PartType.mention, '@陈皮皮', { uid: 'uid_chen' }));
        expect(parts![3]).toEqual(new Part(PartType.mention, '@Bob', { uid: 'uid_bob' }));
    });

    it('should handle same-name users end-to-end', () => {
        const input = '请 @[uid_a:陈皮皮] 和 @[uid_b:陈皮皮] 一起看下';
        const { content, mention } = formatMentionTextV2(input);

        const parts = parseMentionWithEntities(content, mention!.entities!);

        expect(parts).not.toBeNull();
        expect(parts![1].data.uid).toBe('uid_a');
        expect(parts![3].data.uid).toBe('uid_b');
        // Both have same display text but different uids
        expect(parts![1].text).toBe('@陈皮皮');
        expect(parts![3].text).toBe('@陈皮皮');
    });
});

// ═════════════════════════════════════════════════════════════════
// Three-state mention render matrix (PR-C / GH#58)
//
// Mirrors the production logic in:
//   - packages/dmworkbase/src/Components/Conversation/index.tsx
//     ::getMessageMentions  (synthesizes @所有人 / @所有AI MentionInfo entries
//     so MarkdownContent applies the existing mention-highlight class)
//
// Matrix:
//   humans=1                       → highlight @所有人
//   ais=1                          → highlight @所有AI
//   humans=1 + ais=1               → highlight @所有人 + @所有AI
//   all=1 (legacy / server outbound double-write) → highlight @所有人
// ═════════════════════════════════════════════════════════════════

interface MentionInfo {
    name: string
    uid: string
}

interface RenderMention {
    all?: boolean | number
    humans?: number
    ais?: number
    uids?: string[]
    entities?: MentionEntity[]
}

// Delegates to the production `buildMessageMentions` from
// packages/dmworkbase/src/Utils/mentionRender. The test file's local
// `PartType` enum starts at 0 (text) with `mention` at index 2, which
// also matches the SDK's PartType.mention numeric value used by the
// production caller — we pass that numeric value explicitly so the
// helper does not have to import the SDK PartType.
function buildMessageMentions(
    baseParts: Array<{ type: PartType; text: string; data?: { uid?: string } }>,
    mention?: RenderMention,
): MentionInfo[] {
    const parts: MentionRenderPart[] = baseParts.map((p) => ({
        type: p.type as unknown as number,
        text: p.text,
        data: p.data,
    }))
    const flags: MentionRenderFlags | undefined = mention
        ? { all: mention.all, humans: mention.humans, ais: mention.ais }
        : undefined
    return productionBuildMessageMentions(
        parts,
        flags,
        PartType.mention as unknown as number,
    ) as MentionInfo[]
}

describe('render matrix: three-state mention highlight (GH#58)', () => {
    it('humans=1 only → highlights @所有人', () => {
        const text = '通知 @所有人 准时集合'
        const mentions = buildMessageMentions([], { humans: 1 })

        const names = mentions.map((m) => m.name)
        expect(names).toContain('@所有人')
        expect(names).not.toContain('@所有AI')
        // All synthesized highlights reuse the existing "@member" highlight
        // pathway by setting uid='all' (mention-highlight class).
        expect(mentions.every((m) => m.uid === 'all')).toBe(true)
        // sanity: the literal "@所有人" text exists in the message body so
        // MarkdownContent will actually match it.
        expect(text.includes('@所有人')).toBe(true)
    })

    it('ais=1 only → highlights @所有AI', () => {
        const text = '请 @所有AI 协助回答'
        const mentions = buildMessageMentions([], { ais: 1 })

        const names = mentions.map((m) => m.name)
        expect(names).toContain('@所有AI')
        expect(names).not.toContain('@所有人')
        expect(mentions.every((m) => m.uid === 'all')).toBe(true)
        expect(text.includes('@所有AI')).toBe(true)
    })

    it('humans=1 + ais=1 → highlights @所有人 + @所有AI', () => {
        const text = '@所有人 + @所有AI 同步'
        const mentions = buildMessageMentions([], { humans: 1, ais: 1 })

        const names = mentions.map((m) => m.name)
        expect(names).toContain('@所有人')
        expect(names).toContain('@所有AI')
        expect(mentions).toHaveLength(2)
        expect(mentions.every((m) => m.uid === 'all')).toBe(true)
    })

    it('all=1 (legacy) → highlights @所有人 (server outbound rewrites all→humans, both must work)', () => {
        const text = '@所有人 集合'
        const mentions = buildMessageMentions([], { all: 1 })

        const names = mentions.map((m) => m.name)
        expect(names).toContain('@所有人')
        expect(names).not.toContain('@所有AI')
        expect(mentions[0].uid).toBe('all')
    })

    it('regression: undefined mention does not synthesize anything', () => {
        const mentions = buildMessageMentions([], undefined)
        expect(mentions).toHaveLength(0)
    })

    it('regression: @member parts coexist with synthetic @所有AI (no de-dup collision)', () => {
        const parts = [
            { type: PartType.mention, text: '@陈皮皮', data: { uid: 'uid_chen' } },
        ]
        const mentions = buildMessageMentions(parts, { ais: 1 })

        expect(mentions).toHaveLength(2)
        expect(mentions[0]).toEqual({ name: '@陈皮皮', uid: 'uid_chen' })
        expect(mentions[1]).toEqual({ name: '@所有AI', uid: 'all' })
    })

    it('regression: edited content flags override original content (Conversation.getMessageMentions parity)', () => {
        // Conversation.getMessageMentions reads mention flags from
        // remoteExtra.contentEdit when message.remoteExtra.isEdit is true,
        // matching the text source used by getMessageTextContent. Use
        // readMentionFlags here to assert the same lookup precedence the
        // production path performs.
        const original = { mention: { humans: 1 } }
        const edited = { mention: { ais: 1 } }
        const editedFlags = readMentionFlags(edited)
        expect(editedFlags).toEqual({ all: undefined, humans: undefined, ais: 1 })

        const editedMentions = buildMessageMentions([], editedFlags)
        const names = editedMentions.map((m) => m.name)
        expect(names).toContain('@所有AI')
        expect(names).not.toContain('@所有人')

        // sanity: the original (non-edited) flags still synthesize @所有人
        const originalFlags = readMentionFlags(original)
        const originalMentions = buildMessageMentions([], originalFlags)
        expect(originalMentions.map((m) => m.name)).toEqual(['@所有人'])
    })

    it('readMentionFlags falls back to contentObj.mention when SDK Mention is missing the new fields', () => {
        // The wire payload arrives with humans/ais in `contentObj.mention`
        // because the SDK does not yet declare those fields. The render
        // path must still see them via the fallback branch.
        const flags = readMentionFlags({ contentObj: { mention: { humans: 1, ais: 1 } } })
        expect(flags).toEqual({ all: undefined, humans: 1, ais: 1 })
    })

    it('readMentionFlags returns undefined when content lacks any mention shape', () => {
        expect(readMentionFlags(undefined)).toBeUndefined()
        expect(readMentionFlags(null)).toBeUndefined()
        expect(readMentionFlags({})).toBeUndefined()
        expect(readMentionFlags({ contentObj: {} })).toBeUndefined()
    })
})

// ═════════════════════════════════════════════════════════════════
// PR #59 regression: @-mention dropdown keyboard selection
//
// Reproduces the blocking finding from Jerry-Xin's review: typing
// `@Bob` then pressing Enter must select Bob (or whatever member
// matches the filter), NOT the sticky `@所有人` broadcast item.
//
// Root cause was that the suggestion factory always prepended the
// two sticky items ahead of `filteredMembers`. MentionList resets
// `selectedIndex` to 0 whenever `props.items` changes, so Enter
// always landed on `@所有人` (the prepended sticky) instead of the
// typed-name match. Fix: hide sticky items when the query is
// non-empty.
// ═════════════════════════════════════════════════════════════════

describe('@-mention dropdown keyboard selection (PR #59 regression)', () => {
    const fakeMembers = [
        { uid: 'uid_bob', name: 'Bob', orgData: { robot: 0 } },
        { uid: 'uid_alice', name: 'Alice', orgData: { robot: 0 } },
        { uid: 'uid_bot', name: 'Botzilla', orgData: { robot: 1 } },
    ]

    const stubResolvers = {
        iconResolver: (m: { uid: string }) => `avatar://${m.uid}`,
        externalResolver: (_: unknown) => ({ isExternal: false, sourceSpaceName: '' }),
        stickyIcon: 'mention-all-icon',
    }

    it('empty query → sticky @所有人 + @所有AI prepended at index 0 and 1 (UX preserved)', () => {
        const items = buildMentionDropdownItems({
            query: '',
            members: fakeMembers,
            ...stubResolvers,
        })

        // Sticky items occupy the first two slots, followed by all members.
        expect(items.length).toBe(2 + fakeMembers.length)
        expect(items[0]).toMatchObject({
            uid: MENTION_UID_HUMANS,
            name: MENTION_LABEL_HUMANS,
            isBot: false,
        })
        expect(items[1]).toMatchObject({
            uid: MENTION_UID_AIS,
            name: MENTION_LABEL_AIS,
            isBot: true,
        })
        expect(items[2].uid).toBe('uid_bob')
    })

    it('typing @Bob then Enter → selects Bob, NOT the sticky @所有人', () => {
        // MentionList's enterHandler calls selectItem(selectedIndex), and
        // selectedIndex resets to 0 on every items change. Therefore
        // items[0] IS the keyboard-Enter target. Asserting items[0] is
        // exactly the typed member is the canonical regression guard.
        const items = buildMentionDropdownItems({
            query: 'Bob',
            members: fakeMembers,
            ...stubResolvers,
        })

        expect(items.length).toBe(1)
        expect(items[0]).toMatchObject({ uid: 'uid_bob', name: 'Bob' })

        // Triple-belt: no sticky leaks into the filtered list, regardless
        // of where it sits.
        expect(items.find((i) => i.uid === MENTION_UID_HUMANS)).toBeUndefined()
        expect(items.find((i) => i.uid === MENTION_UID_AIS)).toBeUndefined()
    })

    it('case-insensitive filter still puts the typed member at index 0', () => {
        const items = buildMentionDropdownItems({
            query: 'alice',
            members: fakeMembers,
            ...stubResolvers,
        })
        expect(items[0]).toMatchObject({ uid: 'uid_alice', name: 'Alice' })
        expect(items.length).toBe(1)
    })

    it('query with leading/trailing whitespace is treated as a filter (sticky still hidden)', () => {
        const items = buildMentionDropdownItems({
            query: '  Bob  ',
            members: fakeMembers,
            ...stubResolvers,
        })
        // Even with padding the user clearly typed a filter; sticky must
        // not sneak back in or Enter would broadcast again.
        expect(items.find((i) => i.uid === MENTION_UID_HUMANS)).toBeUndefined()
        expect(items.find((i) => i.uid === MENTION_UID_AIS)).toBeUndefined()
        expect(items[0]).toMatchObject({ uid: 'uid_bob' })
    })

    it('query matches zero members → empty list (no accidental sticky fallback to @所有人)', () => {
        const items = buildMentionDropdownItems({
            query: 'Zzz_no_such_member',
            members: fakeMembers,
            ...stubResolvers,
        })
        // No sticky, no match → empty. MentionList shows "没有找到成员"
        // and Enter is a no-op (selectItem(0) on empty array → noop).
        expect(items).toEqual([])
    })

    it('null members + empty query → sticky-only list (fallback path)', () => {
        const items = buildMentionDropdownItems({
            query: '',
            members: null,
            ...stubResolvers,
        })
        expect(items.length).toBe(2)
        expect(items[0].uid).toBe(MENTION_UID_HUMANS)
        expect(items[1].uid).toBe(MENTION_UID_AIS)
    })

    it('null members + non-empty query → empty list (no sticky, no crash)', () => {
        const items = buildMentionDropdownItems({
            query: 'Bob',
            members: null,
            ...stubResolvers,
        })
        // With sticky hidden during search and no members to filter, the
        // dropdown is empty — matching the "没有找到成员" placeholder UX.
        expect(items).toEqual([])
    })

    it('bot member surfaces with isBot=true (regression on isBot wiring)', () => {
        const items = buildMentionDropdownItems({
            query: 'Bot',
            members: fakeMembers,
            ...stubResolvers,
        })
        expect(items[0]).toMatchObject({ uid: 'uid_bot', name: 'Botzilla', isBot: true })
    })
})

// Silence the unused-import warning for MentionRenderInfo: it is part of
// the public surface tested by `buildMessageMentions` return-type checks
// in the existing render-matrix `it` blocks above (TS inference).
type _MentionRenderInfoUsed = MentionRenderInfo
