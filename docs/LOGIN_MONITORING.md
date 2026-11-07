# Historia logowań do portalu

Zakres zmiany do zatwierdzenia: nowa zakładka „Historia logowań” dla zatwierdzonego administratora i menedżerki, prywatny rejestr sesji oraz funkcja jego odczytu. Bez zmian widoczności sald i dokumentów.

## Działanie

Supabase Auth tworzy rekord w `auth.sessions` podczas udanego uwierzytelnienia. Wyzwalacz `portal_capture_login` zapisuje jeden wpis na sesję: identyfikator konta i sesji, e-mail, nazwę użytkownika, rolę i status konta w tej chwili, początek sesji, czas zapisu, IP i przeglądarkę (jeśli Auth je dostarcza). Nie zapisuje haseł ani tokenów. Odnowienie tokenu i odświeżenie strony nie tworzą wpisów.

Historia dotyczy utworzenia uwierzytelnionej sesji; nie jest rejestrem nieudanych prób, obecności online, ani dowodem, że niezatwierdzone konto uzyskało dostęp do inwestycji. Wpisy zachowują się po wylogowaniu i usunięciu konta. Nie dodajemy historycznych wpisów ani automatycznego kasowania historii. Widok ma wyszukiwanie osoby/e-maila, okres 7/30/90 dni lub całą historię, stronicowanie po 50 pozycji i odświeżanie co minutę. Godziny są podawane w strefie Europe/Warsaw.

Tabela jest w niewystawionym schemacie `private`, z RLS i bez bezpośrednich uprawnień użytkowników. Publiczna funkcja odczytu jest SECURITY INVOKER; prywatna, wąska funkcja sprawdza zatwierdzoną rolę admin/manager oraz istniejącą sesję przypisaną do `auth.uid()`. Użytkownik nie może przekazać własnego aktora ani sfałszować wpisu przez RPC. Wyzwalacz ma stały pusty search_path. Awaria zapisu audytu emituje stałe ostrzeżenie w logach bazy i nie blokuje tworzenia sesji; taki wpis może być utracony.

## Wdrożenie po zatwierdzeniu

1. Sprawdzić, czy `portal_capture_login`, `private.portal_login_events` oraz funkcje `portal_login_history` nie istnieją. Skrypt instalacyjny jest jednorazowy i celowo nie nadpisuje historii.
2. Zastosować `supabase/login-monitoring.sql` jako zatwierdzoną zmianę bazy, zarejestrować migrację `portal_login_monitoring` i uruchomić doradców bezpieczeństwa. Skrypt jest transakcyjny.
3. Scalić zatwierdzony PR do main, sprawdzić automatyczne wdrożenie Vercel i `/api/health`.
4. Sprawdzić nowe rzeczywiste logowanie i zakładkę „Historia logowań” na koncie administratora lub menedżerki. Obecnie otwarte sesje nie są wstecznie wpisywane; potrzebne jest nowe logowanie. Sprawdzić brak uprawnień klienta do funkcji odczytu.

## Weryfikacja przed wdrożeniem

`npm test`: test PGlite sprawdza zapis przez rolę usługi Auth, brak duplikatów po aktualizacji sesji, niezmienność danych historycznych, wyszukiwanie, filtr czasu, stabilne stronicowanie, ograniczenia klientów i wykonawców, odmowę dla kont oczekujących/zablokowanych, unieważnionej/cudzej sesji administratora i anonimowego użytkownika, brak bezpośredniego zapisu oraz zachowanie logowania przy awarii audytu. `npm run build` sprawdza kompilację i typy.

Automatyczny test interfejsu z atrapą RPC został przygotowany poza repozytorium, ale uruchomienie Chromium w tym środowisku blokuje błąd systemowy `socket() failed: Operation not permitted`. Nie jest to zaliczony test przeglądarkowy. Rzeczywisty przepływ Supabase Auth → rejestr → widok wymaga weryfikacji po zatwierdzonym wdrożeniu.

## Wycofanie

Po odrębnym zatwierdzeniu wyłączyć wyzwalacz `portal_capture_login` na `auth.sessions` i wycofać komponent oraz wpis menu. Zachować prywatną tabelę i istniejące wpisy; wycofanie interfejsu nie powinno usuwać audytu. Nie zmieniać pozostałych wyzwalaczy Auth.
