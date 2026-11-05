-- Existing databases: run once after the original schema.sql.
-- Safe to run again. No existing rows are deleted.
create table if not exists public.document_downloads (
 id bigint generated always as identity primary key,
 user_id uuid not null references public.profiles(id),
 document_id uuid not null references public.documents(id),
 created_at timestamptz not null default now()
);
alter table public.document_downloads enable row level security;
drop policy if exists downloads_insert on public.document_downloads;
create policy downloads_insert on public.document_downloads for insert to authenticated
 with check(user_id=auth.uid() and exists(select 1 from public.documents d where d.id=document_id));
drop policy if exists downloads_admin_read on public.document_downloads;
create policy downloads_admin_read on public.document_downloads for select to authenticated using(public.is_admin());
grant select,insert on public.document_downloads to authenticated;
grant usage,select on sequence public.document_downloads_id_seq to authenticated;
create index if not exists documents_investment_idx on public.documents(investment_id);
create index if not exists ledger_investment_idx on public.ledger_entries(investment_id);
create index if not exists purchases_investment_idx on public.purchases(investment_id);
create index if not exists investments_client_idx on public.investments(client_id);

