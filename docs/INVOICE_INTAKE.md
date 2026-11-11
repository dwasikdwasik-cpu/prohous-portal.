# Obsługa faktur ze skanera

Menu **Obsługa faktur** jest dostępne dla administratora, menedżerki i wyznaczonych kont z rolą **Obsługa faktur** (`invoice_clerk`). W Zarządzaniu administrator wybiera tę rolę dla indywidualnego, zatwierdzonego konta pracownika. Ogólny login `pracownik` zachowuje dostęp wyłącznie do projektów. Konto obsługi faktur widzi kolejkę i nazwy klientów/inwestycji, bez sald i historii rozliczeń. Przypisane przez nie faktury wymagają zatwierdzenia księgowania przez administratora. Administrator/menedżerka korzystają z istniejącego automatycznego księgowania i wykrywania duplikatów.

Folder: https://drive.google.com/drive/folders/1yIbjkSP3tsa4XsWVxlNMNia5Ah3SqmV4 (SCAN - FA). Czytamy tylko pliki bezpośrednio w tym folderze, bez podfolderów i skrótów. Skany PDF, JPG, PNG, WEBP do 25 MB, jedna faktura w jednym pliku; faktura może mieć kilka stron. Pliki z różnymi numerami faktur wymagają ręcznego rozdzielenia/sprawdzenia przed przypisaniem.

1. Pracownik skanuje dokumenty do folderu.
2. W portalu klika **Pobierz i rozdziel faktury**. Import działa podczas otwartej strony i odczytuje wszystkie strony faktury w istniejącym lokalnym OCR. Nie jest zadaniem w tle po zamknięciu przeglądarki.
3. Automatyczne dopasowanie wymaga jednej pełnej nazwy klienta lub inwestycji w nazwie pliku albo sekcji odbiorcy/dostawy. Dane sprzedawcy ani sam NIP firmy Prohouse nie stanowią dopasowania. Wiele inwestycji tego samego klienta również wymaga wyboru.
4. Przy niejednoznacznym dopasowaniu lub odczycie operator sprawdza podgląd, wybiera **klienta i inwestycję**, uzupełnia dane i potwierdza przypisanie całego pliku.
5. Skany trafiają do prywatnego magazynu roboczego. Kopia przeznaczona dla klienta jest odczytywana ponownie i porównywana SHA-256. Dokument i przypisanie zapisują się jedną transakcją. Import tego samego pliku i wersji nie tworzy drugiego dokumentu.
6. Dopiero po sprawdzeniu dokumentu, przypisania i obu kopii (oryginału oraz pliku w portalu) serwer usuwa skan z folderu. Przy prawie `canTrash` przenosi go do kosza, w pozostałych przypadkach usuwa wyłącznie powiązanie z folderem skanera (`removeParents`). Nie wykonuje trwałego DELETE. Aktualizacja jest warunkowa (ETag / If-Match), aby nie usunąć zmienionego w międzyczasie skanu.
7. Brak dostępu, zmieniony plik, inna suma kontrolna, nieaktywny klient lub usunięta faktura blokują usunięcie oryginału. Dokument już zaimportowany ma przycisk **Ponów usunięcie z folderu** — bez ponownego księgowania.

## Dostęp Google

Konto Google serwera (`GOOGLE_SERVICE_ACCOUNT_EMAIL`) musi mieć uprawnienie **Edytor** do tego konkretnego folderu, w tym możliwość usunięcia pliku z folderu. Dostęp publiczny „każdy z linkiem: czytelnik” nie daje kontu serwera prawa usuwania. Nie trzeba tworzyć nowego klucza prywatnego. Używana jest istniejąca federacja Vercel → Google, z oddzielnym krótkotrwałym zakresem `drive.metadata` dla sprzątania. Standardowe pobrania nadal używają `drive.readonly`.

Widoczność finansów dla klientów pozostaje zgodna z ustawieniami inwestycji; import nie zmienia przełączników faktur ani salda. Skany i odczytane dane nie są umieszczane w publicznym repozytorium. Kopia robocza jest zachowana jako zabezpieczenie przed przerwaniem importu. Puste foldery nie wymagają żadnych operacji kasowania.

## Migracja i testy

Zastosuj `supabase/migrations/20261111171546_invoice_intake.sql` po wcześniejszej konfiguracji ról pracownika. Dodaje kolejkę, prywatny bucket i wąskie procedury importu. Zwykły klient, wykonawca, konto oczekujące i ogólny pracownik nie mają dostępu.

`npm test`, `npm run typecheck`, `npm run build`. Testy obejmują izolację uprawnień, brak dostępu do sald dla operatora, idempotencję, wyścig przypisania, niepoprawne kopie, zmianę skanu i błędy usuwania. Końcowy test na prawdziwym skanie wymaga pliku w folderze oraz nadanych kontu serwera uprawnień Edytora.

## Kontrola jakości odczytu

Najpierw czytane są wszystkie strony oryginalnego PDF, z kontrolą układu tekstu i współrzędnych. Data wystawienia jest rozpoznawana jako konkretne pole; wzmianki w terminie płatności nie tworzą drugiej daty. Numer KSeF nie zastępuje numeru faktury.

Skany są przetwarzane w większej rozdzielczości, z ograniczeniem pamięci telefonu, prostowaniem i dodatkową kontrolą kontrastu. Dwa tryby rozpoznawania oraz położenie słów pomagają odtworzyć tabele VAT. Gorszy drugi odczyt nie usuwa poprawnie odczytanych wartości. Niepewne wartości pozostają propozycjami do sprawdzenia, a sprzeczne numery, daty i kwoty blokują automatyczne księgowanie. OCR ma ograniczony czas pracy i zwalnia pamięć po każdej stronie.

Jeżeli po wcześniejszym błędzie faktura czeka w kolejce, wybierz **Odczytaj ponownie**. Odczyt nie gwarantuje rozpoznania każdego układu ani nieczytelnego zdjęcia; przy braku potwierdzenia kwot w podsumowaniu potrzebna jest weryfikacja ręczna.

### Usuwanie w Obsłudze faktur
Przycisk **Usuń fakturę** jest dostępny przy nieprzypisanym skanie oraz (dla administratora lub menedżera) przy fakturze zapisanej u klienta. Wymaga potwierdzenia. Skany są wycofywane z kolejki z zachowaniem identyfikatora źródła i wersji, więc synchronizacja nie dodaje ich ponownie. Plik Google Drive pozostaje bez zmian. Przypisana faktura trafia do kosza inwestycji; istniejące wyzwalacze cofają jej zaksięgowane koszty dokładnie raz. Można ją przywrócić w Zarządzaniu, w koszu plików inwestycji. Usunięta pozycja nie pozwala na dalszy odczyt, import ani automatyczne czyszczenie folderu ze starego okna przeglądarki.

### Pełna lista klientów i podgląd przypisania
Lista korzysta z kont klientów portalu i aktywnej kartoteki CRM (`ph_records`, rodzaj `clients`). Wyszukiwanie obejmuje nazwę klienta i inwestycji. Brak konta logowania lub wcześniejszej inwestycji nie ukrywa klienta z kartoteki. Dopiero przy ręcznym zatwierdzeniu faktury powstaje brakująca inwestycja; jej utworzenie nie tworzy konta logowania i nie nadaje klientowi dostępu. Konta portalu oczekujące na zatwierdzenie pozostają widoczne, lecz nie można do nich importować faktur. Przy wielu inwestycjach należy wskazać właściwą pozycję.

Podgląd w Obsłudze faktur pokazuje klienta i inwestycję nad dokumentem. Niezapisany wybór jest wyraźnie oznaczony. Oryginalna zawartość PDF/zdjęcia pozostaje zachowana.

### Odczyt PDF na serwerze
Endpoint `POST /api/invoice-intake/:id/read` sprawdza uprawnienia operatora, zapisuje zweryfikowaną kopię skanu i odczytuje wszystkie strony cyfrowego PDF na serwerze. Zachowuje kontrolę numeru, daty, waluty oraz netto + VAT = brutto. Skanowane strony i obrazy kieruje do lokalnego OCR w przeglądarce. Niepełne wyniki PDF są pokazywane jako pola do weryfikacji; błąd dalszego zapisu nie usuwa już odczytanych pól. Przetestowano dwa źródłowe PDF-y KSeF w odizolowanym odczycie, bez przypisywania lub księgowania rzeczywistych dokumentów. Brak zalogowanej sesji testowej nie pozwala potwierdzić pełnego importu produkcyjnego.
