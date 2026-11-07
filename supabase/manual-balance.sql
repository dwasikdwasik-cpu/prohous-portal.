-- One-time transactional upgrade, applied only after owner approval.
begin;
create table private.balance_adjustments (
 id bigint generated always as identity primary key,
 investment_id uuid not null references public.investments(id),
 previous_balance numeric not null,
 target_balance numeric not null,
 delta numeric not null,
 actor uuid not null,
 actor_email text,
 created_at timestamptz not null default now(),
 check(delta=target_balance-previous_balance)
);
alter table private.balance_adjustments enable row level security;
revoke all on private.balance_adjustments from public,anon,authenticated;
revoke all on sequence private.balance_adjustments_id_seq from public,anon,authenticated;
create index balance_adjustments_investment_idx on private.balance_adjustments(investment_id,id desc);

create function private.calculate_portal_balance(inv uuid) returns numeric
language sql stable security invoker set search_path='' as $$
 select coalesce((select sum(case when l.type='expense' then -l.amount else l.amount end)
  from public.ledger_entries l where l.investment_id=inv),0)
 +coalesce((select sum(a.delta) from private.balance_adjustments a where a.investment_id=inv),0);
$$;
revoke all on function private.calculate_portal_balance(uuid) from public,anon,authenticated;

create function private.can_manage_balance() returns boolean
language sql stable security invoker set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.profiles p
  where p.id=auth.uid() and p.role='admin' and p.status='approved')
 and exists(select 1 from auth.sessions s where s.user_id=auth.uid()
  and s.id::text=auth.jwt()->>'session_id' and (s.not_after is null or s.not_after>now()));
$$;
revoke all on function private.can_manage_balance() from public,anon,authenticated;

-- All ledger inserts share the same lock as a manual setting. This prevents a
-- concurrent invoice/deposit from being accidentally absorbed by an adjustment.
create function private.lock_balance_investment() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.investments where id=new.investment_id for no key update;
 return new;
end;$$;
revoke all on function private.lock_balance_investment() from public,anon,authenticated;
create trigger ledger_balance_lock before insert on public.ledger_entries
 for each row execute function private.lock_balance_investment();

create function private.get_portal_balance(p_investment_id uuid) returns numeric
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not (private.is_finance_admin() or private.client_finance_visible(p_investment_id,'balance')) then
  raise exception 'Brak uprawnień do salda.' using errcode='42501';
 end if;
 if not exists(select 1 from public.investments where id=p_investment_id and deleted_at is null) then
  raise exception 'Nie znaleziono aktywnej inwestycji.' using errcode='P0002';
 end if;
 return private.calculate_portal_balance(p_investment_id);
end;$$;
revoke all on function private.get_portal_balance(uuid) from public,anon;
grant execute on function private.get_portal_balance(uuid) to authenticated;
create function public.get_portal_balance(p_investment_id uuid) returns numeric
language sql stable security invoker set search_path='' as $$select private.get_portal_balance(p_investment_id)$$;
revoke all on function public.get_portal_balance(uuid) from public,anon;
grant execute on function public.get_portal_balance(uuid) to authenticated;

create function private.set_portal_balance(p_investment_id uuid,p_target numeric,p_expected numeric) returns numeric
language plpgsql security definer set search_path='' as $$
declare current_balance numeric;
begin
 if not private.can_manage_balance() then
  raise exception 'Tylko zatwierdzony administrator może zmieniać saldo.' using errcode='42501';
 end if;
 if p_target is null or p_target::text in ('NaN','Infinity','-Infinity') or abs(p_target)>999999999999.99 or round(p_target,2)<>p_target
  or p_expected is null or p_expected::text in ('NaN','Infinity','-Infinity') then
  raise exception 'Podaj poprawną kwotę w PLN z najwyżej dwoma miejscami po przecinku.' using errcode='22023';
 end if;
 perform 1 from public.investments where id=p_investment_id and deleted_at is null for no key update;
 if not found then raise exception 'Nie znaleziono aktywnej inwestycji.' using errcode='P0002';end if;
 current_balance:=private.calculate_portal_balance(p_investment_id);
 if current_balance<>p_expected then
  raise exception 'Saldo zmieniło się w międzyczasie. Odśwież dane i ponownie sprawdź kwotę.' using errcode='40001';
 end if;
 if current_balance<>p_target then
  insert into private.balance_adjustments(investment_id,previous_balance,target_balance,delta,actor,actor_email)
  select p_investment_id,current_balance,p_target,p_target-current_balance,auth.uid(),u.email
  from auth.users u where u.id=auth.uid();
 end if;
 return p_target;
end;$$;
revoke all on function private.set_portal_balance(uuid,numeric,numeric) from public,anon;
grant execute on function private.set_portal_balance(uuid,numeric,numeric) to authenticated;
create function public.set_portal_balance(p_investment_id uuid,p_target numeric,p_expected numeric) returns numeric
language sql security invoker set search_path='' as $$select private.set_portal_balance(p_investment_id,p_target,p_expected)$$;
revoke all on function public.set_portal_balance(uuid,numeric,numeric) from public,anon;
grant execute on function public.set_portal_balance(uuid,numeric,numeric) to authenticated;

create function private.portal_balance_history(p_investment_id uuid)
returns table(id bigint,previous_balance numeric,target_balance numeric,actor_email text,created_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.can_manage_balance() then raise exception 'Brak uprawnień.' using errcode='42501';end if;
 return query select a.id,a.previous_balance,a.target_balance,a.actor_email,a.created_at
 from private.balance_adjustments a where a.investment_id=p_investment_id order by a.id desc limit 50;
end;$$;
revoke all on function private.portal_balance_history(uuid) from public,anon;
grant execute on function private.portal_balance_history(uuid) to authenticated;
create function public.portal_balance_history(p_investment_id uuid)
returns table(id bigint,previous_balance numeric,target_balance numeric,actor_email text,created_at timestamptz)
language sql stable security invoker set search_path='' as $$select * from private.portal_balance_history(p_investment_id)$$;
revoke all on function public.portal_balance_history(uuid) from public,anon;
grant execute on function public.portal_balance_history(uuid) to authenticated;
grant usage on schema private to authenticated;
commit;
