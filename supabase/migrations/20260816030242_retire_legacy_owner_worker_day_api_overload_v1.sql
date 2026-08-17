-- Pass 3D release hardening.
-- The legacy 4-argument Owner Worker Day API had a default p_now, making ordinary
-- 3-argument RPC resolution ambiguous. It also called a 4-argument base plan that
-- no longer exists. The overload has no dependents and no anon/authenticated/service
-- execute grants, so retire it rather than extending the obsolete Owner scheduling path.

drop function atlas.owner_worker_day_plan_api_v1(uuid,uuid,date,timestamp with time zone);