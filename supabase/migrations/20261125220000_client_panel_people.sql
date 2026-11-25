create or replace function private.reset_panel_members() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if current_setting('prohouse.revoking_primary_from',true)=new.id::text
    and private.is_finance_admin() then return new;end if;
 -- The first successful activation establishes a primary contact for the
 -- existing document/invoice workflows. All other reassignments clear sharing.
 if old.client_id is null and new.client_id=auth.uid() and exists(
  select 1 from private.portal_invitations where investment_id=new.id and member_id=new.client_id
 ) then return new;end if;
 delete from private.portal_invitations where investment_id=new.id;
 return new;
end;$$;

create or replace function private.manage_panel_invites(op text, inv uuid, title text, address text, digest text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare i public.investments; m private.portal_invitations; result jsonb; replacement uuid;
begin
 if not private.is_finance_admin() then raise insufficient_privilege; end if;
 if op='create' then
  if length(trim(title)) not between 1 and 200 then raise exception 'Podaj nazwę inwestycji.'; end if;
  insert into public.investments(id,name) values(inv,trim(title)) on conflict(id) do nothing;
 end if;
 select * into strict i from public.investments where id=inv and deleted_at is null for update;
 if op='create' and i.name is distinct from trim(title) then raise exception 'Nie można utworzyć panelu.'; end if;
 if op in ('create','list','remove','remove_primary') then
  if op='remove' then
   delete from private.portal_invitations
   where investment_id=inv and email=lower(trim(address)) and (member_id is null or member_id is distinct from i.client_id);
   if not found then raise exception 'Adresu nie ma na liście tej inwestycji. Odśwież panel.';end if;
  elsif op='remove_primary' then
   if i.client_id is null or i.client_id::text is distinct from address then
    raise exception 'Główny klient uległ zmianie. Odśwież panel.';
   end if;
   delete from private.portal_invitations where investment_id=inv and member_id=i.client_id;
   select a.member_id into replacement
    from private.portal_invitations a join public.profiles p on p.id=a.member_id
    where a.investment_id=inv and p.role='client' and p.status='approved'
    order by a.accepted_at nulls last,a.email limit 1;
   -- This operation changes the primary contact while preserving unrelated grants.
   perform set_config('prohouse.revoking_primary_from',inv::text,true);
   update public.investments set client_id=replacement where id=inv;
   perform set_config('prohouse.revoking_primary_from','',true);
   i.client_id:=replacement;
  end if;
  select coalesce(jsonb_agg(to_jsonb(members) order by members."primary" desc,members.email),'[]'::jsonb)
   into result
   from (
    select p.email::text, p.id::text as key, p.id as "memberId",
     p.role='client' and p.status='approved' as active, true as "primary", false as sent, false as expired
    from public.profiles p where p.id=i.client_id
    union all
    select coalesce(p.email,a.email),a.email,a.member_id,
     coalesce(p.role='client' and p.status='approved',false),false,a.mailed_at is not null,coalesce(a.expires_at<=now(),false)
    from private.portal_invitations a left join public.profiles p on p.id=a.member_id
    where a.investment_id=inv and (a.member_id is null or a.member_id is distinct from i.client_id)
   ) members;
  return jsonb_build_object('name',i.name,'members',result);
 end if;
 address:=lower(trim(address));
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
