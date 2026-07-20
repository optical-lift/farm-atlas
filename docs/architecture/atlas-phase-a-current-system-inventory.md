# Atlas Phase A — Current System Inventory and Freeze Record

**Inventory date:** July 20, 2026  
**Repository:** `optical-lift/farm-atlas`  
**Production branch:** `main`  
**Baseline commit inspected:** `21167e27d52fb54f99084d13e9a037eb6cd87433`  
**Vercel project:** `farm-atlas` (`prj_ppP8y06TilUlHOtTLhQjM7hSedh6`)  
**Production domain:** `atlas.elmfarm.co`  
**Supabase project:** `noel-core` (`zirqkouammpwxlqfbsvf`)  
**Atlas database namespace:** `atlas`

## 1. Phase A decision

The current application is frozen as **reference material**, not as an architecture that must remain functional during the rebuild.

This inventory does not attempt to repair the current login loop, preserve the existing route behavior, or reconcile the patch stack. It records what exists so the new user architecture can replace it deliberately.

The rebuild follows this order:

1. Identity
2. Authorization
3. Farm data access
4. Role-based presentation

No new feature or isolated authentication patch should be added to the current path while this inventory is being completed.

## 2. Current production/build state

The latest inspected Vercel production deployment is built from commit `21167e2` and completed successfully.

Build characteristics:

- Next.js `16.2.4`
- React `19.2.4`
- Supabase JS `2.107.0`
- Node `24.x` on Vercel
- `npm run build` executes `npm test` first
- 18 current Node tests pass
- Middleware is still present, and Next.js reports that the `middleware` convention is deprecated in favor of `proxy`

The current build pipeline is usable and should be preserved. The application architecture behind it should not be preserved merely because it builds.

## 3. Complete route surface from the current production build

### 3.1 Application routes

| Route | Current type | Initial classification |
|---|---:|---|
| `/` | dynamic | Role redirect entry point; currently depends on custom Atlas identity resolution |
| `/_not-found` | static | Framework route |
| `/children` | static | Legacy role/task lens |
| `/closeout` | static | Daily closeout workflow |
| `/collections/germination` | static | Crop workflow collection |
| `/collections/maintenance` | dynamic | Maintenance collection |
| `/collections/mowing` | static | Maintenance collection |
| `/collections/weeding` | static | Maintenance collection |
| `/day` | static | Legacy daily worker/task overview |
| `/field` | static | Field command interface |
| `/integrity` | dynamic | Farm graph/integrity inspection |
| `/lineages` | dynamic | Plant lineage interface |
| `/login` | static | Current custom login page |
| `/marshall` | static | Legacy manager lens |
| `/objects/[objectKey]` | dynamic | Object detail/timeline |
| `/onboarding/map` | static | Legacy map/onboarding route |
| `/overview/month` | static | Calendar/task overview |
| `/overview/week` | static | Calendar/task overview |
| `/owner` | dynamic | Current Owner task dashboard |
| `/production` | static | Production planning interface |
| `/production/dashboard` | dynamic | Production dashboard |
| `/task` | static | Legacy task URL compatibility entry |
| `/task-focus/[taskId]` | dynamic | Focused task detail |
| `/task/[...slug]` | dynamic | Legacy/catch-all task detail |
| `/zones` | static | Zone registry/list |
| `/zones/[zoneKey]` | dynamic | Zone detail |
| `/zones/berry-walk-map` | static | Zone-specific map |
| `/zones/main-garden-map` | static | Zone-specific map |

### 3.2 API routes

| Route | Domain | Phase A concern |
|---|---|---|
| `/api/atlas/auth/login` | Identity | Custom token-cookie login; hardcoded temporary Owner compatibility logic |
| `/api/atlas/auth/logout` | Identity | Must be replaced by the standard shared session path |
| `/api/atlas/auth/session` | Identity | Duplicate browser-facing session interpretation |
| `/api/atlas/closeout` | Task results | Must be mapped to authorized result writes |
| `/api/atlas/crop-profiles` | Crop registry | Registry read path |
| `/api/atlas/dashboard` | Dashboard | Broad aggregate read path |
| `/api/atlas/farm-snapshot` | Farm state | Broad farm read path |
| `/api/atlas/field-log` | Field memory | Event write path |
| `/api/atlas/germination-check` | Crop observations | Observation/result write path |
| `/api/atlas/germination-history` | Crop history | Historical read path |
| `/api/atlas/home-task-cards` | Tasks | Legacy homepage-specific read path |
| `/api/atlas/inbox` | Field inbox | Read/write path; underlying table currently lacks RLS |
| `/api/atlas/maintenance-completion` | Maintenance | Mutation path |
| `/api/atlas/maintenance-control` | Maintenance | Mutation/control path |
| `/api/atlas/maintenance-plan` | Maintenance | Derived planning read path |
| `/api/atlas/maintenance-preview` | Maintenance | Derived planning read path |
| `/api/atlas/objects/[objectKey]` | Objects | Object detail read path |
| `/api/atlas/objects/[objectKey]/events` | Object events | Event read/write path; underlying event table lacks RLS |
| `/api/atlas/objects/[objectKey]/observations` | Crop/object observations | Observation write path |
| `/api/atlas/operational-reconcile` | Planning engine | Broad reconciliation mutation |
| `/api/atlas/production-dashboard` | Production | Production aggregate read |
| `/api/atlas/production-plans` | Production | Read/write path; currently has permissive anonymous policies |
| `/api/atlas/production-rules` | Production | Rule registry/read path |
| `/api/atlas/projects` | Projects | Project read path |
| `/api/atlas/rhythm` | Daily hand | Rhythm read path; underlying template table lacks RLS |
| `/api/atlas/task-cards` | Tasks | General task read path |
| `/api/atlas/task-child-toggle` | Tasks | Checklist mutation |
| `/api/atlas/task-crop` | Tasks/crop cycles | Task-to-crop mutation |
| `/api/atlas/task-list-cards` | Tasks | Additional list read path |
| `/api/atlas/task-note` | Tasks | Task note mutation |
| `/api/atlas/task-outcome` | Task results | Result/event mutation |
| `/api/atlas/task-reschedule` | Tasks | Schedule mutation |
| `/api/atlas/task-result` | Task results | Legacy result mutation |
| `/api/atlas/task-transition` | Task results | Canonical transition mutation candidate |
| `/api/atlas/task-unfinished` | Tasks | Legacy unfinished mutation |
| `/api/atlas/weather` | External context | Cached/bounded external read path needed |
| `/api/atlas/zone-registry` | Zones | Zone registry read path |

This route list is complete for the inspected build. The next inventory pass must inspect each route source and record its HTTP methods, Supabase tables/views/RPCs, use of service role, side effects, client callers, and intended replacement.

## 4. Current identity and authentication chain

### 4.1 Custom token cookies

The app currently stores Supabase access and refresh tokens in two custom HTTP-only cookies:

- `atlas_access_token`
- `atlas_refresh_token`

The cookies have a 30-day maximum age, `SameSite=Lax`, root path, and secure mode in production.

### 4.2 Middleware checks cookie presence, not session validity

Current middleware treats the existence of either custom cookie as sufficient to pass its gate. It does not verify the token, refresh the session, load membership, or determine farm scope.

Consequences:

- Expired or invalid cookie values can pass middleware and fail later.
- A valid refresh process can occur after a redirect decision has already been made.
- Middleware, server pages, and API routes can disagree about whether the person is signed in.
- Login loops are structurally possible.

### 4.3 Service-role authentication client

`lib/atlas-auth.ts` creates its authentication/data client with `SUPABASE_SERVICE_ROLE_KEY` and the `atlas` schema. It then:

1. Reads the custom token cookies.
2. Calls `auth.getUser(accessToken)`.
3. Refreshes from the custom refresh token if needed.
4. Loads `user_profiles` and `farm_memberships` using the service-role client.

This makes session resolution dependent on a homegrown token transport and bypasses user-scoped database authorization when loading Atlas identity records.

### 4.4 Login route contains temporary account-specific behavior

The current login route contains:

- A hardcoded Owner email.
- A temporary short-password compatibility branch.
- A profile-active check.
- A separate active-membership count check.
- Custom cookie writes after login.

This code is temporary bootstrap behavior and must not be part of the replacement architecture. The credential must be rotated after the compatibility branch is removed from the public repository history path used by production.

### 4.5 Root route independently decides role destination

The current root route:

1. Calls `getAtlasIdentity()`.
2. Requires an Elm Farm membership.
3. Routes Owner to `/owner`.
4. Routes Manager to `/marshall`.
5. Routes all other memberships to `/day`.

This is still Elm-specific and couples identity resolution directly to legacy role pages.

### 4.6 Browser role redirect also remains mounted globally

`AtlasRoleHomeRedirect` remains mounted in the global layout while the server root route also performs role routing. This is one example of duplicate authority.

## 5. Current global presentation patch stack

The root layout globally mounts all of the following behavior patches:

- `AtlasRoleHomeRedirect`
- `WeekDayNavigation`
- `HomeTodayCompletePatch`
- `HomeQuietTaskHeroPatch`
- `DayHeroQuietPatch`
- `WorkerVocabularyCleanupPatch`
- `TaskProgressExactDayPatch`
- `OwnerHomeLinkPatch`
- `HomeSundayNavigationPatch`
- `OwnerTaskReturnPatch`
- `SafeBedCropAccordionPatch`
- `AttachedTaskHistoryPatch`

It also imports a long sequence of corrective CSS files, including home hero rollbacks, final-fit patches, overview patches, mobile overflow guards, child-task patches, and task-history patches.

These files may contain useful presentation decisions, but the root-layout patch stack must not survive as the architectural basis of the rebuilt app.

**Reuse rule:** extract stable UI components and styles only after their data dependencies and role assumptions are removed.

## 6. Current server data-access pattern

### 6.1 Global service-role client

`lib/atlas/supabase-server.ts` exports one global Supabase client created with the service-role key.

This client is used as the ordinary server data path. It bypasses Row Level Security and makes every route responsible for implementing its own complete authorization correctly.

This pattern is the opposite of the approved rebuild direction.

### 6.2 Why user-scoped access does not work yet

Most Atlas tables have RLS enabled but no policies. A signed-in user-scoped client would therefore be blocked from ordinary operational reads.

The app currently works around this by using service-role reads and filtering in application code.

The replacement must build both layers together:

1. Server authorization through normalized session + farm membership.
2. Database authorization through user-scoped clients, RLS policies, and tightly controlled functions.

### 6.3 Existing database work worth preserving

The Atlas schema contains substantial real domain work that should be preserved and secured rather than discarded:

- Farm, zone, and growing-object registries
- Crop profiles and aliases
- Field logs and object links
- Planting claims and object links
- Object contents and state
- Crop cycles, impacts, and observation timelines
- Tasks, object links, crop-cycle links, transitions, and outcome events
- Projects and project links
- Maintenance objects, dependencies, history, profiles, and scheduler settings
- Production plans, successions, and rule templates
- Plant lineages, instances, and propagation events
- Integrity/provenance tables and canonical-resolution tables
- User profiles and farm memberships

The database contains valuable farm truth and automation behavior. The security and access architecture around it is incomplete.

## 7. Atlas database surface

### 7.1 High-volume operational tables

Approximate current row counts from the inventory pass:

| Table | Rows |
|---|---:|
| `tasks` | 3,338 |
| `task_objects` | 3,254 |
| `task_crop_cycles` | 1,266 |
| `maintenance_objects` | 767 |
| `task_outcome_events` | 304 |
| `crop_cycles` | 228 |
| `object_contents` | 222 |
| `object_content_resolutions` | 221 |
| `object_content_entity_links` | 208 |
| `field_logs` | 156 |
| `growing_objects` | 145 |
| `object_state` | 135 |
| `field_log_objects` | 119 |
| `object_activity_events` | 92 |
| `plant_instances` | 86 |
| `maintenance_dependencies` | 71 |
| `crop_profiles` | 62 |
| `plant_lineages` | 48 |

This is no longer a small prototype database. The rebuild must migrate access paths without erasing operational history.

### 7.2 Important prepared views

Current prepared views include:

- `v_task_cards`
- `v_dashboard_zones`
- `v_project_cards`
- `v_resource_summary`
- `v_canonical_farm_graph`
- `v_crop_cycle_registry`
- `v_current_crop_cycles_by_object`
- `v_planned_crop_cycles_by_object`
- `v_crop_cycle_observation_timeline`
- `v_object_event_timeline`
- `v_object_operational_timeline`
- `v_object_workbench`
- `v_today_rhythm`
- Integrity and yield forecast views

These are candidates for the fast read path, but each must be audited for invoker/definer behavior and whether its underlying RLS rules are respected.

### 7.3 Trigger-heavy task model

The `tasks` table currently has a large trigger chain covering:

- Task-engine field derivation
- Sowing projections and display details
- Crop-profile enrichment
- Reality/readiness gates
- No-Sunday scheduling
- Weeding cooldown and duplicate prevention
- Child-checklist normalization
- Germination follow-up creation
- Delayed follow-up creation
- Crop-cycle milestone synchronization
- Planned crop-cycle creation
- Task-to-crop-cycle link synchronization
- Partial-task roll-forward
- Special crop workflow guards

This automation contains valuable domain rules. It also means task writes can have broad indirect side effects. Every replacement mutation path must be tested against the trigger chain rather than treated as a simple row update.

## 8. Current security and privacy blockers

### 8.1 Eight Atlas tables have RLS disabled

The following tables are exposed without RLS protection in the Atlas schema:

1. `inbox_items`
2. `object_activity_events`
3. `rhythm_templates`
4. `project_task_links`
5. `crop_cycle_impacts`
6. `crop_profile_aliases`
7. `crop_observation_types`
8. `task_crop_cycles`

RLS was **not** enabled during this inventory because enabling it without replacement policies would block current access without completing the security model.

### 8.2 Most RLS-enabled operational tables have no policies

Examples include:

- `farms`
- `zones`
- `growing_objects`
- `tasks`
- `task_objects`
- `crop_cycles`
- `field_logs`
- `planting_claims`
- `object_contents`
- `object_state`
- `projects`
- `maintenance_objects`

This is why the current app depends on service-role access. RLS is technically enabled, but the user-scoped application path has not been implemented.

### 8.3 Two production tables have unrestricted anonymous write policies

`production_plans` and `production_successions` currently permit anonymous and authenticated users to perform unrestricted operations through policies with `USING (true)` and `WITH CHECK (true)`.

These policies are rebuild blockers and must be replaced before those tables participate in the authenticated application.

### 8.4 Security-definer views require review

Supabase security advisors flagged these Atlas views as security-definer views:

- `v_resource_summary`
- `v_dashboard_zones`
- `v_project_cards`

They may apply the view creator's permissions instead of the querying user's policies. Each must be rebuilt or explicitly justified for the new read layer.

### 8.5 Security-definer functions are broadly executable

Many Atlas functions are currently executable by `anon` and/or `authenticated`, including functions that can create or mutate operational records.

High-priority examples:

- `record_task_transition_v1`
- `record_crop_observation_v1`
- `get_object_operational_timeline_v1`
- `recalculate_weeding_priorities`
- `reconcile_sowing_bed_subtasks_v1`
- `sync_crop_cycle_registry_v1`
- Numerous trigger-helper functions that should never be direct public RPC endpoints

The replacement security migration must distinguish:

- Internal trigger helpers: revoke direct execution from public roles.
- Safe read RPCs: authorize by membership and limit output.
- Safe mutation RPCs: authorize role, farm, and target resource inside the function.
- Service-only reconciliation functions: restrict to service role or controlled jobs.

### 8.6 Function search paths need hardening

Supabase flagged mutable `search_path` behavior for Atlas functions including `set_updated_at`, `strip_person_attribution_from_field_records`, `set_germination_thinning_due_date`, and `task_destination_object_ids_v1`.

Security-definer functions must use explicit safe search paths.

### 8.7 Password security is temporary

Supabase leaked-password protection is currently disabled, and the public repository contains a temporary Owner login compatibility branch. Password rotation and normal password policy enforcement belong in the identity-core cutover.

## 9. Shared Supabase project boundary

Atlas currently shares the `noel-core` Supabase project with unrelated Noel/Titus/Bible-study schemas and migrations.

Rules for the rebuild:

- Atlas changes remain inside the `atlas` schema unless an Auth operation is explicitly required.
- Atlas migrations must be clearly named and scoped.
- No Atlas rebuild should modify `public`, `draft`, `intelligence`, `titus`, or other Noel schemas.
- Security-advisor findings outside `atlas` are recorded as shared-project findings but are not part of this Atlas rebuild unless separately authorized.
- Atlas application clients should explicitly target the `atlas` schema.

## 10. Existing assets to preserve

### Preserve as domain truth or behavior candidates

- Farm, zone, object, crop-cycle, task-result, maintenance, production, and lineage records
- Stable IDs and relationships
- Existing field history
- Canonical graph and operational timeline work
- Task transition and result separation
- Trigger rules that encode valid farm behavior, after review
- Current task-assignment and task-routing tests
- Vercel/GitHub deployment pipeline
- Useful visual components after they are detached from legacy role and data logic

### Do not preserve as architecture

- Custom access/refresh token cookies
- Middleware authorization based only on cookie presence
- Service role as the default application read/write client
- Account-specific login compatibility logic
- Elm-specific root routing
- Client-side role redirects
- URL/query-driven role scopes
- Hardcoded assignee visibility
- Global patch components in the root layout
- Duplicate task list/read endpoints that each interpret access differently
- Page-specific authorization
- Development commentary in production UI

## 11. Privacy boundary to build

The replacement must enforce this at both server and database levels:

### Owner

- Full access to every farm with an active Owner membership
- Full operational state, planning context, worker work, private notes, and results within those farms

### Manager

- Operational coordination access to the farm managed
- Worker progress, blockers, schedules, and delegated decisions
- No automatic cross-farm or Owner-private access

### Farm Hand

- Assigned and explicitly shared work only
- Context required to complete that work
- Result/observation submission without broad task-edit permission
- No Owner, Manager, compensation, strategy, or unrelated worker data

No client-supplied farm key, worker key, role, scope, task ID, or URL path may expand access.

## 12. Phase A source-audit matrix still to complete

The production route surface is now enumerated. The next pass must inspect every route and record this matrix:

| Field | Required value |
|---|---|
| Route/source file | Exact path |
| Methods | GET/POST/PATCH/etc. |
| Current callers | Pages/components/helpers |
| Authentication check | Exact function or none |
| Authorization check | Exact membership/policy or none |
| Data client | User-scoped/service-role/other |
| Tables | Reads and writes |
| Views | Reads |
| RPCs | Calls and side effects |
| Trigger side effects | Known downstream writes |
| Client-controlled scope | Farm/role/worker/task params |
| Sensitive output | Owner/manager/private fields |
| Replacement owner | Identity/data/role-interface module |
| Migration disposition | Reuse, replace, merge, retire |

## 13. Immediate next deliverables

1. Complete source-level mapping for all 41 Atlas API routes.
2. Map each UI route to its data helpers and API callers.
3. Inventory every service-role import and direct Supabase query in the repository.
4. Inventory every client-side role, assignee, scope, and redirect decision.
5. Classify all Atlas views and RPCs as user-safe, membership-gated, service-only, internal-trigger-only, or retire.
6. Produce the RLS policy matrix by table and role.
7. Produce the first replacement vertical-slice contract:
   `Login -> normalized AtlasSession -> Owner membership -> authorized farm query -> Owner farm launcher`.

## 14. Freeze rule

Until Phase A is signed off:

- Do not add another redirect patch.
- Do not add another role filter to a page.
- Do not expose another service-role route.
- Do not enable RLS table-by-table without the policy matrix.
- Do not remove existing farm records or trigger behavior casually.
- Document each discovered path before replacing it.

The current application may remain unavailable. The rebuild is judged by architectural coherence, not by keeping the legacy route stack alive during the transition.
