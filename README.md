# PROHOUS — Portal klienta, v0.3

Portal klienta i panel administratora w Next.js + Supabase Auth/PostgreSQL. Loginem jest adres e-mail, hasło ustala klient. Nowe konta oczekują na zatwierdzenie. Każda inwestycja ma przypisanego klienta i prywatny folder Google Drive.

## Google Drive bez klucza JSON (Vercel OIDC)

Jeśli organizacja Google blokuje tworzenie kluczy kont usług, użyj federacji tożsamości. Nie wyłączaj polityki organizacji. Portal wymienia podpisany token Vercel na krótkotrwały token konta usługi z zakresem `drive.readonly`.

1. W Google Cloud Shell uruchom `bash scripts/setup-google-federation.sh`, aby zobaczyć plan. Po jego sprawdzeniu wykonaj `bash scripts/setup-google-federation.sh --apply` z kopii tego repozytorium.
2. Skrypt jest przygotowany dla projektu `project-dcc520bb-b866-4147-a65`, konta `prohous-portal@project-dcc520bb-b866-4147-a65.iam.gserviceaccount.com` i wyłącznie produkcyjnego projektu Vercel `prohous-portal` w zespole `prohous`. Włącza wymagane API, tworzy dedykowaną pulę/providera OIDC i przyznaje dokładnemu podmiotowi Vercel rolę Workload Identity User na tym koncie usługi. Nie tworzy kluczy ani nie nadaje kontu usługi ról administratora projektu. Jeśli istniejący provider ma inną konfigurację, zatrzymuje się.
3. W projekcie Vercel włącz OIDC w trybie Team. Dodaj zmienne produkcyjne `GOOGLE_SERVICE_ACCOUNT_EMAIL` oraz `GCP_WORKLOAD_IDENTITY_AUDIENCE` (wartość wypisana na końcu skryptu). To identyfikatory konfiguracji, nie klucze prywatne. Numer projektu w audience musi być numerem odczytanym przez skrypt, nie ID tekstowym.
4. Udostępnij kontu usługi wyłącznie foldery inwestycji jako **Przeglądający**. Wpisz ID właściwego folderu w danej inwestycji.
5. Ponów wdrożenie i sprawdź synchronizację oraz pobranie pliku z prawdziwego folderu. Pole `/api/health` potwierdza wyłącznie obecność konfiguracji; nie potwierdza połączenia z Google.

Gdy `GCP_WORKLOAD_IDENTITY_AUDIENCE` jest ustawione, portal używa federacji i nie przełącza się automatycznie na klucz prywatny przy błędzie. Przeglądy wdrożeń (preview) nie otrzymują uprawnień do produkcyjnego Drive. Błąd ograniczeń organizacji lub uprawnień w Cloud Shell należy zgłosić administratorowi, zamiast poszerzać zakres skryptu.

Instrukcje poniżej dotyczą także wariantu ze starszym kluczem JSON, jeśli taki klucz jest już dozwolony i skonfigurowany.

## Funkcje
- Rejestracja, logowanie, potwierdzenie e-mail przez Supabase, odzyskiwanie i zmiana hasła.
- Pulpit klienta, galeria zdjęć, wyszukiwarka dokumentów i faktur, lista zakupów z powiązaniem do faktury.
- Saldo osobno dla inwestycji: wpłaty minus wydatki. Import dokumentów i zapis towaru nie tworzą operacji finansowej. Administrator księguje ją jawnie. Korekty jako przeciwne operacje z opisem; istniejących wpisów nie edytuje się w interfejsie.
- Administrator: zatwierdzenie lub blokada klientów, tworzenie i przypisanie inwestycji, księgowanie operacji, zapis zakupów, synchronizacja Drive i publikacja dokumentów.
- Import plików ze wskazanego folderu i podfolderów (do 500 folderów, maks. 30 poziomów przy weryfikacji pobrania). Skróty nie są importowane. Dokumenty, Arkusze, Prezentacje i Rysunki Google są eksportowane do PDF przy pobraniu. Limit pliku: 25 MB. Synchronizacja uruchamiana przyciskiem, bez automatycznego harmonogramu.
- RLS izoluje rekordy klientów w bazie. API dokumentu ponownie sprawdza token, zatwierdzenie konta, uprawnienia do inwestycji i położenie pliku w Drive. Plik jest przesyłany przez serwer; prywatny URL nie jest udostępniany klientowi.
- Nowe dokumenty zawsze jako szkice. Po kontroli administrator uzupełnia kategorię, numer faktury, dostawcę, datę, kwotę i udostępnia klientowi. Kwoty i pozycje faktur wprowadzane ręcznie — brak OCR.
- Historia zmian i rejestr żądań pobrania w bazie. Rejestr żądań nie jest potwierdzeniem pełnego pobrania. Błąd zapisu audytu blokuje przekazanie pliku.

## Uruchomienie / Vercel
1. `npm ci` (Node.js 22 lub 24).
2. Nowa baza: wykonaj kolejno `supabase/schema.sql` oraz `supabase/upgrade-v2.sql`. Istniejąca baza v0.1: najpierw migracje `supabase/migrations/002_document_downloads.sql` i `003_function_permissions.sql`, następnie `upgrade-v2.sql`. Baza v0.2: tylko `upgrade-v2.sql`, jednorazowo. Nie wykonuj ponownie inicjalizacji istniejącej bazy.
3. Ustaw `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (może zawierać klucz publishable) i serwerowy sekret `GOOGLE_SERVICE_ACCOUNT_JSON`. Lokalnie w `.env.local`, w Vercel jako zmienne środowiskowe. Nigdy nie umieszczaj klucza prywatnego w Git ani w przeglądarce. Klucz service-role Supabase nie jest potrzebny.
4. W Supabase Auth ustaw Site URL na docelowy HTTPS portalu i dodaj go do Redirect URLs. Włącz potwierdzanie e-mail, min. 12 znaków hasła, SMTP do wysyłki wiadomości i ograniczenia ruchu właściwe dla skali. Aplikacja wymaga min. 12 znaków przy rejestracji i resecie.
5. Zarejestruj swoje konto i potwierdź e-mail. Zweryfikuj UUID w Supabase Auth, następnie nadaj administratora w SQL Editor: `update public.profiles set role='admin',status='approved' where id='<ZWERYFIKOWANE_UUID>';`. Nie przyznawaj roli na podstawie niepotwierdzonego adresu.
6. Vercel: framework Next.js, katalog główny repozytorium, `npm run build`, domyślny katalog wyjściowy. Po zmianie zmiennych ponownie wdroż aplikację.
7. `npm run dev`, `npm run build`, `npm start`.

## Google Drive
Utwórz konto usługi w projekcie Google Cloud, włącz Google Drive API. Dodaj JSON konta jako sekret serwera. Zachowano również zgodność ze zmiennymi `GOOGLE_SERVICE_ACCOUNT_EMAIL` i `GOOGLE_PRIVATE_KEY` z wersji v0.2. Udostępnij kontu usługi tylko foldery inwestycji w trybie odczytu. Nie włączaj publicznego dostępu do dokumentów. W panelu administratora wpisz ID folderu z adresu Drive, kliknij „Sprawdź folder Drive”, sprawdź i opublikuj odpowiednie pliki. Połączenie Google Drive z czatem nie jest tożsame z konfiguracją serwerowej integracji portalu.

## Weryfikacja
`npm test` zachowuje testy polityki pobierania i uruchamia dodatkowo testy SQL w lokalnym PostgreSQL/WASM (PGlite): migracje, izolacja dwóch klientów, ukrycie szkiców, blokada kont oczekujących, zakaz samodzielnego nadania administratora i księgowania przez klienta, dostęp administratora, zgodność faktury z inwestycją. Testy nie łączą się z rzeczywistą bazą.

Kompilacja i testy SQL nie zastępują testu na wdrożeniu z dwoma prawdziwymi kontami i prywatnym folderem Drive. Przed zaproszeniem klientów sprawdź e-mail potwierdzający, reset hasła, zatwierdzenie kont, pobranie plików, odcięcie dostępu po blokadzie, kopie zapasowe i treść informacji o przetwarzaniu danych. Faktyczne dane klientów nie są dołączone do repozytorium.

## Przesyłanie plików przez portal

Administrator wybiera inwestycję i w Zarządzaniu używa formularza „Dodaj pliki z komputera”. Obsługiwane są PDF, JPG, PNG, WEBP, GIF, DOCX i XLSX, maksymalnie 25 MB na plik i 50 plików w partii. Przesyłanie odbywa się bezpośrednio do prywatnego magazynu Supabase `portal-documents`; nie kopiuje plików na Google Drive. Migracja `20261106070406_portal_private_uploads.sql` tworzy magazyn oraz reguły dostępu. Dotychczasowe dokumenty Drive działają bez zmian.

Pliki trafiają do wybranej inwestycji jako szkice. Przycisk „Udostępnij wszystkie” publikuje wyłącznie szkice tej inwestycji; nie zmienia przypisania klientów. Częściowe niepowodzenie grupowego przesyłania pokazuje liczbę dodanych plików i listę błędów. Udane pliki zostają zapisane. Pobranie wymaga uprawnienia do dokumentu i zapisu audytu; adres pobrania wygasa po 60 sekundach.

## Usuwanie plików

Administrator może użyć „Usuń” przy pliku w Zarządzaniu. Dokument trafia do kosza wybranej inwestycji i jest wycofywany z publikacji. „Przywróć” odtwarza go jako szkic. Kosz nie kasuje oryginałów Drive ani danych źródłowych. Import Drive nie odtwarza automatycznie plików z kosza, a publikacja grupowa je pomija. Nowe pobrania plików z kosza są blokowane; wydany wcześniej adres prywatnego pliku może pozostać ważny do 60 sekund. Migracja: `20261106071638_document_trash.sql`.

## Ustawienia konta

„Moje konto” / „Ustawienia konta” pozwala zalogowanemu użytkownikowi zmienić własny adres e-mail i hasło (minimum 12 znaków, powtórzenie hasła). Zmiany przechodzą przez Supabase Auth. Zmiana adresu wymaga potwierdzeń e-mail; trigger synchronizuje wyłącznie potwierdzony `auth.users.email` do profilu, bez zmiany identyfikatora, roli i inwestycji. Przy wymaganej ponownej weryfikacji hasła formularz obsługuje kod z `reauthenticate()`. Administrator może wysłać klientowi link do zmiany hasła, bez poznawania jego hasła. Operacje te wymagają działającego SMTP.

## Automatyczne rozliczanie dokumentów

Nowe pliki w kategorii Faktury lub Dokumenty płatności są analizowane w przeglądarce administratora (tekst PDF lub lokalny OCR zdjęcia/skanu). Numer, data wystawienia i kwota brutto są zapisywane w dokumencie. Jednoznaczny odczyt w PLN uruchamia transakcyjne księgowanie wydatku w tej samej inwestycji, również przy przesyłaniu grupowym. Publikacja pliku jest niezależna od rozliczenia.

Nieczytelne/niepełne dane, rozbieżne kwoty, inne waluty, korekty i pro formy trafiają do sprawdzenia. Administrator może poprawić dane i użyć „Zapisz i zaksięguj”. Dla wcześniej dodanych plików służy „Odczytaj i zaksięguj”. Nie wykonujemy automatycznej zmiany sald dla starych dokumentów podczas wdrożenia. Parser nie interpretuje dowolnych układów faktur bezbłędnie. OCR przetwarza do 12 stron PDF i wymaga dostępnej przeglądarki; przerwaną analizę można ponowić.

Unikalne powiązanie dokumentu, klucz numer/rok/wystawca oraz skrót SHA-256 pliku ograniczają duplikaty. Dowód płatności z tym samym numerem faktury i rokiem jest dodatkowo porównywany z fakturami inwestycji. W razie podejrzenia duplikatu saldo nie jest ponownie pomniejszane. Nie należy drugi raz ręcznie księgować wydatku dodanego przez automat. Stare ręczne operacje bez powiązanego dokumentu wymagają osobnego sprawdzenia.

Po zaksięgowaniu dane finansowe dokumentu są blokowane. Usunięcie go do kosza lub przywrócenie nie zmienia historii rozliczeń. Korekty księguje się jako osobne przeciwne operacje, z odniesieniem do oryginału. Obecne saldo działa osobno dla każdej inwestycji. Nie ma automatycznych przeliczeń walut.

Worker PDF, kod OCR i polski model językowy są kopiowane z przypiętych paczek npm przez `scripts/prepare-invoice-ocr.mjs` przy budowaniu aplikacji. Dokumenty nie są wysyłane do usług rozpoznawania osób trzecich.

## Podgląd faktur klienta

Spis faktur i lista dokumentów mają osobne przyciski „Podgląd” i „Pobierz”. PDF jest renderowany w portalu z nawigacją po stronach; zdjęcia faktur są wyświetlane jako obraz. Podgląd pobiera plik przez tę samą autoryzowaną ścieżkę co pobieranie, z kontrolą inwestycji, publikacji i kosza. Nie tworzy publicznych odnośników. Inne formaty można pobrać, bez osadzania ich zawartości w portalu. Klient widzi tylko dokumenty opublikowane dla swojej inwestycji.

## Widoczność przesłanych faktur

Administrator widzi w zakładkach Faktury i Wszystkie dokumenty także szkice, z oznaczeniem widoczności i przyciskiem publikacji. Klient nadal otrzymuje wyłącznie opublikowane pliki swojej inwestycji. Przy przesyłaniu można zaznaczyć „Od razu udostępnij przesłane pliki klientowi tej inwestycji”; opcja jest domyślnie włączona. Widok odświeża dane po powrocie do karty i co 30 sekund. Import rozpoznaje nazwy eksportów `_KSEF_` jako faktury.

Nowe dokumenty są domyślnie publikowane, również przy imporcie Drive. „Cofnij udostępnienie” w zakładce Faktury lub w Zarządzaniu wycofuje widoczność dla klienta. Ponowny import pomija istniejące rekordy i nie cofa tej decyzji. Usunięcie do kosza i przywrócenie zachowują zasadę przywracania jako szkic. Migracja `20261106080421_automatic_document_publication.sql` zmienia wyłącznie wartość domyślną dla nowych rekordów.

## Projekty inwestycyjne

Zakładka „Projekty inwestycyjne” zastępuje „Zakupione towary”. Administrator może przesłać do 50 plików projektu dla wybranej inwestycji bezpośrednio z tej zakładki albo z Zarządzania. Klient widzi opublikowane pliki, może je przeglądać (PDF/zdjęcia) i pobierać. Publikację można cofnąć, a plik przenieść do kosza. Projekty nie są księgowane i nie zmieniają salda. Dane dawnych zakupów pozostają w bazie jako historia, bez widoku ani formularza zakupów w portalu.

## Dokładna kontrola przed księgowaniem

Odczyt przechodzi przez wszystkie strony PDF (bez wcześniejszego limitu 12 stron). Po niepełnym lub niepotwierdzonym odczycie tekstu uruchamia dodatkowy OCR pozostałych stron i porównuje oba odczyty. Sprzeczne numery, daty i kwoty blokują automatyczne księgowanie.

Faktura wymaga potwierdzenia brutto obliczeniem netto + VAT albo spójnym podsumowaniem stawek VAT. Weryfikowane są sumy i stawki, z tolerancją 1 grosza dla sum i 2 groszy dla obliczenia stawki. Nieczytelne podsumowanie, korekta, zaliczka/pro forma, obca waluta lub plik zawierający różne faktury wymagają kontroli administratora. Dokument płatności nie musi zawierać podsumowania VAT. Administrator nadal może ręcznie zatwierdzić dane po sprawdzeniu oryginału. Automatyczny odczyt nie gwarantuje bezbłędności każdego układu dokumentu; wynik niepewny nie odejmuje salda.

## Kolejka faktur ze skanera

Panel **Obsługa faktur** pobiera PDF i zdjęcia z folderu SCAN - FA, odczytuje je i przypisuje jednoznaczne dokumenty do klientów. Pozostałe trafiają do ręcznej weryfikacji. Po potwierdzonym zapisie i porównaniu kopii skan jest usuwany z folderu; nie wykonuje się trwałego kasowania. Operator ma dedykowaną rolę bez sald. Instrukcja, dostęp Google i migracja: [docs/INVOICE_INTAKE.md](docs/INVOICE_INTAKE.md).
