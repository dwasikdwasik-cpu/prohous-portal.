# PROHOUS Portal Klienta — wersja developerska

Aplikacja Next.js + Supabase (PostgreSQL/Auth/RLS). Wymaga konfiguracji przed uruchomieniem. Nie jest produkcyjnym wdrożeniem.

## Uruchomienie lokalne
1. Zainstaluj Node.js 20+.
2. `npm install`
3. Utwórz projekt Supabase. W SQL Editor wykonaj `supabase/schema.sql`.
4. Skopiuj `.env.example` do `.env.local` i uzupełnij `NEXT_PUBLIC_SUPABASE_URL` i `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
5. W Supabase Auth włącz weryfikację adresu e-mail i skonfiguruj URL aplikacji.
6. Zarejestruj konto administratora. Po zweryfikowaniu tożsamości administratora nadaj rolę wyłącznie ręcznie w SQL Editor: `update public.profiles set role='admin',status='approved' where id='<ZWERYFIKOWANE_UUID>';`. Nigdy nie pozwalaj klientom nadawać sobie roli admin.
7. `npm run dev` i otwórz http://localhost:3000.

## Co już działa po konfiguracji
- Rejestracja, logowanie i status konta oczekującego na zatwierdzenie.
- Panel admina: zatwierdzanie klientów, dodawanie inwestycji i przypisywanie do klienta.
- Panel klienta: inwestycje, salda z operacji, lista zakupów i metadane dokumentów.
- Ochrona danych inwestycji przez PostgreSQL Row Level Security.
- Historia zmian w wybranych tabelach.

## Co wymaga dokończenia PRZED dopuszczeniem klientów
- Integracja Google Drive: konto usługi/OAuth, dostęp do wskazanych folderów, skan plików i zatwierdzanie publikacji. Tabela `documents` jest gotowa na metadane. Pobieranie plików w `/api/document/[id]` celowo zwraca 501, aby nie udostępniać prywatnych plików bez serwerowej autoryzacji.
- Zabezpieczenie sesji po stronie serwera, pobieranie plików przez proxy po sprawdzeniu RLS, ochrona przed nadmiernym ruchem, logi pobrań.
- Powiązanie zakupów z fakturami, import i walidacja danych z faktur, workflow zatwierdzania wydatków; obecnie wydatki księguje administrator ręcznie.
- Korekty, przypisanie wielu klientów do jednej inwestycji, eksport raportów, pełna historia korekt finansowych.
- Testy E2E i bezpieczeństwa, MFA administratorów, kopie zapasowe, retencja i polityka RODO.
- Hosting, konfiguracja DNS/TLS domeny `klient.prohous.pl`, polityka prywatności.

**Ważne:** To kod działającego szkieletu MVP po konfiguracji usług, nie ukończony ani opublikowany system produkcyjny. Nie podłączono Google Drive i nie zaimportowano prawdziwych danych klientów.
