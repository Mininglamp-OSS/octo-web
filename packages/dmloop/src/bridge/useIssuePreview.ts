import { useCallback, useEffect, useState } from "react";
import { UserService, WKApp } from "@octo/base";
import { getIssuePreview, type IssuePreviewData } from "../api/issuePreviewApi";

export interface IssuePreviewTarget {
  workspaceSlug: string;
  issueIdentifier: string;
  sourceUrl: string;
}

const memberNameRequests = new Map<string, Promise<string | null>>();
const previewRequests = new Map<string, Promise<IssuePreviewData | null>>();

export function resolvePreviewMemberName(uid: string): Promise<string | null> {
  const key = `${WKApp.shared.currentSpaceId}:${uid}`;
  const pending = memberNameRequests.get(key);
  if (pending) return pending;

  const request = UserService.getUserProfile(uid)
    .then((profile) => {
      const name = profile?.name;
      return typeof name === "string" && name.trim() ? name.trim() : null;
    })
    .catch(() => null)
    .then((name) => {
      // Cache successful identity resolution, but let a transient failure retry
      // the next time the preview is opened.
      if (!name && memberNameRequests.get(key) === request) {
        memberNameRequests.delete(key);
      }
      return name;
    });
  memberNameRequests.set(key, request);
  return request;
}

export function requestIssuePreview(
  target: IssuePreviewTarget,
  generation: number
): Promise<IssuePreviewData | null> {
  const key = [
    WKApp.shared.currentSpaceId,
    target.workspaceSlug,
    target.issueIdentifier,
    generation,
  ].join(":");
  const pending = previewRequests.get(key);
  if (pending) return pending;

  const request = getIssuePreview(
    target.workspaceSlug,
    target.issueIdentifier,
    resolvePreviewMemberName
  ).finally(() => {
    if (previewRequests.get(key) === request) previewRequests.delete(key);
  });
  previewRequests.set(key, request);
  return request;
}

export function useIssuePreview(target: IssuePreviewTarget) {
  const [data, setData] = useState<IssuePreviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [generation, setGeneration] = useState(0);
  const retry = useCallback(() => setGeneration((value) => value + 1), []);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(false);
    setData(null);
    requestIssuePreview(target, generation)
      .then((result) => {
        if (!current) return;
        if (!result) setError(true);
        else setData(result);
      })
      .catch(() => {
        if (current) setError(true);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [generation, target.issueIdentifier, target.workspaceSlug]);

  return { data, loading, error, retry };
}
