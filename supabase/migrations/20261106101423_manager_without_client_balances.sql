alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check check(role in ('admin','manager','client','electrician','plumber'));
create function private.is_finance_admin() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.profiles where id=auth.uid() and role='admin' and status='approved');
$$;
revoke all on function private.is_finance_admin() from public,anon;
grant execute on function private.is_finance_admin() to authenticated;
-- General administration and financial access are separate capabilities.
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.profiles where id=auth.uid() and role in ('admin','manager') and status='approved');
$$;
create or replace function public.can_access_investment(inv uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.is_finance_admin() or exists(select 1 from public.investments i join public.profiles p on p.id=i.client_id where i.id=inv and i.client_id=auth.uid() and p.status='approved' and p.role='client');
$$;
alter policy investments_read on public.investments using(public.is_admin() or public.can_access_investment(id) or (select private.is_installer()));
alter policy ledger_admin_insert on public.ledger_entries with check((select private.is_finance_admin()));
-- Managers cannot grant administrator access or alter privileged accounts.
create function public.protect_privileged_profile() returns trigger language plpgsql set search_path='' as $$
begin
 if auth.uid() is not null and not private.is_finance_admin() then
  if new.id<>old.id or new.role in ('admin','manager') and new.role<>old.role or
   (old.role in ('admin','manager') and (old.id<>auth.uid() or row(new.role,new.status) is distinct from row(old.role,old.status))) then
   raise exception 'Tylko administrator może zmieniać konta i uprawnienia administratorów oraz menedżerów.';
  end if;
 end if;
 return new;
end;$$;
create trigger protect_privileged_profile before update on public.profiles for each row execute function public.protect_privileged_profile();
revoke execute on function public.protect_privileged_profile() from public,anon,authenticated;
-- These trigger-only routines perform narrowly scoped bookkeeping. Their invocation
-- is not exposed through RPC; normal managers cannot read or write the ledger.
alter function public.book_document_expense() set schema private;
alter function private.book_document_expense() security definer;
alter function public.protect_booked_document() set schema private;
alter function private.protect_booked_document() security definer;
alter function public.adjust_deleted_invoice() set schema private;
alter function private.adjust_deleted_invoice() security definer;
revoke all on function private.book_document_expense() from public,anon,authenticated;
revoke all on function private.protect_booked_document() from public,anon,authenticated;
revoke all on function private.adjust_deleted_invoice() from public,anon,authenticated;
