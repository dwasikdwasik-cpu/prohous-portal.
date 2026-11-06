-- Electricians and plumbers share installation-only permissions, with separate accounts.
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check check(role in ('admin','client','electrician','plumber'));
-- Renaming preserves policy dependencies and keeps the helper outside the exposed API.
alter function private.is_electrician() rename to is_installer;
create or replace function private.is_installer() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.profiles where id=auth.uid() and role in ('electrician','plumber') and status='approved');
$$;
revoke all on function private.is_installer() from public,anon;
grant execute on function private.is_installer() to authenticated;
