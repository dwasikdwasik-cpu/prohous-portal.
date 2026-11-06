-- Finance is hidden from clients by default; administrators can opt in per investment.
alter table public.investments add column client_invoices_visible boolean not null default false;
alter table public.investments add column client_balance_visible boolean not null default false;
create function private.client_finance_visible(inv uuid,section text) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.investments i join public.profiles p on p.id=i.client_id
 where i.id=inv and i.deleted_at is null and i.client_id=auth.uid() and p.role='client' and p.status='approved'
 and case section when 'invoices' then i.client_invoices_visible when 'balance' then i.client_balance_visible else false end);
$$;
revoke all on function private.client_finance_visible(uuid,text) from public,anon;
grant execute on function private.client_finance_visible(uuid,text) to authenticated;
alter policy ledger_read on public.ledger_entries using((select private.is_finance_admin()) or private.client_finance_visible(investment_id,'balance'));
alter policy purchases_read on public.purchases using(public.is_admin() or private.client_finance_visible(investment_id,'invoices'));
alter policy documents_read on public.documents using(
 public.is_admin() or (deleted_at is null and private.investment_is_active(investment_id) and (
  (published and public.can_access_investment(investment_id) and (
   private.client_finance_visible(investment_id,'invoices') or
   (category in ('zdjecia','projekty','umowy','protokoly') and invoice_number is null and invoice_date is null and gross_amount is null)
  )) or
  ((select private.is_installer()) and ((category='projekty' and published) or (category='zdjecia' and uploaded_by=auth.uid())))
 ))
);
