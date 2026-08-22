alter table local_intel.organization_identity_profiles
  add column if not exists identity_form text not null default 'unknown';

alter table local_intel.organization_identity_profiles
  drop constraint if exists organization_identity_profiles_identity_form_check;
alter table local_intel.organization_identity_profiles
  add constraint organization_identity_profiles_identity_form_check
  check (identity_form in ('unknown','public_identity_surface','shared_brand','legal_entity','operating_unit'));

insert into local_intel.relationship_definitions (
  relationship_kind,relationship_category,subject_entity_types,object_entity_types,
  inverse_relationship_kind,is_hierarchical,is_person_organization,description,is_active,metadata,created_at,updated_at
)
values
  ('uses_brand','brand_legal_identity',array['business','organization','nonprofit']::text[],array['business','organization','nonprofit']::text[],
   'brand_used_by',false,false,'Subject legal or operating organization provides services under the object brand identity. This relationship does not assert ownership, parentage, or legal identity equality.',true,
   jsonb_build_object('does_not_imply_ownership',true,'does_not_imply_parentage',true,'identity_distinct',true),now(),now()),
  ('brand_used_by','brand_legal_identity',array['business','organization','nonprofit']::text[],array['business','organization','nonprofit']::text[],
   'uses_brand',false,false,'Subject brand identity is used by the object legal or operating organization. This relationship does not assert ownership, parentage, or legal identity equality.',true,
   jsonb_build_object('does_not_imply_ownership',true,'does_not_imply_parentage',true,'identity_distinct',true),now(),now())
on conflict (relationship_kind) do update set
  relationship_category=excluded.relationship_category,
  subject_entity_types=excluded.subject_entity_types,
  object_entity_types=excluded.object_entity_types,
  inverse_relationship_kind=excluded.inverse_relationship_kind,
  is_hierarchical=excluded.is_hierarchical,
  is_person_organization=excluded.is_person_organization,
  description=excluded.description,
  is_active=excluded.is_active,
  metadata=excluded.metadata,
  updated_at=now();

insert into local_intel.sources (source_url,source_kind,publisher,title,source_date,retrieved_at,notes,metadata)
values (
  'https://abacuspro.com/',
  'official_organization_site',
  'Abacus!',
  'Abacus! - Better Guidance. Smarter Decisions.',
  null,
  now(),
  'First-party identity source for the Abacus! shared brand and alternative practice structure. The site states that Abacus! is the brand name under which Abacus CPAs LLC and Abacus Business Consulting, LLC provide professional services and that the entities under the brand are independently owned.',
  jsonb_build_object(
    'evidence_scope','brand_and_legal_structure',
    'first_party',true,
    'structure','alternative_practice_structure',
    'ownership_relationship_asserted',false,
    'captured_for','party_relative_identity_governance_v1'
  )
)
on conflict (source_url) do update set
  source_kind=excluded.source_kind,
  publisher=excluded.publisher,
  title=excluded.title,
  retrieved_at=excluded.retrieved_at,
  notes=excluded.notes,
  metadata=coalesce(local_intel.sources.metadata,'{}'::jsonb) || excluded.metadata;

select * from local_intel.refresh_source_class_assignments_v2();

update local_intel.entities
set metadata = (coalesce(metadata,'{}'::jsonb) - 'legal_name') || jsonb_build_object(
      'brand_name','Abacus!',
      'identity_form','shared_brand',
      'legal_structure','alternative_practice_structure',
      'classification_state','shared_brand_structure_verified',
      'official_identity_source','https://abacuspro.com/',
      'ownership_relationship_asserted',false,
      'legal_entities_named',jsonb_build_array('Abacus CPAs LLC','Abacus Business Consulting, LLC')
    ),
    updated_at=now(),
    last_verified_at=now(),
    verification_state='official_verified'
where stable_key='network-employer-abacus';

update local_intel.organization_identity_profiles p
set identity_form='shared_brand',
    operating_unit_kind='unknown',
    hierarchy_state='affiliated_only',
    legal_name=null,
    local_unit_name=null,
    canonical_domain='abacuspro.com',
    source_id=s.id,
    last_hierarchy_verified_at=now(),
    metadata=coalesce(p.metadata,'{}'::jsonb) || jsonb_build_object(
      'identity_classified_at',now(),
      'identity_classification_basis','First-party Abacus! site identifies Abacus! as the shared brand used by two separately named legal entities in an alternative practice structure.',
      'identity_classification_source_strength','first_party_organization_level',
      'alternative_practice_structure',true,
      'ownership_relationship_asserted',false,
      'legal_entity_count_named',2
    ),
    updated_at=now()
from local_intel.sources s
where p.entity_id=(select id from local_intel.entities where stable_key='network-employer-abacus')
  and s.source_url='https://abacuspro.com/';

insert into local_intel.entities (
  stable_key,entity_type,name,description,website_url,phone,email,address_line1,city,state,postal_code,
  status,verification_state,last_verified_at,metadata,created_at,updated_at
)
select 'abacus-cpas-llc-legal-entity','business','Abacus CPAs LLC',
       'Legal professional-services entity named by the first-party Abacus! site as one of the independently owned entities operating under the Abacus! brand.',
       'https://abacuspro.com/',null,null,null,null,null,null,'active','official_verified',now(),
       jsonb_build_object('identity_form','legal_entity','shared_brand','Abacus!','structure','alternative_practice_structure','first_party_identity_source','https://abacuspro.com/','independently_owned_under_brand',true,'ownership_relationship_asserted',false),
       now(),now()
where not exists (select 1 from local_intel.entities where stable_key='abacus-cpas-llc-legal-entity');

insert into local_intel.entities (
  stable_key,entity_type,name,description,website_url,phone,email,address_line1,city,state,postal_code,
  status,verification_state,last_verified_at,metadata,created_at,updated_at
)
select 'abacus-business-consulting-llc-legal-entity','business','Abacus Business Consulting, LLC',
       'Legal professional-services entity named by the first-party Abacus! site as one of the independently owned entities operating under the Abacus! brand.',
       'https://abacuspro.com/',null,null,null,null,null,null,'active','official_verified',now(),
       jsonb_build_object('identity_form','legal_entity','shared_brand','Abacus!','structure','alternative_practice_structure','first_party_identity_source','https://abacuspro.com/','independently_owned_under_brand',true,'ownership_relationship_asserted',false),
       now(),now()
where not exists (select 1 from local_intel.entities where stable_key='abacus-business-consulting-llc-legal-entity');

insert into local_intel.organization_identity_profiles (
  entity_id,operating_unit_kind,hierarchy_state,legal_name,local_unit_name,canonical_domain,last_hierarchy_verified_at,source_id,metadata,created_at,updated_at,identity_unit_class,identity_form
)
select e.id,'unknown','affiliated_only',e.name,null,'abacuspro.com',now(),s.id,
       jsonb_build_object('identity_classification_basis','First-party Abacus! site names this legal entity as an independently owned entity providing professional services under the Abacus! brand.','alternative_practice_structure',true,'shared_brand','Abacus!','ownership_relationship_asserted',false),
       now(),now(),'canonical_organization','legal_entity'
from local_intel.entities e cross join local_intel.sources s
where e.stable_key in ('abacus-cpas-llc-legal-entity','abacus-business-consulting-llc-legal-entity')
  and s.source_url='https://abacuspro.com/'
on conflict (entity_id) do update set
  operating_unit_kind=excluded.operating_unit_kind,
  hierarchy_state=excluded.hierarchy_state,
  legal_name=excluded.legal_name,
  canonical_domain=excluded.canonical_domain,
  last_hierarchy_verified_at=excluded.last_hierarchy_verified_at,
  source_id=excluded.source_id,
  metadata=excluded.metadata,
  updated_at=now(),
  identity_unit_class=excluded.identity_unit_class,
  identity_form=excluded.identity_form;

insert into local_intel.entity_relationships (
  subject_entity_id,relationship_kind,object_entity_id,role_title,valid_from,valid_to,is_current,
  verification_state,last_verified_at,source_id,metadata,created_at,updated_at,truth_state,current_confidence,
  last_seen_current_at,conflict_state,conflict_reason,resolution_basis,adjudicated_at
)
select legal.id,'uses_brand',brand.id,null,null,null,true,'source_verified',now(),s.id,
       jsonb_build_object('structure','alternative_practice_structure','does_not_imply_ownership',true,'does_not_imply_parentage',true,'identity_distinct',true),
       now(),now(),'accepted_current',1.0,now(),'none',null,
       'First-party Abacus! disclosure names the legal entity as providing professional services under the Abacus! brand.',null
from local_intel.entities legal
join local_intel.entities brand on brand.stable_key='network-employer-abacus'
join local_intel.sources s on s.source_url='https://abacuspro.com/'
where legal.stable_key in ('abacus-cpas-llc-legal-entity','abacus-business-consulting-llc-legal-entity')
  and not exists (
    select 1 from local_intel.entity_relationships r
    where r.subject_entity_id=legal.id and r.relationship_kind='uses_brand' and r.object_entity_id=brand.id and r.is_current
  );

insert into local_intel.entity_relationships (
  subject_entity_id,relationship_kind,object_entity_id,role_title,valid_from,valid_to,is_current,
  verification_state,last_verified_at,source_id,metadata,created_at,updated_at,truth_state,current_confidence,
  last_seen_current_at,conflict_state,conflict_reason,resolution_basis,adjudicated_at
)
select brand.id,'brand_used_by',legal.id,null,null,null,true,'source_verified',now(),s.id,
       jsonb_build_object('structure','alternative_practice_structure','does_not_imply_ownership',true,'does_not_imply_parentage',true,'identity_distinct',true),
       now(),now(),'accepted_current',1.0,now(),'none',null,
       'Inverse of first-party-supported uses_brand relationship; no ownership or parentage is asserted.',null
from local_intel.entities legal
join local_intel.entities brand on brand.stable_key='network-employer-abacus'
join local_intel.sources s on s.source_url='https://abacuspro.com/'
where legal.stable_key in ('abacus-cpas-llc-legal-entity','abacus-business-consulting-llc-legal-entity')
  and not exists (
    select 1 from local_intel.entity_relationships r
    where r.subject_entity_id=brand.id and r.relationship_kind='brand_used_by' and r.object_entity_id=legal.id and r.is_current
  );

insert into local_intel.entity_sources(entity_id,source_id,relation_kind)
select e.id,s.id,'primary_current_identity'
from local_intel.entities e cross join local_intel.sources s
where e.stable_key in ('network-employer-abacus','abacus-cpas-llc-legal-entity','abacus-business-consulting-llc-legal-entity')
  and s.source_url='https://abacuspro.com/'
  and not exists (
    select 1 from local_intel.entity_sources es where es.entity_id=e.id and es.source_id=s.id and es.relation_kind='primary_current_identity'
  );