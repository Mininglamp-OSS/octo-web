import { WKApp } from "@octo/base";

import {
  buildGroupCreateOrganizationRootEmployees,
  buildGroupCreateOrganizationTree,
} from "./organizationCompatibility";
import type {
  GroupCreateOrganizationDepartment,
  GroupCreateOrganizationEmployee,
  GroupCreateOrganizationInfo,
  GroupCreateOrganizationNode,
} from "./organizationCompatibility";

interface GroupCreateOrganizationResponse {
  departments?: GroupCreateOrganizationDepartment[];
  employees?: GroupCreateOrganizationEmployee[];
}

export async function loadGroupCreateOrganization(): Promise<{
  info?: GroupCreateOrganizationInfo;
  tree: GroupCreateOrganizationNode[];
}> {
  const joined = await WKApp.apiClient.get("/organization/joined");
  const info = Array.isArray(joined)
    ? (joined[0] as GroupCreateOrganizationInfo | undefined)
    : undefined;
  if (!info?.org_id) return { info, tree: [] };

  const response = (await WKApp.apiClient.get(
    `/organizations/${info.org_id}/department`
  )) as GroupCreateOrganizationResponse | undefined;
  if (!response) return { info, tree: [] };

  const departments = Array.isArray(response.departments)
    ? buildGroupCreateOrganizationTree(response.departments)
    : [];
  const employees = Array.isArray(response.employees)
    ? buildGroupCreateOrganizationRootEmployees(response.employees)
    : [];

  return { info, tree: [...departments, ...employees] };
}
