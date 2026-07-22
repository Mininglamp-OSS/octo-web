import { httpGet } from "./http";
import type {
  AssigneeType,
  Issue,
  IssueComment,
  TaskRun,
  TimelineEntry,
  Workspace,
} from "./types";

export interface IssuePreviewData {
  workspace: Workspace;
  issue: Issue;
  children: Issue[];
  comments: IssueComment[];
  timeline: TimelineEntry[];
  runs: TaskRun[];
}

interface PreviewDirectory {
  actorNames: Map<string, string>;
  projectNames: Map<string, string>;
  memberOctoUids: Map<string, string>;
}

export type ResolvePreviewMemberName = (uid: string) => Promise<string | null>;

const actorKey = (
  type: string | null | undefined,
  id: string | null | undefined
) => (type && id ? `${type}:${id}` : "");

async function loadPreviewDirectory(
  workspace: Workspace
): Promise<PreviewDirectory> {
  const scope = { workspaceSlug: workspace.slug };
  const [members, agents, squads, projects] = await Promise.all([
    httpGet<Array<{ user_id: string; name: string; octo_uid?: string | null }>>(
      `/workspaces/${workspace.id}/members`,
      undefined,
      scope
    ).catch(() => []),
    httpGet<Array<{ id: string; name: string }>>(
      "/agents",
      { include_archived: true },
      scope
    ).catch(() => []),
    httpGet<Array<{ id: string; name: string }>>(
      "/squads",
      undefined,
      scope
    ).catch(() => []),
    httpGet<{ projects?: Array<{ id: string; title: string }> }>(
      "/projects",
      undefined,
      scope
    ).catch(() => ({ projects: [] })),
  ]);
  const actorNames = new Map<string, string>();
  const memberOctoUids = new Map<string, string>();
  members.forEach((item) => {
    actorNames.set(actorKey("member", item.user_id), item.name);
    // Older task records can store the bridged Octo uid directly instead of
    // the Fleet member UUID. Resolve both identities to the same display name.
    if (item.octo_uid) {
      actorNames.set(actorKey("member", item.octo_uid), item.name);
      memberOctoUids.set(item.user_id, item.octo_uid);
      memberOctoUids.set(item.octo_uid, item.octo_uid);
    }
  });
  agents.forEach((item) =>
    actorNames.set(actorKey("agent", item.id), item.name)
  );
  squads.forEach((item) =>
    actorNames.set(actorKey("squad", item.id), item.name)
  );
  return {
    actorNames,
    memberOctoUids,
    projectNames: new Map(
      (projects.projects ?? []).map((item) => [item.id, item.title])
    ),
  };
}

async function resolveUsedMemberNames(
  directory: PreviewDirectory,
  actors: Array<{ type: string | null | undefined; id: string | null | undefined }>,
  resolveMemberName?: ResolvePreviewMemberName
): Promise<void> {
  if (!resolveMemberName) return;

  // Only resolve member identities that are visible in this detail snapshot.
  // A Fleet member UUID is translated to its bridged Octo uid when possible;
  // old records that already store an Octo uid are queried directly.
  const actorIdsByOctoUid = new Map<string, Set<string>>();
  actors.forEach(({ type, id }) => {
    if (type !== "member" || !id) return;
    const octoUid = directory.memberOctoUids.get(id) ?? id;
    const actorIds = actorIdsByOctoUid.get(octoUid) ?? new Set<string>();
    actorIds.add(id);
    actorIdsByOctoUid.set(octoUid, actorIds);
  });

  await Promise.all(
    [...actorIdsByOctoUid.entries()].map(async ([octoUid, actorIds]) => {
      const name = await resolveMemberName(octoUid).catch(() => null);
      if (!name) return;
      directory.actorNames.set(actorKey("member", octoUid), name);
      actorIds.forEach((id) =>
        directory.actorNames.set(actorKey("member", id), name)
      );
    })
  );
}

function actorName(
  directory: PreviewDirectory,
  type: string | null | undefined,
  id: string | null | undefined
): string | null {
  if (!id) return null;
  return directory.actorNames.get(actorKey(type, id)) ?? id;
}

function enrichIssue(issue: Issue, directory: PreviewDirectory): Issue {
  return {
    ...issue,
    assignee_name: actorName(directory, issue.assignee_type, issue.assignee_id),
    creator_name: actorName(
      directory,
      issue.creator_type ?? "member",
      issue.creator_id
    ),
    project_name: issue.project_id
      ? directory.projectNames.get(issue.project_id) ?? issue.project_id
      : null,
  };
}

async function resolveScopedIssue(
  workspaceSlug: string,
  issueIdentifier: string
): Promise<Issue | null> {
  const scope = { workspaceSlug };
  const direct = await httpGet<Issue>(
    `/issues/${encodeURIComponent(issueIdentifier)}`,
    undefined,
    scope
  ).catch(() => null);
  if (direct?.identifier?.toLowerCase() === issueIdentifier.toLowerCase()) {
    return direct;
  }
  const searched = await httpGet<{ issues?: Issue[] }>(
    "/issues/search",
    { q: issueIdentifier, limit: 50, include_closed: true },
    scope
  ).catch(() => ({ issues: [] }));
  return (
    (searched.issues ?? []).find(
      (issue) =>
        issue.identifier.toLowerCase() === issueIdentifier.toLowerCase()
    ) ?? null
  );
}

/**
 * Read-only task snapshot for the chat-side preview. Every workspace-scoped
 * request carries the link's slug explicitly, so opening a preview never
 * changes the full Loop page's selected workspace or directory cache.
 */
export async function getIssuePreview(
  workspaceSlug: string,
  issueIdentifier: string,
  resolveMemberName?: ResolvePreviewMemberName
): Promise<IssuePreviewData | null> {
  const workspaces = await httpGet<Workspace[]>("/workspaces");
  const workspace = workspaces.find((item) => item.slug === workspaceSlug);
  if (!workspace) return null;
  const rawIssue = await resolveScopedIssue(workspaceSlug, issueIdentifier);
  if (!rawIssue) return null;

  const scope = { workspaceSlug };
  const issueId = rawIssue.id;
  const [
    directory,
    childrenResult,
    commentsResult,
    timelineResult,
    runsResult,
  ] = await Promise.all([
    loadPreviewDirectory(workspace),
    httpGet<{ issues?: Issue[] }>(
      `/issues/${issueId}/children`,
      undefined,
      scope
    ).catch(() => ({ issues: [] })),
    httpGet<IssueComment[]>(
      `/issues/${issueId}/comments`,
      undefined,
      scope
    ).catch(() => []),
    httpGet<TimelineEntry[]>(
      `/issues/${issueId}/timeline`,
      undefined,
      scope
    ).catch(() => []),
    httpGet<TaskRun[]>(`/issues/${issueId}/task-runs`, undefined, scope).catch(
      () => []
    ),
  ]);

  await resolveUsedMemberNames(
    directory,
    [
      { type: rawIssue.creator_type ?? "member", id: rawIssue.creator_id },
      { type: rawIssue.assignee_type, id: rawIssue.assignee_id },
      ...(childrenResult.issues ?? []).flatMap((issue) => [
        { type: issue.creator_type ?? "member", id: issue.creator_id },
        { type: issue.assignee_type, id: issue.assignee_id },
      ]),
      ...commentsResult.map((comment) => ({
        type: comment.author_type,
        id: comment.author_id,
      })),
      ...timelineResult.map((entry) => ({
        type: entry.actor_type,
        id: entry.actor_id,
      })),
    ],
    resolveMemberName
  );

  const comments = commentsResult.map((comment) => ({
    ...comment,
    author_name:
      actorName(
        directory,
        comment.author_type as AssigneeType,
        comment.author_id
      ) ?? comment.author_id,
  }));
  const timeline = timelineResult.map((entry) => ({
    ...entry,
    actor_name: actorName(directory, entry.actor_type, entry.actor_id),
  }));
  const runs = runsResult
    .map((run) => ({
      ...run,
      agent_name: actorName(directory, "agent", run.agent_id),
    }))
    .sort((a, b) =>
      (b.created_at ?? b.dispatched_at ?? "").localeCompare(
        a.created_at ?? a.dispatched_at ?? ""
      )
    );

  return {
    workspace,
    issue: enrichIssue(rawIssue, directory),
    children: (childrenResult.issues ?? []).map((issue) =>
      enrichIssue(issue, directory)
    ),
    comments,
    timeline,
    runs,
  };
}
