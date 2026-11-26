create table public.investment_project_folders (
  id uuid primary key default gen_random_uuid(),
  investment_id uuid not null references public.investments(id) on delete cascade,
  name text not null check (name = btrim(name) and char_length(name) between 1 and 100 and name !~ '[[:cntrl:]]'),
  unique (investment_id, id)
);
create unique index investment_project_folders_name
  on public.investment_project_folders (investment_id, lower(name));

alter table public.investment_project_folders enable row level security;
revoke all on public.investment_project_folders from public, anon, authenticated;
grant select, delete, insert (investment_id, name), update (name)
  on public.investment_project_folders to authenticated;
create policy manage_investment_project_folders on public.investment_project_folders
  for all to authenticated
  using ((select public.is_admin()) and exists (
    select 1 from public.investments i where i.id = investment_id and i.deleted_at is null
  ))
  with check ((select public.is_admin()) and exists (
    select 1 from public.investments i where i.id = investment_id and i.deleted_at is null
  ));

alter table public.documents
  add column project_folder_id uuid,
  add constraint document_folder_projects_only check (project_folder_id is null or category = 'projekty'),
  add constraint document_folder_same_investment foreign key (investment_id, project_folder_id)
    references public.investment_project_folders (investment_id, id) on delete set null (project_folder_id);
create index documents_project_folder on public.documents (investment_id, project_folder_id)
  where project_folder_id is not null;
