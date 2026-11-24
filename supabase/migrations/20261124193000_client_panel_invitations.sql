-- Per-investment access. Existing primary clients keep their original assignments.
create table private.portal_invitations (
 investment_id uuid not null references public.investments on delete cascade,
 email text not null,
 token_hash text unique,
 expires_at timestamptz,
 member_id uuid references public.profiles on delete cascade,
 accepted_at timestamptz,
 mailed_at timestamptz,
 primary key(investment_id,email)
);
create index portal_members_by_user on private.portal_invitations(member_id,investment_id) where member_id is not null;
alter table private.portal_invitations enable row level security;
revoke all on private.portal_invitations from public,anon,authenticated;

create function private.has_client_panel(inv uuid,person uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.investments i join public.profiles p on p.id=person
 where i.id=inv and i.deleted_at is null and p.role='client' and p.status='approved'
 and (i.client_id=p.id or exists(select 1 from private.portal_invitations m
 where m.investment_id=i.id and m.member_id=p.id)));
$$;
revoke all on function private.has_client_panel(uuid,uuid) from public,anon,authenticated;

create or replace function public.can_access_investment(inv uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select private.is_finance_admin() or private.has_client_panel(inv,auth.uid());
$$;
create or replace function private.client_finance_visible(inv uuid,section text) returns boolean
language sql stable security definer set search_path='' as $$
 select private.has_client_panel(inv,auth.uid()) and exists(select 1 from public.investments i where i.id=inv and
 case section when 'invoices' then i.client_invoices_visible when 'balance' then i.client_balance_visible else false end);
$$;

create function private.reset_panel_members() returns trigger language plpgsql security definer set search_path='' as $$
begin
 -- The first successful activation establishes a primary contact for the
 -- existing document/invoice workflows. All other reassignments clear sharing.
 if old.client_id is null and new.client_id=auth.uid() and exists(
  select 1 from private.portal_invitations where investment_id=new.id and member_id=new.client_id
 ) then return new;end if;
 delete from private.portal_invitations where investment_id=new.id;
 return new;
end;$$;
revoke all on function private.reset_panel_members() from public,anon,authenticated;
create trigger reset_client_panel_members after update of client_id on public.investments
 for each row when(old.client_id is distinct from new.client_id) execute function private.reset_panel_members();

-- Sharing is controlled by the logged-in administrator. The service cannot select
-- a different actor on behalf of an unprivileged caller.
create function private.manage_panel_invites(op text, inv uuid, title text, address text, digest text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare i public.investments; m private.portal_invitations; result jsonb;
begin
 if not private.is_finance_admin() then raise insufficient_privilege; end if;
 if op='create' then
  if length(trim(title)) not between 1 and 200 then raise exception 'Podaj nazwę inwestycji.'; end if;
  insert into public.investments(id,name) values(inv,trim(title)) on conflict(id) do nothing;
 end if;
 select * into strict i from public.investments where id=inv and deleted_at is null for update;
 if op='create' and i.name is distinct from trim(title) then raise exception 'Nie można utworzyć panelu.'; end if;
 if op in ('create','list') then
  select coalesce(jsonb_agg(jsonb_build_object('email',coalesce(p.email,a.email),'active',a.member_id is not null,
   'sent',a.mailed_at is not null,'expired',a.expires_at<=now(),'key',a.email) order by a.email),'[]') into result
   from private.portal_invitations a left join public.profiles p on p.id=a.member_id where a.investment_id=inv and (a.member_id is null or a.member_id is distinct from i.client_id);
  return jsonb_build_object('name',i.name,'members',result);
 end if;
 address:=lower(trim(address));
 if op='remove' then
  delete from private.portal_invitations where investment_id=inv and email=address and (member_id is null or member_id is distinct from i.client_id);
  return '{}'::jsonb;
 end if;
 if op='sent' then
  update private.portal_invitations set mailed_at=now() where investment_id=inv and email=address and token_hash=digest;
  return '{}'::jsonb;
 end if;
 if op<>'stage' or digest is null or digest !~ '^[a-f0-9]{64}$' or address is null or length(address)>254
  or address !~ '^[^[:space:]@,;]+@[^[:space:]@,;]+\.[^[:space:]@,;]+$' then raise exception 'Nieprawidłowe zaproszenie.'; end if;
 if exists(select 1 from public.profiles p where lower(p.email)=address and (p.role<>'client' or p.status='rejected')) then
  raise exception 'Adres jest przypisany do konta z inną rolą lub do zablokowanego konta.'; end if;
 if exists(select 1 from public.profiles p where p.id=i.client_id and lower(p.email)=address and p.status='approved') then
  return jsonb_build_object('active',true); end if;
 insert into private.portal_invitations(investment_id,email,token_hash,expires_at) values(inv,address,digest,now()+interval '7 days')
 on conflict(investment_id,email) do update set token_hash=excluded.token_hash,expires_at=excluded.expires_at,mailed_at=null
 where portal_invitations.member_id is null;
 select * into strict m from private.portal_invitations where investment_id=inv and email=address;
 return jsonb_build_object('active',m.member_id is not null,'name',i.name);
end;$$;
create function public.manage_panel_invites(op text,inv uuid,title text default '',address text default '',digest text default '') returns jsonb
language sql security invoker set search_path='' as $$ select private.manage_panel_invites(op,inv,title,address,digest) $$;
revoke all on function private.manage_panel_invites(text,uuid,text,text,text),public.manage_panel_invites(text,uuid,text,text,text) from public,anon;
grant execute on function private.manage_panel_invites(text,uuid,text,text,text),public.manage_panel_invites(text,uuid,text,text,text) to authenticated;

create function private.panel_invite_info(digest text) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('email',a.email,'registered',exists(select 1 from auth.users u where lower(u.email)=a.email))
 from private.portal_invitations a join public.investments i on i.id=a.investment_id and i.deleted_at is null
 where a.token_hash=digest and a.expires_at>now() and a.member_id is null;
$$;
create function public.panel_invite_info(digest text) returns jsonb language sql security invoker set search_path='' as $$
 select private.panel_invite_info(digest);
$$;
revoke all on function private.panel_invite_info(text),public.panel_invite_info(text) from public,anon,authenticated;
grant execute on function private.panel_invite_info(text),public.panel_invite_info(text) to service_role;

create function private.accept_panel_invite(digest text) returns void language plpgsql security definer set search_path='' as $$
declare m private.portal_invitations; target uuid; verified_email text; p public.profiles;
begin
 select investment_id into target from private.portal_invitations where token_hash=digest;
 perform 1 from public.investments where id=target and deleted_at is null for update;
 if not found then raise exception 'Zaproszenie jest nieważne.';end if;
 select * into m from private.portal_invitations where token_hash=digest and investment_id=target and expires_at>now() and member_id is null for update;
 if not found then raise exception 'Zaproszenie wygasło lub zostało wykorzystane.';end if;
 select lower(email) into verified_email from auth.users where id=auth.uid() and email_confirmed_at is not null;
 select * into p from public.profiles where id=auth.uid() for update;
 if verified_email is null or verified_email<>m.email or p.role is distinct from 'client' or p.status not in ('pending','approved') then
  raise exception 'Użyj potwierdzonego konta klienta z zaproszenia.';end if;
 -- Pending accounts with prior primary assignments require manual approval of those other panels.
 if p.status='pending' and exists(select 1 from public.investments where client_id=p.id and id<>target) then
  raise exception 'Skontaktuj się z ProHouse w sprawie zatwierdzenia konta.'; end if;
 update public.profiles set status='approved' where id=p.id and status='pending';
 update private.portal_invitations set member_id=p.id,accepted_at=now(),expires_at=null,token_hash=null
 where investment_id=target and email=m.email;
 update public.investments set client_id=p.id where id=target and client_id is null;
end;$$;
create function public.accept_panel_invite(digest text) returns void language sql security invoker set search_path='' as $$
 select private.accept_panel_invite(digest);
$$;
revoke all on function private.accept_panel_invite(text),public.accept_panel_invite(text) from public,anon;
grant execute on function private.accept_panel_invite(text),public.accept_panel_invite(text) to authenticated;

create function private.preview_panel_ids(person uuid) returns setof uuid language plpgsql stable security definer set search_path='' as $$
begin
 if not private.is_finance_admin() then raise insufficient_privilege;end if;
 return query select i.id from public.investments i where private.has_client_panel(i.id,person);
end;$$;
create function public.preview_panel_ids(person uuid) returns setof uuid language sql stable security invoker set search_path='' as $$
 select * from private.preview_panel_ids(person);
$$;
revoke all on function private.preview_panel_ids(uuid),public.preview_panel_ids(uuid) from public,anon;
grant execute on function private.preview_panel_ids(uuid),public.preview_panel_ids(uuid) to authenticated;

-- Lock the exact version shown in the confirmation before handing it to the
-- existing audited purge. A restore, move, or second soft delete invalidates it.
create function private.lock_panel_trash_item(inv uuid,doc uuid,removed timestamptz) returns text
language plpgsql security definer set search_path='' as $$
declare title text;
begin
 if not private.is_finance_admin() then raise insufficient_privilege;end if;
 select d.title into strict title from public.documents d
 where d.id=doc and d.investment_id=inv and d.deleted_at=removed for update;
 perform private.start_portal_document_removal(doc,title);
 return title;
end;$$;
create function public.lock_panel_trash_item(inv uuid,doc uuid,removed timestamptz) returns text
language sql security invoker set search_path='' as $$ select private.lock_panel_trash_item(inv,doc,removed) $$;
revoke all on function private.lock_panel_trash_item(uuid,uuid,timestamptz),public.lock_panel_trash_item(uuid,uuid,timestamptz) from public,anon;
grant execute on function private.lock_panel_trash_item(uuid,uuid,timestamptz),public.lock_panel_trash_item(uuid,uuid,timestamptz) to authenticated;
