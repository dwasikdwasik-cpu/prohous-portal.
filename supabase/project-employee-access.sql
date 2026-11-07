-- Apply transactionally after approval. PIN activation is a separate private data write.
begin;
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check check(role in ('admin','manager','client','electrician','plumber','employee'));
create function private.is_project_employee() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.profiles where id=auth.uid() and role='employee' and status='approved');
$$;
revoke all on function private.is_project_employee() from public,anon;
grant execute on function private.is_project_employee() to authenticated;
alter policy investments_read on public.investments using(public.is_admin() or (deleted_at is null and (public.can_access_investment(id) or (select private.is_installer()) or (select private.is_project_employee()))));
-- A separate read policy adds the employee exception without widening other roles.
create policy employee_project_read on public.documents for select to authenticated using(
 (select private.is_project_employee()) and deleted_at is null and published and category='projekty'
 and private.investment_is_active(investment_id) and invoice_number is null and invoice_date is null and gross_amount is null and supplier is null
);

create table private.project_employee_login (
 singleton boolean primary key default true check(singleton),
 pin_hash text,
 user_id uuid references auth.users(id),
 failed_attempts integer not null default 0,
 window_started_at timestamptz not null default now()
);
alter table private.project_employee_login enable row level security;
revoke all on private.project_employee_login from public,anon,authenticated;
insert into private.project_employee_login(singleton) values(true);
create function private.check_project_employee_pin(p_pin text)
returns table(valid boolean,retry_after integer,user_id uuid)
language plpgsql security definer set search_path='' as $$
declare config private.project_employee_login;
begin
 select * into config from private.project_employee_login where singleton for update;
 if config.pin_hash is null then return query select false,0,null::uuid;return;end if;
 if config.window_started_at<=now()-interval '15 minutes' then
  update private.project_employee_login set failed_attempts=0,window_started_at=now() where singleton;
  config.failed_attempts:=0;config.window_started_at:=now();
 end if;
 if config.failed_attempts>=10 then
  return query select false,greatest(1,ceil(extract(epoch from config.window_started_at+interval '15 minutes'-now()))::integer),null::uuid;return;
 end if;
 if p_pin is not null and p_pin ~ '^[0-9]{4}$' and extensions.crypt(p_pin,config.pin_hash)=config.pin_hash then
  return query select true,0,config.user_id;return;
 end if;
 update private.project_employee_login set failed_attempts=failed_attempts+1 where singleton;
 return query select false,0,null::uuid;
end;$$;
revoke all on function private.check_project_employee_pin(text) from public,anon,authenticated;
grant execute on function private.check_project_employee_pin(text) to service_role;
create function public.check_project_employee_pin(p_pin text)
returns table(valid boolean,retry_after integer,user_id uuid)
language sql security invoker set search_path='' as $$select * from private.check_project_employee_pin(p_pin)$$;
revoke all on function public.check_project_employee_pin(text) from public,anon,authenticated;
grant usage on schema private to service_role;
grant execute on function public.check_project_employee_pin(text) to service_role;
create function private.bind_project_employee(p_user_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.profiles p join auth.users u on u.id=p.id where p.id=p_user_id and p.role='employee' and p.status='approved' and lower(u.email)='pracownik@prohous.pl') then
  raise exception 'Niepoprawne konto pracownika.';
 end if;
 update private.project_employee_login set user_id=p_user_id where singleton and (user_id is null or user_id=p_user_id);
 if not found then raise exception 'Konto pracownika jest już przypisane.';end if;
end;$$;
revoke all on function private.bind_project_employee(uuid) from public,anon,authenticated;
grant execute on function private.bind_project_employee(uuid) to service_role;
create function public.bind_project_employee(p_user_id uuid) returns void
language sql security invoker set search_path='' as $$select private.bind_project_employee(p_user_id)$$;
revoke all on function public.bind_project_employee(uuid) from public,anon,authenticated;
grant execute on function public.bind_project_employee(uuid) to service_role;
commit;
