-- Client receivables have their own records. Only these functions may publish or settle them.
create table private.prohouse_issued_invoices (
 id uuid primary key,
 investment_id uuid not null references public.investments on delete cascade,
 number text not null check (length(trim(number)) between 1 and 100),
 issued_on date not null,
 total_cents bigint not null check (total_cents between 1 and 99999999999),
 created_at timestamptz not null default now(),
 revision integer not null default 1,
 pdf bytea check (octet_length(pdf) between 5 and 5242880)
);
create unique index prohouse_invoice_number on private.prohouse_issued_invoices (investment_id,lower(trim(number)));
create index prohouse_invoice_history on private.prohouse_issued_invoices (investment_id,created_at desc);
create table private.prohouse_invoice_terms (
 invoice_id uuid not null references private.prohouse_issued_invoices on delete cascade,
 id uuid not null,
 position integer not null,
 due_on date not null,
 cents bigint not null check (cents between 1 and 99999999999),
 paid_at timestamptz,
 primary key(invoice_id,id)
);
alter table private.prohouse_issued_invoices enable row level security;
alter table private.prohouse_invoice_terms enable row level security;
revoke all on private.prohouse_issued_invoices,private.prohouse_invoice_terms from public,anon,authenticated;

create function private.check_issued_invoice_access(inv uuid, preview uuid) returns void
language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(select 1 from public.investments where id=inv and deleted_at is null) then raise insufficient_privilege; end if;
 if preview is not null then
  if not private.is_finance_admin() or not private.has_client_panel(inv,preview) then raise insufficient_privilege; end if;
 elsif not private.is_finance_admin() and not private.has_client_panel(inv,auth.uid()) then raise insufficient_privilege;
 end if;
end; $$;
revoke all on function private.check_issued_invoice_access(uuid,uuid) from public,anon,authenticated;

create function private.prohouse_invoice_history(inv uuid,preview uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform private.check_issued_invoice_access(inv,preview);
 return (select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'number',i.number,'issued_on',i.issued_on,
  'created_at',i.created_at,'total_cents',i.total_cents,'revision',i.revision,'has_pdf',i.pdf is not null,
  'terms',(select jsonb_agg(jsonb_build_object('id',t.id,'due_on',t.due_on,'cents',t.cents,'paid_at',t.paid_at)
   order by t.position) from private.prohouse_invoice_terms t where t.invoice_id=i.id))
  order by i.created_at desc,i.id),'[]'::jsonb) from private.prohouse_issued_invoices i where i.investment_id=inv);
end; $$;
create function private.prohouse_invoice_pdf(inv uuid,invoice uuid,preview uuid) returns text
language plpgsql stable security definer set search_path='' as $$
begin
 perform private.check_issued_invoice_access(inv,preview);
 return (select encode(i.pdf,'base64') from private.prohouse_issued_invoices i where i.investment_id=inv and i.id=invoice);
end; $$;

create function private.manage_prohouse_invoice(inv uuid,invoice uuid,version integer,action text,details jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare current_revision integer; terms jsonb; total bigint; content bytea; target uuid;
begin
 if not private.is_finance_admin() then raise insufficient_privilege; end if;
 perform 1 from public.investments where id=inv and deleted_at is null for key share;
 if not found then raise exception 'Nie znaleziono aktywnej inwestycji.'; end if;
 select i.revision into current_revision from private.prohouse_issued_invoices i
 where i.id=invoice and i.investment_id=inv for update;
 if version is null or coalesce(current_revision,0)<>version then
  raise exception 'Dane zmieniły się. Odśwież historię i sprawdź aktualną wersję faktury.'; end if;
 if action in ('paid','unpaid') and current_revision is not null then
  target:=(details->>'term')::uuid;
  update private.prohouse_invoice_terms set paid_at=case when action='paid' then now() end
   where invoice_id=invoice and id=target and (paid_at is null)=(action='paid');
  if not found then raise exception 'Sprawdź aktualny status transzy.'; end if;
  update private.prohouse_issued_invoices set revision=revision+1 where id=invoice;
  return;
 end if;
 if action is distinct from 'save' then raise exception 'Nieprawidłowa operacja.'; end if;
 terms:=details->'terms';
 if jsonb_typeof(terms) is distinct from 'array' or jsonb_array_length(terms) not between 1 and 100 then
  raise exception 'Dodaj od 1 do 100 transz.'; end if;
 total:=(details->>'total_cents')::bigint;
 if exists(select 1 from jsonb_to_recordset(terms) as t(id uuid,due_on date,cents bigint)
   where t.id is null or t.due_on is null or t.cents is null or t.cents<=0) or
  (select count(distinct t->>'id') from jsonb_array_elements(terms) t)<>jsonb_array_length(terms) or
  (select sum((t->>'cents')::bigint) from jsonb_array_elements(terms) t) is distinct from total then
  raise exception 'Sprawdź kwoty i terminy. Suma transz musi odpowiadać kwocie brutto faktury.'; end if;
 if exists(select 1 from private.prohouse_invoice_terms old where old.invoice_id=invoice and old.paid_at is not null
  and not exists(select 1 from jsonb_to_recordset(terms) as t(id uuid,due_on date,cents bigint)
   where t.id=old.id and t.cents=old.cents and t.due_on=old.due_on)) then
  raise exception 'Przed zmianą opłaconej transzy cofnij jej potwierdzenie.'; end if;
 if details->>'pdf' is not null then
  if length(details->>'pdf')>6990508 then raise exception 'Maksymalny rozmiar PDF to 5 MB.'; end if;
  content:=decode(details->>'pdf','base64');
  if substring(content from 1 for 5)<>decode('255044462d','hex') then raise exception 'Wybierz plik PDF.'; end if;
 end if;
 if current_revision is null then
  insert into private.prohouse_issued_invoices(id,investment_id,number,issued_on,total_cents,pdf)
   values(invoice,inv,trim(details->>'number'),(details->>'issued_on')::date,total,content);
 else
  update private.prohouse_issued_invoices set number=trim(details->>'number'),issued_on=(details->>'issued_on')::date,
   total_cents=total,pdf=coalesce(content,pdf),revision=revision+1 where id=invoice;
 end if;
 delete from private.prohouse_invoice_terms t where t.invoice_id=invoice and not exists
  (select 1 from jsonb_array_elements(terms) part where (part->>'id')::uuid=t.id);
 insert into private.prohouse_invoice_terms(invoice_id,id,position,due_on,cents)
  select invoice,(part->>'id')::uuid,ordinality,(part->>'due_on')::date,(part->>'cents')::bigint
  from jsonb_array_elements(terms) with ordinality as parts(part,ordinality)
  on conflict(invoice_id,id) do update set position=excluded.position,due_on=excluded.due_on,cents=excluded.cents;
end; $$;

create function public.prohouse_invoice_history(inv uuid,preview uuid default null) returns jsonb
language sql stable security invoker set search_path='' as $$select private.prohouse_invoice_history(inv,preview)$$;
create function public.prohouse_invoice_pdf(inv uuid,invoice uuid,preview uuid default null) returns text
language sql stable security invoker set search_path='' as $$select private.prohouse_invoice_pdf(inv,invoice,preview)$$;
create function public.manage_prohouse_invoice(inv uuid,invoice uuid,version integer,action text,details jsonb) returns void
language sql security invoker set search_path='' as $$select private.manage_prohouse_invoice(inv,invoice,version,action,details)$$;
revoke all on function private.prohouse_invoice_history(uuid,uuid), public.prohouse_invoice_history(uuid,uuid),
 private.prohouse_invoice_pdf(uuid,uuid,uuid), public.prohouse_invoice_pdf(uuid,uuid,uuid),
 private.manage_prohouse_invoice(uuid,uuid,integer,text,jsonb), public.manage_prohouse_invoice(uuid,uuid,integer,text,jsonb) from public,anon;
grant execute on function private.prohouse_invoice_history(uuid,uuid), public.prohouse_invoice_history(uuid,uuid),
 private.prohouse_invoice_pdf(uuid,uuid,uuid), public.prohouse_invoice_pdf(uuid,uuid,uuid),
 private.manage_prohouse_invoice(uuid,uuid,integer,text,jsonb), public.manage_prohouse_invoice(uuid,uuid,integer,text,jsonb) to authenticated;
