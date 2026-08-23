insert into atlas.source_custody_adjudications (
  custody_key,
  custody_class,
  disposition,
  evidence,
  rationale,
  adjudicated_by
)
values (
  'atlas-management-before-20260823202957',
  'historical_provenance',
  'accepted',
  jsonb_build_object(
    'policyKind','legacy_provenance_epoch',
    'cutoverVersion','20260823202957',
    'migrationCount',1171,
    'firstVersion','20260702174405',
    'lastVersion','20260823163557',
    'manifestSha256','68d1e72e8a85ac35dd892d08d2b491f435324acb26c6e0386639ef12377c0ed8',
    'repositoryCensus',jsonb_build_object(
      'verified',363,
      'unresolvedHistorical',808,
      'missing',234,
      'mismatched',190,
      'versionDriftMatch',73,
      'versionDriftMismatch',309,
      'ambiguousNameDrift',2
    ),
    'currentSurfaceRequiredExact',true,
    'postCutoverSourceRequiredExact',true,
    'waivesCurrentSurfaceMismatch',false
  ),
  'The pre-custody Atlas migration ledger is preserved as immutable deployment provenance but is not fully reproducible from repository bytes. Its exact ledger fingerprint and debt census are accepted as a legacy provenance epoch only because the current governed executable surface is independently required to match repository authority exactly. This adjudication does not convert legacy discrepancies into verified source and cannot waive any present executable-surface mismatch. Every Atlas-management migration at or after the custody cutover must reconcile exactly or by an explicit per-artifact adjudication.',
  'atlas-source-custody-v1'
);

create or replace function atlas.source_custody_release_packet_v1()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, atlas, extensions, supabase_migrations
as $function$
with migration_bytes as (
  select version, name, array_to_string(statements, E'\n') as sql
  from supabase_migrations.schema_migrations
),
management_migrations as (
  select version, name,
    encode(
      extensions.digest(
        convert_to('blob ' || octet_length(sql)::text, 'UTF8')
        || decode('00','hex')
        || convert_to(sql,'UTF8'),
        'sha1'
      ),
      'hex'
    ) as expected_blob_sha
  from migration_bytes
  where position('atlas.' in lower(sql)) > 0
),
legacy_migrations as (
  select * from management_migrations where version < '20260823202957'
),
post_cutover_migrations as (
  select * from management_migrations where version >= '20260823202957'
),
legacy_live as (
  select
    count(*)::integer as migration_count,
    min(version) as first_version,
    max(version) as last_version,
    encode(
      extensions.digest(
        convert_to(coalesce(string_agg(version || E'\t' || name || E'\t' || expected_blob_sha, E'\n' order by version),''),'UTF8'),
        'sha256'
      ),
      'hex'
    ) as manifest_sha256
  from legacy_migrations
),
legacy_adjudication as (
  select custody_key, disposition, evidence, rationale, adjudicated_by, adjudicated_at
  from atlas.source_custody_adjudications
  where custody_class='historical_provenance'
    and custody_key='atlas-management-before-20260823202957'
  order by adjudicated_at desc
  limit 1
),
latest_drift_adjudications as (
  select distinct on (custody_key)
    custody_key, disposition, evidence, rationale, adjudicated_by, adjudicated_at
  from atlas.source_custody_adjudications
  where custody_class='version_drift'
  order by custody_key, adjudicated_at desc
),
surface_packet as (
  select atlas.source_custody_live_packet_v1() as packet
),
rpc_drift as (
  select count(*)::integer as unresolved
  from atlas.authenticated_rpc_registry_drift_v1()
)
select jsonb_build_object(
  'contractVersion',2,
  'capturedAt',statement_timestamp(),
  'surface',jsonb_build_object(
    'contractVersion',1,
    'families',coalesce((select packet->'families' from surface_packet),'[]'::jsonb)
  ),
  'rpcDriftCount',(select unresolved from rpc_drift),
  'migrationProvenance',jsonb_build_object(
    'scope','atlas-management',
    'exactFromVersion','20260823202957',
    'legacyEpoch',jsonb_build_object(
      'live',coalesce((select to_jsonb(legacy_live) from legacy_live),'{}'::jsonb),
      'adjudication',coalesce((select jsonb_build_object(
        'custodyKey',custody_key,
        'disposition',disposition,
        'evidence',evidence,
        'rationale',rationale,
        'adjudicatedBy',adjudicated_by,
        'adjudicatedAt',adjudicated_at
      ) from legacy_adjudication),'{}'::jsonb)
    ),
    'migrationCount',(select count(*) from post_cutover_migrations),
    'manifest',coalesce((
      select jsonb_agg(jsonb_build_object(
        'version',version,
        'name',name,
        'expectedBlobSha',expected_blob_sha
      ) order by version)
      from post_cutover_migrations
    ),'[]'::jsonb)
  ),
  'acceptedVersionDrift',coalesce((
    select jsonb_agg(jsonb_build_object(
      'custodyKey',custody_key,
      'evidence',evidence,
      'rationale',rationale,
      'adjudicatedBy',adjudicated_by,
      'adjudicatedAt',adjudicated_at
    ) order by custody_key)
    from latest_drift_adjudications
    where disposition='accepted'
  ),'[]'::jsonb)
);
$function$;

revoke all on function atlas.source_custody_release_packet_v1() from public;
grant execute on function atlas.source_custody_release_packet_v1() to anon, authenticated, service_role;

comment on function atlas.source_custody_release_packet_v1() is
'Publicly callable read-only Atlas source-custody packet. Current executable surface and post-cutover migration provenance are hard release proofs; pre-cutover deployment provenance is bound to an immutable legacy-epoch fingerprint and debt census. Contains no operational business rows or migration SQL bodies.';