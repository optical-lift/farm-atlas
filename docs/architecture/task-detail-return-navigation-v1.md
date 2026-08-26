# Task detail return navigation v1

Task detail is an execution surface, not a navigation authority. Its close control returns the user to the context that opened the task without inventing a second task-state path.

Return precedence is:

1. A present, safe, local `returnTo` query value is authoritative.
2. Browser history is eligible only when `returnTo` is absent and the referrer proves a safe same-origin non-Task-Focus surface.
3. Otherwise the assignee's canonical list path is the fallback.

Unsafe, protocol-relative, external, and recursive `/task-focus/...` return targets are never followed. A present but unsafe `returnTo` goes directly to the canonical fallback rather than consulting history.

The shared assigned-task header uses the existing `atlas-note-plus` visual slot as a close affordance and renders an X. The anchor retains the canonical list path as a no-JavaScript fallback; client navigation applies the precedence above.

This is application navigation behavior only. It does not change task custody, task state, database authority, or Worker Day placement.
