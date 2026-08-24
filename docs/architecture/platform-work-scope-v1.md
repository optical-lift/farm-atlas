# Atlas Platform Work Scope v1

The platform work-scope boundary is **organization → operating unit → operating-unit membership**.

An operating unit is not synonymous with a tenant. The initial adapter supports the existing `farm` operating-unit kind because it is the real domain currently present in Atlas. New operating-unit kinds should be added only when a real domain requires them; Atlas must not manufacture a generic `tenant_id` replacement for existing farm identity.

`atlas.resolve_platform_work_scope_v1(text, uuid, uuid)` is a service-internal adapter. It resolves the parent organization, active organization membership, operating-unit identity and membership, role, user, and timezone. It fails closed when the operating unit or either membership layer is inactive or inconsistent.

Worker Day remains classified `needs_generalization`. This change only removes direct farm membership and farm metadata reads from Day Shape scope establishment. Capacity settings and Day Shape policies remain attached to their current operating-unit/domain keys until a later portability conversion has a concrete cross-domain requirement.

The migration preserves Day Shape output exactly across the active production membership census. The before/after aggregate SHA-256 is `9308dcdf6e78dbd3762784126194f5d8793a73756ee3bd882cfb21b3131e71bb`.