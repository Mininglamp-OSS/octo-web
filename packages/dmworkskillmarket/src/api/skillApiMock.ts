import type {
  Category,
  NewSkillForm,
  PagedResult,
  Skill,
  SkillListQuery,
  SkillTag,
  SkillVersion,
  UpdateSkillForm,
} from "../types/skill";
import {
  CATEGORY_SEEDS,
  CURRENT_SPACE_ID,
  CURRENT_USER_ID,
  CURRENT_USER_NAME,
  createInitialSkills,
} from "./mockData";

let skills = createInitialSkills();

function withDelay<T>(value: T): Promise<T> {
  return new Promise((resolve) => {
    globalThis.setTimeout(() => resolve(value), 220);
  });
}

function withDelayReject(error: Error): Promise<never> {
  return new Promise((_, reject) => {
    globalThis.setTimeout(() => reject(error), 220);
  });
}

function cloneSkill(skill: Skill): Skill {
  return { ...skill, tags: [...skill.tags] };
}

function normalizeQuery(query?: string): string {
  return (query ?? "").trim().toLowerCase();
}

function getCategoryName(categoryId: string): string {
  return CATEGORY_SEEDS.find((c) => c.id === categoryId)?.name ?? "";
}

function matchesQuery(skill: Skill, q: string): boolean {
  if (!q) return true;
  return [
    skill.name,
    skill.description,
    skill.ownerName,
    skill.visibility,
    skill.categoryId,
    getCategoryName(skill.categoryId),
    ...skill.tags,
  ]
    .join(" ")
    .toLowerCase()
    .includes(q);
}

function applySkillQuery(query: SkillListQuery): Skill[] {
  const q = normalizeQuery(query.q);
  const selectedTags = query.tags?.filter(Boolean) ?? [];
  return skills
    .filter((skill) => !query.mine || skill.ownerId === CURRENT_USER_ID)
    .filter(
      (skill) =>
        !query.categoryId ||
        query.categoryId === "all" ||
        skill.categoryId === query.categoryId
    )
    .filter((skill) => selectedTags.every((tag) => skill.tags.includes(tag)))
    .filter((skill) => matchesQuery(skill, q))
    .sort((a, b) => {
      if (query.sort === "latest")
        return b.createdAt.localeCompare(a.createdAt);
      return b.updatedAt.localeCompare(a.updatedAt);
    });
}

function pageSkills(items: Skill[], query: SkillListQuery): PagedResult<Skill> {
  const limit = query.limit ?? 20;
  const offset = Number(query.cursor ?? 0);
  const page = items.slice(offset, offset + limit).map(cloneSkill);
  const nextOffset = offset + page.length;
  return {
    items: page,
    nextCursor: nextOffset < items.length ? String(nextOffset) : null,
    total: items.length,
  };
}

export function getCategories(_opts?: {
  signal?: AbortSignal;
}): Promise<Category[]> {
  const counted = CATEGORY_SEEDS.map((category) => ({
    ...category,
    skillCount:
      category.id === "all"
        ? skills.length
        : skills.filter((skill) => skill.categoryId === category.id).length,
  }));
  return withDelay(counted);
}

export function getSkills(
  query: SkillListQuery = {},
  _opts?: { signal?: AbortSignal }
): Promise<PagedResult<Skill>> {
  return withDelay(pageSkills(applySkillQuery(query), query));
}

export function getMySkills(
  query: SkillListQuery = {},
  _opts?: { signal?: AbortSignal }
): Promise<PagedResult<Skill>> {
  return getSkills({ ...query, mine: true });
}

export function getSkillTags(
  q = "",
  _opts?: { signal?: AbortSignal }
): Promise<SkillTag[]> {
  const query = normalizeQuery(q);
  const names = Array.from(new Set(skills.flatMap((skill) => skill.tags)))
    .filter((name) => !query || name.toLowerCase().includes(query))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 20)
    .map((name) => ({ name, createdBy: CURRENT_USER_ID }));
  return withDelay(names);
}

export function getSkill(id: string): Promise<Skill> {
  const skill = skills.find((item) => item.id === id);
  if (!skill) return withDelayReject(new Error("Skill not found"));
  return withDelay(cloneSkill(skill));
}

export function trackSkillView(id: string): Promise<void> {
  skills = skills.map((skill) =>
    skill.id === id
      ? { ...skill, viewCount: (skill.viewCount ?? 0) + 1 }
      : skill
  );
  return withDelay(undefined);
}

export function createSkill(form: NewSkillForm): Promise<Skill> {
  const now = new Date().toISOString();
  const baseId =
    form.name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "new-skill";
  let id = baseId;
  let suffix = 2;
  while (skills.some((skill) => skill.id === id)) {
    id = `${baseId}-${suffix}`;
    suffix += 1;
  }
  const skill: Skill = {
    id,
    name: form.name.trim(),
    displayName: form.displayName ?? "",
    description: form.description.trim(),
    categoryId: form.categoryId,
    tags: [...form.tags],
    ownerId: CURRENT_USER_ID,
    ownerName: CURRENT_USER_NAME,
    spaceId: CURRENT_SPACE_ID,
    visibility: form.visibility,
    version: form.version ?? "1.0.0",
    readmeContent: form.readmeContent,
    iconUrl: form.iconUrl ?? "",
    fileName: form.fileName,
    fileUrl: `mock://skills/${id}.zip`,
    fileSize: form.fileSize,
    createdAt: now,
    updatedAt: now,
  };
  skills = [skill, ...skills];
  return withDelay(cloneSkill(skill));
}

export function updateSkill(id: string, form: UpdateSkillForm): Promise<Skill> {
  const skill = skills.find((item) => item.id === id);
  if (!skill) return withDelayReject(new Error("Skill not found"));
  const updated: Skill = {
    ...skill,
    ...form,
    version: form.version ?? skill.version,
    tags: form.tags ? [...form.tags] : [...skill.tags],
    updatedAt: new Date().toISOString(),
  };
  skills = skills.map((item) => (item.id === id ? updated : item));
  return withDelay(cloneSkill(updated));
}

export function deleteSkill(id: string): Promise<void> {
  const exists = skills.some((item) => item.id === id);
  if (!exists) return withDelayReject(new Error("Skill not found"));
  skills = skills.filter((item) => item.id !== id);
  return withDelay(undefined);
}

export function listVersions(_skillId: string): Promise<SkillVersion[]> {
  return withDelay([]);
}
