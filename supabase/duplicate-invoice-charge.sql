-- Explicit, one-time-per-copy override. Automatic deduplication remains enabled.
begin;
create table private.duplicate_invoice_charges (
 document_id uuid primary key references public.documents(id) on delete cascade,
 ledger_entry_id uuid not null unique references public.ledger_entries(id) on delete cascade,
 investment_id uuid not null references public.investments(id) on delete cascade,
 amount numeric(14,2) not null check(amount>0),
 confirmed_by uuid not null,
 confirmed_email text,
 confirmed_at timestamptz not null default now()
);
alter table private.duplicate_invoice_charges enable row level security;
revoke all on private.duplicate_invoice_charges from public,anon,authenticated;
create function private.charge_duplicate_invoice(p_document_id uuid,p_investment_id uuid,p_expected_amount numeric) returns jsonb
language plpgsql security definer set search_path='' as $$
declare invoice public.documents;prior private.duplicate_invoice_charges;entry_id uuid;
begin
 if not private.can_manage_balance() then
  raise exception 'Tylko zatwierdzony administrator może ponownie obciążyć saldo duplikatem.' using errcode='42501';
 end if;
 -- Keep the same lock order as document updates: document, then investment.
 select * into invoice from public.documents where id=p_document_id for update;
 if invoice.id is null or invoice.investment_id is distinct from p_investment_id or invoice.deleted_at is not null then
  raise exception 'Nie znaleziono aktywnej faktury w wybranej inwestycji.' using errcode='P0002';
 end if;
 perform 1 from public.investments where id=invoice.investment_id and deleted_at is null and purge_started_at is null for no key update;
 if not found then raise exception 'Inwestycja jest usunięta lub trwa jej usuwanie.';end if;
 if invoice.category<>'faktury' or invoice.currency<>'PLN' or nullif(btrim(invoice.invoice_number),'') is null or invoice.invoice_date is null
  or invoice.gross_amount is null or invoice.gross_amount::text in ('NaN','Infinity','-Infinity') or invoice.gross_amount<=0 then
  raise exception 'Sprawdź numer, datę i dodatnią kwotę brutto faktury w PLN.' using errcode='22023';
 end if;
 if p_expected_amount is distinct from invoice.gross_amount then
  raise exception 'Kwota faktury zmieniła się. Odśwież dane i potwierdź aktualną kwotę.' using errcode='40001';
 end if;
 select * into prior from private.duplicate_invoice_charges where document_id=invoice.id;
 if found then return jsonb_build_object('charged',false,'amount',prior.amount);end if;
 if invoice.accounting_status<>'duplicate' or exists(select 1 from public.ledger_entries where document_id=invoice.id) then
  raise exception 'Ponowne obciążenie jest dostępne tylko dla niezaksięgowanego duplikatu.' using errcode='22023';
 end if;
 -- Deliberately omit the canonical invoice/hash keys. Only this reviewed copy is
 -- an extra charge; the existing unique indexes and automatic checks stay intact.
 insert into public.ledger_entries(investment_id,type,amount,note,created_by,document_id,event_document_id,document_date)
 values(invoice.investment_id,'expense',invoice.gross_amount,'Duplikat — doliczony ręcznie: '||invoice.invoice_number,auth.uid(),invoice.id,invoice.id,invoice.invoice_date)
 returning id into entry_id;
 insert into private.duplicate_invoice_charges(document_id,ledger_entry_id,investment_id,amount,confirmed_by,confirmed_email)
 select invoice.id,entry_id,invoice.investment_id,invoice.gross_amount,auth.uid(),email from auth.users where id=auth.uid();
 update public.documents set accounting_status='booked',accounting_note='Duplikat zaksięgowany ręcznie — kwotę brutto ponownie odjęto od salda.' where id=invoice.id;
 return jsonb_build_object('charged',true,'amount',invoice.gross_amount);
end;$$;
revoke all on function private.charge_duplicate_invoice(uuid,uuid,numeric) from public,anon;
grant execute on function private.charge_duplicate_invoice(uuid,uuid,numeric) to authenticated;
create function public.charge_duplicate_invoice(p_document_id uuid,p_investment_id uuid,p_expected_amount numeric) returns jsonb
language sql security invoker set search_path='' as $$select private.charge_duplicate_invoice(p_document_id,p_investment_id,p_expected_amount)$$;
revoke all on function public.charge_duplicate_invoice(uuid,uuid,numeric) from public,anon;
grant execute on function public.charge_duplicate_invoice(uuid,uuid,numeric) to authenticated;
commit;
