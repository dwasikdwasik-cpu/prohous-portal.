-- Private portal uploads coexist with the existing Google Drive documents.
alter table public.documents add column storage_path text;
alter table public.documents alter column drive_file_id drop not null;
alter table public.documents add constraint documents_exactly_one_source check (
 (storage_path is null and drive_file_id is not null) or
 (storage_path is not null and drive_file_id is null and
 storage_path ~ ('^' || investment_id::text || '/[0-9a-f-]{36}\.(pdf|jpg|png|webp|gif|docx|xlsx)$'))
);
create unique index documents_storage_path_unique on public.documents(storage_path) where storage_path is not null;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('portal-documents','portal-documents',false,26214400,array[
 'application/pdf','image/jpeg','image/png','image/webp','image/gif',
 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]);
create policy portal_upload_admin_insert on storage.objects for insert to authenticated
with check(bucket_id='portal-documents' and public.is_admin() and
 name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|jpg|png|webp|gif|docx|xlsx)$' and
 exists(select 1 from public.investments i where i.id::text=split_part(storage.objects.name,'/',1)));
create policy portal_upload_read on storage.objects for select to authenticated
using(bucket_id='portal-documents' and (public.is_admin() or exists(
 select 1 from public.documents d where d.storage_path=storage.objects.name
 and d.published and public.can_access_investment(d.investment_id)
)));
-- Uploads are immutable. Only unattached uploads may be cleaned up after a failed save.
create policy portal_upload_cleanup on storage.objects for delete to authenticated
using(bucket_id='portal-documents' and public.is_admin() and not exists(
 select 1 from public.documents d where d.storage_path=storage.objects.name
));
