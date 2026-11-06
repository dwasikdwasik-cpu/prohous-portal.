alter table public.investments add column deleted_at timestamptz;
create function private.investment_is_active(inv uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.investments where id=inv and deleted_at is null);
$$;
revoke all on function private.investment_is_active(uuid) from public,anon;
grant execute on function private.investment_is_active(uuid) to authenticated;
create or replace function public.can_access_investment(inv uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.is_finance_admin() or exists(select 1 from public.investments i join public.profiles p on p.id=i.client_id where i.id=inv and i.deleted_at is null and i.client_id=auth.uid() and p.status='approved' and p.role='client');
$$;
alter policy investments_read on public.investments using(public.is_admin() or (deleted_at is null and (public.can_access_investment(id) or (select private.is_installer()))));
alter policy documents_read on public.documents using(
 public.is_admin() or (deleted_at is null and private.investment_is_active(investment_id) and (
  (published and public.can_access_investment(investment_id)) or
  ((select private.is_installer()) and ((category='projekty' and published) or (category='zdjecia' and uploaded_by=auth.uid())))
 ))
);
create policy active_investment_document_insert on public.documents as restrictive for insert to authenticated with check(private.investment_is_active(investment_id));
