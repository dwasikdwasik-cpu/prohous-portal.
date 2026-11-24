-- __DOCUMENT_TABLE__ is the uniquely identified table used by the existing personnel RPC.
create table if not exists attendance_private.personnel_purges (
 id uuid primary key,
 object_path text,
 completed boolean not null default false,
 check ((object_path is null) = completed)
);
alter table attendance_private.personnel_purges enable row level security;
revoke all on attendance_private.personnel_purges from public, anon, authenticated;
grant select,insert,update on attendance_private.personnel_purges to service_role;
grant delete on __DOCUMENT_TABLE__ to service_role;

-- A case requires its attachment. Serialize attachment changes with a pending purge.
create or replace function attendance_private.protect_bailiff_attachment()
returns trigger language plpgsql security definer set search_path=pg_catalog as $guard$
begin
 if new.document_id is not null then
  perform pg_advisory_xact_lock(hashtextextended(new.document_id::text,5831));
  if exists(select 1 from attendance_private.personnel_purges where id=new.document_id) then
   raise exception 'Wybrany dokument jest w trakcie usuwania.' using errcode='23503';
  end if;
 end if;
 return new;
end
$guard$;
revoke all on function attendance_private.protect_bailiff_attachment() from public,anon,authenticated;
drop trigger if exists personnel_purge_attachment_guard on attendance_private.bailiff_cases;
create trigger personnel_purge_attachment_guard before insert or update of document_id on attendance_private.bailiff_cases
for each row execute function attendance_private.protect_bailiff_attachment();

create or replace function public.prohouse_personnel_files_api(p jsonb, admin_actor uuid)
returns jsonb language plpgsql security invoker set search_path = pg_catalog as $function$
declare
 op text := p->>'action';
 target uuid := nullif(p->>'id','')::uuid;
 ticket attendance_private.personnel_purges%rowtype;
 old_state text;
 info jsonb;
begin
 if op not in ('documents_data','document_get','document_reserve','document_commit','document_archive','document_restore','purge_begin','purge_finish') then
  return jsonb_build_object('status',400,'error','Nieznana operacja.');
 end if;
 if op in ('purge_begin','purge_finish') and
    (admin_actor is null or not exists(select 1 from public.profiles where id=admin_actor and role='admin' and status='approved')) then
  return jsonb_build_object('status',403,'error','Tylko administrator może usunąć dokument.');
 end if;
 if op='documents_data' then
  return public.prohouse_personnel_api(p,admin_actor);
 end if;
 if target is null then return jsonb_build_object('status',400,'error','Brak identyfikatora dokumentu.'); end if;
 perform pg_advisory_xact_lock(hashtextextended(target::text,5831));
 select * into ticket from attendance_private.personnel_purges where id=target;
 if ticket.id is not null then
  if op='purge_begin' then return jsonb_build_object('done',ticket.completed,'path',ticket.object_path); end if;
  if op='purge_finish' then
   if not ticket.completed then
    delete from __DOCUMENT_TABLE__ where id=target;
    update attendance_private.personnel_purges set completed=true,object_path=null where id=target;
   end if;
   return jsonb_build_object('ok',true);
  end if;
  return jsonb_build_object('status',410,'error','Dokument został przeznaczony do trwałego usunięcia.');
 end if;
 if op='purge_finish' then return jsonb_build_object('status',409,'error','Nie rozpoczęto usuwania.'); end if;
 if op<>'purge_begin' then return public.prohouse_personnel_api(p,admin_actor); end if;
 select state into old_state from __DOCUMENT_TABLE__ where id=target for update;
 if old_state is null or old_state not in ('ready','archived') then
  return jsonb_build_object('status',404,'error','Nie znaleziono dokumentu.');
 end if;
 if exists(select 1 from attendance_private.bailiff_cases where document_id=target) then
  return jsonb_build_object('status',409,'error','Ten dokument jest załącznikiem do zajęcia komorniczego. Usunięcie dokumentu skasowałoby również zapis sprawy.');
 end if;
 info := public.prohouse_personnel_api(p||jsonb_build_object('action','document_get'),admin_actor);
 if info ? 'error' then return info; end if;
 if nullif(info->>'path','') is null then raise exception 'Missing document storage key'; end if;
 if old_state='ready' then
  declare archived_result jsonb;
  begin
   archived_result := public.prohouse_personnel_api(p||jsonb_build_object('action','document_archive'),admin_actor);
   if archived_result ? 'error' then return archived_result; end if;
   if not exists(select 1 from __DOCUMENT_TABLE__ where id=target and state='archived') then
    raise exception 'Archive did not commit';
   end if;
  end;
 end if;
 insert into attendance_private.personnel_purges(id,object_path) values(target,info->>'path');
 return jsonb_build_object('done',false,'path',info->>'path');
end
$function$;
revoke all on function public.prohouse_personnel_files_api(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.prohouse_personnel_files_api(jsonb,uuid) to service_role;
notify pgrst,'reload schema';
