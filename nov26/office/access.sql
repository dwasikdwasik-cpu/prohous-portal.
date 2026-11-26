create table if not exists attendance_private.office_admins (
 user_id uuid primary key references auth.users(id) on delete cascade,
 email text not null check(email=lower(btrim(email))),
 granted_at timestamptz not null default now()
);
revoke all on attendance_private.office_admins from public,anon,authenticated;
-- Read only through HR service endpoints. The shared portal profile keeps its own role.
do $schema$
declare columns_sql text;
begin
 select string_agg(case a.attname
  when 'role' then format('case when g.user_id is not null then %L::%s else p.role end as role','admin',format_type(a.atttypid,a.atttypmod))
  when 'status' then format('case when g.user_id is not null then %L::%s else p.status end as status','approved',format_type(a.atttypid,a.atttypmod))
  else format('p.%I',a.attname) end,', ' order by a.attnum)
 into columns_sql from pg_attribute a where a.attrelid='public.profiles'::regclass and a.attnum>0 and not a.attisdropped;
 execute 'create or replace view public.prohouse_workforce_profiles as select '||columns_sql||$view$
 from public.profiles p
 left join auth.users u on u.id=p.id and u.email_confirmed_at is not null
 left join attendance_private.office_admins g on g.user_id=u.id and g.email=lower(u.email)
  and p.status in ('pending','approved')$view$;
end $schema$;
revoke all on public.prohouse_workforce_profiles from public,anon,authenticated;
grant select on public.prohouse_workforce_profiles to service_role;
