create extension if not exists pgcrypto;
create table public.profiles(id uuid primary key references auth.users(id) on delete cascade,email text,full_name text,role text not null default 'client' check(role in ('admin','client')),status text not null default 'pending' check(status in ('pending','approved','rejected')),created_at timestamptz not null default now());
create table public.investments(id uuid primary key default gen_random_uuid(),name text not null,client_id uuid references public.profiles(id),drive_folder_id text,created_at timestamptz not null default now());
create table public.ledger_entries(id uuid primary key default gen_random_uuid(),investment_id uuid not null references public.investments(id) on delete cascade,type text not null check(type in ('deposit','expense')),amount numeric(14,2) not null check(amount>0),note text,created_by uuid references public.profiles(id),created_at timestamptz not null default now());
create table public.purchases(id uuid primary key default gen_random_uuid(),investment_id uuid not null references public.investments(id) on delete cascade,name text not null,quantity numeric(12,3) not null check(quantity>0),unit_price numeric(14,2) not null check(unit_price>=0),invoice_document_id uuid,created_at timestamptz not null default now());
create table public.documents(id uuid primary key default gen_random_uuid(),investment_id uuid not null references public.investments(id) on delete cascade,title text not null,category text not null check(category in ('zdjecia','faktury','umowy','protokoly','inne')),drive_file_id text not null,published boolean not null default false,created_at timestamptz not null default now());
create table public.audit_log(id bigint generated always as identity primary key,actor uuid,action text not null,table_name text not null,row_id text,created_at timestamptz not null default now());
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from profiles where id=auth.uid() and role='admin' and status='approved')$$;
create or replace function public.can_access_investment(inv uuid) returns boolean language sql stable security definer set search_path=public as $$select public.is_admin() or exists(select 1 from investments i join profiles p on p.id=i.client_id where i.id=inv and i.client_id=auth.uid() and p.status='approved')$$;
create or replace function public.new_profile() returns trigger language plpgsql security definer set search_path=public as $$begin insert into profiles(id,email,full_name) values(new.id,new.email,coalesce(new.raw_user_meta_data->>'full_name',''));return new;end$$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.new_profile();
alter table profiles enable row level security;alter table investments enable row level security;alter table ledger_entries enable row level security;alter table purchases enable row level security;alter table documents enable row level security;alter table audit_log enable row level security;
create policy profiles_read on profiles for select using(id=auth.uid() or public.is_admin());
create policy profiles_admin_update on profiles for update using(public.is_admin()) with check(public.is_admin());
create policy investments_read on investments for select using(public.can_access_investment(id));
create policy investments_admin_insert on investments for insert with check(public.is_admin());
create policy investments_admin_update on investments for update using(public.is_admin()) with check(public.is_admin());
create policy ledger_read on ledger_entries for select using(public.can_access_investment(investment_id));
create policy ledger_admin_insert on ledger_entries for insert with check(public.is_admin());
create policy purchases_read on purchases for select using(public.can_access_investment(investment_id));
create policy purchases_admin_insert on purchases for insert with check(public.is_admin());
create policy documents_read on documents for select using(public.can_access_investment(investment_id) and (published or public.is_admin()));
create policy documents_admin_insert on documents for insert with check(public.is_admin());
create policy documents_admin_update on documents for update using(public.is_admin()) with check(public.is_admin());
create or replace function public.log_changes() returns trigger language plpgsql security definer set search_path=public as $$begin insert into audit_log(actor,action,table_name,row_id) values(auth.uid(),TG_OP,TG_TABLE_NAME,coalesce(new.id,old.id)::text);return coalesce(new,old);end$$;
create trigger ledger_audit after insert or update or delete on ledger_entries for each row execute function public.log_changes();
create trigger docs_audit after insert or update or delete on documents for each row execute function public.log_changes();
create trigger profiles_audit after update on profiles for each row execute function public.log_changes();
create trigger investments_audit after insert or update or delete on investments for each row execute function public.log_changes();
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
-- Trigger functions cannot be invoked through the client API.
revoke execute on function public.new_profile() from public,anon,authenticated;
revoke execute on function public.log_changes() from public,anon,authenticated;
-- These two helpers are required by authenticated RLS policies.
revoke execute on function public.is_admin() from public,anon;
revoke execute on function public.can_access_investment(uuid) from public,anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.can_access_investment(uuid) to authenticated;
create policy audit_admin_read on public.audit_log for select to authenticated using(public.is_admin());
