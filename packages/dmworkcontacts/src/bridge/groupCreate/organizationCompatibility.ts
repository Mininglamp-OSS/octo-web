import type { GroupCreateCandidateContact } from "./types";

export interface GroupCreateOrganizationInfo {
  name: string;
  org_id?: string;
  short_no?: string;
  is_upload_logo?: number;
}

export interface GroupCreateOrganizationEmployee {
  employee_id: string;
  employee_name: string;
  uid: string;
  avatar?: string;
}

export interface GroupCreateOrganizationDepartment {
  dept_id: string;
  name: string;
  org_id: string;
  short_no: string;
  children?: GroupCreateOrganizationDepartment[];
  employees?: GroupCreateOrganizationEmployee[];
}

export interface GroupCreateOrganizationNode {
  key: string;
  label: string;
  value: string;
  name: string;
  org_id?: string;
  dept_id?: string;
  is_department?: boolean;
  is_employee?: boolean;
  employee_name?: string;
  uid?: string;
  avatar?: string;
  children?: GroupCreateOrganizationNode[];
}

function countDepartmentEmployees(
  departments: GroupCreateOrganizationDepartment[]
): number {
  return departments.reduce((count, department) => {
    const directEmployees = department.employees?.length ?? 0;
    const childEmployees = department.children
      ? countDepartmentEmployees(department.children)
      : 0;
    return count + directEmployees + childEmployees;
  }, 0);
}

function employeeNode(
  employee: GroupCreateOrganizationEmployee,
  key: string
): GroupCreateOrganizationNode {
  return {
    ...employee,
    key,
    label: employee.employee_name,
    value: employee.employee_id,
    name: employee.employee_name,
    is_employee: true,
  };
}

export function buildGroupCreateOrganizationTree(
  departments: GroupCreateOrganizationDepartment[]
): GroupCreateOrganizationNode[] {
  return departments.map((department) => {
    const childDepartments = buildGroupCreateOrganizationTree(
      department.children ?? []
    );
    const employees = (department.employees ?? []).map((employee) =>
      employeeNode(employee, `${department.dept_id}_${employee.employee_id}`)
    );
    const employeeCount =
      (department.employees?.length ?? 0) +
      countDepartmentEmployees(department.children ?? []);

    return {
      key: department.short_no,
      label:
        employeeCount > 0
          ? `${department.name}(${employeeCount})`
          : department.name,
      value: department.dept_id,
      name: department.name,
      org_id: department.org_id,
      dept_id: department.dept_id,
      is_department: true,
      children: [...childDepartments, ...employees],
    };
  });
}

export function collectGroupCreateOrganizationMembers(
  nodes: GroupCreateOrganizationNode[]
): GroupCreateCandidateContact[] {
  return nodes.flatMap((node) => {
    if (node.is_department) {
      return collectGroupCreateOrganizationMembers(node.children ?? []);
    }
    if (node.is_employee && node.uid) {
      return [
        {
          uid: node.uid,
          name: node.employee_name ?? node.name,
          avatar: node.avatar,
        },
      ];
    }
    return [];
  });
}

export function buildGroupCreateOrganizationRootEmployees(
  employees: GroupCreateOrganizationEmployee[]
): GroupCreateOrganizationNode[] {
  return employees.map((employee) =>
    employeeNode(employee, `uid_${employee.uid}`)
  );
}
