# Task Focus readiness performance

Generic Worker Task Focus must not perform a second browser-side readiness request after navigation.

The canonical assigned-task server boundary resolves the governed worker-safe execution warrant during the initial server render and passes the normalized result into the client execution shell. The client shell is therefore presentation-only for readiness: executable work paints the real task card immediately; a real canonical blocker paints Waiting; a transport/authorization failure paints Task unavailable.

The authenticated API remains available for callers that genuinely need a standalone readiness read, and both the API and Task Focus server render share `lib/atlas/worker-readiness.ts` so presentation semantics cannot drift.

This change deliberately does not alter readiness authority, completion authorization, result-return authority, task identity, or Worker Day selection.
