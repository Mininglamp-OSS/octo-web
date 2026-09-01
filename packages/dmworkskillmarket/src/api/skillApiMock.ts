import type {
  Category,
  NewSkillForm,
  PagedResult,
  ReviewListMode,
  ReviewRequest,
  ReviewStatus,
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
import type { CreateReviewRequestInput } from "./skillApiReal";

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

export function getCategories(opts?: {
  signal?: AbortSignal;
  q?: string;
  tags?: string[];
}): Promise<Category[]> {
  const filtered = applySkillQuery({ q: opts?.q, tags: opts?.tags });
  const counted = CATEGORY_SEEDS.map((category) => ({
    ...category,
    skillCount:
      category.id === "all"
        ? filtered.length
        : filtered.filter((skill) => skill.categoryId === category.id).length,
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

// ─── Review requests ─────────────────────────────────────────────────────
// A real (if small) in-memory state machine so VITE_USE_MOCK dev mode
// exercises the workflow instead of handing the UI empty objects. Mirrors the
// server rules that matter to the UI: one pending request per plugin, reject
// requires a reason, approve flips a first-listing draft to `space`, and an
// upgrade submission must carry the new content (see below).

let reviewRequests: ReviewRequest[] = [];
let reviewSeq = 0;
/** Content frozen with each request, keyed by review id. Approving an upgrade
 *  applies it — which is what makes the mock exercise the real invariant that
 *  the live plugin does not change until approval. */
const reviewSnapshots = new Map<string, { readmeContent?: string; version: string }>();

function findReview(id: string): ReviewRequest | undefined {
  return reviewRequests.find((item) => item.id === id);
}

export function createReviewRequest(
  input: CreateReviewRequestInput
): Promise<ReviewRequest> {
  const skill = skills.find((item) => item.id === input.pluginId);
  if (!skill) return withDelayReject(new Error("Plugin not found"));
  if (
    reviewRequests.some(
      (item) => item.pluginId === input.pluginId && item.status === "pending"
    )
  ) {
    return withDelayReject(new Error("A request is already pending"));
  }
  const isFirst = skill.visibility === "private";
  // An upgrade must carry the new content. For a listed plugin the plugin row
  // IS the live content, so freezing "whatever is on the row" would have the
  // reviewer approve something that already shipped. The real backend rejects
  // this too; enforcing it here keeps mock mode honest.
  const hasContent =
    input.parseTaskId !== undefined ||
    input.manifestJson !== undefined ||
    input.pluginJson !== undefined;
  if (!isFirst && !hasContent) {
    return withDelayReject(new Error("content is required for an upgrade"));
  }
  reviewSeq += 1;
  const request: ReviewRequest = {
    id: `review-${reviewSeq}`,
    pluginId: input.pluginId,
    pluginName: skill.displayName || skill.name,
    pluginType: "skill",
    pluginIconUrl: skill.iconUrl || undefined,
    spaceId: CURRENT_SPACE_ID,
    targetScope: "space",
    status: "pending",
    kind: isFirst ? "first" : "upgrade",
    version: input.version,
    currentVersion: isFirst ? undefined : skill.version,
    changelog: input.changelog,
    readmeContent: readmeFromReviewInput(input) ?? skill.readmeContent,
    applicantId: CURRENT_USER_ID,
    applicantName: CURRENT_USER_NAME,
    decisionSource: "web",
    submittedAt: new Date().toISOString(),
  };
  reviewRequests = [request, ...reviewRequests];
  reviewSnapshots.set(request.id, {
    readmeContent: request.readmeContent,
    version: request.version,
  });
  return withDelay({ ...request });
}

/** Pull the submitted SKILL.md out of a declared package document, when the
 *  caller supplied one. A parse-task submission has no client-side document —
 *  the server materializes it — so this returns undefined there. */
function readmeFromReviewInput(input: CreateReviewRequestInput): string | undefined {
  const attachments = (input.pluginJson as
    | { attachments?: Array<{ path?: string; raw_content?: string }> }
    | undefined)?.attachments;
  if (!Array.isArray(attachments)) return undefined;
  return attachments.find((a) => a?.path === "SKILL.md")?.raw_content;
}


export function listReviewRequests(
  _mode: ReviewListMode,
  params?: {
    status?: ReviewStatus;
    page?: number;
    pageSize?: number;
    signal?: AbortSignal;
  }
): Promise<PagedResult<ReviewRequest>> {
  // `mode` is irrelevant here: the mock has a single user who is also the
  // reviewer, so `mine` and `space` see the same rows.
  const matched = reviewRequests.filter(
    (item) => !params?.status || item.status === params.status
  );
  const page = params?.page && params.page > 0 ? params.page : 1;
  const pageSize = params?.pageSize ?? 20;
  const start = (page - 1) * pageSize;
  const items = matched
    .slice(start, start + pageSize)
    .map((item) => ({ ...item }));
  return withDelay({
    items,
    nextCursor: page * pageSize < matched.length ? String(page + 1) : null,
    total: matched.length,
  });
}

export function getReviewRequest(id: string): Promise<ReviewRequest> {
  const found = findReview(id);
  if (!found) return withDelayReject(new Error("Review request not found"));
  return withDelay({ ...found });
}

export function approveReview(id: string): Promise<void> {
  const found = findReview(id);
  if (!found || found.status !== "pending") {
    return withDelayReject(new Error("Review request is not pending"));
  }
  found.status = "approved";
  found.reviewerId = CURRENT_USER_ID;
  found.reviewerName = CURRENT_USER_NAME;
  found.reviewedAt = new Date().toISOString();
  // Approval is the moment the frozen content becomes live — not submission.
  const snapshot = reviewSnapshots.get(id);
  skills = skills.map((item) =>
    item.id === found.pluginId
      ? {
          ...item,
          visibility: "space",
          version: found.version,
          ...(snapshot?.readmeContent !== undefined
            ? { readmeContent: snapshot.readmeContent }
            : {}),
        }
      : item
  );
  return withDelay(undefined);
}

export function rejectReview(id: string, reason: string): Promise<void> {
  const found = findReview(id);
  if (!found || found.status !== "pending") {
    return withDelayReject(new Error("Review request is not pending"));
  }
  if (!reason.trim()) return withDelayReject(new Error("reason is required"));
  found.status = "rejected";
  found.reason = reason;
  found.reviewerId = CURRENT_USER_ID;
  found.reviewerName = CURRENT_USER_NAME;
  found.reviewedAt = new Date().toISOString();
  return withDelay(undefined);
}

export function cancelReview(id: string): Promise<void> {
  const found = findReview(id);
  if (!found || found.status !== "pending") {
    return withDelayReject(new Error("Review request is not pending"));
  }
  found.status = "canceled";
  found.reviewedAt = new Date().toISOString();
  return withDelay(undefined);
}
