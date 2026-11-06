alter table public.documents drop constraint documents_category_check;
alter table public.documents add constraint documents_category_check check(category in ('zdjecia','faktury','platnosci','umowy','protokoly','inne'));
alter table public.documents add column currency text not null default 'PLN' check(currency in ('PLN','OTHER','UNKNOWN'));
alter table public.documents add column content_sha256 text check(content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$');
alter table public.documents add column auto_book boolean not null default false;
alter table public.documents add column accounting_status text not null default 'pending' check(accounting_status in ('pending','not_applicable','needs_review','booked','duplicate'));
alter table public.documents add column accounting_note text;
alter table public.ledger_entries add column document_id uuid references public.documents(id);
alter table public.ledger_entries add column document_date date;
alter table public.ledger_entries add column booking_key text;
alter table public.ledger_entries add column source_sha256 text;
create unique index ledger_document_once on public.ledger_entries(document_id) where document_id is not null;
create unique index ledger_invoice_once on public.ledger_entries(investment_id,booking_key) where booking_key is not null;
create unique index ledger_upload_once on public.ledger_entries(investment_id,source_sha256) where source_sha256 is not null;

create function public.protect_booked_document() returns trigger language plpgsql set search_path='' as $$
begin
 if exists(select 1 from public.ledger_entries where document_id=old.id) and
 row(new.investment_id,new.invoice_number,new.invoice_date,new.gross_amount,new.currency,new.supplier,new.category,new.content_sha256,new.storage_path,new.drive_file_id)
 is distinct from row(old.investment_id,old.invoice_number,old.invoice_date,old.gross_amount,old.currency,old.supplier,old.category,old.content_sha256,old.storage_path,old.drive_file_id) then
  raise exception 'Dokument jest zaksięgowany. Zapisz korektę jako osobną operację rozliczeniową.';
 end if;
 return new;
end;$$;
create trigger protect_booked_document before update on public.documents for each row execute function public.protect_booked_document();
revoke execute on function public.protect_booked_document() from public,anon,authenticated;

create function public.book_document_expense() returns trigger language plpgsql set search_path='' as $$
declare fingerprint text; duplicate_entry uuid;
begin
 if new.deleted_at is not null then return new; end if;
 if exists(select 1 from public.ledger_entries where document_id=new.id) then return new;end if;
 if new.category not in ('faktury','platnosci') then
  update public.documents set accounting_status='not_applicable' where id=new.id;return new;
 end if;
 if not new.auto_book or new.invoice_number is null or length(trim(new.invoice_number))=0 or new.invoice_date is null or new.gross_amount is null or new.gross_amount<=0 or new.currency<>'PLN' then
  update public.documents set accounting_status='needs_review' where id=new.id;return new;
 end if;
 if not public.is_admin() then raise exception 'Brak uprawnień do księgowania';end if;
 -- Serialize bookings within an investment, including invoice/payment pairs.
 perform id from public.investments where id=new.investment_id for update;
 fingerprint:=regexp_replace(lower(new.invoice_number),'[^a-z0-9]','','g')||'|'||extract(year from new.invoice_date)::text||'|'||regexp_replace(lower(coalesce(new.supplier,'')),'[^a-z0-9]','','g');
 select l.id into duplicate_entry from public.ledger_entries l where l.investment_id=new.investment_id and
 (l.booking_key=fingerprint or (new.content_sha256 is not null and l.source_sha256=new.content_sha256) or exists(
  select 1 from public.documents original where original.id=l.document_id
  and (new.category='platnosci' or original.category='platnosci')
  and regexp_replace(lower(original.invoice_number),'[^a-z0-9]','','g')=regexp_replace(lower(new.invoice_number),'[^a-z0-9]','','g')
  and extract(year from original.invoice_date)=extract(year from new.invoice_date)
  and (nullif(trim(new.supplier),'') is null or nullif(trim(original.supplier),'') is null or lower(original.supplier)=lower(new.supplier))
 )) limit 1;
 if duplicate_entry is not null then
  update public.documents set accounting_status='duplicate',accounting_note='Ten dokument został już rozliczony w tej inwestycji. Nie odjęto kwoty ponownie.' where id=new.id;return new;
 end if;
 begin
  insert into public.ledger_entries(investment_id,type,amount,note,created_by,document_id,document_date,booking_key,source_sha256)
  values(new.investment_id,'expense',new.gross_amount,'Dokument '||new.invoice_number||' · '||new.invoice_date::text,auth.uid(),new.id,new.invoice_date,fingerprint,new.content_sha256);
 exception when unique_violation then
  update public.documents set accounting_status='duplicate',accounting_note='Dokument rozliczono wcześniej. Nie odjęto kwoty ponownie.' where id=new.id;return new;
 end;
 update public.documents set accounting_status='booked',accounting_note='Kwotę brutto odjęto od salda inwestycji.' where id=new.id;
 return new;
end;$$;
create trigger book_document_expense after insert or update of invoice_number,invoice_date,gross_amount,currency,supplier,category,auto_book,content_sha256 on public.documents
for each row execute function public.book_document_expense();
revoke execute on function public.book_document_expense() from public,anon,authenticated;
