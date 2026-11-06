alter table public.documents drop constraint documents_category_check;
alter table public.documents add constraint documents_category_check
check(category in ('zdjecia','faktury','platnosci','projekty','umowy','protokoly','inne'));
