# PROHOUS — Portal Klienta 0.2

Portal Next.js + Supabase: konta klientów, akceptacja przez administratora, inwestycje, wpłaty i wydatki, zakupy oraz dokumenty z Google Drive.

## Co dodano w wersji 0.2

- Szkice dokumentów i publikacja/cofnięcie publikacji przez administratora.
- Pobieranie plików przez serwer z tokenem sesji (bez tokenów w adresach URL).
- Serwer weryfikuje użytkownika w Supabase, odczytuje dokument i inwestycję z uprawnieniami tego użytkownika (RLS), następnie sprawdza przynależność pliku do folderu inwestycji.
- Zapis próby przekazania pliku w document_downloads. Brak zapisu blokuje pobranie. Rejestr nie dowodzi, że użytkownik odebrał wszystkie bajty.
- Pobieranie jako załącznik, brak cache, limit 25 MB; Dokumenty/Arkusze/Prezentacje/Rysunki Google eksportowane do PDF.
- Zapis rozliczeń zachowuje wybraną inwestycję. Przy błędzie formularz pozostaje wypełniony.
- Ekran konfiguracji przy braku zmiennych Supabase, polskie opisy i responsywny układ.
- Testy polityki pobierania (z atrapami usług). Nie zastępują testów RLS na rzeczywistej bazie.

## Uruchomienie

Node.js 22 lub nowszy, `npm ci`, następnie `npm run dev`.

1. Utwórz projekt Supabase w regionie UE.
2. Dla NOWEJ bazy wykonaj `supabase/schema.sql` w SQL Editor dokładnie raz.
3. Dla istniejącej bazy z wersji 0.1 wykonaj kolejno `supabase/migrations/002_document_downloads.sql` i `supabase/migrations/003_function_permissions.sql`. Główny schema.sql nie jest migracją i nie należy uruchamiać go ponownie.
4. Skopiuj `.env.example` do `.env.local`. Wprowadź adres projektu i klucz publiczny anon. Nigdy nie używaj service_role w kodzie przeglądarki.
5. Włącz potwierdzanie e-mail w Supabase Authentication i ustaw Site URL / Redirect URLs na adres aplikacji.
6. Zarejestruj i potwierdź swój adres e-mail. W Supabase Authentication odczytaj UUID właściwego użytkownika. Nadaj mu rolę administratora ręcznie w SQL Editor:

```sql
update public.profiles set role='admin', status='approved'
where id='<UUID ZWERYFIKOWANEGO KONTA ADMINISTRATORA>';
```

Klient nie może nadać sobie uprawnień administratora.

## Google Drive

1. W projekcie Google Cloud włącz Google Drive API i utwórz konto usługi.
2. Udostępnij temu kontu jako Oglądającemu tylko foldery przeznaczone dla portalu. Klienci nie potrzebują publicznych linków ani bezpośrednich uprawnień do Drive.
3. Wprowadź po stronie serwera `GOOGLE_SERVICE_ACCOUNT_EMAIL` i `GOOGLE_PRIVATE_KEY`. Klucz może zawierać rzeczywiste nowe linie albo zapis `\n`. Nie dodawaj kluczy do GitHub ani nie przesyłaj ich w rozmowie.
4. Dodając inwestycję, podaj ID jej folderu Drive. Pliki muszą znajdować się bezpośrednio w tym folderze (podfoldery i skróty nie są obsługiwane).
5. Wybierz inwestycję, dodaj tytuł i ID pliku, zapisz szkic, sprawdź pobranie, następnie opublikuj dokument klientowi.
6. W obecnej wersji lista plików nie synchronizuje się automatycznie. Konto usługi nie ma prawa zapisu do Drive.

## Vercel

Repozytorium `prohous-portal`: Framework Next.js, Root Directory katalog zawierający package.json, Build Command `npm run build`.

Dodaj dwie zmienne NEXT_PUBLIC_SUPABASE_* oraz, gdy chcesz uruchomić dokumenty, dwie zmienne GOOGLE_* z `.env.example`. Klucze Google wyłącznie w środowisku serwerowym. Ponów Deploy po zmianie zmiennych publicznych. Skonfiguruj Supabase URL po uzyskaniu adresu wdrożenia. Domena klient.prohous.pl pozostaje osobnym krokiem DNS.

## Sprawdzenie

- `npm test`: polityka dostępu do pobierania, odmowa bez sesji, odmowa przy braku dokumentu widocznego przez RLS, inny folder, limit pliku, audyt i brak ujawniania błędów usług.
- `npm run typecheck`
- `npm run build`
- Przed udostępnieniem klientom: na docelowej bazie sprawdź dwa różne konta klientów, konto oczekujące i administratora. Klient A nie może czytać inwestycji, dokumentów, zakupów ani operacji klienta B. Konto oczekujące nie może czytać danych inwestycji. Szkice widzi tylko administrator.

## Pozostały zakres

Brak automatycznego importu faktur i synchronizacji folderów, automatycznej księgowości zakupów, korekt finansowych, eksportów rozliczeń oraz wielu klientów na inwestycję. Zakup to pozycja informacyjna; saldo zmienia wyłącznie operacja finansowa administratora. Należy unikać podwójnego księgowania.

Do wdrożenia produkcyjnego pozostają testy integracyjne na usługach docelowych, MFA administratora, ograniczanie ruchu przy pobieraniu (np. na Vercel), kopie zapasowe i polityka prywatności. Aplikacja używa sesji Supabase w przeglądarce; serwer pobierania sprawdza token przy każdym żądaniu. Nie wdrożono sesji HttpOnly/SSR. Nie zaimportowano danych klientów ani nie utworzono kont/projektów w usługach zewnętrznych.
