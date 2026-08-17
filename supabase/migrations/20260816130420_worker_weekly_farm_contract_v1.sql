do $deploy$
declare v_sql text;
begin
  select content into v_sql from http_get('https://raw.githubusercontent.com/optical-lift/farm-atlas/f256579e9b179586e605768aacbd31facfd0f472/supabase/migrations/20260816124500_worker_weekly_farm_contract_v1.sql');
  if v_sql is null or length(v_sql)<1000 then raise exception 'Pinned 3G migration source unavailable'; end if;
  execute v_sql;
end;
$deploy$;