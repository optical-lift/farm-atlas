# Anna Permission Matrix — July 21, 2026

## Release contract

Anna is an active Elm Farm `farm_hand`. She must retain the shared operational Atlas experience while her writes remain limited to work inside her membership and assignment scope. Owner production, assignment, membership, and administrative mutations must remain unavailable.

This proof combines source-route inspection with live Supabase calls executed as Anna's authenticated user identity. Mutation probes were deliberately rolled back and did not persist farm changes.

## Shared read surfaces

| Surface | Application path | Membership gate | Live Anna result |
| --- | --- | --- | --- |
| Purple task-forward home | `/` via `/api/atlas/home-task-cards` | `requireAtlasApiAccess()` + `home_task_cards_v1` | 17 task cards for July 21 |
| Day, Week, Month | `/day`, `/overview/week`, `/overview/month` via `/api/atlas/task-cards` | `requireAtlasApiAccess()` + `task_cards_v1` | 190 visible task cards |
| Schedule window | canonical schedule RPC | active membership + task visibility scope | 43 visible cards from July 21–31 |
| Mowing collection | canonical task cards | same task-card membership scope | 10 visible mowing cards |
| Weeding collection | canonical task cards | same task-card membership scope | 38 visible weeding/weed-maintenance cards |
| Farm snapshot | `/api/atlas/farm-snapshot` | `farm_snapshot_for_member_v1` | object returned |
| Zone registry | `/api/atlas/zone-registry` | `zone_registry_source_v1` | object returned |
| Bed/object workbench | `/api/atlas/objects/[objectKey]` | `object_workbench_v1` | Berry Walk Bed 10 object returned |
| Germination history | `/api/atlas/germination-history` | membership plus task scope | object returned for Anna-assigned germination task |
| Closeouts | `/api/atlas/closeout` | `closeout_summary_source_v1` | object returned |
| Production plans | `/api/atlas/production-plans` and `/api/atlas/production-dashboard` | membership-scoped shared reader | array returned; four active plans verified separately |

## Visibility proof

The canonical task reader, executed as Anna, returned:

- 190 total visible cards.
- 122 open or blocked cards.
- 10 mowing cards.
- 38 weeding or weed-maintenance cards.
- Anna's assigned Follow Me mowing task was present.
- Zero cards with Owner-prefixed titles were visible.

This confirms that Mowing and Weeding remain collections of canonical task objects rather than independent hardcoded lists, while Owner-only task content stays filtered.

## Germination scope boundary

Germination history is intentionally task-scoped in addition to farm-membership-scoped.

- Anna's assigned germination task `Check germination — Teddy sunflower` returned history successfully.
- A management-scoped germination task outside Anna's task scope returned SQLSTATE `42501` with `Task is outside this membership scope.`

The correct acceptance expectation is therefore: Anna can open germination history attached to work in her scope, not every management-only germination task in the farm.

## Mutation matrix

The following calls were executed as Anna against a real assigned task. A forced exception rolled back each successful probe before the transaction completed.

| Operation | Expected | Result |
| --- | --- | --- |
| Complete assigned task | Allow | Allowed, rolled back |
| Mark assigned task unfinished | Allow | Allowed, rolled back |
| Block assigned task | Allow | Allowed, rolled back |
| Reschedule assigned task | Allow | Allowed, rolled back |
| Use Owner task transition | Deny | Denied, `42501` |
| Change production dashboard policy/schedule | Deny | Denied, `42501` |
| Change production plan/succession | Deny | Denied, `42501` |
| Create a plan from a production rule | Deny | Denied, `42501` |
| Prepare or assign a farm membership | Deny | Denied, `42501` |

Every denied Owner RPC returned an explicit Owner-membership requirement rather than failing only in the interface.

## Authenticated outsider proof

A simulated authenticated user with no Elm Farm membership was denied all tested operational readers with SQLSTATE `42501` and `Active farm membership required.`

Denied surfaces:

- Home task cards.
- Day/Week/Month task cards.
- Farm snapshot.
- Zone registry.
- Object workbench.
- Germination history.
- Closeouts.
- Production plans.

## Source-contract test

`tests/atlas-anna-permission-matrix.test.mjs` locks the route-level contract:

- Shared operational readers use cookie authentication and active membership.
- Day, Week, and Month use the same canonical task-card client.
- Mowing and Weeding derive from canonical task cards.
- Production GET paths are shared membership reads.
- Production PATCH/POST paths are same-origin and Owner-only.
- Farm-Hand task transitions remain separate from Owner task transitions.

## Remaining release gate

This matrix proves the database and route contract, but it does not replace the visual authenticated acceptance pass. PR #43 must remain unmerged until:

1. A READY Vercel preview exists for the current PR head.
2. Anna signs in on an actual phone or phone-width browser.
3. The complete walkthrough in `docs/release/anna-phone-acceptance-walkthrough.md` passes.
4. No Owner controls or Owner-only task content are exposed.
