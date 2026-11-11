# Invoice corrections and bulk scanner cleanup

## Confirmed corrections

The invoice intake panel sends the raw OCR/digital text and original field values to the authenticated learning endpoint after reading. The machine observation is separate from the suggestion shown to the operator. Only explicit manual save/import or a manual edit of an intake-backed document confirms feedback. Confirmation reads the actual saved document values from the database. Automatic imports and unfinished form edits do not confirm examples.

The history stores invoice number, date, gross amount, supplier and currency with the source hash, operator and confirmation time. Re-reading an imported document cannot overwrite the original observation. Deleted intake items/documents are excluded from learning through RLS. No existing invoices are backfilled as human-confirmed examples.

Suggestions currently learn locations for invoice number, issue date and gross amount. They require two different source hashes with the same corrected label/location for the same recognized seller NIP. Both same-line and next-line labels are supported. Old field values are never copied to a new invoice. Ambiguous matches and missing seller identifiers produce no suggestion. Applied suggestions disable automatic booking/import and are marked for manual verification. Client assignment is not learned from corrections.

If learning is unavailable, reading and manual import remain usable with an explicit warning. For scans entered without any OCR text, confirmed data is recorded but cannot teach a text location until a usable observation exists.

## Bulk cleanup

“Usuń wszystko” appears only in “Do usunięcia z folderu”. It confirms the number of currently listed imported scans and processes that fixed set sequentially through the existing cleanup endpoint. Each endpoint call reads the current record and verifies the portal copy, source content/version and conditional Drive update. Failed items stay available for retry, with per-item errors and a summary count. Pending scans and completed items are not selected. No portal invoices are deleted.

## Deployment

1. Apply `supabase/migrations/20261111201134_invoice_intake_learning.sql` to the portal project. It adds `invoice_reading_feedback`, a guarded private function, a public invoker wrapper, an operator-only read policy and an index. It does not change existing financial records or their values.
2. Deploy the matching application commit.
3. Verify an authenticated OCR/read → manual correction → save flow and a later invoice from the same supplier after two independent examples. Confirm that suggestions require manual approval.
4. Verify bulk cleanup with an imported scan and a deliberately failing item in a controlled environment.

Focused tests cover pattern learning, isolation between suppliers, ambiguous/invalid values, independent evidence, RLS, explicit confirmation, deletion exclusion and sequential cleanup. A signed-in production UI run is still required.
