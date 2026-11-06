-- Tradespeople have global project read access, never global financial access.
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check check(role in ('admin','client','electrician'));
alter table public.documents add column uploaded_by uuid references public.profiles(id) default auth.uid();
create schema if not exists private;
revoke all on schema private from public,anon;
grant usage on schema private to authenticated;
-- Definer is needed only for this self-profile lookup, avoiding policy recursion.
create function private.is_electrician() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.profiles where id=auth.uid() and role='electrician' and status='approved');
$$;
revoke all on function private.is_electrician() from public,anon;
grant execute on function private.is_electrician() to authenticated;
-- Do not expand this helper: ledger and purchase policies use it.
create or replace function public.can_access_investment(inv uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.is_admin() or exists(select 1 from public.investments i join public.profiles p on p.id=i.client_id where i.id=inv and i.client_id=auth.uid() and p.status='approved' and p.role='client');
$$;
alter policy investments_read on public.investments to authenticated using(public.can_access_investment(id) or (select private.is_electrician()));
alter policy documents_read on public.documents to authenticated using(
 public.is_admin() or (deleted_at is null and (
  (published and public.can_access_investment(investment_id)) or
  ((select private.is_electrician()) and ((category='projekty' and published) or (category='zdjecia' and uploaded_by=auth.uid())))
 ))
);
-- Cleanup must see even trashed documents, which are hidden by RLS from their author.
create function private.upload_is_unattached(path text) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and not exists(select 1 from public.documents where storage_path=path);
$$;
revoke all on function private.upload_is_unattached(text) from public,anon;
grant execute on function private.upload_is_unattached(text) to authenticated;
alter policy portal_upload_read on storage.objects using(
 bucket_id='portal-documents' and (public.is_admin() or exists(
  select 1 from public.documents d where d.storage_path=storage.objects.name
 ) or ((select private.is_electrician()) and owner_id=auth.uid()::text and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp|gif)$' and private.upload_is_unattached(name)))
);
create policy electrician_photo_upload on storage.objects for insert to authenticated with check(
 bucket_id='portal-documents' and (select private.is_electrician()) and owner_id=auth.uid()::text
 and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp|gif)$'
 and exists(select 1 from public.investments i where i.id::text=split_part(storage.objects.name,'/',1))
);
-- Isolated ownership lookup prevents documents ↔ storage policy recursion.
create function private.owns_photo_upload(path text, mime text) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from storage.objects o where o.bucket_id='portal-documents' and o.name=path and o.owner_id=auth.uid()::text
 and o.name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp|gif)$' and o.metadata->>'mimetype'=mime);
$$;
revoke all on function private.owns_photo_upload(text,text) from public,anon;
grant execute on function private.owns_photo_upload(text,text) to authenticated;
create policy electrician_photo_insert on public.documents for insert to authenticated with check(
 (select private.is_electrician()) and uploaded_by=auth.uid() and category='zdjecia' and storage_path is not null and drive_file_id is null
 and published and deleted_at is null and not auto_book
 and invoice_number is null and invoice_date is null and gross_amount is null and supplier is null
 and mime_type in ('image/jpeg','image/png','image/webp','image/gif')
 and private.owns_photo_upload(storage_path,mime_type)
);
create policy electrician_photo_cleanup on storage.objects for delete to authenticated using(
 bucket_id='portal-documents' and (select private.is_electrician()) and owner_id=auth.uid()::text and private.upload_is_unattached(name)
);
