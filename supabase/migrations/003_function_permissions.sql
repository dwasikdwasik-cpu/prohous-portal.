-- Trigger functions cannot be invoked through the client API.
revoke execute on function public.new_profile() from public,anon,authenticated;
revoke execute on function public.log_changes() from public,anon,authenticated;
-- These two helpers are required by authenticated RLS policies.
revoke execute on function public.is_admin() from public,anon;
revoke execute on function public.can_access_investment(uuid) from public,anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.can_access_investment(uuid) to authenticated;
create policy audit_admin_read on public.audit_log for select to authenticated using(public.is_admin());
