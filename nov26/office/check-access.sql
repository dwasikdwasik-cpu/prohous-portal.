begin;
do $check$
declare actor uuid; initial_role text; mailbox text;
begin
 select p.id,p.role,lower(u.email) into actor,initial_role,mailbox from public.profiles p join auth.users u on p.id=u.id
 where p.role<>'admin' and p.status in ('approved','pending') and u.email_confirmed_at is not null and u.email is not null
 and not exists(select from attendance_private.office_admins g where g.user_id=p.id) limit 1;
 if actor is null then raise exception 'Brak potwierdzonego profilu do wycofywanej próby zakresu.';end if;
 if exists(select from public.prohouse_workforce_profiles where id=actor and role='admin') then raise exception 'Błędny stan początkowy.';end if;
 insert into attendance_private.office_admins(user_id,email) values(actor,mailbox);
 if not exists(select from public.prohouse_workforce_profiles where id=actor and role='admin' and status='approved') then raise exception 'Nie nadano dostępu do kadr.';end if;
 if not exists(select from public.profiles where id=actor and role=initial_role) then raise exception 'Zmieniła się rola innego portalu.';end if;
 if has_table_privilege('authenticated','public.prohouse_workforce_profiles','select') or has_table_privilege('anon','public.prohouse_workforce_profiles','select') then raise exception 'Nieprawidłowe uprawnienia widoku.';end if;
end $check$;
rollback;
