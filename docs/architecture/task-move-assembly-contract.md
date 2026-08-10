# Atlas Task Move Assembly Contract

Status: Pass 0 contract for the Task Move convergence work.

## One semantic grammar

A task is not a stack of instructions. It is a proposed transition in farm state.

The canonical Task Move therefore has two different structures that must never be conflated:

```text
CURRENT -------- MOVE -------- AFTER
                  |
                  +-- resource requirement
                  +-- container requirement
                  +-- medium requirement
                  +-- source requirement
                  +-- destination requirement
                  +-- capacity requirement
                  +-- prerequisite / dependency
                  +-- method constraint
```

The **spine** answers:

1. What is true now?
2. What move are we making, to what subject, and where?
3. What will be true after the move succeeds?

The **branches** answer:

- What has to be available?
- What has to be decided?
- What dependency has to be satisfied?
- What capacity has to exist?
- What constraint must the move obey?

Branch ordering has no temporal meaning. `3 x 200-cell trays`, `potting mix`, and `4 lit tray positions` are parallel requirements for potting up; they are not steps that happen one after another.

## Executability

A requirement branch has one of four statuses:

- `resolved`: the requirement is satisfied.
- `warning`: usable information exists, but the requirement is not fully verified.
- `missing`: a required fact or resource has not been attached.
- `blocked`: available truth shows the requirement cannot currently be satisfied.

A required `missing` or `blocked` branch makes the Task Move `blocked` and sets `spine.connection = stops_at_move`.

The target AFTER state is **not erased** when a branch blocks execution. The system can truthfully know the intended resulting state while also knowing that the move cannot reach it yet.

A missing CURRENT or AFTER description is represented explicitly as missing truth. It produces a warning unless the MOVE itself or a required branch is blocked. Atlas does not invent a state sentence to make the visual complete.

## Capacity units are physical truth

A task-capacity requirement must use the physical unit the move actually consumes. A pool measured in a different unit cannot satisfy the requirement unless Atlas has a separate canonical conversion fact.

For example, four propagation trays require `4 tray_positions`. Atlas may not silently reinterpret that as `4 shelf_positions`. A shelf-position pool and a tray-position pool can both exist because they answer different physical questions. Until a measured shelf-to-tray conversion exists, they remain separate truths.

A confirmed pool total is also not automatically the same thing as currently available capacity. Occupancy or reservation truth must exist before Atlas claims a confirmed amount is free for the move.

## Provenance and precedence

Every spine fact and branch carries provenance. Stronger structured links take precedence over fallback prose:

1. `task_object` for explicit linked farm-object truth or source/destination relationships carried by `task_objects.role`.
2. `resource_requirement` for task-scoped typed requirements; `task_resource_requirements.move_role` controls the semantic branch role when present.
3. `prerequisite` for task dependency context.
4. `action_template` for required resources the task should have but does not yet have attached.
5. `task_record` for an explicit task blocker.
6. `legacy_metadata` for transitional state/requirement fields while older tasks are migrated.
7. `derived` only for presentation-derived MOVE labels such as a normalized action or work site.
8. `missing` when Atlas cannot resolve the fact without guessing.

A legacy value that matches a stronger structured requirement is deduplicated in favor of the stronger source.

## Requirement kinds

The canonical branch kinds are:

- `resource`
- `container`
- `medium`
- `source`
- `destination`
- `capacity`
- `dependency`
- `prerequisite`
- `method`

Classification uses structured role/type/category/key fields first and conservative label matching second. Unknown requirements remain `resource`; Atlas must not invent a more specific role.

## Source boundaries

`resolveTaskMove(taskId)` reads through the existing viewer-scoped task-card boundary and existing task dependency/project context. It performs no farm-state writes.

`assembleTaskMove(task)` is the pure convergence seam. Current worker UI can continue using the compatibility execution model until the six acceptance archetypes resolve correctly.

## Acceptance archetypes

Pass 1 must prove the grammar on at least these six shapes:

1. Snow in Summer propagation: CURRENT and AFTER remain known while unresolved light capacity blocks the spine at MOVE. Tray and potting-mix requirements are sibling branches, and the capacity branch is expressed in tray positions rather than inferred shelf positions.
2. Mowing: a simple CURRENT -> MOVE -> AFTER with only mower and target-height branches.
3. Weeding: a linked bed grounds the subject/site without being mistaken for an instruction stage.
4. Transplant readiness: canonical destination object roles and prerequisite requirements stay attached to MOVE.
5. Outreach: a non-field task can still have a truthful state transition and dependency/resource branches without pretending it is crop work.
6. Finish Elm: project context remains context; prerequisites/dependencies are branches; the project hierarchy is not turned into task steps.
