# Ręczne doliczenie duplikatu faktury

Administrator widzi przy fakturze o statusie `duplicate` przycisk „Dolicz kwotę — Duplikat” w liście faktur/dokumentów oraz w edycji plików w Zarządzaniu. Potwierdzenie pokazuje kwotę brutto i nazwę inwestycji. Ta operacja ponownie odejmuje kwotę od salda, nawet jeśli oryginalną fakturę rozliczono wcześniej. Dotyczy jednej wgranej kopii, nie wszystkich kopii tej samej faktury.

Automatyczne rozpoznawanie duplikatów pozostaje włączone. Ponowne przesłanie samo nie nalicza kosztu. Nie usuwamy ani nie zmieniamy indeksów `ledger_document_once`, `ledger_invoice_once` i `ledger_upload_once`. Każda nowa kopia wymaga oddzielnej świadomej decyzji administratora.

## Zakres

- `app/page.tsx`: przycisk wyłącznie dla administratora, potwierdzenie kwoty/inwestycji, wywołanie RPC i odświeżenie salda.
- `supabase/duplicate-invoice-charge.sql`: nowa prywatna tabela audytu i publiczne SECURITY INVOKER RPC delegujące do wąskiej funkcji prywatnej. Instalacja jest jednorazowa, transakcyjna, bez księgowania istniejących faktur.
- `tests/duplicate-invoice-charge.test.mjs`: test integracyjny aktualnej bazy i uprawnień.

## Zabezpieczenia

Funkcja wymaga zatwierdzonej roli `admin` i istniejącej własnej sesji Auth (dotychczasowe `private.can_manage_balance`). Menedżerka, klienci, wykonawcy, pracownik, konta oczekujące/zablokowane i anonimowi nie mogą z niej skorzystać. Kwota, data i numer pochodzą z bazy, nie z wartości do zaksięgowania przesłanej przez przeglądarkę. Wartość z interfejsu jest tylko kontrolą, że administrator potwierdził aktualną kwotę; zmiana danych powoduje odmowę bez obciążenia.

Wymagana jest aktywna, nieusunięta faktura w podanej inwestycji, dodatnia skończona kwota brutto, PLN, numer i data oraz status niezaksięgowanego duplikatu. Inwestycja nie może być usunięta ani w trakcie trwałego usuwania. Funkcja blokuje wiersz dokumentu, a potem inwestycji — zgodnie z kolejnością istniejącego księgowania. Nie omija blokady księgi przy usuwaniu inwestycji.

Powstaje normalny wydatek powiązany z ID tej kopii i notatką „Duplikat — doliczony ręcznie: [numer]”. Celowo pomija kanoniczne klucze numeru/hasza, aby zatwierdzić tylko ten wyjątek. Unikalne ID dokumentu i prywatny rejestr zapewniają jeden dodatkowy wydatek na kopię. Powtórne kliknięcie/ponowienie żądania zwraca informację, że kopię już doliczono. Status zmienia się na `booked`, więc przycisk znika i dane finansowe dokumentu zostają objęte dotychczasową blokadą edycji.

Prywatny audyt przechowuje dokument, wpis księgi, inwestycję, kwotę, administratora, snapshot e-maila i czas. RLS jest włączone; użytkownicy nie mają bezpośredniego dostępu do tabeli. Standardowy audyt księgi i dokumentów pozostaje. Klient z włączoną widocznością rozliczeń zobaczy zwykły wydatek; nie dodajemy ukrytej korekty salda.

Usunięcie tej kopii do kosza anuluje jej koszt dokładnie raz. Przywrócenie odtwarza koszt dotychczasowym mechanizmem i nie pozwala kolejny raz obciążyć tej samej kopii przyciskiem. Ręcznie ustawione saldo nadal uwzględnia następne wydatki. Trwałe usunięcie całej inwestycji usuwa też związane rekordy nowego audytu przez kaskadę FK.

## Wdrożenie po akceptacji

1. Sprawdzić brak nowej tabeli i funkcji oraz obecność wcześniejszych funkcji salda i trwałego usuwania.
2. Zastosować SQL jako zarejestrowaną migrację `duplicate_invoice_charge`. Sprawdzić doradców oraz uprawnienia.
3. Scalić PR, poczekać na Vercel READY i sprawdzić opublikowaną wersję.
4. Rzeczywiste obciążenie istniejącej inwestycji wykonać dopiero po wskazaniu faktury przez właściciela lub potwierdzeniu w aplikacji; nie księgować testowych kwot klientom.

## Weryfikacja

Nowy test PGlite sprawdza ponowne przesłanie po usunięciu oryginału, duplikaty po numerze/haszu, dokładność kwoty, ponowienie tej samej operacji, zwykłe księgowanie po wyjątku, blokadę modyfikacji zaksięgowanej kopii, kosz/przywracanie, ręczne saldo, zmianę kwoty po odczycie, walutę i kwotę zerową, inne inwestycje, uprawnienia ról i sesji oraz kaskadę przy trwałym usuwaniu inwestycji. Sprawdzenie typów i kompilacja obejmują oba miejsca przycisku. Test interakcji przeglądarkowej nie był wykonany.
