# Kamera online — konfiguracja i wdrożenie

Administrator i menedżerka dodają kamery w Zarządzaniu lub zakładce Kamera online
dla wybranej inwestycji. Każda kamera ma nazwę, typ odtwarzania, adres HTTPS oraz
przełącznik udostępniania. Można zapisać ukryty szkic bez adresu, edytować i usunąć
kamerę oraz cofnąć udostępnienie. Domyślnie kamera jest ukryta.

Klient widzi zakładkę tylko jeśli ma udostępnioną kamerę. Baza ogranicza odczyt
do zatwierdzonego klienta przypisanego do aktywnej inwestycji. Konta wykonawców
i pracownika nie mają dostępu. Zmiana klienta, blokada profilu i kosz inwestycji
odcinają odczyt w bazie. Konfiguracja znika przy trwałym usunięciu inwestycji.
Odświeżenie istniejącej strony odbywa się po powrocie do okna lub co 30 sekund.

## Transmisja

Portal obsługuje HLS (.m3u8, natywnie Safari, hls.js w kompatybilnych przeglądarkach)
oraz osadzony odtwarzacz HTTPS (np. odtwarzacz bramki WebRTC). HLS wymaga CORS dla
portalu na manifestach, segmentach i kluczach; iframe wymaga zezwolenia na osadzanie
przez dostawcę. Start następuje dopiero na żądanie, a zatrzymanie lub opuszczenie
sekcji usuwa odtwarzacz i połączenia. Błąd HLS umożliwia ponowienie połączenia.
Samo wczytanie iframe nie oznacza potwierdzonego działania kamery.

Tapo C500 -> Wi-Fi routera LTE z SIM -> dostępna z internetu bramka transmisji
RTSP do HTTPS -> adres HLS lub osadzanego odtwarzacza w portalu. Bramka musi mieć
dostęp do kamery, np. przez prywatne połączenie wychodzące z budowy. Zwykły router
LTE nie gwarantuje publicznego adresu ani możliwości takiego połączenia.
Wymagane urządzenie/bramka i hosting transmisji są osobnym etapem, po zakupie
kamery. Vercel i ta zmiana nie konwertują RTSP ani nie zestawiają tunelu LTE.

Nie zapisujemy loginu i hasła RTSP w portalu. Adres podglądu HTTPS jest przekazywany
przeglądarce uprawnionego użytkownika. RLS chroni konfigurację i dostęp w portalu,
ale nie unieważnia skopiowanego adresu u dostawcy. Dla prywatnego obrazu bramka
musi dodatkowo autoryzować widza / wydawać krótkotrwałe linki. Nie używać stałych
publicznych adresów jako zabezpieczenia. Cofnięcie udostępnienia nie unieważnia
takiego publicznego adresu. Nie wstawiać adresu panelu administracyjnego kamery.

## Zakres do zatwierdzenia przed wdrożeniem produkcyjnym

1. Nowa tabela `investment_cameras` z RLS, indeksem i kasowaniem kaskadowym.
2. Nowa sekcja w Zarządzaniu i pozycja Kamera online w menu uprawnionych kont.
3. Odtwarzacz HLS i iframe oraz zależność hls.js (dokładna wersja w lockfile).
4. Bez zmian DNS, sald, faktur i istniejących przypisań klientów. Nie dodajemy
   żadnych rzeczywistych kamer ani adresów transmisji.

Kolejność: zatwierdzenie -> migracja bazy -> publikacja aplikacji. Przy wycofaniu
wersji aplikacji można pozostawić pustą tabelę. Test rzeczywistego podglądu wymaga
skonfigurowanej kamery i bramki; bez nich nie można potwierdzić połączenia end to end.
