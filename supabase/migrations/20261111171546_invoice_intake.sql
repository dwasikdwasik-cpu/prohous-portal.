-- Apply after project-employee-access.sql. A separate clerk role never inherits finance access.
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check check(role in ('admin','manager','client','electrician','plumber','employee','invoice_clerk'));
create function private.is_invoice_operator() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.profiles where id=auth.uid() and status='approved' and role in ('admin','manager','invoice_clerk'));
$$;
revoke all on function private.is_invoice_operator() from public,anon;
grant execute on function private.is_invoice_operator() to authenticated;
create table public.invoice_intake(
 id uuid primary key default gen_random_uuid(),drive_file_id text not null check(drive_file_id ~ '^[a-zA-Z0-9_-]{10,200}$'),source_version text not null,
 original_name text not null,mime_type text not null check(mime_type in ('application/pdf','image/jpeg','image/png','image/webp')),source_size bigint not null check(source_size>0 and source_size<=26214400),
 staged_path text,content_sha256 text check(content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$'),
 status text not null default 'queued' check(status in ('queued','needs_review','ready','imported','complete')),
 invoice_number text,invoice_date date,gross_amount numeric(14,2) check(gross_amount is null or gross_amount>0),supplier text,currency text not null default 'UNKNOWN' check(currency in ('PLN','OTHER','UNKNOWN')),
 auto_book boolean not null default false,accounting_note text,match_reason text,reviewed_at timestamptz,
 assigned_investment_id uuid references public.investments(id) on delete set null,target_document_id uuid not null default gen_random_uuid(),target_storage_path text,
 document_id uuid references public.documents(id) on delete set null,imported_by uuid references public.profiles(id) on delete set null,imported_at timestamptz,completed_at timestamptz,cleanup_error text,
 created_at timestamptz not null default now(),unique(drive_file_id,source_version)
);
alter table public.invoice_intake enable row level security;
grant select on public.invoice_intake to authenticated;
revoke insert,update,delete on public.invoice_intake from anon,authenticated;
create policy invoice_intake_staff_read on public.invoice_intake for select to authenticated using((select private.is_invoice_operator()));
create index invoice_intake_queue_idx on public.invoice_intake(status,created_at);
alter table public.documents add column source_intake_id uuid unique references public.invoice_intake(id);
create policy invoice_clerk_document_read on public.documents for select to authenticated using(
 (select private.is_invoice_operator()) and source_intake_id is not null and deleted_at is null and private.investment_is_active(investment_id)
);
create function private.invoice_intake_targets() returns table(investment_id uuid,investment_name text,client_name text) language plpgsql security definer set search_path='' as $$
begin
 if not private.is_invoice_operator() then raise exception 'Brak uprawnień do obsługi faktur';end if;
 return query select i.id,i.name,coalesce(nullif(p.full_name,''),p.email,'Klient') from public.investments i join public.profiles p on p.id=i.client_id where i.deleted_at is null and p.role='client' and p.status='approved' order by p.full_name,i.name;
end;$$;
revoke all on function private.invoice_intake_targets() from public,anon;
grant execute on function private.invoice_intake_targets() to authenticated;
create function private.invoice_intake_action(p_id uuid,p_action text,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare q public.invoice_intake;ext text;target uuid;doc uuid;
begin
 if not private.is_invoice_operator() then raise exception 'Brak uprawnień do obsługi faktur';end if;
 if p_action='register' then
  insert into public.invoice_intake(drive_file_id,source_version,original_name,mime_type,source_size)
  values(p_data->>'drive_file_id',p_data->>'source_version',left(p_data->>'original_name',500),p_data->>'mime_type',(p_data->>'source_size')::bigint)
  on conflict(drive_file_id,source_version) do nothing;
  select * into q from public.invoice_intake where drive_file_id=p_data->>'drive_file_id' and source_version=p_data->>'source_version';return to_jsonb(q);
 end if;
 select * into q from public.invoice_intake where id=p_id for update;
 if not found then raise exception 'Nie znaleziono skanu';end if;
 ext:=case q.mime_type when 'application/pdf' then 'pdf' when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' end;
 if p_action='stage' then
  if q.document_id is not null then return to_jsonb(q);end if;
  if not coalesce(p_data->>'sha256','') ~ '^[0-9a-f]{64}$' then raise exception 'Brak sumy kontrolnej';end if;
  if q.content_sha256 is not null and q.content_sha256<>p_data->>'sha256' then raise exception 'Kopia skanu zmieniła się';end if;
  if not exists(select 1 from storage.objects where bucket_id='invoice-intake' and name=q.id::text||'/scan.'||ext) then raise exception 'Brak zapisanej kopii skanu';end if;
  update public.invoice_intake set staged_path=q.id::text||'/scan.'||ext,content_sha256=p_data->>'sha256',status='needs_review' where id=q.id;
 elsif p_action='review' then
  if q.document_id is not null then raise exception 'Faktura jest już przypisana';end if;
  if q.staged_path is null then raise exception 'Najpierw zapisz kopię skanu';end if;
  target:=nullif(p_data->>'investment_id','')::uuid;
  if target is not null and not exists(select 1 from public.investments i join public.profiles p on p.id=i.client_id where i.id=target and i.deleted_at is null and p.role='client' and p.status='approved') then raise exception 'Wybierz aktywną inwestycję przypisaną do zatwierdzonego klienta';end if;
  update public.invoice_intake set invoice_number=nullif(left(trim(p_data->>'invoice_number'),150),''),invoice_date=nullif(p_data->>'invoice_date','')::date,gross_amount=nullif(p_data->>'gross_amount','')::numeric,supplier=nullif(left(p_data->>'supplier',300),''),currency=coalesce(p_data->>'currency','UNKNOWN'),auto_book=coalesce((p_data->>'auto_book')::boolean,false),accounting_note=left(p_data->>'accounting_note',2000),match_reason=left(p_data->>'match_reason',500),assigned_investment_id=target,reviewed_at=now(),status=case when target is null then 'needs_review' else 'ready' end where id=q.id;
 elsif p_action='reserve' then
  if q.document_id is not null then return to_jsonb(q);end if;
  target:=nullif(p_data->>'investment_id','')::uuid;
  if q.staged_path is null or q.content_sha256 is null then raise exception 'Najpierw pobierz i sprawdź skan';end if;
  if not exists(select 1 from public.investments i join public.profiles p on p.id=i.client_id where i.id=target and i.deleted_at is null and p.role='client' and p.status='approved') then raise exception 'Wybierz aktywną inwestycję klienta';end if;
  update public.invoice_intake set assigned_investment_id=target,target_storage_path=target::text||'/'||target_document_id::text||'.'||ext where id=q.id;
 elsif p_action='finalize' then
  if q.target_storage_path is distinct from p_data->>'storage_path' then raise exception 'Przypisanie zmieniło się w innym oknie. Odśwież kolejkę';end if;
  if q.document_id is not null then return to_jsonb(q);end if;
  if q.assigned_investment_id is null or q.staged_path is null or q.content_sha256 is null or q.target_storage_path is null then raise exception 'Niekompletny import';end if;
  if not exists(select 1 from public.investments i join public.profiles p on p.id=i.client_id where i.id=q.assigned_investment_id and i.deleted_at is null and p.role='client' and p.status='approved') then raise exception 'Inwestycja lub klient nie są aktywni';end if;
  if not exists(select 1 from storage.objects where bucket_id='portal-documents' and name=q.target_storage_path) then raise exception 'Brak pliku w portalu';end if;
  insert into public.documents(id,investment_id,title,category,storage_path,mime_type,published,uploaded_by,invoice_number,invoice_date,gross_amount,supplier,currency,content_sha256,auto_book,accounting_note,source_intake_id)
  values(q.target_document_id,q.assigned_investment_id,q.original_name,'faktury',q.target_storage_path,q.mime_type,true,auth.uid(),q.invoice_number,q.invoice_date,q.gross_amount,q.supplier,q.currency,q.content_sha256,q.auto_book and public.is_admin(),q.accounting_note,q.id) returning id into doc;
  update public.invoice_intake set document_id=doc,status='imported',imported_by=auth.uid(),imported_at=now(),cleanup_error=null where id=q.id;
 elsif p_action='cleanup' then
  if q.document_id is null then raise exception 'Nie przypisano faktury';end if;
  update public.invoice_intake set status=case when p_data->>'error' is null then 'complete' else 'imported' end,completed_at=case when p_data->>'error' is null then now() else null end,cleanup_error=left(p_data->>'error',1000) where id=q.id;
 else raise exception 'Nieznana operacja';end if;
 select * into q from public.invoice_intake where id=p_id;return to_jsonb(q);
end;$$;
revoke all on function private.invoice_intake_action(uuid,text,jsonb) from public,anon;
grant execute on function private.invoice_intake_action(uuid,text,jsonb) to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('invoice-intake','invoice-intake',false,26214400,array['application/pdf','image/jpeg','image/png','image/webp']);
create policy invoice_scan_upload on storage.objects for insert to authenticated with check(
 bucket_id='invoice-intake' and (select private.is_invoice_operator()) and exists(select 1 from public.invoice_intake q where name=q.id::text||'/scan.'||case q.mime_type when 'application/pdf' then 'pdf' when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' end)
);
create policy invoice_scan_read on storage.objects for select to authenticated using(bucket_id='invoice-intake' and (select private.is_invoice_operator()));
create policy invoice_target_upload on storage.objects for insert to authenticated with check(bucket_id='portal-documents' and (select private.is_invoice_operator()) and exists(select 1 from public.invoice_intake q where q.target_storage_path=name and q.document_id is null));
create policy invoice_target_read on storage.objects for select to authenticated using(bucket_id='portal-documents' and (select private.is_invoice_operator()) and exists(select 1 from public.invoice_intake q where q.target_storage_path=name));
create trigger invoice_intake_audit after insert or update on public.invoice_intake for each row execute function public.log_changes();

-- Public RPC wrappers run as the caller; only guarded routines in the private schema bypass RLS.
create function public.invoice_intake_targets() returns table(investment_id uuid,investment_name text,client_name text) language sql security invoker set search_path='' as $$select * from private.invoice_intake_targets()$$;
create function public.invoice_intake_action(p_id uuid,p_action text,p_data jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select private.invoice_intake_action(p_id,p_action,p_data)$$;
revoke all on function public.invoice_intake_targets() from public,anon;
revoke all on function public.invoice_intake_action(uuid,text,jsonb) from public,anon;
grant execute on function public.invoice_intake_targets() to authenticated;
grant execute on function public.invoice_intake_action(uuid,text,jsonb) to authenticated;
