-- Auth owns the login address. Mirror only the confirmed auth.users.email value.
create function public.sync_confirmed_account_email() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 update public.profiles set email=new.email where id=new.id;
 return new;
end;
$$;
revoke all on function public.sync_confirmed_account_email() from public,anon,authenticated;
create trigger sync_profile_confirmed_email after update of email on auth.users
for each row when(old.email is distinct from new.email)
execute function public.sync_confirmed_account_email();
