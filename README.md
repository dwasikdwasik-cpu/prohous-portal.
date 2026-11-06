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
