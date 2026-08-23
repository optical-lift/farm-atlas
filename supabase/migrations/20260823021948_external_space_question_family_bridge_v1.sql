insert into local_intel.question_families(
  question_key,label,resident_intent,primary_object_scopes,freshness_class,minimum_evidence,
  answer_policy,insufficient_data_policy,example_questions,sort_order,active
)
select
  'external_space_use',
  'External gathering-space use',
  'Does this organization actually use, seek, rent, or otherwise rely on gathering space outside its own facilities, and in what contexts?',
  array['entity','outreach_target']::text[],
  'moderate',
  jsonb_build_object(
    'preferred','dated attributable evidence of event location, venue booking/rental, venue search/RFP, facility inventory, or explicit space preference',
    'scope_rule','organization-level evidence does not automatically establish every use-case fit',
    'negative_rule','no search result is not evidence that external space is never used'
  ),
  'Return the strongest attributable evidence about external, internal, or mixed gathering-space behavior. Keep organization-level behavior separate from campaign-use-case fit. Do not convert generic event activity into external-venue use unless location or venue behavior is supported.',
  'If governed sources do not establish external or internal space behavior, preserve the result as unresolved and record what was checked. Do not infer that the organization does not use external space.',
  jsonb_build_array(
    'Has this organization held staff training or planning at an external venue?',
    'Has this organization rented, booked, searched for, or solicited external meeting/event space?',
    'Does this organization appear to self-supply the relevant gathering space?'
  ),
  95,
  true
where not exists(select 1 from local_intel.question_families where question_key='external_space_use');