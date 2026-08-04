begin;

alter function atlas.bell_history_v3(uuid, uuid, integer, timestamptz) volatile;

commit;
