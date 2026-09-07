# Structured Work A1 — Legacy Prose Writer Inventory

Status: compatibility inventory for Release A / A1 of `STRUCTURED-WORK-MIGRATION-V1.md`.

These are the application-level prose-first operational writers currently allowed to remain active while the governed Structured Work Writer is built.

They are compatibility debt. They are **not** approved examples for new work authoring.

| Writer ID | Application path | Canonical write path | Why temporarily allowed |
| --- | --- | --- | --- |
| `manual-task-v1` | `app/api/atlas/manual-task/route.ts` | `create_manual_task_v1` | Existing owner/manager manual farm-task workflow still depends on prose-first authoring. |
| `project-task-v1` | `app/api/atlas/projects/[projectId]/tasks/route.ts` | `owner_operator_create_project_task_v1` / `create_project_task_v1` | Existing project-task workflow still depends on title/note authoring. |

## A1 rule

No new application-level operational writer may establish work meaning through prose alone.

A new prose-first writer must not be added to the registry as routine implementation. Discovering another existing writer requires updating this inventory and the A1 guard test deliberately. Creating a genuinely new work-authoring path must wait for the governed Structured Work Writer defined later in Release A.

Legacy reads remain available where required for current owner/manager compatibility, but legacy prose is not worker-safe presentation data.

In particular:

- `work_items.instructions` is canonical/legacy source material, not an employee instruction field;
- legacy task metadata prose is not an employee presentation contract;
- employee-facing payloads may not include these fields merely because the employee's work is linked to the source record.

## Exit condition

These registry entries are removed as their callers migrate to Structured Work Writer. The registry should shrink to zero; it must not become a permanent allow-list for prose-first task creation.
