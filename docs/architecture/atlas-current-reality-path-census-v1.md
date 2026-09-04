# Atlas Current Reality Path Census v1

**Status:** Repository-owned current-state census for Reality Foundation #787  
**Census date:** 2026-09-04  
**Scope:** Identity, relationship, communication, flower commerce, outreach, route/round, local-intelligence, reconciliation, projection, UI/API write paths  
**Governing specifications:** `atlas-core-reality-contract-v1.md`, `atlas-receive-reconciliation-v1.md`, `smart-contacts-elm-local-boundary-v1.md`

This census records what Atlas actually does now. It is not a target-schema proposal and it does not declare legacy data disposable. Its purpose is to make every current reality path explicit enough that later migrations can proceed without relying on conversation memory.

## 1. Classification grammar

Every artifact in this census is assigned one primary target classification.

| Classification | Meaning |
| --- | --- |
| **Core** | Generic Atlas truth or execution infrastructure that must exist independently of any one business/domain/integration. |
| **Domain** | Authoritative domain truth with domain-specific invariants, such as flower sales or demand. |
| **Evidence** | Source-attributed observations/custody. Evidence may support reconciliation but does not itself become governing state. |
| **Projection** | Derived/rebuildable current state or read model. Never the sole authority for history. |
| **Integration** | Optional connected capability. It may discover/enrich/observe/act but cannot own canonical Atlas identity or generic operational truth. |
| **Legacy** | Current path that must remain readable during migration but is not the target authority. |
| **Bridge** | Temporary seam between classifications. A bridge is not allowed to become permanent hidden authority. |

Disposition verbs used below: **retain**, **evolve**, **wrap**, **repoint**, **migrate**, **backfill**, **extract**, **deprecate**, **block-direct-write**.

## 2. Executive finding

Atlas currently has four overlapping relationship/reality lanes:

1. **Buyer reconstruction lane** — a denormalized buyer relationship record plus buyer-local aliases, contact events, purchase reconstruction, profiles, preferences, and Intelligence views.
2. **Communication custody lane** — connected-source ingestion into append-only communication evidence with explicit source authority and custody semantics.
3. **Flower commerce/execution lane** — guarded flower sale/demand/standing/prospect commands that reference buyer relationships and project route work into generic operational routes.
4. **Elm Local / local-intelligence lane** — a large entity/person/contact/discovery/campaign/provider system that currently acts as both intelligence product and, in a few Atlas RPCs, de facto identity/outreach infrastructure.

The major failure is not absence of data. It is absence of a single canonical identity/relationship spine joining these lanes.

Two production facts make that visible:

- `atlas.buyer_relationship_reconstruction` has **92 rows and 0 populated `entity_id` links**.
- `atlas.communication_events` has **4,084 rows while `atlas.communication_identity_links` has 0 rows**.

Therefore Atlas can possess both relationship memory and communication evidence while still failing to resolve them to the same person/organization/relationship.

## 3. Quantitative production inventory

Counts are current as of the census date and are included as migration-risk signals, not permanent contract values.

| Artifact | Rows | Linkage note |
| --- | ---: | --- |
| `atlas.buyer_relationship_reconstruction` | 92 | 0 `entity_id` populated |
| `atlas.buyer_identity_aliases` | 250 | buyer-local identity silo |
| `atlas.buyer_contact_events` | 23 | valuable event history |
| `atlas.buyer_reported_purchase_history` | 91 | reconstructed historical evidence |
| `atlas.flower_buyer_buying_profiles` | 90 | relationship-derived domain state |
| `atlas.flower_buyer_product_preferences` | 11 | product-specific relationship state |
| `atlas.communication_events` | 4,084 | append-only evidence |
| `atlas.communication_event_source_observations` | 60 | source-level evidence |
| `atlas.communication_event_conflicts` | 0 | conflict lane exists |
| `atlas.communication_identity_links` | 0 | intended bridge currently unused |
| `atlas.communication_threads` | 9 | source/thread grouping |
| `atlas.communication_ingest_batches` | 1,209 | custody history |
| `atlas.connected_sources` | 1 | source registry |
| `atlas.flower_sale_orders` | 21 | 13 linked to buyer relationship |
| `atlas.flower_standing_orders` | 1 | 1 linked |
| `atlas.flower_demand_orders` | 1 | 1 linked |
| `atlas.flower_prospect_routes` | 7 | domain planning |
| `atlas.flower_prospect_route_lines` | 22 | 7 linked to buyer relationship |
| `atlas.operational_routes` | 31 | generic route execution |
| `atlas.operational_route_stops` | 50 | generic route stops |
| `atlas.operational_route_events` | 10 | route history |
| `local_intel.entities` | 2,176 | integration-owned entity corpus today |
| `local_intel.people` | 1,594 | integration-owned people corpus today |
| `local_intel.entity_relationships` | 1,338 | integration relationship graph |
| `local_intel.contact_points` | 350 | integration contact data |
| `local_intel.outreach_targets` | 69 | integration targeting |
| `local_intel.campaigns` | 1 | campaign system lightly used |
| `local_intel.campaign_targets` | 26 | campaign targets |
| `local_intel.campaign_contacts` | 3 | campaign contact history |
| `local_intel.campaign_send_receipts` | 0 | send custody unused currently |
| `local_intel.campaign_response_events` | 0 | response custody unused currently |
| `local_intel.provider_messages` | 0 | provider message lane unused currently |
| `local_intel.entity_ingestion_candidates` | 0 | discovery pipeline current queue empty |

## 4. Path census

### 4.1 Buyer reconstruction and buyer-local identity

| Current artifacts | Current responsibility / semantics | Current writers/readers | Target classification | Target destination / disposition | Migration risk | Direct writes after cutover |
| --- | --- | --- | --- | --- | --- | --- |
| `atlas.buyer_relationship_reconstruction` | Denormalized current buyer memory: business/contact labels, relationship state, priority, purchase summary, interests, payment/access/pursuit notes, next action, provenance metadata. It currently behaves as authority because UI/RPC state depends on it. | Written by historical reconstruction and `record_buyer_outreach_result_v1`; read by buyer views, flower buyer options, Intelligence projections. | **Legacy authority** | **Migrate** identity into Atlas canonical party graph and history into canonical relationship event/current-position model. Preserve a compatibility read until parity. | High: this row mixes identity, evidence, event history summary, current state, and planning. | **Block direct writes** once replacement commands/read models are live. |
| `atlas.buyer_identity_aliases` | Buyer-local aliases/contact names synchronized from relationship/contact rows. | Triggered by `sync_buyer_identity_from_relationship_v1` and `sync_buyer_identity_from_contact_event_v1`. | **Legacy** | **Migrate** useful aliases into Core party/external-identity/contact identity structures. | Medium: alias collisions and same-name people cannot be assumed identical. | Block legacy alias writes after canonical identity cutover. |
| `atlas.buyer_contact_events` | Occurrence-level outreach/contact results with method, outcome, reached person, follow-up, offer, quantity/price/date, recorder, notes, metadata. | `record_buyer_outreach_result_v1`; buyer/intelligence read models. | **Legacy event authority → Core relationship event** | **Migrate event-by-event** with original occurrence/provenance. Do not collapse into current status. | Medium-high: event vocab is buyer-specific and may contain corrections only in notes/metadata. | New writes must use generic relationship/Receive contract after cutover. |
| `atlas.buyer_reported_purchase_history` | Historical reconstructed purchase reports; not equivalent to transactional sale ledger. | Historical import/reconstruction; Intelligence reads. | **Evidence** | **Preserve/backfill** as attributed historical purchase evidence linked to party/relationship; never silently convert to sale orders. | Medium: reported amounts/quantities may be incomplete. | Direct legacy writes blocked after backfill. |
| `atlas.flower_buyer_buying_profiles` | Flower-specific buyer lane/stage/cadence/window/days/route priority. | Buyer workflow + audit/scope triggers; `v_flower_buyer_position_v1`. | **Domain projection** | **Repoint** to canonical relationship/party IDs; keep flower-specific semantics. | Medium: some fields may currently function as manually asserted state rather than derivation. | Writes allowed only through flower-domain/current-position commands, not arbitrary table writes. |
| `atlas.flower_buyer_product_preferences` | Flower/product preference, quantity, accepted price, source contact/sale lineage. | Flower buyer workflows; `v_flower_buyer_position_v1`. | **Domain projection/evidence-backed state** | **Repoint** to canonical relationship/party IDs and retain lineage. | Low-medium. | Guarded domain write only. |

Relevant buyer functions/RPCs: `record_buyer_outreach_result_v1`, `sync_buyer_identity_from_relationship_v1`, `sync_buyer_identity_from_contact_event_v1`, `flower_sale_buyer_options_v1`, `validate_flower_buyer_buying_profile_scope_v1`, `validate_flower_buyer_product_preference_scope_v1`.

Relevant buyer triggers: `sync_buyer_identity_from_relationship_v1`, `sync_buyer_identity_from_contact_event_v1`, buyer/profile/preference update/scope guards.

### 4.2 Communication custody and source evidence

| Current artifacts | Current responsibility / semantics | Current writers/readers | Target classification | Target destination / disposition | Migration risk | Direct writes after cutover |
| --- | --- | --- | --- | --- | --- | --- |
| `atlas.connected_sources` | Registry of connected communication/data sources. | Relay/source APIs. | **Core** | **Retain** as connected-source registry. | Low. | Guarded source-registration APIs only. |
| `atlas.communication_ingest_batches` | Batch-level source custody/provenance. | Communication relay ingest. | **Evidence** | **Retain**. | Low. | Append/guarded ingest only. |
| `atlas.communication_events` | Canonicalized communication evidence with `source_authority='evidence_only'`, `permitted_state_effect='append_source_attributed_evidence_only'`, `governing_state_changed=false`, source/custody hashes. | `ingest_communication_events_relay_api_v1`; shadow interpretation/readers. Append-only triggers. | **Core Evidence** | **Retain** unchanged in authority posture. Feed reconciliation; never directly govern current relationship state. | Low structurally; high value. | Only governed evidence ingestion. No mutating updates/deletes. |
| `atlas.communication_event_source_observations` | Source-observation lineage for communication events. | Ingest/reconciliation support. | **Evidence** | **Retain**. | Low. | Append-only. |
| `atlas.communication_event_conflicts` | Explicit conflict representation. | Communication reconciliation. | **Evidence** | **Retain/evolve** as needed by Receive. | Low; currently empty. | Guarded conflict creation only. |
| `atlas.communication_threads` | Thread grouping under source custody. | Ingest. | **Evidence/Core support** | **Retain**. | Low. | Guarded ingest only. |
| `atlas.communication_identity_links` | Intended mapping from communication identity to Atlas target identity. Currently no rows. | Guard function exists; no effective production linkage. | **Bridge → Core external identity link** | **Evolve** in #788 so communication identities resolve to canonical Atlas parties/relationships. | High because it is structurally present but operationally unused. | New writes through identity reconciliation only. |

Relevant functions/RPCs: `ingest_communication_events_relay_api_v1`, `register_communication_relay_api_v1`, `communication_source_health_self_api_v1`, `connected_sources_self_api_v1`, `communication_identity_links_guard_v1`, source-principal/observation guards, mutation rejection functions.

Relevant triggers include `communication_events_append_only`, `communication_events_source_guard`, source-observation append/source/parent guards, conflict source guard, identity-link guard, ingest-batch source guard, thread/source guards, and connected-source timestamp guard.

**Disposition:** This is the strongest existing reality-intake pattern in the relationship area. Preserve it. #789 should extend its evidence/reconciliation discipline rather than replace it with a looser generic JSON memory table.

### 4.3 Flower commerce and demand

| Current artifacts | Current responsibility / semantics | Current writers/readers | Target classification | Target destination / disposition | Migration risk | Direct writes after cutover |
| --- | --- | --- | --- | --- | --- | --- |
| `atlas.flower_sale_orders`, lines, cancellation events, fulfillment events | Authoritative flower commercial occurrence with guarded create/cancel/fulfill behavior and append-only event lanes. | Flower Commerce API and `record_flower_sale_*`, cancel/fulfillment RPCs; domain dashboards/read models. | **Domain authority** | **Retain**. Replace buyer relationship foreign-key concept with canonical relationship/party reference through governed migration. | Medium only at identity seam; commercial semantics are strong. | Continue command APIs; direct table writes remain blocked/guarded. |
| `atlas.flower_standing_orders`, lines, cancellation events | Recurring flower demand agreement. | Standing-order commands and demand materialization. | **Domain authority** | **Retain** and repoint identity reference. | Low-medium. | Guarded commands only. |
| `atlas.flower_demand_orders`, lines, commitment/pricing/allocation/release/cancellation/link events | Demand-side commercial truth with append-only commitment/allocation/pricing history and explicit sale links. | `record/commit/cancel/allocate/release_flower_demand_*` command family. | **Domain authority** | **Retain** and repoint identity reference. | Low-medium. | Guarded commands only. |
| `atlas.flower_prospect_routes`, lines, release events, prospect-sale links | Flower-specific commercial prospect planning and later sale linkage. | Prospect route commands; sync triggers to operational routes. | **Domain planning** | **Retain/evolve** as flower-domain producer of generic Rounds. Repoint relationship IDs. | Medium. | Domain commands only. |
| `atlas.v_flower_buyer_position_v1`, `v_flower_buyer_product_sales_v1`, `v_flower_buyer_sales_summary_v1` | Flower buyer read models combining buyer reconstruction + commercial/domain records. | Flower UI/API and Intelligence. | **Projection** | **Repoint** to canonical relationship timeline/current-position sources. | High during cutover because current UI depends on them. | Read-only. |

The flower command family includes guarded `record_*`, `cancel_*`, `commit_*`, `materialize_*`, `allocate_*`, `release_*`, owner-operator variants, validators, and sale/demand/prospect link functions. The current append-only/validation trigger pattern is intentional target behavior, not migration debt.

### 4.4 Generic operational routes → Rounds

| Current artifacts | Current responsibility / semantics | Current writers/readers | Target classification | Target destination / disposition | Migration risk | Direct writes after cutover |
| --- | --- | --- | --- | --- | --- | --- |
| `atlas.operational_routes` | Generic executable route record with source authority/system/record lineage and idempotency. | `record_operational_route_v1`; flower sync functions; route boards. | **Core execution** | **Evolve** into universal Rounds foundation (#792), preserving source bindings and idempotency. | Low-medium. | Guarded route/Round commands only. |
| `atlas.operational_route_stops` | Generic route stops. | Route record/sync APIs. | **Core execution** | **Retain/evolve**. Add canonical party/place/relationship references where appropriate. | Medium at identity seam. | Guarded commands only. |
| `atlas.operational_route_events` | Actual route/stop execution history. | `record_operational_route_stop_event_v1`. | **Core event history** | **Retain**. | Low. | Append/event command only. |
| `atlas.operational_route_bindings` | Immutable source-system/source-record binding. | Domain→route sync. | **Core bridge infrastructure** | **Retain**. | Low. | Immutable/guarded. |
| Flower prospect/sale→route sync triggers and functions | Project domain intent into generic execution. | `sync_flower_prospect_route_to_operational_route_v1`, `sync_flower_sale_order_to_operational_route_v1`, related triggers. | **Domain→Core projection bridge** | **Retain/adapt** to Rounds. | Low. | Bridge writes only through declared projection path. |

This path already demonstrates the desired architecture: domain truth remains flower-domain truth, while execution is projected into a generic Atlas structure.

### 4.5 Local Intel / Elm Local → Smart Contacts

| Current artifacts | Current responsibility / semantics | Current writers/readers | Target classification | Target destination / disposition | Migration risk | Direct writes after cutover |
| --- | --- | --- | --- | --- | --- | --- |
| `local_intel.entities`, `people`, `entity_aliases`, `entity_claims`, `entity_signals`, `entity_relationships`, `organization_identity_profiles` | Discovered/enriched identity corpus, source-backed claims and relationship graph. | Search/business-census/entity ingestion and identity resolution functions; Elm Local reads. | **Integration** | **Extract** behind Smart Contacts. Core identity facts needed operationally are linked/copied through explicit external-identity/evidence contracts, not foreign-owned as canonical Atlas identity. | High if treated as canonical; manageable because extraction can be adapter-first. | Smart Contacts may write its own integration schema; Atlas Core must not write these tables directly as canonical identity. |
| `local_intel.contact_points`, contact context/preferences/validation | Discovered/validated communication coordinates. | Discovery, validation, targeting. | **Integration** | **Retain inside Smart Contacts**; expose evidence-backed contact observations to Core through adapter when operationally accepted. | Medium. | Integration-owned only. |
| `local_intel.outreach_targets` | Prospect/target selection. | Local intelligence workflows. | **Integration** | Smart Contacts targeting surface. | Low. | Integration only. |
| `local_intel.campaigns`, targets, contacts, target-fit adjudications, send receipts, response events | Marketing/outreach campaign planning/execution/evidence. | Campaign functions. | **Integration** | Smart Contacts campaign subsystem. | Low-medium; production use is currently light. | Integration only. |
| `local_intel.provider_messages`, provider update/availability candidates, communication provider/sender/permission/authority events | Provider-facing messaging/communication safety and ingestion. | Provider/campaign functions. | **Integration** | Smart Contacts/provider adapter. | Low currently due sparse usage. | Integration only. |
| Search discovery work/lanes/subjects/sources/evidence/candidates | Current web discovery and evidence-gathering pipeline. | `app/api/atlas/elm-local-discovery/route.ts` plus `get/claim/register/ingest/finish/requeue_search_discovery_*`. | **Integration Evidence** | Smart Contacts discovery engine. | Low architecturally; naming currently says Atlas/Elm Local in route. | Integration evidence intake only. |

Relevant local-intelligence function families include search discovery claim/finish/requeue/ingest/apply/register; campaign targeting/send/response; communication authority/permission/provider/sender-health; research/search-finding/census; contact/relationship search synchronization; and identity adjudication.

### 4.6 Cross-schema boundary violations / transition bridges

| Current path | Current behavior | Classification | Disposition |
| --- | --- | --- | --- |
| `atlas.entity_identity_review_queue_api_v1` → local-intel identity review | Atlas Core-facing RPC exposes an identity review queue whose underlying authority is local-intelligence identity. | **Legacy Bridge** | Replace with Core canonical-identity review contract in #788; Smart Contacts can submit evidence/candidates. |
| `atlas.entity_identity_adjudicate_api_v1` → local-intel adjudication | Atlas-facing adjudication mutates/accepts local-intelligence identity decisions. | **Legacy Bridge** | Split Core identity adjudication from Smart Contacts candidate adjudication. |
| `atlas.record_phone_outreach_result_v1` / `record_phone_outreach_result_and_complete_v2` | Atlas task completion path reaches into local-intelligence campaign/entity/contact structures. | **Integration Bridge** | Record operational contact occurrence in Core relationship history; notify Smart Contacts campaign adapter separately when applicable. |
| `app/api/atlas/elm-local-discovery/route.ts` | Atlas URL namespace runs a web-search evidence gatherer directly against `local_intel` RPCs. | **Integration API living under Atlas namespace** | Move behind Smart Contacts integration boundary; Atlas may invoke adapter, not depend on internal local-intel tables. |

These are not reasons to delete Elm Local. They identify where optional intelligence currently impersonates Core infrastructure.

## 5. API / application call-site census

Current main-branch API routes relevant to this work are classified below.

| API route | Current write/read path | Classification | Disposition |
| --- | --- | --- | --- |
| `app/api/atlas/buyer-outreach/route.ts` | POST → `atlas.record_buyer_outreach_result_v1`; writes contact event and legacy reconstructed buyer state. | **Legacy UI/API write** | Repoint to Receive/relationship event command; compatibility adapter during cutover. |
| `app/api/atlas/phone-outreach/route.ts` | POST → `atlas.record_phone_outreach_result_and_complete_v2`; task + local-intel bridge. | **Integration Bridge** | Split Core operational event/task completion from optional Smart Contacts campaign update. |
| `app/api/atlas/network-outreach/route.ts` | POST → `record_network_outreach_result_v1` or releases next network batch. Network/event-specific result grammar. | **Domain/legacy specialized outreach** | Preserve event-domain fields where real; emit generic relationship occurrence/open loop through canonical relationship contract. |
| `app/api/atlas/entity-identity-review/route.ts` | Owner adjudication → `entity_identity_adjudicate_api_v1`. | **Legacy Bridge** | Repoint to Core identity review/adjudication; Smart Contacts candidate source remains external. |
| `app/api/atlas/elm-local-discovery/route.ts` | Web-search evidence gatherer; directly uses `local_intel` RPCs for search context, source registration, evidence ingestion, subject/lane work. | **Integration** | Smart Contacts adapter/API. |
| `app/api/atlas/flower-commerce/route.ts` | GET reads flower commercial tables and buyer options; POST uses guarded flower-sale commands with idempotency. | **Domain authority API** | Retain commands; repoint buyer options/reference to canonical relationship/party. |
| `app/api/atlas/flower-demand/route.ts`, `flower-demand-workflow/route.ts` | Demand domain reads/commands. | **Domain authority API** | Retain; repoint identity seam. |
| `app/api/atlas/flower-prospect-route/route.ts` | Prospect planning/route command. | **Domain planning API** | Retain; project to Rounds and canonical relationship IDs. |
| `app/api/continuity/messages/ingest/route.ts` | Enforces evidence-only payload boundary, hashes relay token, calls `ingest_communication_events_relay_api_v1`, then optional shadow interpretation. | **Core Evidence API** | Retain as model receive path. |
| `app/api/owner/ask-atlas/reconcile/route.ts` | Treats worker report as attributed evidence, compares against governing records, returns reconciliation classification, explicitly changes no records. | **Core reconciliation precedent** | Retain; use as design precedent for #789. Extend later through explicit proposed/accepted command path rather than allowing model to mutate raw tables. |

### Application-write rule after cutover

No UI or assistant route may select a storage table because it happens to contain the desired field. Application routes must call one of:

1. a Core Receive/reconciliation contract;
2. a Core identity/relationship/Round command;
3. a declared domain command; or
4. an explicit integration adapter.

Compatibility RPCs may remain temporarily, but they must be visibly classified as bridges and must not accumulate new semantics.

## 6. Projection/read-model census

### Atlas/flower projections

- `atlas.v_flower_buyer_position_v1` — **Domain Projection**; repoint to canonical relationship history/current state.
- `atlas.v_flower_buyer_product_sales_v1` — **Domain Projection**; retain/repoint.
- `atlas.v_flower_buyer_sales_summary_v1` — **Domain Projection**; retain/repoint.

### Intelligence projections

- `intelligence.v_noel_buyer_contact_events`
- `intelligence.v_noel_buyer_followup_queue_v1`
- `intelligence.v_noel_buyer_memory_v1`
- `intelligence.v_noel_buyer_order_history`
- `intelligence.v_noel_buyer_relationships`
- `intelligence.v_noel_florist_relationships`
- `intelligence.v_noel_flower_buyer_positions`
- `intelligence.v_noel_flower_buyer_product_positions`

All are **Projection**. They may remain useful read surfaces, but none may be treated as primary operational authority. Repoint after #788/#790; retire duplicates only after read parity.

### Local-intelligence projections

- `local_intel.v_local_intel_relationship_truth`
- `local_intel.v_person_identity_v1`
- `local_intel.v_outreach_contact_resolution_v1`
- `local_intel.v_best_entity_contact_route_v1`
- `local_intel.v_entity_identity_review_queue_v2`

All are **Integration Projection**. Smart Contacts may retain them. Core must not require them to know who a canonical Atlas party is.

## 7. Trigger and mutation semantics worth preserving

The census found several existing patterns that should survive migration:

1. **Communication evidence is append-only** and source guarded.
2. **Flower sale/demand/standing/prospect occurrence tables use append-only or guarded command semantics** with validators rather than arbitrary in-place edits.
3. **Cancellation/release/commitment are modeled as events** rather than destructive history rewriting.
4. **Operational route bindings are immutable** and preserve source-system/source-record lineage.
5. **Ask Atlas reconciliation is read-only by default** and explicitly abstains instead of converting worker wording into governing truth.
6. **Local Intel discovery preserves source citations/evidence** and separates discovered evidence from canonical application where identity is unresolved.

The migration must not destroy these strengths in the name of unification.

## 8. Current failure modes explained by the census

### 8.1 Relationship memory without canonical identity

Buyer records contain rich business/contact history, but all 92 buyer `entity_id` links are null. The system therefore cannot naturally join that memory to a general Atlas party record.

### 8.2 Communication evidence without identity resolution

Atlas has 4,084 communication events and a purpose-built identity-link table with no rows. The evidence lane is strong; the reconciliation/linking lane is not active.

### 8.3 Multiple event vocabularies

Buyer outreach, phone outreach, network outreach, campaign responses, communication evidence, flower sales, and operational routes each describe interactions from different angles. Some specialization is legitimate, but there is no single generic relationship occurrence/open-loop spine underneath them.

### 8.4 Optional intelligence owns too much identity surface

`local_intel` contains a sophisticated identity/contact graph and Atlas-facing RPCs call it directly. That makes removing or disabling Elm Local unsafe even though Smart Contacts should be optional.

### 8.5 Projection can look like authority

The Intelligence and buyer-position views are useful and rich enough to be mistaken for truth stores. The census explicitly classifies them as projections so future code cannot write architecture around that mistake.

## 9. Target migration map

| Current lane | Destination work |
| --- | --- |
| Buyer pseudo-identity + aliases | #788 canonical Atlas party graph / external identities |
| Communication identity linking | #788 canonical party/external identity reconciliation |
| Buyer contact events + current state | #789 Receive + #790 relationship timeline/current position |
| Buyer reconstructed purchases | #793 historical evidence backfill |
| Flower buyer profiles/preferences | Flower domain projections repointed during #790/#793 |
| Flower sale/demand/standing authority | Retained; identity FK concept migrated during #788/#790 |
| Operational routes | #792 Rounds evolution |
| Elm Local identity/contact/discovery/campaign | #791 Smart Contacts extraction |
| Atlas RPCs that directly call local-intel semantics | #788/#791 explicit adapter replacement |
| Assistant/UI table-oriented writes | #794 cutover after Core contracts exist |
| Existing Intelligence read models | Repoint after #790, then parity-based retirement decisions |

## 10. Cutover prohibitions

The following are explicitly prohibited during later work:

- Do not bulk-copy `local_intel.entities` into a new Core party table and declare identity solved.
- Do not convert every `buyer_reported_purchase_history` row into a sale order.
- Do not update/delete append-only communication, sale, demand, standing, route-event, cancellation, commitment, allocation, or source-custody history to make migration easier.
- Do not let a generated summary/current-state row become the only surviving record of an occurrence.
- Do not make Smart Contacts required for Atlas to remember a person, business, interaction, sale, route, commitment, or follow-up.
- Do not replace the present evidence firewalls with a generic assistant JSON write endpoint.
- Do not retire a legacy path until its replacement has read/write parity tests and the source-custody gate remains green.

## 11. Decisions frozen by this census

The following are current-state classification decisions and do not require further product interpretation:

1. Canonical people/organizations/places must move to Atlas Core, not remain owned by `local_intel`.
2. Smart Contacts owns discovery, enrichment, ranking, campaign targeting, and provider-specific outreach intelligence.
3. Atlas Core owns actual relationship history, current position, open loops/follow-ups, canonical identity, and field execution.
4. Flower commercial tables are domain authority and should not be flattened into a generic CRM.
5. Communication custody is evidence authority and should not be flattened into governing relationship state.
6. Operational routes are a viable Core foundation for Rounds.
7. Existing Intelligence `v_noel_*` relationship views are projections, not source authority.
8. Ask Atlas reconciliation is a valid precedent for evidence-first Receive behavior.

## 12. One deferred product design question

The census does not need to decide the exact generic vocabulary for **relationship intent before contact**—for example whether Atlas Core calls the generic object an opportunity, pursuit, relationship objective, or something else. What is frozen is the boundary: Core must own the operational relationship/open-loop truth; Smart Contacts may recommend, rank, or discover whom to pursue. #790 can name the generic model without reopening the ownership decision.

## 13. #787 exit gate

This census is sufficient to begin #788 when:

- [x] Buyer relationship and buyer-local identity paths are classified.
- [x] Communication evidence/custody paths are classified.
- [x] Flower sale/demand/standing/prospect authority paths are classified.
- [x] Operational route/Round foundation paths are classified.
- [x] Local Intel identity/contact/discovery/campaign/provider paths are classified.
- [x] Atlas↔local-intel boundary bridges are identified.
- [x] Relevant current API/UI write paths are classified.
- [x] Relationship/buyer/Intelligence read projections are classified.
- [x] Direct-write cutover posture is stated.
- [x] Migration hazards and preservation rules are stated.

No subsequent migration should need conversation memory to decide which current lane owns what. New artifacts discovered during implementation must be added to this census before they are migrated; discovery of a missed artifact does not authorize an ad-hoc destination.