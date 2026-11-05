-- Dla istniejącej bazy po schema.sql. Wykonaj raz, przed uruchomieniem v2.
begin;
alter table public.documents add column if not exists mime_type text;
alter table public.documents add column if not exists invoice_number text;
alter table public.documents add column if not exists invoice_date date;
alter table public.documents add column if not exists supplier text;
alter table public.documents add column if not exists gross_amount numeric(14,2) check(gross_amount>=0);
create unique index if not exists documents_investment_drive_unique on public.documents(investment_id,drive_file_id);
alter table public.purchases add column if not exists unit text not null default 'szt.';
alter table public.purchases add constraint purchases_invoice_fk foreign key(invoice_document_id) references public.documents(id);
-- Faktura powiązana z zakupem musi należeć do tej samej inwestycji.
create or replace function public.validate_purchase_invoice() returns trigger language plpgsql set search_path=public as $$
begin
if new.invoice_document_id is not null and not exists(select 1 from public.documents where id=new.invoice_document_id and investment_id=new.investment_id and category='faktury' and published=true) then raise exception 'Faktura musi być opublikowana i należeć do tej samej inwestycji';end if;return new;end$$;
create trigger purchase_invoice_check before insert or update on public.purchases for each row execute function public.validate_purchase_invoice();
create trigger purchases_audit after insert or update or delete on public.purchases for each row execute function public.log_changes();
do $$ begin if not exists(select 1 from pg_policies where schemaname='public' and tablename='audit_log' and policyname='audit_admin_read') then create policy audit_admin_read on public.audit_log for select using(public.is_admin());end if;end $$;
create table if not exists public.document_downloads(id bigint generated always as identity primary key,user_id uuid not null references public.profiles(id),document_id uuid not null references public.documents(id),created_at timestamptz not null default now());
alter table public.document_downloads enable row level security;
do $$ begin
if not exists(select 1 from pg_policies where schemaname='public' and tablename='document_downloads' and policyname='downloads_admin_read') then create policy downloads_admin_read on public.document_downloads for select using(public.is_admin());end if;
if not exists(select 1 from pg_policies where schemaname='public' and tablename='document_downloads' and policyname='downloads_insert') then create policy downloads_insert on public.document_downloads for insert with check(user_id=auth.uid() and exists(select 1 from public.documents d where d.id=document_id));end if;
end $$;
commit;
