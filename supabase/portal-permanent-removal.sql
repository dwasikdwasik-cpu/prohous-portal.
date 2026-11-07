-- Approved feature installation only; no account or investment is removed here.
begin;
-- Keep investments, files, accounting and download audit when an account is removed.
alter table public.investments drop constraint investments_client_id_fkey;
alter table public.investments add constraint investments_client_id_fkey foreign key(client_id) references public.profiles(id) on delete set null;
alter table public.documents drop constraint documents_uploaded_by_fkey;
alter table public.documents add constraint documents_uploaded_by_fkey foreign key(uploaded_by) references public.profiles(id) on delete set null;
alter table public.ledger_entries drop constraint ledger_entries_created_by_fkey;
alter table public.ledger_entries add constraint ledger_entries_created_by_fkey foreign key(created_by) references public.profiles(id) on delete set null;
alter table public.document_downloads alter column user_id drop not null;
alter table public.document_downloads drop constraint document_downloads_user_id_fkey;
alter table public.document_downloads add constraint document_downloads_user_id_fkey foreign key(user_id) references public.profiles(id) on delete set null;
alter table private.project_employee_login drop constraint project_employee_login_user_id_fkey;
alter table private.project_employee_login add constraint project_employee_login_user_id_fkey foreign key(user_id) references auth.users(id) on delete set null;
create table private.account_removal_requests (
 user_id uuid primary key,actor uuid not null,session_id uuid not null,expected_email text not null,expected_role text not null,
 requested_at timestamptz not null default now(),expires_at timestamptz not null,completed_at timestamptz
);
alter table private.account_removal_requests enable row level security;
revoke all on private.account_removal_requests from public,anon,authenticated;
create function private.request_portal_account_removal(p_user_id uuid,p_confirmation text) returns uuid
language plpgsql security definer set search_path='' as $$
declare victim public.profiles;
begin
 if not private.can_manage_balance() then raise exception 'Tylko administrator może usuwać konta.' using errcode='42501';end if;
 select * into victim from public.profiles where id=p_user_id for update;
 if victim.id is null or victim.id=auth.uid() or victim.role not in ('client','electrician','plumber','employee') then raise exception 'Tego konta nie można usunąć.';end if;
 if victim.email is null or p_confirmation is distinct from victim.email then raise exception 'Wpisz dokładny adres e-mail usuwanego konta.';end if;
 insert into private.account_removal_requests(user_id,actor,session_id,expected_email,expected_role,expires_at)
 values(victim.id,auth.uid(),(auth.jwt()->>'session_id')::uuid,victim.email,victim.role,now()+interval '5 minutes')
 on conflict(user_id) do update set actor=excluded.actor,session_id=excluded.session_id,expected_email=excluded.expected_email,expected_role=excluded.expected_role,requested_at=now(),expires_at=excluded.expires_at,completed_at=null;
 -- Removing only ownership metadata preserves the actual portal files. Other
 -- buckets are left untouched; unrelated ownership/FKs may safely block deletion.
 update storage.objects set owner=null,owner_id=null where bucket_id='portal-documents' and (owner=victim.id or owner_id=victim.id::text);
 return victim.id;
end;$$;
revoke all on function private.request_portal_account_removal(uuid,text) from public,anon;
grant execute on function private.request_portal_account_removal(uuid,text) to authenticated;
create function public.request_portal_account_removal(p_user_id uuid,p_confirmation text) returns uuid
language sql security invoker set search_path='' as $$select private.request_portal_account_removal(p_user_id,p_confirmation)$$;
revoke all on function public.request_portal_account_removal(uuid,text) from public,anon;
grant execute on function public.request_portal_account_removal(uuid,text) to authenticated;
create function private.guard_portal_account_removal() returns trigger
language plpgsql security definer set search_path='' as $$
declare request private.account_removal_requests;victim public.profiles;
begin
 select * into request from private.account_removal_requests where user_id=old.id and completed_at is null for update;
 if found then
  select * into victim from public.profiles where id=old.id for update;
  if not exists(select 1 from public.profiles p join auth.sessions s on s.user_id=p.id where p.id=request.actor and p.role='admin' and p.status='approved' and s.id=request.session_id and (s.not_after is null or s.not_after>now())) then raise exception 'Brak uprawnień do usunięcia konta.';end if;
  if request.expires_at<now() or victim.role not in ('client','electrician','plumber','employee') or victim.role is distinct from request.expected_role or victim.email is distinct from request.expected_email then raise exception 'Dane konta zmieniły się. Ponów potwierdzenie usunięcia.';end if;
  update private.account_removal_requests set completed_at=now() where user_id=old.id;
 end if;
 -- A deleted shared account must not be automatically recreated by its old PIN.
 update private.project_employee_login set pin_hash=null where user_id=old.id;
 return old;
end;$$;
revoke all on function private.guard_portal_account_removal() from public,anon,authenticated;
create trigger portal_guard_account_removal before delete on auth.users for each row execute function private.guard_portal_account_removal();

-- Permanent investment removal is available only from the trash.
alter table public.investments add column purge_started_at timestamptz;
alter table private.balance_adjustments drop constraint balance_adjustments_investment_id_fkey;
alter table private.balance_adjustments add constraint balance_adjustments_investment_id_fkey foreign key(investment_id) references public.investments(id) on delete cascade;
alter table public.document_downloads drop constraint document_downloads_document_id_fkey;
alter table public.document_downloads add constraint document_downloads_document_id_fkey foreign key(document_id) references public.documents(id) on delete cascade;
create table private.investment_removal_audit (
 investment_id uuid primary key,name text not null,actor uuid not null,
 document_count bigint not null,ledger_count bigint not null,started_at timestamptz not null default now(),completed_at timestamptz
);
alter table private.investment_removal_audit enable row level security;
revoke all on private.investment_removal_audit from public,anon,authenticated;
create function private.guard_purging_investment() returns trigger language plpgsql set search_path='' as $$
begin
 if current_user not in ('postgres','supabase_admin','service_role') and (old.purge_started_at is not null or new.purge_started_at is distinct from old.purge_started_at) then
  raise exception 'Trwa bezpowrotne usuwanie inwestycji. Nie można jej przywrócić ani zmieniać.';
 end if;return new;
end;$$;
revoke all on function private.guard_purging_investment() from public,anon,authenticated;
create trigger guard_purging_investment before update on public.investments for each row execute function private.guard_purging_investment();
create function private.investment_is_purging(inv uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.investments where id=inv and purge_started_at is not null);
$$;
revoke all on function private.investment_is_purging(uuid) from public,anon;
grant execute on function private.investment_is_purging(uuid) to authenticated;
create function private.guard_purging_document() returns trigger language plpgsql set search_path='' as $$
begin
 if current_user not in ('postgres','supabase_admin','service_role') and
  (private.investment_is_purging(coalesce(new.investment_id,old.investment_id)) or (tg_op='UPDATE' and private.investment_is_purging(old.investment_id))) then
  raise exception 'Trwa usuwanie inwestycji.';
 end if;return coalesce(new,old);
end;$$;
revoke all on function private.guard_purging_document() from public,anon,authenticated;
create trigger guard_purging_document before insert or update or delete on public.documents for each row execute function private.guard_purging_document();
create or replace function private.lock_balance_investment() returns trigger language plpgsql security definer set search_path='' as $$
declare purging timestamptz;
begin
 select purge_started_at into purging from public.investments where id=new.investment_id for no key update;
 if purging is not null then raise exception 'Trwa usuwanie inwestycji.';end if;
 return new;
end;$$;
revoke all on function private.lock_balance_investment() from public,anon,authenticated;
create function private.start_portal_investment_removal(p_investment_id uuid,p_confirmation text) returns text[]
language plpgsql security definer set search_path='' as $$
declare investment public.investments;paths text[];
begin
 if not private.can_manage_balance() then raise exception 'Tylko administrator może bezpowrotnie usuwać inwestycje.' using errcode='42501';end if;
 select * into investment from public.investments where id=p_investment_id for update;
 if investment.id is null or investment.deleted_at is null then raise exception 'Najpierw przenieś inwestycję do kosza.';end if;
 if p_confirmation is distinct from investment.name then raise exception 'Wpisz dokładną nazwę inwestycji.';end if;
 update public.investments set purge_started_at=coalesce(purge_started_at,now()) where id=investment.id;
 insert into private.investment_removal_audit(investment_id,name,actor,document_count,ledger_count)
 values(investment.id,investment.name,auth.uid(),(select count(*) from public.documents where investment_id=investment.id),(select count(*) from public.ledger_entries where investment_id=investment.id))
 on conflict(investment_id) do nothing;
 select coalesce(array_agg(storage_path) filter(where storage_path is not null),'{}'::text[]) into paths from public.documents where investment_id=investment.id;
 return paths;
end;$$;
revoke all on function private.start_portal_investment_removal(uuid,text) from public,anon;
grant execute on function private.start_portal_investment_removal(uuid,text) to authenticated;
create function public.start_portal_investment_removal(p_investment_id uuid,p_confirmation text) returns text[]
language sql security invoker set search_path='' as $$select private.start_portal_investment_removal(p_investment_id,p_confirmation)$$;
revoke all on function public.start_portal_investment_removal(uuid,text) from public,anon;
grant execute on function public.start_portal_investment_removal(uuid,text) to authenticated;
-- Final deletion can run only inside the verified server function, after Storage
-- cleanup. It rechecks the administrator's still-existing session and role.
create function private.finish_portal_investment_removal(p_investment_id uuid,p_actor uuid,p_session_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.profiles p join auth.sessions s on s.user_id=p.id where p.id=p_actor and p.role='admin' and p.status='approved' and s.id=p_session_id and (s.not_after is null or s.not_after>now())) then raise exception 'Brak uprawnień.' using errcode='42501';end if;
 perform 1 from public.investments where id=p_investment_id and deleted_at is not null and purge_started_at is not null for update;
 if not found then raise exception 'Nie rozpoczęto usuwania inwestycji.';end if;
 if exists(select 1 from storage.objects o join public.documents d on d.storage_path=o.name where d.investment_id=p_investment_id and o.bucket_id='portal-documents') then raise exception 'Pliki oczekują na usunięcie.';end if;
 delete from public.investments where id=p_investment_id;
 update private.investment_removal_audit set completed_at=now() where investment_id=p_investment_id;
end;$$;
revoke all on function private.finish_portal_investment_removal(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function private.finish_portal_investment_removal(uuid,uuid,uuid) to service_role;
create function public.finish_portal_investment_removal(p_investment_id uuid,p_actor uuid,p_session_id uuid) returns void
language sql security invoker set search_path='' as $$select private.finish_portal_investment_removal(p_investment_id,p_actor,p_session_id)$$;
revoke all on function public.finish_portal_investment_removal(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.finish_portal_investment_removal(uuid,uuid,uuid) to service_role;
commit;
