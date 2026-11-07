# Ręczne ustawianie salda inwestycji

## Zakres do zatwierdzenia

- `app/BalanceEditor.tsx`: formularz docelowego salda i wewnętrzna historia ostatnich 50 korekt, tylko dla administratora.
- `app/page.tsx`: formularz w zakładkach „Saldo i rozliczenia” oraz „Zarządzanie”, odczyt aktualnego salda z bazy zamiast liczenia go wyłącznie z widocznej historii.
- `supabase/manual-balance.sql`: prywatny rejestr korekt, chronione funkcje ustawiania/odczytu salda i historii oraz blokada inwestycji przy księgowaniu, synchronizująca korekty z wpłatami i fakturami.
- `tests/manual-balance.test.mjs`: test integracyjny zachowania i uprawnień.

## Zachowanie

Administrator wybiera inwestycję i wpisuje kwotę docelową w PLN. Obsługiwane są kwoty dodatnie, zero i ujemne, maksymalnie dwa miejsca po przecinku i wartość bezwzględna do 999 999 999 999,99 PLN. Zapis wymaga potwierdzenia wyświetlanej kwoty.

Przykład: bieżące saldo 20 000 PLN, administrator wpisuje 15 000 PLN — nowe saldo to 15 000 PLN. Późniejsza faktura 1 000 PLN daje saldo 14 000 PLN. Usunięcie zaksięgowanej faktury odwraca jej koszt zgodnie z dotychczasową logiką.

Korekta jest oddzielona od księgi wpłat i wydatków. Klient nie otrzymuje wpisu o korekcie w historii ani dostępu do rejestru korekt przez API. Zobaczy aktualną kwotę wyłącznie, gdy administrator włączył widoczność salda tej inwestycji. Dotychczasowe wpłaty, wydatki i ich historia pozostają bez zmian; ich prosta różnica może odbiegać od ręcznie ustawionego salda. Klient może dostrzec zmianę kwoty, ale nie zobaczy szczegółów korekty.

Menedżerka, elektryk, hydraulik, klienci oraz konta oczekujące/zablokowane nie mogą ustawiać salda ani odczytywać rejestru korekt. Administrator musi mieć zatwierdzony profil i istniejącą własną sesję Auth. Kontrola jest po stronie bazy, niezależnie od interfejsu. Dane audytu (kto, kiedy, poprzednia i docelowa kwota, różnica) są niezmienne dla użytkowników i zachowane w prywatnym schemacie z RLS. Publiczne RPC mają SECURITY INVOKER; wąskie prywatne funkcje podwyższają uprawnienia po sprawdzeniu dostępu. Pomocnicze funkcje obliczeniowe nie są wywoływalne przez użytkowników.

Zapis blokuje wiersz inwestycji i porównuje aktualną kwotę z odczytaną przez administratora. Przy nieaktualnym saldzie nie zapisuje korekty i żąda ponownego sprawdzenia kwoty. Wpłaty i faktury korzystają z tej samej blokady. Zapis identycznej kwoty jest operacją pustą. Dane pieniężne są liczone w bazie jako NUMERIC.

## Wdrożenie po zatwierdzeniu

1. Sprawdzić brak `private.balance_adjustments`, nowych funkcji oraz wyzwalacza `ledger_balance_lock`.
2. Zastosować jednorazowy, transakcyjny `supabase/manual-balance.sql` jako zarejestrowaną migrację `manual_investment_balance`. Nie zmienia istniejących kwot ani nie dopisuje historycznych korekt.
3. Sprawdzić RLS, przydziały uprawnień, wyzwalacz i doradców bezpieczeństwa.
4. Scalić PR i zweryfikować automatyczne wdrożenie. Odświeżyć portal, by używał nowej funkcji odczytu salda.
5. Rzeczywiste ustawienie kwoty na koncie klienta wymaga wskazania inwestycji i kwoty przez właściciela. Nie wprowadzać testowych korekt finansowych na kontach klientów.

## Testy i ograniczenia weryfikacji

`npm test`: pełny zestaw oraz nowy test PGlite sprawdzają ustawienie dokładnej kwoty, brak wpisu w historii klienta, blokady ról, aktywną własną sesję, prywatność audytu, widoczność salda, inne inwestycje, kwoty zerowe/ujemne, odrzucenie NaN/nieskończoności/nadmiarowej precyzji, konflikt starego odczytu, brak duplikatów i dalsze księgowanie faktur/wpłat oraz usuwanie/przywracanie faktur.

`npm run build` obejmuje kompilację i sprawdzenie typów. Test w przeglądarce nie został wykonany: wcześniej potwierdzono blokadę startu Chromium (`socket() failed: Operation not permitted`). Rzeczywisty zapis finansowy na produkcji nie jest częścią testów bez wskazanej inwestycji i kwoty.

## Wycofanie

Można wyłączyć formularz po zatwierdzeniu. Po pierwszej korekcie trzeba zachować odczyt salda uwzględniający korekty; powrót do liczenia wyłącznie z księgi pokazałby niepoprawną kwotę. Nie usuwać rejestru ani kompensować korekt bez osobnej zgody właściciela.
