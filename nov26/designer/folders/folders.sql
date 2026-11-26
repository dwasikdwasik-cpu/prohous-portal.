create table if not exists designer_private.folders (
 id uuid primary key default gen_random_uuid(),
 investment_id uuid not null references public.investments(id) on delete cascade,
 name text not null check (name = btrim(name) and length(name) between 1 and 100),
 unique (investment_id, id)
);
create unique index if not exists designer_folder_name on designer_private.folders(investment_id,lower(name));
alter table designer_private.submissions add column if not exists folder_id uuid;
do $$ begin
 if not exists(select 1 from pg_constraint where conrelid='designer_private.submissions'::regclass and conname='submission_investment_folder') then
  alter table designer_private.submissions add constraint submission_investment_folder
   foreign key(investment_id,folder_id) references designer_private.folders(investment_id,id);
 end if;
end $$;

create or replace function public.designer_save_folder(investment uuid, folder_name text, folder uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 if not exists(select 1 from designer_private.investments() i where i.id=investment) then raise insufficient_privilege; end if;
 if folder_name is null or length(btrim(folder_name)) not between 1 and 100 then raise invalid_parameter_value; end if;
 if folder is null then
  insert into designer_private.folders(investment_id,name) values(investment,btrim(folder_name)) returning id into result;
 else
  update designer_private.folders set name=btrim(folder_name) where id=folder and investment_id=investment returning id into result;
  if not found then raise insufficient_privilege; end if;
 end if;
 return result;
end $$;

create or replace function public.designer_folder_workspace() returns jsonb
language sql stable security definer set search_path='' as $$
 with workspace as (select public.designer_workspace() as data)
 select data || jsonb_build_object(
 'folders',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'investment',f.investment_id,'name',f.name) order by lower(f.name),f.id)
  from designer_private.folders f join designer_private.investments() i on i.id=f.investment_id),'[]'::jsonb),
 'projects',coalesce((select jsonb_agg(p.item || jsonb_build_object('folder',s.folder_id) order by p.pos)
  from jsonb_array_elements(data->'projects') with ordinality as p(item,pos)
  left join designer_private.submissions s on s.document_id=(p.item->>'id')::uuid),'[]'::jsonb))
 from workspace
$$;

create or replace function public.designer_file_in_folder(investment uuid,request_id uuid,title text,extension text,mime text,bytes integer,checksum text,finish boolean,folder uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare receipt jsonb; previous_folder uuid; has_receipt boolean;
begin
 if not exists(select 1 from designer_private.investments() i where i.id=investment) then raise insufficient_privilege; end if;
 if folder is not null and not exists(select 1 from designer_private.folders f where f.id=folder and f.investment_id=investment) then raise insufficient_privilege; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || request_id::text,0));
 select s.folder_id into previous_folder from designer_private.submissions s
 where s.designer_id=auth.uid() and s.request_id=designer_file_in_folder.request_id;
 has_receipt:=found;
 if has_receipt and previous_folder is distinct from folder then raise invalid_parameter_value; end if;
 receipt:=public.designer_project_file(investment,request_id,title,extension,mime,bytes,checksum,finish);
 if not has_receipt and folder is not null then
  update designer_private.submissions set folder_id=folder where document_id=(receipt->>'id')::uuid;
 end if;
 return receipt;
end $$;
revoke all on designer_private.folders from public,anon,authenticated;
revoke all on function public.designer_save_folder(uuid,text,uuid),public.designer_folder_workspace(),public.designer_file_in_folder(uuid,uuid,text,text,text,integer,text,boolean,uuid) from public,anon;
grant execute on function public.designer_save_folder(uuid,text,uuid),public.designer_folder_workspace(),public.designer_file_in_folder(uuid,uuid,text,text,text,integer,text,boolean,uuid) to authenticated;
