-- Install document purge capability; this migration deletes no user documents.
alter table public.documents add column purge_started_at timestamptz;
create table private.document_removal_audit (
 document_id uuid primary key,title text not null,investment_id uuid not null,drive_file_id text,actor uuid not null,
 started_at timestamptz not null default now(),completed_at timestamptz
);
alter table private.document_removal_audit enable row level security;
revoke all on private.document_removal_audit from public,anon,authenticated;
create function private.guard_document_purge() returns trigger language plpgsql set search_path='' as $$
begin
 if current_user not in ('postgres','supabase_admin','service_role') and
  (old.purge_started_at is not null or (tg_op='UPDATE' and new.purge_started_at is distinct from old.purge_started_at)) then
  raise exception 'Trwa bezpowrotne usuwanie dokumentu. Nie można go przywrócić ani zmieniać.';
 end if;
 return coalesce(new,old);
end;$$;
revoke all on function private.guard_document_purge() from public,anon,authenticated;
create trigger guard_document_purge before update or delete on public.documents for each row execute function private.guard_document_purge();
create function private.start_portal_document_removal(p_document_id uuid,p_confirmation text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d public.documents;paths text[];a private.document_removal_audit;
begin
 if not private.can_manage_balance() then raise exception 'Tylko administrator może usuwać dokumenty bezpowrotnie.' using errcode='42501';end if;
 select * into d from public.documents where id=p_document_id for update;
 if not found then
  select * into a from private.document_removal_audit where document_id=p_document_id and completed_at is not null;
  if found and p_confirmation=a.title then return jsonb_build_object('document_paths','[]'::jsonb,'scan_paths','[]'::jsonb);end if;
  raise exception 'Nie znaleziono dokumentu.';
 end if;
 if d.deleted_at is null then raise exception 'Najpierw przenieś dokument do kosza.';end if;
 if p_confirmation is distinct from d.title then raise exception 'Wpisz dokładną nazwę dokumentu.';end if;
 -- Refuse to destroy financial evidence if the soft-delete reversal was not recorded.
 if exists(select 1 from public.ledger_entries l where l.type='expense' and (l.document_id=d.id or l.event_document_id=d.id)
  and not exists(select 1 from public.ledger_entries r where r.reversal_of=l.id)) then raise exception 'Najpierw anuluj koszt faktury w koszu.';end if;
 update public.documents set purge_started_at=coalesce(purge_started_at,now()) where id=d.id;
 insert into private.document_removal_audit(document_id,title,investment_id,drive_file_id,actor) values(d.id,d.title,d.investment_id,d.drive_file_id,auth.uid()) on conflict(document_id) do nothing;
 update public.invoice_intake set deleted_at=coalesce(deleted_at,now()),deleted_by=coalesce(deleted_by,auth.uid()) where document_id=d.id;
 select coalesce(array_agg(staged_path) filter(where staged_path is not null),'{}'::text[]) into paths from public.invoice_intake where document_id=d.id;
 return jsonb_build_object('document_paths',case when d.storage_path is null then '[]'::jsonb else jsonb_build_array(d.storage_path) end,'scan_paths',to_jsonb(paths));
end;$$;
revoke all on function private.start_portal_document_removal(uuid,text) from public,anon;
grant execute on function private.start_portal_document_removal(uuid,text) to authenticated;
create function public.start_portal_document_removal(p_document_id uuid,p_confirmation text) returns jsonb
language sql security invoker set search_path='' as $$select private.start_portal_document_removal(p_document_id,p_confirmation)$$;
revoke all on function public.start_portal_document_removal(uuid,text) from public,anon;
grant execute on function public.start_portal_document_removal(uuid,text) to authenticated;
create function private.finish_portal_document_removal(p_document_id uuid,p_actor uuid,p_session_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare d public.documents;
begin
 if not exists(select 1 from public.profiles p join auth.sessions s on s.user_id=p.id where p.id=p_actor and p.role='admin' and p.status='approved' and s.id=p_session_id and (s.not_after is null or s.not_after>now())) then raise exception 'Brak uprawnień.' using errcode='42501';end if;
 select * into d from public.documents where id=p_document_id and deleted_at is not null and purge_started_at is not null for update;
 if not found then
  if exists(select 1 from private.document_removal_audit where document_id=p_document_id and completed_at is not null) then return;end if;
  raise exception 'Nie rozpoczęto usuwania dokumentu.';
 end if;
 if exists(select 1 from storage.objects where bucket_id='portal-documents' and name=d.storage_path)
  or exists(select 1 from storage.objects o join public.invoice_intake q on q.staged_path=o.name where q.document_id=d.id and o.bucket_id='invoice-intake') then raise exception 'Pliki oczekują na usunięcie.';end if;
 delete from public.invoice_reading_feedback where intake_id in (select id from public.invoice_intake where document_id=d.id);
 update public.invoice_intake set staged_path=null where document_id=d.id;
 -- Keep the original expense, its reversal, amounts, booking keys and purchases.
 -- Only detach foreign keys that would prevent removing the trashed document.
 update public.ledger_entries set document_id=null where document_id=d.id;
 update public.ledger_entries set event_document_id=null where event_document_id=d.id;
 update public.purchases set invoice_document_id=null where invoice_document_id=d.id;
 delete from public.documents where id=d.id;
 update private.document_removal_audit set completed_at=now() where document_id=d.id;
end;$$;
revoke all on function private.finish_portal_document_removal(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function private.finish_portal_document_removal(uuid,uuid,uuid) to service_role;
create function public.finish_portal_document_removal(p_document_id uuid,p_actor uuid,p_session_id uuid) returns void
language sql security invoker set search_path='' as $$select private.finish_portal_document_removal(p_document_id,p_actor,p_session_id)$$;
revoke all on function public.finish_portal_document_removal(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.finish_portal_document_removal(uuid,uuid,uuid) to service_role;

-- Preserve a source tombstone so a later Drive sync cannot resurrect a purged file.
create index document_removal_source_idx on private.document_removal_audit(investment_id,drive_file_id) where drive_file_id is not null;
create function private.prevent_purged_document_import() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.drive_file_id is not null and exists(select 1 from private.document_removal_audit where investment_id=new.investment_id and drive_file_id=new.drive_file_id) then return null;end if;
 return new;
end;$$;
revoke all on function private.prevent_purged_document_import() from public,anon,authenticated;
create trigger prevent_purged_document_import before insert on public.documents for each row execute function private.prevent_purged_document_import();
