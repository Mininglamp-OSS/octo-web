// 保留捕获组尾部换行以对齐服务端 Go 侧 `server/internal/skill` 的正则语义。
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?\r?\n)---\r?\n?/;

export type SkillFrontmatter = Record<string, string>;

export interface ParsedFrontmatter {
  frontmatter: SkillFrontmatter | null;
  body: string;
}

function stripQuotes(v: string): string {
  if (v.length >= 2 && ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'")))) {
    return v.slice(1, -1);
  }
  return v;
}

// 轻量 frontmatter 解析：仅用于展示技能文件头部的 key: value 字段。
// 不引入 yaml 依赖；如需严格 YAML 解析（多行块标量等），改用 `yaml` 包的 parse。
function parseSimpleYaml(block: string): SkillFrontmatter {
  const result: SkillFrontmatter = {};
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = stripQuotes(line.slice(idx + 1).trim());
    if (key) result[key] = value;
  }
  return result;
}

/** 解析 Markdown frontmatter：无头/无字段时回退为纯正文。 */
export function parseFrontmatter(raw: string): ParsedFrontmatter {
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) return { frontmatter: null, body: raw };

  const body = raw.slice(match[0].length);
  const parsed = parseSimpleYaml(match[1]!);

  return {
    frontmatter: Object.keys(parsed).length > 0 ? parsed : null,
    body,
  };
}

/** 是否已带 `---\n...\n---` frontmatter 分隔块（不要求字段非空）。 */
export function hasFrontmatter(raw: string): boolean {
  return FRONTMATTER_RE.test(raw);
}

// 把值渲染成安全的 YAML 标量：含冒号/井号/引号/换行或首尾空格等不安全字符时用
// 双引号包裹（JSON 字符串是合法的 YAML 双引号标量，转义规则一致）。
function yamlScalar(v: string): string {
  const unsafe = v === "" || /[:#\n"'\\]/.test(v) || /^[\s\-?&*!|>%@`[\]{},]/.test(v) || /\s$/.test(v);
  return unsafe ? JSON.stringify(v) : v;
}

/**
 * 确保 SKILL.md 带标准 frontmatter，且 name/description 两个必填字段一定存在：
 * 无分隔块时按 `---\nname: ...\ndescription: ...\n---` 生成头部拼在正文前；已有
 * 分隔块但缺 name/description 时，用入参（通常来自 DB 记录）补齐缺失字段。
 *
 * 关键点：不能因为「已有 frontmatter 块」就原样返回——若块内没有 name，头部会
 * 缺标题，详情页的 name 输入框读到空值、保存校验必然失败，技能变得不可编辑。
 * 补齐缺失字段可保证头部标题与 DB 标题一致（agent 依赖二者一致才能正确使用技能）。
 */
export function ensureSkillFrontmatter(name: string, description: string, content: string): string {
  if (!hasFrontmatter(content)) {
    const header = `---\nname: ${yamlScalar(name)}\ndescription: ${yamlScalar(description)}\n---\n`;
    return content.trim() ? `${header}\n${content}` : header;
  }
  const parsed = parseFrontmatter(content).frontmatter;
  let out = content;
  if (!parsed?.name?.trim()) out = setFrontmatterField(out, "name", name);
  if (!parsed?.description?.trim()) out = setFrontmatterField(out, "description", description);
  return out;
}

/**
 * 更新（或插入）frontmatter 中某个字段并返回新的完整文本，其余行、正文保持不变。
 * 无 frontmatter 时补建分隔块。用于「外层输入框 ↔ SKILL.md 头部」的双向同步：
 * content 作为唯一数据源，字段值改动后回写到头部，避免两份 name 漂移。
 */
export function setFrontmatterField(raw: string, key: string, value: string): string {
  const newLine = `${key}: ${yamlScalar(value)}`;
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) {
    const header = `---\n${newLine}\n---\n`;
    return raw.trim() ? `${header}\n${raw}` : header;
  }
  const body = raw.slice(match[0].length);
  // 捕获组尾部带一个换行；去掉后按行处理，避免产生空字段行。
  const inner = match[1]!.replace(/\r?\n$/, "");
  const lines = inner.length ? inner.split(/\r?\n/) : [];
  let replaced = false;
  const updated = lines.map((line) => {
    const idx = line.indexOf(":");
    if (!replaced && idx > 0 && line.slice(0, idx).trim() === key) {
      replaced = true;
      return newLine;
    }
    return line;
  });
  if (!replaced) updated.push(newLine);
  return `---\n${updated.join("\n")}\n---\n${body}`;
}
