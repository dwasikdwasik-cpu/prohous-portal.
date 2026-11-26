-- Run inside a transaction that is rolled back. Only disposable fixtures are used.
select set_config('test.folder_manager', gen_random_uuid()::text, true),
       set_config('test.folder_investment', gen_random_uuid()::text, true);
insert into auth.users(id,email,raw_user_meta_data)
  values(current_setting('test.folder_manager')::uuid,'folders-'||gen_random_uuid()||'@example.invalid','{}'::jsonb);
update public.profiles set role='manager', status='approved' where id=current_setting('test.folder_manager')::uuid;
insert into public.investments(id, name) values(current_setting('test.folder_investment')::uuid,'Próba folderów');
insert into public.ledger_entries(investment_id,type,amount,note)
  values(current_setting('test.folder_investment')::uuid,'deposit',1,'Próba uprawnień');
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('test.folder_manager'),true);
do $test$
declare
  inv uuid := current_setting('test.folder_investment')::uuid;
  first_folder uuid;
  second_folder uuid;
  first_doc uuid;
  second_doc uuid;
begin
  if not public.is_admin() then raise exception 'Nieprawidłowa rola testowa'; end if;
  if exists(select from public.ledger_entries where investment_id=inv) then raise exception 'Saldo widoczne dla menedżerki'; end if;
  insert into public.investment_project_folders(investment_id,name) values (inv,'Rzuty'),(inv,'Instalacje');
  select id into strict first_folder from public.investment_project_folders where investment_id=inv and name='Rzuty';
  select id into strict second_folder from public.investment_project_folders where investment_id=inv and name='Instalacje';
  update public.investment_project_folders set name='Rysunki' where id=first_folder returning id into strict first_folder;
  begin
    insert into public.investment_project_folders(investment_id,name) values(inv,'RYSUNKI');
    raise exception 'Przyjęto powtórzoną nazwę';
  exception when unique_violation then null; end;
  insert into public.documents(investment_id,category,title,drive_file_id,project_folder_id,published)
    values(inv,'projekty','Dokument A',gen_random_uuid()::text,first_folder,true) returning id into first_doc;
  insert into public.documents(investment_id,category,title,drive_file_id,project_folder_id,published)
    values(inv,'projekty','Dokument B',gen_random_uuid()::text,first_folder,false) returning id into second_doc;
  update public.documents set project_folder_id=second_folder where id in(first_doc,second_doc);
  if (select count(*) from public.documents where investment_id=inv and project_folder_id=second_folder)<>2
    then raise exception 'Błąd przenoszenia wielu plików'; end if;
  delete from public.investment_project_folders where id=second_folder;
  if (select count(*) from public.documents where id in(first_doc,second_doc) and investment_id=inv and project_folder_id is null)<>2
    then raise exception 'Błąd zachowania zawartości folderu'; end if;
end $test$;
reset role;

select set_config('request.jwt.claim.sub','',true);
update public.profiles set role='client' where id=current_setting('test.folder_manager')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('test.folder_manager'),true);
do $test$
begin
  if exists(select from public.investment_project_folders where investment_id=current_setting('test.folder_investment')::uuid)
    then raise exception 'Konto klienta widzi folder zaplecza'; end if;
end $test$;
reset role;
