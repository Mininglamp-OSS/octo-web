/**
 * 线性解析 mention 标记 `@[uid:name]`，替换为 `@name`。
 * 不使用正则表达式，避免 ReDoS 风险（CodeQL Polynomial RegEx）。
 *
 * 格式：`@[uid:displayName]`
 * - uid = "-1" 时显示 "@所有人"
 * - 其他 uid 显示 "@displayName"
 */
export function replaceMentions(text: string): string {
    let result = '';
    let i = 0;
    while (i < text.length) {
        // 查找 @[ 起始标记
        if (text[i] === '@' && i + 1 < text.length && text[i + 1] === '[') {
            // 找到 @[，开始解析
            const start = i;
            i += 2; // 跳过 @[

            // 找 : 分隔符
            let colonIdx = -1;
            while (i < text.length && text[i] !== ']' && text[i] !== '\n') {
                if (text[i] === ':' && colonIdx === -1) {
                    colonIdx = i;
                }
                i++;
            }

            // 找到 ] 结束标记
            if (i < text.length && text[i] === ']' && colonIdx !== -1) {
                const uid = text.slice(start + 2, colonIdx);
                const name = text.slice(colonIdx + 1, i);
                result += uid === '-1' ? t('todo.mention.everyone') : `@${name}`;
                i++; // 跳过 ]
            } else {
                // 格式不完整，原样输出
                result += text[start];
                i = start + 1;
            }
        } else {
            result += text[i];
            i++;
        }
    }
    return result;
}

/**
 * 线性解析 mention 标记，提取 uid 列表 + 替换后的文本。
 * 用于 parseMentionText 场景（需要同时拿 uid 和显示文本）。
 */
export function parseMentions(raw: string): { title: string; uids: string[] } {
    const uids: string[] = [];
    let result = '';
    let i = 0;
    while (i < raw.length) {
        if (raw[i] === '@' && i + 1 < raw.length && raw[i + 1] === '[') {
            const start = i;
            i += 2;

            let colonIdx = -1;
            while (i < raw.length && raw[i] !== ']' && raw[i] !== '\n') {
                if (raw[i] === ':' && colonIdx === -1) {
                    colonIdx = i;
                }
                i++;
            }

            if (i < raw.length && raw[i] === ']' && colonIdx !== -1) {
                const uid = raw.slice(start + 2, colonIdx);
                const name = raw.slice(colonIdx + 1, i);
                if (uid && uid !== '-1') uids.push(uid);
                result += uid === '-1' ? t('todo.mention.everyone') : `@${name}`;
                i++;
            } else {
                result += raw[start];
                i = start + 1;
            }
        } else {
            result += raw[i];
            i++;
        }
    }
    return { title: result.trim(), uids: [...new Set(uids)] };
}
import { t } from "@octo/base";
