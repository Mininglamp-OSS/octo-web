/**
 * Tests for voice transcription @mention parsing:
 * - parseMentionMarkers: converts ASR "@name" markers to Tiptap mention nodes
 * - End-to-end: parseMentionMarkers → extractMentionsFromEditor → formatMentionTextV2
 */

// ─── Type definitions (mirroring production code) ────────────────

interface MemberInfo {
    uid: string
    name: string
}

interface MentionEntity {
    uid: string
    offset: number
    length: number
}

// Sentinel uids shared with Utils/mentionRender. Mirrored here so the
// test stays self-contained (no import cycle through the editor module).
const MENTION_UID_HUMANS = "-2"
const MENTION_UID_AIS = "-3"
const MENTION_LABEL_HUMANS = "所有人"
const MENTION_LABEL_AIS = "所有AI"

class MentionModel {
    all: boolean = false
    humans?: number
    ais?: number
    uids?: Array<string>
    entities?: MentionEntity[]
}

// ─── Extracted functions (mirroring production code) ─────────────

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function buildMentionRegex(members: MemberInfo[]): RegExp {
    const specialNames = ["所有人", "all", "everyone", "所有AI", "All AIs"]
    const allNames = [...specialNames, ...members.map((m) => m.name)]
    const unique = [...new Set(allNames)]
    unique.sort((a, b) => b.length - a.length)
    const pattern = unique.map(escapeRegExp).join("|")
    return new RegExp(`@(${pattern})(?=[\\s，。！？,!?]|$)`, "gi")
}

function parseMentionMarkers(
    text: string,
    members: MemberInfo[]
): Array<{ type: string; text?: string; attrs?: { id: string; label: string } }> {
    const result: Array<{ type: string; text?: string; attrs?: { id: string; label: string } }> = []
    const regex = buildMentionRegex(members)
    let lastIndex = 0
    let match: RegExpExecArray | null

    while ((match = regex.exec(text)) !== null) {
        const name = match[1]
        const matchStart = match.index

        if (matchStart > lastIndex) {
            result.push({ type: 'text', text: text.slice(lastIndex, matchStart) })
        }

        const isHumans = name === '所有人' || name.toLowerCase() === 'all' || name.toLowerCase() === 'everyone'
        const isAis = name === MENTION_LABEL_AIS || name.toLowerCase() === 'all ais'
        const member = members.find(m => m.name.toLowerCase() === name.toLowerCase())

        if (isHumans) {
            result.push({
                type: 'mention',
                attrs: { id: MENTION_UID_HUMANS, label: MENTION_LABEL_HUMANS },
            })
            result.push({ type: 'text', text: ' ' })
        } else if (isAis) {
            result.push({
                type: 'mention',
                attrs: { id: MENTION_UID_AIS, label: MENTION_LABEL_AIS },
            })
            result.push({ type: 'text', text: ' ' })
        } else if (member) {
            result.push({
                type: 'mention',
                attrs: { id: member.uid, label: member.name },
            })
            result.push({ type: 'text', text: ' ' })
        } else {
            result.push({ type: 'text', text: match[0] })
        }

        lastIndex = match.index + match[0].length
        if (isHumans || isAis || member) {
            if (lastIndex < text.length && /\s/.test(text[lastIndex])) {
                lastIndex++
            }
        }
    }

    if (lastIndex < text.length) {
        result.push({ type: 'text', text: text.slice(lastIndex) })
    }

    return result
}

function formatMentionTextV2(text: string): {
    content: string;
    mention: MentionModel | undefined;
} {
    const entities: MentionEntity[] = [];
    const uids: string[] = [];
    let result = '';
    let cursor = 0;
    let all = false;
    let humans = false;
    let ais = false;

    const placeholderPattern = /@\[([^:\]]+):([^\]]+)\]/g;
    let match;

    while ((match = placeholderPattern.exec(text)) !== null) {
        const uid = match[1];
        const name = match[2];

        result += text.substring(cursor, match.index);

        if (uid === '-1') {
            all = true;
            result += `@${MENTION_LABEL_HUMANS}`;
        } else if (uid === MENTION_UID_HUMANS) {
            humans = true;
            result += `@${MENTION_LABEL_HUMANS}`;
        } else if (uid === MENTION_UID_AIS) {
            ais = true;
            result += `@${MENTION_LABEL_AIS}`;
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

    if (all || humans || ais || entities.length > 0) {
        const mention = new MentionModel();
        mention.all = all;
        if (uids.length > 0) mention.uids = uids;
        if (entities.length > 0) mention.entities = entities;
        if (humans) mention.humans = 1;
        if (ais) mention.ais = 1;
        return { content: result, mention };
    }

    return { content: result, mention: undefined };
}

// Simulates extractMentionsFromEditor traversal on a Tiptap JSON doc
function extractMentionsFromJSON(doc: any): string {
    let result = ''

    function traverse(node: any) {
        if (node.type === 'text') {
            result += node.text
        } else if (node.type === 'mention') {
            const uid = node.attrs.id
            const label = node.attrs.label
            result += `@[${uid}:${label}]`
        } else if (node.type === 'hardBreak') {
            result += '\n'
        } else if (node.content) {
            node.content.forEach(traverse)
        }
    }

    if (doc.content) {
        doc.content.forEach((block: any, i: number) => {
            if (i > 0) result += '\n'
            traverse(block)
        })
    }

    return result
}

// ─── Tests ───────────────────────────────────────────────────────

describe('parseMentionMarkers', () => {
    const members: MemberInfo[] = [
        { uid: 'uid_chen', name: '陈皮皮' },
        { uid: 'uid_bob', name: 'Bob' },
        { uid: 'uid_alice', name: 'Alice' },
    ]

    it('should parse single mention', () => {
        const result = parseMentionMarkers('@陈皮皮 看一下', members)
        expect(result).toEqual([
            { type: 'mention', attrs: { id: 'uid_chen', label: '陈皮皮' } },
            { type: 'text', text: ' ' },
            { type: 'text', text: '看一下' },
        ])
    })

    it('should parse multiple mentions', () => {
        const result = parseMentionMarkers('@陈皮皮 和 @Bob 请看下', members)
        const mentions = result.filter(n => n.type === 'mention')
        expect(mentions).toHaveLength(2)
        expect(mentions[0].attrs).toEqual({ id: 'uid_chen', label: '陈皮皮' })
        expect(mentions[1].attrs).toEqual({ id: 'uid_bob', label: 'Bob' })
    })

    it('should keep unmatched @name as plain text', () => {
        const result = parseMentionMarkers('@不存在的人 hello', members)
        expect(result).toEqual([
            { type: 'text', text: '@不存在的人 hello' },
        ])
    })

    it('should handle @所有人', () => {
        const result = parseMentionMarkers('@所有人 注意', members)
        expect(result[0]).toEqual({
            type: 'mention',
            attrs: { id: MENTION_UID_HUMANS, label: MENTION_LABEL_HUMANS },
        })
    })

    it('should handle @all (English)', () => {
        const result = parseMentionMarkers('@all check this', members)
        expect(result[0]).toEqual({
            type: 'mention',
            attrs: { id: MENTION_UID_HUMANS, label: MENTION_LABEL_HUMANS },
        })
    })

    it('should handle @everyone (English)', () => {
        const result = parseMentionMarkers('@everyone check this', members)
        expect(result[0]).toEqual({
            type: 'mention',
            attrs: { id: MENTION_UID_HUMANS, label: MENTION_LABEL_HUMANS },
        })
    })

    it('should handle @所有AI', () => {
        const result = parseMentionMarkers('@所有AI 看一下', members)
        expect(result[0]).toEqual({
            type: 'mention',
            attrs: { id: MENTION_UID_AIS, label: MENTION_LABEL_AIS },
        })
    })

    it('should handle @All AIs (English)', () => {
        const result = parseMentionMarkers('@All AIs check this', members)
        expect(result[0]).toEqual({
            type: 'mention',
            attrs: { id: MENTION_UID_AIS, label: MENTION_LABEL_AIS },
        })
    })

    it('should still match @所有AI with empty members list', () => {
        const result = parseMentionMarkers('@所有AI 注意', [])
        expect(result[0]).toEqual({
            type: 'mention',
            attrs: { id: MENTION_UID_AIS, label: MENTION_LABEL_AIS },
        })
    })

    it('should return plain text when no @markers', () => {
        const result = parseMentionMarkers('今天天气不错', members)
        expect(result).toEqual([{ type: 'text', text: '今天天气不错' }])
    })

    it('should handle empty members list', () => {
        const result = parseMentionMarkers('@陈皮皮 hello', [])
        // With empty members, only special names (所有人/all/everyone) match
        expect(result).toEqual([{ type: 'text', text: '@陈皮皮 hello' }])
    })

    it('should still match @所有人 with empty members list', () => {
        const result = parseMentionMarkers('@所有人 注意', [])
        expect(result[0]).toEqual({
            type: 'mention',
            attrs: { id: MENTION_UID_HUMANS, label: MENTION_LABEL_HUMANS },
        })
    })

    it('should handle @mention at end of text', () => {
        const result = parseMentionMarkers('请看 @Bob', members)
        const mentions = result.filter(n => n.type === 'mention')
        expect(mentions).toHaveLength(1)
        expect(mentions[0].attrs?.id).toBe('uid_bob')
    })

    it('should handle empty text', () => {
        const result = parseMentionMarkers('', members)
        expect(result).toEqual([])
    })

    it('should handle mixed matched and unmatched mentions', () => {
        const result = parseMentionMarkers('@陈皮皮 和 @不存在 请看', members)
        const mentions = result.filter(n => n.type === 'mention')
        expect(mentions).toHaveLength(1)
        expect(mentions[0].attrs?.id).toBe('uid_chen')
        const texts = result.filter(n => n.type === 'text').map(n => n.text)
        expect(texts.join('')).toContain('@不存在')
    })

    it('should handle text with leading content before mention', () => {
        const result = parseMentionMarkers('你好 @陈皮皮 请看下', members)
        expect(result[0]).toEqual({ type: 'text', text: '你好 ' })
        expect(result[1]).toEqual({ type: 'mention', attrs: { id: 'uid_chen', label: '陈皮皮' } })
        expect(result[2]).toEqual({ type: 'text', text: ' ' })
        expect(result[3]).toEqual({ type: 'text', text: '请看下' })
    })

    it('should not produce double spaces after matched mention', () => {
        const result = parseMentionMarkers('@Bob hello', members)
        // Should be: mention, space, "hello" — not mention, space, space, "hello"
        expect(result).toEqual([
            { type: 'mention', attrs: { id: 'uid_bob', label: 'Bob' } },
            { type: 'text', text: ' ' },
            { type: 'text', text: 'hello' },
        ])
    })

    it('should handle @mention with special chars that do not match', () => {
        const result = parseMentionMarkers('@user@domain.com 看看', members)
        // No known member matches, entire string is plain text
        expect(result).toEqual([{ type: 'text', text: '@user@domain.com 看看' }])
    })

    it('should match first member when duplicate names exist', () => {
        const dupeMembers: MemberInfo[] = [
            { uid: 'uid_a', name: '张三' },
            { uid: 'uid_b', name: '张三' },
        ]
        const result = parseMentionMarkers('@张三 看一下', dupeMembers)
        const mentions = result.filter(n => n.type === 'mention')
        expect(mentions).toHaveLength(1)
        expect(mentions[0].attrs?.id).toBe('uid_a')
    })

    it('should parse mention with space in name', () => {
        const spaceMembers: MemberInfo[] = [
            { uid: 'uid_cindy', name: 'Cindy Che' },
            { uid: 'uid_bob', name: 'Bob' },
        ]
        const result = parseMentionMarkers('@Cindy Che 看一下', spaceMembers)
        expect(result).toEqual([
            { type: 'mention', attrs: { id: 'uid_cindy', label: 'Cindy Che' } },
            { type: 'text', text: ' ' },
            { type: 'text', text: '看一下' },
        ])
    })

    it('should prefer longer name when shorter name is a prefix', () => {
        const spaceMembers: MemberInfo[] = [
            { uid: 'uid_cindy', name: 'Cindy' },
            { uid: 'uid_cindy_che', name: 'Cindy Che' },
        ]
        const result = parseMentionMarkers('@Cindy Che hello', spaceMembers)
        const mentions = result.filter(n => n.type === 'mention')
        expect(mentions).toHaveLength(1)
        expect(mentions[0].attrs?.id).toBe('uid_cindy_che')
    })

    it('should handle multiple mentions with spaces in names', () => {
        const spaceMembers: MemberInfo[] = [
            { uid: 'uid_john', name: 'John Smith' },
            { uid: 'uid_cindy', name: 'Cindy Che' },
        ]
        const result = parseMentionMarkers('@John Smith 和 @Cindy Che 请看', spaceMembers)
        const mentions = result.filter(n => n.type === 'mention')
        expect(mentions).toHaveLength(2)
        expect(mentions[0].attrs).toEqual({ id: 'uid_john', label: 'John Smith' })
        expect(mentions[1].attrs).toEqual({ id: 'uid_cindy', label: 'Cindy Che' })
    })

    it('should match name with space case-insensitively', () => {
        const spaceMembers: MemberInfo[] = [
            { uid: 'uid_cindy', name: 'Cindy Che' },
        ]
        const result = parseMentionMarkers('@cindy che hello', spaceMembers)
        const mentions = result.filter(n => n.type === 'mention')
        expect(mentions).toHaveLength(1)
        expect(mentions[0].attrs?.id).toBe('uid_cindy')
    })
})

describe('voice mention end-to-end', () => {
    const members: MemberInfo[] = [
        { uid: 'uid_chen', name: '陈皮皮' },
        { uid: 'uid_bob', name: 'Bob' },
    ]

    it('single mention should produce correct entities via send pipeline', () => {
        const nodes = parseMentionMarkers('你好 @陈皮皮 请看下', members)

        // Simulate what the editor would produce as JSON
        const editorJSON = {
            type: 'doc',
            content: [{ type: 'paragraph', content: nodes }],
        }

        const extracted = extractMentionsFromJSON(editorJSON)
        expect(extracted).toBe('你好 @[uid_chen:陈皮皮] 请看下')

        const { content, mention } = formatMentionTextV2(extracted)
        expect(content).toBe('你好 @陈皮皮 请看下')
        expect(mention?.entities).toEqual([
            { uid: 'uid_chen', offset: 3, length: 4 },
        ])
    })

    it('multiple mentions should produce correct entities', () => {
        const nodes = parseMentionMarkers('@陈皮皮 和 @Bob 请看下', members)

        const editorJSON = {
            type: 'doc',
            content: [{ type: 'paragraph', content: nodes }],
        }

        const extracted = extractMentionsFromJSON(editorJSON)
        const { content, mention } = formatMentionTextV2(extracted)

        expect(content).toBe('@陈皮皮 和 @Bob 请看下')
        expect(mention?.entities).toHaveLength(2)
        expect(mention?.entities?.[0].uid).toBe('uid_chen')
        expect(mention?.entities?.[1].uid).toBe('uid_bob')
    })

    it('@所有人 (voice) should set mention.humans = 1', () => {
        const nodes = parseMentionMarkers('@所有人 注意', members)

        const editorJSON = {
            type: 'doc',
            content: [{ type: 'paragraph', content: nodes }],
        }

        const extracted = extractMentionsFromJSON(editorJSON)
        expect(extracted).toBe('@[-2:所有人] 注意')

        const { content, mention } = formatMentionTextV2(extracted)

        expect(content).toBe('@所有人 注意')
        expect(mention?.humans).toBe(1)
        expect(mention?.all).toBe(false)
        expect(mention?.ais).toBeUndefined()
    })

    it('@所有AI (voice) should set mention.ais = 1', () => {
        const nodes = parseMentionMarkers('@所有AI 注意', members)

        const editorJSON = {
            type: 'doc',
            content: [{ type: 'paragraph', content: nodes }],
        }

        const extracted = extractMentionsFromJSON(editorJSON)
        expect(extracted).toBe('@[-3:所有AI] 注意')

        const { content, mention } = formatMentionTextV2(extracted)

        expect(content).toBe('@所有AI 注意')
        expect(mention?.ais).toBe(1)
        expect(mention?.all).toBe(false)
        expect(mention?.humans).toBeUndefined()
    })

    it('unmatched @mention should pass through as plain text', () => {
        const nodes = parseMentionMarkers('@不存在 hello', members)

        const editorJSON = {
            type: 'doc',
            content: [{ type: 'paragraph', content: nodes }],
        }

        const extracted = extractMentionsFromJSON(editorJSON)
        expect(extracted).toBe('@不存在 hello')

        const { content, mention } = formatMentionTextV2(extracted)
        expect(content).toBe('@不存在 hello')
        expect(mention).toBeUndefined()
    })

    it('mixed matched and unmatched mentions', () => {
        const nodes = parseMentionMarkers('@陈皮皮 和 @不存在 请看', members)

        const editorJSON = {
            type: 'doc',
            content: [{ type: 'paragraph', content: nodes }],
        }

        const extracted = extractMentionsFromJSON(editorJSON)
        const { content, mention } = formatMentionTextV2(extracted)

        expect(content).toBe('@陈皮皮 和 @不存在 请看')
        expect(mention?.entities).toHaveLength(1)
        expect(mention?.entities?.[0].uid).toBe('uid_chen')
    })
})
