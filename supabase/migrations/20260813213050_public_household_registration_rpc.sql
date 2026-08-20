create or replace function atlas.submit_public_household_registration_v1(
  p_offering_key text,
  p_primary_name text,
  p_primary_email text,
  p_primary_phone text default null,
  p_household_name text default null,
  p_participant_names text[] default '{}'::text[],
  p_terms_accepted boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  o atlas.community_registration_offerings%rowtype;
  r atlas.community_registrations%rowtype;
  n text := trim(coalesce(p_primary_name,''));
  e text := lower(trim(coalesce(p_primary_email,'')));
  p text;
  rn text;
begin
  if not p_terms_accepted then
    raise exception using errcode='22023', message='Participation terms must be accepted.';
  end if;
  if length(n) < 2 or length(n) > 120 then
    raise exception using errcode='22023', message='Primary adult name is required.';
  end if;
  if length(e) < 5 or length(e) > 254 or position('@' in e) < 2 then
    raise exception using errcode='22023', message='A valid email address is required.';
  end if;

  select * into o
  from atlas.community_registration_offerings x
  where x.stable_key=trim(p_offering_key)
    and x.registration_type='household_participation'
    and x.status='open'
    and (x.opens_at is null or x.opens_at<=now())
    and (x.closes_at is null or x.closes_at>=now())
  limit 1;
  if not found then
    raise exception using errcode='P0002', message='Registration is not currently open for this program.';
  end if;

  if exists(select 1 from atlas.community_registrations x where x.offering_id=o.id and lower(x.primary_email)=e and x.status not in ('cancelled','refunded')) then
    raise exception using errcode='23505', message='This email is already registered for this program.';
  end if;

  rn := 'ELM-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));
  insert into atlas.community_registrations(
    offering_id,registration_number,registrant_type,status,primary_name,primary_email,
    primary_phone,household_name,submitted_at,confirmed_at,metadata
  ) values (
    o.id,rn,'household',case when o.fee_amount>0 then 'payment_pending' else 'confirmed' end,
    n,e,nullif(trim(coalesce(p_primary_phone,'')),''),nullif(trim(coalesce(p_household_name,'')),''),
    now(),case when o.fee_amount=0 then now() else null end,
    jsonb_build_object('source','public_registration_v1','terms_version',o.terms_version,'terms_accepted_at',now())
  ) returning * into r;

  insert into atlas.community_registration_participants(registration_id,display_name,participant_role)
  values(r.id,n,'adult');
  foreach p in array coalesce(p_participant_names,'{}'::text[]) loop
    p:=trim(p);
    if p<>'' then
      insert into atlas.community_registration_participants(registration_id,display_name,participant_role)
      values(r.id,left(p,120),'family_member');
    end if;
  end loop;

  if o.fee_amount>0 then
    insert into atlas.community_registration_payments(
      registration_id,amount,currency,status,beneficiary_type,beneficiary_reference,metadata
    ) values (
      r.id,o.fee_amount,o.fee_currency,'pending',
      nullif(o.metadata->>'revenue_beneficiary_type',''),nullif(o.metadata->>'revenue_beneficiary_reference',''),
      jsonb_build_object('beneficiary_status',coalesce(o.metadata->>'revenue_beneficiary_status','unresolved'),'payment_integration_status',coalesce(o.metadata->>'payment_integration_status','not_configured'))
    );
  end if;

  return jsonb_build_object(
    'ok',true,'registration_id',r.id,'registration_number',r.registration_number,'status',r.status,
    'payment_status',case when o.fee_amount>0 then 'pending' else 'not_required' end,
    'amount_due',o.fee_amount,'currency',o.fee_currency,
    'message',case when o.fee_amount>0 then 'Registration received. Payment instructions will follow.' else 'Registration confirmed.' end
  );
end;
$$;

revoke all on function atlas.submit_public_household_registration_v1(text,text,text,text,text,text[],boolean) from public;
grant execute on function atlas.submit_public_household_registration_v1(text,text,text,text,text,text[],boolean) to anon, authenticated, service_role;
