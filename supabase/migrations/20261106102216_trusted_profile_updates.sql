create or replace function public.protect_privileged_profile() returns trigger language plpgsql set search_path='' as $$
begin
 -- Only established trusted database roles may perform system profile updates.
 if current_user in ('postgres','supabase_admin','service_role') then return new;end if;
 if auth.uid() is null then raise exception 'Wymagane uwierzytelnienie.';end if;
 if not private.is_finance_admin() then
  if new.id<>old.id or new.role in ('admin','manager') and new.role<>old.role or
   (old.role in ('admin','manager') and (old.id<>auth.uid() or row(new.role,new.status) is distinct from row(old.role,old.status))) then
   raise exception 'Tylko administrator może zmieniać konta i uprawnienia administratorów oraz menedżerów.';
  end if;
 end if;
 return new;
end;$$;
revoke execute on function public.protect_privileged_profile() from public,anon,authenticated;
