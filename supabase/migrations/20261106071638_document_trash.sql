alter table public.documents add column deleted_at timestamptz;
alter table public.documents add constraint documents_trash_unpublished check(deleted_at is null or published=false);
alter policy documents_read on public.documents using (
 public.is_admin() or (deleted_at is null and published and public.can_access_investment(investment_id))
);
alter policy portal_upload_read on storage.objects using (
 bucket_id='portal-documents' and (public.is_admin() or exists(
  select 1 from public.documents d where d.storage_path=storage.objects.name
  and d.deleted_at is null and d.published and public.can_access_investment(d.investment_id)
 ))
);
