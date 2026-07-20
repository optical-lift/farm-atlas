# Atlas Phase B — Next Owner Data Vertical Slice

The next implementation slice begins the server-only Atlas data layer.

## Contract

```text
getAtlasSession()
→ require Owner membership
→ resolve selected farm
→ query authorized Owner tasks through user-scoped Supabase client
→ return a stable Owner dashboard projection
```

## Initial modules

```text
lib/atlas-data/farms.ts
lib/atlas-data/tasks.ts
lib/atlas-data/owner-dashboard.ts
```

## Rules

- No Owner page may query Supabase directly.
- No task query may accept a role or farm authority supplied by the client.
- No service-role client may be used for the ordinary Owner read.
- The first query may be narrow, but its authorization path must be final.
- Existing Owner presentation components may be reused only after their data fetches are removed.

## First response shape

```text
farm
ownerActions
farmBlockers
workerExecution
upcomingDeadlines
```

The initial implementation may populate only `farm` and `ownerActions`. Empty sections must remain valid stable fields so the dashboard can grow without changing its authority model.
