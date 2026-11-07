# Konto projektowe pracownika i trwałe usuwanie w portalu

## Zakres

1. Login `pracownik`, czterocyfrowy kod wybrany przez właściciela, dostęp tylko do udostępnionych projektów wszystkich aktywnych inwestycji. Bez zdjęć instalacji, faktur, sald, danych innych profili, dodawania/zmieniania plików i panelu administracyjnego. Odczyt i pobieranie projektów działają przez dotychczasowy autoryzowany endpoint.
2. „Pliki inwestycji” domyślnie zwinięte, z rozwijaniem nagłówkiem. Wcześniej wdrożone rozwijane „Konta klientów i wykonawców” i kosz zostają zachowane.
3. Administrator może trwale usunąć konto klienta, elektryka, hydraulika lub pracownika po wpisaniu dokładnego e-maila. Własnego konta, administratorów i menedżerów nie można usunąć tą funkcją.
4. Administrator może trwale usunąć inwestycję z kosza po wpisaniu dokładnej nazwy. Operacja obejmuje dane inwestycji, jej dokumenty w portalu, wpłaty, wydatki, korekty salda, dawną listę zakupów, historię pobrań związanych z usuwanymi plikami i oryginały przesłane do prywatnego Storage portalu. Pliki źródłowe Google Drive pozostają bez zmian.

## Logowanie pracownika

Nie obniżamy globalnej polityki haseł Supabase. Kod jest sprawdzany w osobnej funkcji `project-employee-login` z `verify_jwt=false`, ponieważ użytkownik nie ma jeszcze sesji. Funkcja wykonuje własne uwierzytelnienie kodem; RPC sprawdzające kod jest dostępne wyłącznie roli usługi. Kod jest przechowywany jako bcrypt w prywatnej tabeli. Nie należy umieszczać rzeczywistego kodu w repozytorium, logach ani komunikatach błędu.

Po 10 nieudanych próbach wspólne konto jest blokowane na pozostałą część 15-minutowego okna. Limit jest trwały w bazie, wspólny dla wszystkich adresów IP. Poprawne logowania nie kasują licznika nieudanych prób. Czterocyfrowy kod jest wspólnym dostępem wybranym przez właściciela; historia logowań identyfikuje konto „Pracownik”, a nie poszczególne osoby.

Przy pierwszym poprawnym logowaniu funkcja tworzy przez oficjalne Auth Admin API jedno potwierdzone konto techniczne `pracownik@prohous.pl`, ustawia profil `employee/approved` i wiąże jego ID z konfiguracją. Nie wysyła zaproszenia ani wiadomości e-mail. Jeśli adres zajmuje konto o innej roli lub statusie, nie przejmuje go i nie zmienia jego uprawnień. Po związaniu ID nie tworzy innego konta. Każde logowanie sprawdza zatwierdzenie profilu przed wydaniem sesji i po nim.

Wewnętrzne hasło Auth jest HMAC wyprowadzonym z serwerowego klucza Supabase i nigdy nie trafia do przeglądarki. Właściwe tokeny sesji powstają przez standardowy Supabase Auth. Przeglądarka dostaje tylko tokeny pracownika i przechowuje sesję przez SDK. Rotacja serwerowego klucza wymaga odrębnej aktualizacji wewnętrznego hasła tego konta. Zmiana samego kodu nie unieważnia istniejących sesji; zablokowanie profilu natychmiast odbiera dostęp przez RLS. Trwałe usunięcie konta usuwa jego sesje i wyłącza kod, żeby konto nie odtworzyło się automatycznie.

RLS udostępnia pracownikowi wyłącznie opublikowane, nieusunięte dokumenty `projekty`, bez pól faktury/kwoty/dostawcy, z aktywnych inwestycji. Rola nie jest dodawana do istniejącego helpera instalatorów, więc nie otrzymuje praw do zdjęć ani uploadu. Klient nie może nadać sobie tej roli; sprawdzamy zaufany profil w bazie, nie user_metadata.

## Trwałe usuwanie kont

Funkcja `portal-permanent-removal` wymaga ważnej sesji i zatwierdzonego profilu administratora. Żądanie przygotowujące w bazie ponownie sprawdza administratora, jego aktywną sesję, dokładny e-mail i dozwoloną rolę konta. Przed usunięciem użytkownika Auth wyzwalacz jeszcze raz sprawdza te warunki i blokuje wyścig ze zmianą roli/e-maila lub odebraniem uprawnień administratorowi. Następnie konto jest usuwane przez Auth Admin API, wraz z sesjami i profilem.

Inwestycje pozostają bez przypisanego klienta. Dokumenty, pliki, saldo i rozliczenia pozostają zachowane. Referencje autora w dokumentach/księdze i użytkownika w historii pobrań stają się puste; historyczne logi audytu pozostają. Własność metadanych plików z bucketu portalu jest zdejmowana, bez usuwania plików. Innych bucketów i schematu obecności nie zmieniamy. Ich referencje mogą bezpiecznie zablokować usunięcie konta; wtedy konto pozostaje, a właściciel musi rozstrzygnąć zależność oddzielnie. Jeśli samo usunięcie Auth nie powiedzie się, przygotowane metadane właściciela plików mogą już być wyczyszczone; pliki i odczyt przez przypisane dokumenty zostają zachowane.

To jest usuwanie konta, a nie automatyczne kasowanie całej dokumentacji inwestycji lub realizacja żądania usunięcia wszystkich danych osobowych. Prywatne rejestry audytu zachowują historyczny identyfikator oraz snapshot e-maila tam, gdzie rejestrowano go wcześniej.

## Usuwanie inwestycji z kosza

Najpierw wymagane są kosz, dokładna nazwa i aktywna sesja administratora. Rozpoczęcie ustawia blokadę `purge_started_at`, zapisuje prywatny audyt i zwraca ścieżki plików z bazy. Po rozpoczęciu nie wolno przywrócić inwestycji, edytować dokumentów ani dodawać wpisów księgi. Nie ufamy ścieżkom z żądania przeglądarki.

Funkcja serwerowa usuwa pliki Storage partiami po 100. Dopiero potem uruchamia usługową funkcję finalizacji, która ponownie sprawdza administratora i sesję oraz brak plików w Storage. Finalizacja transakcyjnie usuwa inwestycję i zależne rekordy. Zachowuje tylko prywatny audyt nazwy, liczby dokumentów/operacji, administratora i czasu.

Awaria Storage lub finałowej transakcji nie jest zgłaszana jako sukces. Inwestycja pozostaje w koszu jako „Usuwanie rozpoczęte”; administrator ponawia tę samą operację. Część plików może już być nieodwracalnie usunięta. Nie ma przywracania rozpoczętej operacji. Inne inwestycje i oryginały Google Drive nie są usuwane.

## Kolejność wdrożenia po zatwierdzeniu

1. Sprawdzić bazę i brak kolidujących funkcji/tabel/nazw Edge Functions. Obecna produkcja ma migracje wcześniejszych funkcji salda i logowania, pgcrypto w schemacie extensions; nie ma jeszcze nowych tabel.
2. Zastosować jednorazowo transakcyjny `supabase/project-employee-access.sql`, a następnie `supabase/portal-permanent-removal.sql` jako zarejestrowane migracje. Instalacja nie usuwa żadnego konta, inwestycji ani pliku i nie ustawia kodu w repozytorium.
3. Wdrożyć `project-employee-login` z własnym uwierzytelnieniem kodem (`verify_jwt=false`) i `portal-permanent-removal` z kontrolą JWT (`verify_jwt=true`) z podanych plików `.mjs`, SDK przypięte do 2.119.0. Korzystają wyłącznie z wbudowanych sekretów Supabase; klucz usługi nie trafia do Vercel ani przeglądarki.
4. W osobnym zatwierdzonym zapisie ustawić bcrypt wybranego przez właściciela kodu w `private.project_employee_login` oraz wyzerować licznik prób/okno. Nie drukować wartości hasha ani kodu.
5. Sprawdzić uprawnienia i doradców, scalić PR, sprawdzić wdrożenie Vercel i /api/health. Konto techniczne zostanie utworzone dopiero przez pierwsze poprawne logowanie.
6. Sprawdzić rzeczywiste logowanie pracownika. Nie usuwać testowo istniejących kont/inwestycji produkcyjnych bez konkretnego wskazania właściciela.

## Weryfikacja

Nowe testy PGlite obejmują pełną migrację, prawa pracownika, brak dostępu do finansów/zdjęć/uploadu, prywatność funkcji kodu, limit prób, trwałe usuwanie kont z zachowaniem inwestycji i plików, brak możliwości usunięcia administratora/menedżerki, wyścigi roli i odebrania sesji, wyłączenie kodu po usunięciu pracownika, usuwanie inwestycji wyłącznie z kosza, blokady równoległych zmian, usunięcie własnych zależności i zachowanie innych inwestycji. PGlite symuluje tylko primitive crypt; produkcja korzysta z pgcrypto bcrypt.

Testy handlerów obejmują błędny kod, rate limit, pierwsze utworzenie konta, brak przejęcia innej roli, zgodność użytkownika wydanej sesji, brak tokenów w odpowiedzi błędu, kontrolę administratora i zaniechanie finalizacji przy awarii Storage. Pełny `npm test`, suite RLS oraz `npm run build` zakończone powodzeniem. Rzeczywisty kod Edge i interakcje przeglądarkowe pozostają do weryfikacji po zatwierdzeniu; w środowisku wcześniej potwierdzono blokadę startu Chromium (`socket() failed: Operation not permitted`).
