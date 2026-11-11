-- Retain source/version tombstones so a dismissed scan is never silently re-imported.
alter table public.invoice_intake add column deleted_at timestamptz;
alter table public.invoice_intake add column deleted_by uuid references public.profiles(id) on delete set null;
create function private.remove_intake_invoice(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare q public.invoice_intake;
begin
 if not private.is_invoice_operator() then raise exception 'Brak uprawnień do obsługi faktur';end if;
 select * into q from public.invoice_intake where id=p_id for update;
 if not found then raise exception 'Nie znaleziono skanu';end if;
 if q.document_id is not null and not public.is_admin() then raise exception 'Fakturę przypisaną do klienta może usunąć administrator';end if;
 if q.deleted_at is not null then return jsonb_build_object('removed',true,'document_removed',q.document_id is not null);end if;
 if q.document_id is not null then
  -- Existing document triggers reverse the invoice and duplicate charges exactly once.
  update public.documents set deleted_at=coalesce(deleted_at,now()),published=false where id=q.document_id;
 end if;
 update public.invoice_intake set deleted_at=now(),deleted_by=auth.uid() where id=q.id;
 return jsonb_build_object('removed',true,'document_removed',q.document_id is not null);
end;$$;
revoke all on function private.remove_intake_invoice(uuid) from public,anon;
grant execute on function private.remove_intake_invoice(uuid) to authenticated;
create function public.remove_intake_invoice(p_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.remove_intake_invoice(p_id)$$;
revoke all on function public.remove_intake_invoice(uuid) from public,anon;
grant execute on function public.remove_intake_invoice(uuid) to authenticated;

-- Use the same row lock as removal to reject stale OCR/import requests atomically.
create or replace function private.invoice_intake_action(p_id uuid,p_action text,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
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
 if q.deleted_at is not null then raise exception 'Skan został usunięty z obsługi faktur. Odśwież kolejkę';end if;
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
