begin;

with anna as (
  select fm.id as membership_id
  from atlas.farm_memberships fm
  where fm.active=true
    and fm.role='farm_hand'
    and lower(coalesce(fm.worker_key,''))='anna'
  order by fm.created_at
  limit 1
)
update atlas.tasks t
set assigned_membership_id=anna.membership_id,
    visibility_scope='assigned_worker',
    metadata=coalesce(t.metadata,'{}'::jsonb)||jsonb_build_object(
      'display_action','Stock',
      'display_subject',case t.title
        when 'Set up kitchen + coffee + water station' then 'Cold-brew + water station'
        when 'Stock bouquet wrapping station' then 'Bouquet wrapping station'
        when 'Stock bouquet tool station' then 'Bouquet tool station'
      end,
      'display_title',case t.title
        when 'Set up kitchen + coffee + water station' then 'Cold-brew + water station'
        when 'Stock bouquet wrapping station' then 'Bouquet wrapping station'
        when 'Stock bouquet tool station' then 'Bouquet tool station'
      end
    ),
    updated_at=now()
from anna
where t.due_date=date '2026-08-13'
  and t.title in ('Set up kitchen + coffee + water station','Stock bouquet wrapping station','Stock bouquet tool station')
  and t.status in ('open','blocked');

update atlas.tasks
set blocker_text='Waiting for Elm weekly harvest and Karianne’s Thursday harvest.',updated_at=now()
where title='Condition + sort Thursday flower buckets'
  and due_date=date '2026-08-13'
  and status='blocked';

commit;
