# Shared Composition shadow endpoint

`POST /api/composition/shadow` is an unlinked verification surface for the Shared Composition Engine.

- It returns `404` when `VERCEL_ENV=production`.
- It does not alter Ask Elm, Ask Atlas, Clock, Worker Day, tasks, or public ranking.
- `elm_local` requests pass through structured request-envelope interpretation, database epistemic validation, Local shadow retrieval, Noel runtime-pack derivation, and (only when evidence-backed affordances exist) creative proposal generation plus the database proposal firewall.
- `atlas_worker_day` requests use live worker-day signals, Noel runtime-pack derivation, and a proposal that must preserve all protected claims and identify any neutral tie-order as non-canonical.
- The language model may parse and compose; it may not establish local facts, canon rules, hidden psychological states, or moral priority.

This endpoint exists to prove the runtime chain before any production integration.