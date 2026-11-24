-- The installer rolls this synthetic record and its deletion marker back to a savepoint.
do $check$
declare
 actor uuid; employee uuid; doc uuid := gen_random_uuid(); result jsonb; args jsonb;
begin
 select id into actor from public.profiles where role='admin' and status='approved' limit 1;
 select id into employee from attendance_private.employees limit 1;
 if actor is null or employee is null then raise exception 'Brak danych do próby transakcyjnej'; end if;
 args:=jsonb_build_object('id',doc,'employee_id',employee,'title','TEST instalacji kartoteki',
  'category','other','document_date',current_date,'note','','filename','proba.txt','mime','text/plain',
  'size_bytes',1,'sha256',repeat('a',64),'visible',false,'session','admin:test');
 result:=public.prohouse_personnel_files_api(args||'{"action":"document_reserve"}',actor);
 if result ? 'error' or result->>'path' is null then raise exception 'Nie powiodła się rezerwacja testowa: %',result->>'error'; end if;
 result:=public.prohouse_personnel_files_api(args||'{"action":"document_commit"}',actor);
 if result ? 'error' then raise exception 'Nie powiódł się zapis testowy'; end if;
 result:=public.prohouse_personnel_files_api(args||'{"action":"document_archive"}',actor);
 if result ? 'error' or not exists(select 1 from __DOCUMENT_TABLE__ where id=doc and state='archived') then raise exception 'Archiwizacja nie powiodła się'; end if;
 result:=public.prohouse_personnel_files_api(args||'{"action":"document_restore"}',actor);
 if result ? 'error' or not exists(select 1 from __DOCUMENT_TABLE__ where id=doc and state='ready') then raise exception 'Przywrócenie nie powiodło się'; end if;
 begin
  insert into attendance_private.bailiff_cases(id,employee_id,document_id,fields,reviewed_by)
   values(gen_random_uuid(),employee,doc,'{}'::jsonb,actor);
  result:=public.prohouse_personnel_files_api(args||'{"action":"purge_begin"}',actor);
  if result->>'status' is distinct from '409' then raise exception 'Usunięcie załącznika skasowałoby sprawę'; end if;
  raise exception using errcode='P4321',message='Rollback synthetic case';
 exception when sqlstate 'P4321' then null;
 end;
 result:=public.prohouse_personnel_files_api(args||'{"action":"purge_begin"}',null);
 if result->>'status' is distinct from '403' then raise exception 'Brak blokady pracownika'; end if;
 result:=public.prohouse_personnel_files_api(args||'{"action":"purge_begin"}',actor);
 if result->>'path' is null then raise exception 'Nie rozpoczęto usuwania: %',result->>'error'; end if;
 begin
  insert into attendance_private.bailiff_cases(id,employee_id,document_id,fields,reviewed_by)
   values(gen_random_uuid(),employee,doc,'{}'::jsonb,actor);
  raise exception 'Pozwolono przypisać usuwany plik do sprawy';
 exception when foreign_key_violation then null;
 end;
 result:=public.prohouse_personnel_files_api(args||'{"action":"document_restore"}',actor);
 if result->>'status' is distinct from '410' then raise exception 'Nie zablokowano przywrócenia'; end if;
 result:=public.prohouse_personnel_files_api(args||'{"action":"purge_finish"}',actor);
 if result->>'ok' is distinct from 'true' or exists(select 1 from __DOCUMENT_TABLE__ where id=doc) then raise exception 'Nie usunięto wpisu'; end if;
 result:=public.prohouse_personnel_files_api(args||'{"action":"purge_begin"}',actor);
 if result->>'done' is distinct from 'true' then raise exception 'Ponowienie usuwania nie powiodło się'; end if;
 result:=public.prohouse_personnel_files_api(args||'{"action":"document_reserve"}',actor);
 if result->>'status' is distinct from '410' then raise exception 'Nie zablokowano powtórnego dodania z tym samym ID'; end if;
end
$check$;
