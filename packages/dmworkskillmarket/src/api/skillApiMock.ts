import type {
  Category,
  NewSkillForm,
  PagedResult,
  PluginDisplayStatus,
  PluginListingState,
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
import {
  SkillMarketApiError,
  type CreateReviewRequestInput,
  type DelistPluginInput,
  type PluginListingResult,
  type PublishPluginInput,
  type PluginReviewPolicy,
} from "./skillApiReal";

let skills = createInitialSkills();
let autoApproveEnabled = true;

export function getReviewPolicy(): Promise<PluginReviewPolicy> {
  return withDelay({ isAutoApproveEnabled: autoApproveEnabled });
}

export function updateReviewPolicy(enabled: boolean): Promise<PluginReviewPolicy> {
  autoApproveEnabled = enabled;
  return withDelay({ isAutoApproveEnabled: enabled, updatedAt: new Date().toISOString() });
}

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
  // `pluginType` is accepted for signature parity with the real client and
  // ignored: the mock catalog only holds skills, so an "all types" listing and
  // a skill listing are the same rows here.
  _opts?: { signal?: AbortSignal; pluginType?: string }
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

/**
 * Stamp the plugin's CURRENT listing state onto a review row at read time.
 *
 * Computed per read, never stored on the row, because it is live plugin state
 * rather than part of the frozen request: an approved request whose plugin an
 * admin later delisted must start reporting `delisted` without anything going
 * back to rewrite the review record. The real backend joins it the same way.
 */
function withLiveListingState(request: ReviewRequest): ReviewRequest {
  const listingState = skills.find(
    (item) => item.id === request.pluginId
  )?.listingState;
  return {
    ...request,
    ...(listingState ? { pluginListingState: listingState } : {}),
  };
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
    status: autoApproveEnabled ? "approved" : "pending",
    kind: isFirst ? "first" : "upgrade",
    version: input.version,
    currentVersion: isFirst ? undefined : skill.version,
    changelog: input.changelog,
    readmeContent: readmeFromReviewInput(input) ?? skill.readmeContent,
    applicantId: CURRENT_USER_ID,
    applicantName: CURRENT_USER_NAME,
    decisionSource: autoApproveEnabled ? "policy" : "web",
    submittedAt: new Date().toISOString(),
    ...(autoApproveEnabled
      ? { reviewerId: CURRENT_USER_ID, reviewerName: CURRENT_USER_NAME, reviewedAt: new Date().toISOString() }
      : {}),
  };
  reviewRequests = [request, ...reviewRequests];
  reviewSnapshots.set(request.id, {
    readmeContent: request.readmeContent,
    version: request.version,
  });
  if (autoApproveEnabled) {
    skills = skills.map((item) => item.id === skill.id
      ? { ...item, visibility: "space", listingState: "published" as PluginListingState, version: input.version }
      : item);
  }
  refreshListing(request.pluginId);
  return withDelay(withLiveListingState(request));
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
    .map(withLiveListingState);
  return withDelay({
    items,
    nextCursor: page * pageSize < matched.length ? String(page + 1) : null,
    total: matched.length,
  });
}

export function getReviewRequest(id: string): Promise<ReviewRequest> {
  const found = findReview(id);
  if (!found) return withDelayReject(new Error("Review request not found"));
  return withDelay(withLiveListingState(found));
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
          // Approval is also what puts the plugin on the shelf: a publish of a
          // space-visibility plugin only opened the request, it did not list it.
          listingState: "published" as PluginListingState,
          version: found.version,
          ...(snapshot?.readmeContent !== undefined
            ? { readmeContent: snapshot.readmeContent }
            : {}),
        }
      : item
  );
  refreshListing(found.pluginId);
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
  refreshListing(found.pluginId);
  return withDelay(undefined);
}

export function cancelReview(id: string): Promise<void> {
  const found = findReview(id);
  if (!found || found.status !== "pending") {
    return withDelayReject(new Error("Review request is not pending"));
  }
  found.status = "canceled";
  found.reviewedAt = new Date().toISOString();
  refreshListing(found.pluginId);
  return withDelay(undefined);
}

// ─── Listing lifecycle: publish / delist ──────────────────────────────────
//
// The mock owns `listingState` and re-folds `displayStatus` after every
// transition, exactly as the server does per read. It is written as a fold
// rather than as assignments at each call site because that is the invariant
// under test: the status a client renders is a FUNCTION of (listing state,
// review entity), never an independently stored flag that a missed branch can
// leave stale.

/** Recompute `displayStatus` for one plugin and write it back onto the row. */
function refreshListing(pluginId: string): void {
  skills = skills.map((skill) => {
    if (skill.id !== pluginId) return skill;
    const listingState = skill.listingState ?? "draft";
    return { ...skill, listingState, displayStatus: foldDisplayStatus(pluginId, listingState) };
  });
}

function foldDisplayStatus(
  pluginId: string,
  listingState: PluginListingState
): PluginDisplayStatus {
  // reviewRequests is newest-first, matching the server's submitted_at ordering.
  const mine = reviewRequests.filter((item) => item.pluginId === pluginId);
  // A pending request wins over everything, including an already-published
  // listing: "已上架 + 有升级在审" reads as 审核中 to the applicant.
  if (mine.some((item) => item.status === "pending")) return "pending_review";
  if (listingState === "draft" && mine[0]?.status === "rejected") return "rejected";
  return listingState;
}

/**
 * Build the response for one plugin.
 *
 * `reviewId` is passed in rather than looked up, because on the wire its
 * presence means one specific thing — "this call opened a review" — and callers
 * branch on exactly that. Deriving it from whatever request happens to sit on
 * the plugin would attach a stale rejected id to an immediate private publish
 * and make that branch lie.
 */
function listingResult(pluginId: string, reviewId?: string): PluginListingResult {
  const skill = skills.find((item) => item.id === pluginId);
  const listingState = skill?.listingState ?? "draft";
  return {
    pluginId,
    listingState,
    displayStatus: foldDisplayStatus(pluginId, listingState),
    ...(reviewId ? { reviewId } : {}),
  };
}

/** Same envelope the real client normalizes a failed response into, so mock-mode
 *  callers can use `pluginConflictReason` / `pluginRequiredRole` unchanged. */
function listingError(
  code: string,
  status: number,
  message: string,
  details?: Record<string, string>
): Promise<never> {
  return withDelayReject(
    new SkillMarketApiError(code, message, status, details)
  );
}

export function publishPlugin(
  input: PublishPluginInput
): Promise<PluginListingResult> {
  const skill = skills.find((item) => item.id === input.pluginId);
  // 404, not 403 — the real endpoint refuses to confirm that someone else's
  // plugin exists.
  if (!skill) return listingError("NOT_FOUND", 404, "Plugin not found");
  if ((skill.listingState ?? "draft") === "published") {
    return listingError("CONFLICT", 409, "Already published", {
      conflict_reason: "already_published",
    });
  }
  if (reviewRequests.some((item) => item.pluginId === skill.id && item.status === "pending")) {
    return listingError("CONFLICT", 409, "A review is already pending", {
      conflict_reason: "review_pending",
    });
  }
  // The branch the server owns: what "publish" means comes from the plugin's
  // visibility, not from the caller. A private plugin is visible to its owner
  // only, so nobody needs to vet it; anything wider enters the Space queue.
  if (skill.visibility === "private") {
    skills = skills.map((item) =>
      item.id === skill.id
        ? {
            ...item,
            listingState: "published" as PluginListingState,
            version: input.version ?? item.version,
          }
        : item
    );
    refreshListing(skill.id);
    return withDelay(listingResult(skill.id));
  }
  reviewSeq += 1;
  const request: ReviewRequest = {
    id: `review-${reviewSeq}`,
    pluginId: skill.id,
    pluginName: skill.displayName || skill.name,
    pluginType: "skill",
    pluginIconUrl: skill.iconUrl || undefined,
    spaceId: CURRENT_SPACE_ID,
    targetScope: "space",
    status: autoApproveEnabled ? "approved" : "pending",
    // A publish freezes the row as-is, so it is a first listing whenever the row
    // is not already on the shelf.
    kind: (skill.listingState ?? "draft") === "published" ? "upgrade" : "first",
    version: input.version ?? skill.version,
    changelog: input.changelog,
    readmeContent: skill.readmeContent,
    applicantId: CURRENT_USER_ID,
    applicantName: CURRENT_USER_NAME,
    decisionSource: autoApproveEnabled ? "policy" : "web",
    submittedAt: new Date().toISOString(),
    ...(autoApproveEnabled
      ? { reviewerId: CURRENT_USER_ID, reviewerName: CURRENT_USER_NAME, reviewedAt: new Date().toISOString() }
      : {}),
  };
  reviewRequests = [request, ...reviewRequests];
  reviewSnapshots.set(request.id, {
    readmeContent: request.readmeContent,
    version: request.version,
  });
  if (autoApproveEnabled) {
    skills = skills.map((item) => item.id === skill.id
      ? { ...item, listingState: "published" as PluginListingState, version: request.version }
      : item);
    refreshListing(skill.id);
    return withDelay(listingResult(skill.id));
  }
  refreshListing(skill.id);
  // The review id IS the outcome here: it tells the caller this publish opened
  // a request instead of listing the plugin.
  return withDelay(listingResult(skill.id, request.id));
}

export function delistPlugin(
  input: DelistPluginInput
): Promise<PluginListingResult> {
  const skill = skills.find((item) => item.id === input.pluginId);
  if (!skill) return listingError("NOT_FOUND", 404, "Plugin not found");
  if ((skill.listingState ?? "draft") !== "published") {
    return listingError("CONFLICT", 409, "Plugin is not published", {
      conflict_reason: "not_published",
    });
  }
  // The mock's single user is also the Space admin, so the 403 path is not
  // reachable here; `required_role` is documented on the real client instead.
  skills = skills.map((item) =>
    item.id === skill.id
      ? { ...item, listingState: "delisted" as PluginListingState }
      : item
  );
  refreshListing(skill.id);
  // No review id: a takedown never opens a review request.
  return withDelay(listingResult(skill.id));
}
