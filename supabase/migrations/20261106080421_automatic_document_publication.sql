-- Publish newly created documents by default; retain all existing visibility choices.
alter table public.documents alter column published set default true;
