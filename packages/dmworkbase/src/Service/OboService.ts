import APIClient from "./APIClient";

export interface OboGrant {
  id: number;
  grantor_uid: string;
  grantee_bot_uid: string;
  grantee_bot_name?: string;
  mode: "auto" | "draft";
  global_enabled: boolean;
  active: boolean;
  persona_prompt?: string;
  created_at?: number;
  updated_at?: number;
}

export interface OboScope {
  id: number;
  grant_id: number;
  channel_id: string;
  channel_type: number;
  enabled: boolean;
}

export interface CreateOboScopeRequest {
  grant_id: number;
  channel_id: string;
  channel_type: number;
  enabled: boolean;
}

export interface CreateOboGrantRequest {
  grantee_bot_uid: string;
  mode: "auto" | "draft";
  global_enabled: boolean;
  persona_prompt?: string;
}

export type UpdateOboGrantRequest = Record<string, any>;

function asList<T>(value: T[] | { items?: T[] } | undefined): T[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (Array.isArray(value?.items)) {
    return value.items;
  }
  return [];
}

export async function listOboGrants(): Promise<OboGrant[]> {
  const grants = await APIClient.shared.get<OboGrant[] | { items?: OboGrant[] }>(
    "obo/grants"
  );
  return asList(grants);
}

export async function listOboGrantScopes(
  grantId: number
): Promise<OboScope[]> {
  const scopes = await APIClient.shared.get<OboScope[] | { items?: OboScope[] }>(
    `obo/grants/${grantId}/scopes`
  );
  return asList(scopes);
}

export function createOboGrant(
  request: CreateOboGrantRequest
): Promise<OboGrant> {
  return APIClient.shared.post("obo/grants", request);
}

export function updateOboGrant(
  grantId: number,
  request: UpdateOboGrantRequest
): Promise<void> {
  return APIClient.shared.put(`obo/grants/${grantId}`, request);
}

export function deleteOboGrant(grantId: number): Promise<void> {
  return APIClient.shared.delete(`obo/grants/${grantId}`);
}

export function createOboScope(
  request: CreateOboScopeRequest
): Promise<OboScope> {
  return APIClient.shared.post("obo/scopes", request);
}

export function deleteOboScope(scopeId: number): Promise<void> {
  return APIClient.shared.delete(`obo/scopes/${scopeId}`);
}
