import type { UserRole } from "./models";

export type Capability =
  | "view_assigned_tasks"
  | "record_task_outcome"
  | "postpone_assigned_task"
  | "view_relevant_merchant_data"
  | "view_team_performance"
  | "manage_users"
  | "import_official_reports"
  | "manage_operating_config"
  | "view_audit_log"
  | "create_tasks"
  | "verify_outcomes";

const permissions: Record<UserRole, ReadonlySet<Capability>> = {
  assistant: new Set<Capability>([
    "view_assigned_tasks",
    "record_task_outcome",
    "postpone_assigned_task",
    "view_relevant_merchant_data",
    "view_team_performance",
  ]),
  director: new Set<Capability>([
    "view_assigned_tasks",
    "record_task_outcome",
    "postpone_assigned_task",
    "view_relevant_merchant_data",
    "view_team_performance",
    "manage_users",
    "import_official_reports",
    "manage_operating_config",
    "view_audit_log",
    "create_tasks",
    "verify_outcomes",
  ]),
};

export function can(role: UserRole, capability: Capability): boolean {
  return permissions[role].has(capability);
}
