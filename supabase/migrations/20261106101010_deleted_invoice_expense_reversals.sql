-- Preserve the original expense and append an explicit cancellation credit.
alter table public.ledger_entries drop constraint ledger_entries_type_check;
alter table public.ledger_entries add constraint ledger_entries_type_check check(type in ('deposit','expense','expense_reversal'));
alter table public.ledger_entries add column reversal_of uuid references public.ledger_entries(id);
alter table public.ledger_entries add column event_document_id uuid references public.documents(id);
create unique index ledger_reversal_once on public.ledger_entries(reversal_of) where reversal_of is not null;
create index ledger_document_events on public.ledger_entries(event_document_id) where event_document_id is not null;
alter table public.ledger_entries add constraint ledger_reversal_type check((type='expense_reversal')=(reversal_of is not null));
create function public.validate_expense_reversal() returns trigger language plpgsql set search_path='' as $$
begin
 if new.reversal_of is not null and not exists(select 1 from public.ledger_entries l where l.id=new.reversal_of and l.type='expense' and l.investment_id=new.investment_id and l.amount=new.amount) then
  raise exception 'Anulowanie musi odpowiadać wydatkowi tej samej inwestycji i kwocie.';
 end if;
 if new.event_document_id is not null and not exists(select 1 from public.documents d where d.id=new.event_document_id and d.investment_id=new.investment_id) then
  raise exception 'Dokument musi należeć do tej samej inwestycji.';
 end if;
 return new;
end;$$;
create trigger validate_expense_reversal before insert on public.ledger_entries for each row execute function public.validate_expense_reversal();
revoke execute on function public.validate_expense_reversal() from public,anon,authenticated;
create function public.adjust_deleted_invoice() returns trigger language plpgsql set search_path='' as $$
declare expense public.ledger_entries;credit public.ledger_entries;
begin
 if (old.deleted_at is null)=(new.deleted_at is null) or new.category not in ('faktury','platnosci') then return new;end if;
 if not public.is_admin() then raise exception 'Brak uprawnień do zmiany rozliczenia.';end if;
 perform id from public.investments where id=new.investment_id for update;
 if new.deleted_at is not null then
  select l.* into expense from public.ledger_entries l where l.investment_id=new.investment_id and l.type='expense' and (l.document_id=new.id or l.event_document_id=new.id)
   and not exists(select 1 from public.ledger_entries r where r.reversal_of=l.id) order by l.created_at desc limit 1;
  if expense.id is not null then
   insert into public.ledger_entries(investment_id,type,amount,note,created_by,document_date,reversal_of,event_document_id)
   values(new.investment_id,'expense_reversal',expense.amount,'Anulowanie kosztu usuniętej faktury '||coalesce(new.invoice_number,new.title),auth.uid(),(new.deleted_at at time zone 'Europe/Warsaw')::date,expense.id,new.id)
   on conflict(reversal_of) where reversal_of is not null do nothing;
  end if;
 else
  select l.* into credit from public.ledger_entries l where l.event_document_id=new.id and l.type='expense_reversal' order by l.created_at desc limit 1;
  if credit.id is not null and not exists(select 1 from public.ledger_entries l where l.type='expense' and (l.document_id=new.id or l.event_document_id=new.id) and not exists(select 1 from public.ledger_entries r where r.reversal_of=l.id)) then
   insert into public.ledger_entries(investment_id,type,amount,note,created_by,document_date,event_document_id)
   values(new.investment_id,'expense',credit.amount,'Przywrócenie kosztu faktury '||coalesce(new.invoice_number,new.title),auth.uid(),(now() at time zone 'Europe/Warsaw')::date,new.id);
  end if;
 end if;
 return new;
end;$$;
create trigger adjust_deleted_invoice after update of deleted_at on public.documents for each row execute function public.adjust_deleted_invoice();
revoke execute on function public.adjust_deleted_invoice() from public,anon,authenticated;
-- Repair already trashed, previously booked invoices. Unbooked files cause no balance movement.
insert into public.ledger_entries(investment_id,type,amount,note,document_date,reversal_of,event_document_id)
select l.investment_id,'expense_reversal',l.amount,'Anulowanie kosztu usuniętej faktury '||coalesce(d.invoice_number,d.title),(d.deleted_at at time zone 'Europe/Warsaw')::date,l.id,d.id
from public.ledger_entries l join public.documents d on d.id=l.document_id
where l.type='expense' and d.deleted_at is not null and d.category in ('faktury','platnosci')
 and not exists(select 1 from public.ledger_entries r where r.reversal_of=l.id)
on conflict(reversal_of) where reversal_of is not null do nothing;
