-- Withdraw the added CRM client list and its lazy investment creation API.
-- Existing client records, investments and invoice assignments are retained.
drop function public.invoice_intake_directory();
drop function private.invoice_intake_directory();
drop function public.resolve_invoice_client(text);
drop function private.resolve_invoice_client(text);
