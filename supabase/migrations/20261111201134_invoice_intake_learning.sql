-- Keep machine observations separate from explicitly confirmed document values.
create table public.invoice_reading_feedback (
 intake_id uuid primary key references public.invoice_intake(id) on delete cascade,
 content_sha256 text not null check(content_sha256 ~ '^[0-9a-f]{64}$'),
 supplier_key text check(supplier_key is null or supplier_key ~ '^[0-9]{10}$'),
 original_text text not null default '' check(length(original_text)<=60000),
 original_values jsonb not null default '{}' check(jsonb_typeof(original_values)='object' and octet_length(original_values::text)<=4096),
 corrected_values jsonb check(corrected_values is null or jsonb_typeof(corrected_values)='object'),
 observed_by uuid references public.profiles(id) on delete set null,
 confirmed_by uuid references public.profiles(id) on delete set null,
 observed_at timestamptz not null default now(),confirmed_at timestamptz
);
alter table public.invoice_reading_feedback enable row level security;
revoke all on public.invoice_reading_feedback from public,anon,authenticated;
grant select on public.invoice_reading_feedback to authenticated;
create policy invoice_feedback_operator_read on public.invoice_reading_feedback for select to authenticated using (
 (select private.is_invoice_operator()) and exists (
  select 1 from public.invoice_intake q where q.id=intake_id and q.deleted_at is null
  and (q.document_id is null or exists(select 1 from public.documents d where d.id=q.document_id and d.deleted_at is null))
 )
);
create index invoice_feedback_supplier_idx on public.invoice_reading_feedback(supplier_key,confirmed_at desc) where confirmed_at is not null;
create function private.invoice_learning_action(p_id uuid,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare q public.invoice_intake;d public.documents;
begin
 if not private.is_invoice_operator() then raise exception 'Brak uprawnień do obsługi faktur';end if;
 select * into q from public.invoice_intake where id=p_id for update;
 if not found or q.deleted_at is not null then raise exception 'Nie znaleziono aktywnego skanu';end if;
 if q.staged_path is null or q.content_sha256 is null then raise exception 'Najpierw pobierz kopię skanu';end if;
 if p_action='observe' then
  if q.document_id is not null then raise exception 'Faktura jest już zapisana';end if;
  if jsonb_typeof(p_data->'text') is distinct from 'string' or length(p_data->>'text')>60000
   or jsonb_typeof(p_data->'values') is distinct from 'object' then raise exception 'Nieprawidłowy odczyt';end if;
  insert into public.invoice_reading_feedback(intake_id,content_sha256,supplier_key,original_text,original_values,observed_by)
  values(q.id,q.content_sha256,nullif(p_data->>'supplier_key',''),p_data->>'text',p_data->'values',auth.uid())
  on conflict(intake_id) do update set original_text=excluded.original_text,original_values=excluded.original_values,
   supplier_key=excluded.supplier_key,observed_by=excluded.observed_by,observed_at=now()
  where public.invoice_reading_feedback.confirmed_at is null;
 elsif p_action='confirm' then
  select * into d from public.documents where id=q.document_id and deleted_at is null and published
   and source_intake_id=q.id and content_sha256=q.content_sha256 and investment_id=q.assigned_investment_id;
  if not found or q.reviewed_at is null then raise exception 'Najpierw zapisz i potwierdź fakturę';end if;
  -- Confirmed values come from the saved document, never from the request body.
  insert into public.invoice_reading_feedback(intake_id,content_sha256,corrected_values,confirmed_by,confirmed_at)
  values(q.id,q.content_sha256,jsonb_build_object('invoice_number',d.invoice_number,'invoice_date',d.invoice_date,
   'gross_amount',d.gross_amount,'supplier',d.supplier,'currency',d.currency),auth.uid(),now())
  on conflict(intake_id) do update set corrected_values=excluded.corrected_values,confirmed_by=excluded.confirmed_by,confirmed_at=excluded.confirmed_at;
 else raise exception 'Nieznana operacja';end if;
 return jsonb_build_object('recorded',true);
end;$$;
revoke all on function private.invoice_learning_action(uuid,text,jsonb) from public,anon;
grant execute on function private.invoice_learning_action(uuid,text,jsonb) to authenticated;
create function public.invoice_learning_action(p_id uuid,p_action text,p_data jsonb default '{}') returns jsonb
language sql security invoker set search_path='' as $$select private.invoice_learning_action(p_id,p_action,p_data)$$;
revoke all on function public.invoice_learning_action(uuid,text,jsonb) from public,anon;
grant execute on function public.invoice_learning_action(uuid,text,jsonb) to authenticated;
