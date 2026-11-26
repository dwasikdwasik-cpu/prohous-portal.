begin;
do $test$
declare d uuid; inv uuid; client uuid; f uuid; second uuid; receipt jsonb; req uuid:=gen_random_uuid(); other uuid; label text:='Proba '||gen_random_uuid()::text;
begin
 select id into d from public.profiles where role='designer' and status='approved' limit 1;
 select i.id,i.client_id into inv,client from public.investments i join public.profiles c on c.id=i.client_id where c.role='client' and c.status='approved' and i.deleted_at is null and i.purge_started_at is null limit 1;
 if d is null or inv is null then raise exception 'Brak zatwierdzonego profilu lub inwestycji do transakcyjnej próby.'; end if;
 insert into designer_private.clients(designer_id,client_id) values(d,client) on conflict do nothing;
 perform set_config('request.jwt.claim.sub',d::text,true);
 f:=public.designer_save_folder(inv,label);
 second:=public.designer_save_folder(inv,label||' B');
 perform public.designer_save_folder(inv,label||' A',f);
 if not exists(select from jsonb_array_elements(public.designer_folder_workspace()->'folders') a where a->>'id'=f::text and a->>'name'=label||' A') then raise exception 'Brak folderu po zmianie nazwy';end if;
 select public.designer_file_in_folder(inv,req,'Test','pdf','application/pdf',256,repeat('a',64),false,f) into receipt;
 if receipt is distinct from public.designer_file_in_folder(inv,req,'Test','pdf','application/pdf',256,repeat('a',64),false,f) then raise exception 'Błąd powtórzenia';end if;
 begin
  perform public.designer_file_in_folder(inv,req,'Test','pdf','application/pdf',256,repeat('a',64),false,second);
  raise exception 'Zaakceptowano niezgodny folder';
 exception when invalid_parameter_value then null;end;
 begin
  perform public.designer_file_in_folder(inv,gen_random_uuid(),'Test','pdf','application/pdf',256,repeat('b',64),false,gen_random_uuid());
  raise exception 'Zaakceptowano obcy folder';
 exception when insufficient_privilege then null;end;
 if (select folder_id from designer_private.submissions where document_id=(receipt->>'id')::uuid) is distinct from f then raise exception 'Nie zapisano przydziału pliku';end if;
 perform public.designer_file_in_folder(inv,gen_random_uuid(),'Test 2','pdf','application/pdf',256,repeat('c',64),false,f);
end $test$;
rollback;
