-- Apply once, transactionally, after the portal's existing upgrades.
-- No historical backfill: only sessions created after this installation are logged.
begin;
create table private.portal_login_events (
 session_id uuid primary key,
 user_id uuid not null,
 email text,
 full_name text,
 role text,
 profile_status text,
 signed_in_at timestamptz not null,
 recorded_at timestamptz not null default now(),
 ip_address text,
 user_agent text
);
alter table private.portal_login_events enable row level security;
revoke all on private.portal_login_events from public,anon,authenticated;
create index portal_login_events_time_idx on private.portal_login_events(signed_in_at desc,session_id desc);

-- Auth creates this row server-side. Never accept an actor, timestamp, IP, or
-- session identifier supplied by the browser. No tokens/passwords are recorded.
create function private.capture_portal_login() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into private.portal_login_events(session_id,user_id,email,full_name,role,profile_status,signed_in_at,ip_address,user_agent)
 select new.id,new.user_id,u.email,p.full_name,p.role,p.status,coalesce(new.created_at,now()),new.ip::text,left(new.user_agent,500)
 from auth.users u left join public.profiles p on p.id=u.id where u.id=new.user_id
 on conflict(session_id) do nothing;
 return new;
exception when others then
 -- An audit storage outage must not lock customers out. Log a fixed warning
 -- without including tokens, personal details, or the failing SQL statement.
 raise warning 'Portal login audit capture failed';
 return new;
end;$$;
revoke all on function private.capture_portal_login() from public,anon,authenticated;
create trigger portal_capture_login after insert on auth.sessions
 for each row execute function private.capture_portal_login();

create function private.portal_login_history(p_search text default '',p_since timestamptz default null,p_limit integer default 51,p_offset integer default 0)
returns table(session_id uuid,user_id uuid,email text,full_name text,role text,profile_status text,signed_in_at timestamptz,ip_address text,user_agent text)
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(
  select 1 from public.profiles p where p.id=auth.uid() and p.status='approved' and p.role in ('admin','manager')
 ) or not exists(
  select 1 from auth.sessions s where s.user_id=auth.uid() and s.id::text=auth.jwt()->>'session_id'
   and (s.not_after is null or s.not_after>now())
 ) then raise exception 'Brak uprawnień.' using errcode='42501';end if;
 return query select e.session_id,e.user_id,e.email,e.full_name,e.role,e.profile_status,e.signed_in_at,e.ip_address,e.user_agent
 from private.portal_login_events e
 where (p_since is null or e.signed_in_at>=p_since)
 and (coalesce(btrim(p_search),'')='' or strpos(lower(coalesce(e.email,'')||' '||coalesce(e.full_name,'')),lower(left(btrim(p_search),200)))>0)
 order by e.signed_in_at desc,e.session_id desc
 limit least(greatest(coalesce(p_limit,51),1),101) offset greatest(coalesce(p_offset,0),0);
end;$$;
revoke all on function private.portal_login_history(text,timestamptz,integer,integer) from public,anon;
grant execute on function private.portal_login_history(text,timestamptz,integer,integer) to authenticated;
create function public.portal_login_history(p_search text default '',p_since timestamptz default null,p_limit integer default 51,p_offset integer default 0)
returns table(session_id uuid,user_id uuid,email text,full_name text,role text,profile_status text,signed_in_at timestamptz,ip_address text,user_agent text)
language sql stable security invoker set search_path='' as $$
 select * from private.portal_login_history(p_search,p_since,p_limit,p_offset);
$$;
revoke all on function public.portal_login_history(text,timestamptz,integer,integer) from public,anon;
grant usage on schema private to authenticated;
grant execute on function public.portal_login_history(text,timestamptz,integer,integer) to authenticated;
commit;
