update atlas.tasks
set title = 'Grow-room basil transplant readiness',
    updated_at = now()
where id = '111af7b8-c4b6-4db1-be30-c2fc20470e20'::uuid
  and title = 'Check whether grow-room basil is ready to transplant';

do $validation$
begin
  if not exists (
    select 1
    from atlas.tasks
    where id = '111af7b8-c4b6-4db1-be30-c2fc20470e20'::uuid
      and title = 'Grow-room basil transplant readiness'
      and status in ('open','blocked')
      and due_date = date '2026-07-20'
  ) then
    raise exception 'Basil transplant-readiness task was not normalized for day-plan carry-forward.';
  end if;
end;
$validation$;
