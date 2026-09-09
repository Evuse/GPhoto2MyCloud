# GPhoto2MyCloud per macOS

Applicazione grafica per pilotare **la sessione Google Foto già aperta in Chrome**:
seleziona le foto in lotti lungo l'intera timeline e invia a Chrome il vero comando
**⇧D**. Chrome salva temporaneamente lo ZIP nella sua cartella Download locale;
l'app lo estrae nella cartella `Media` sul My Cloud e infine elimina lo ZIP locale.

![Architettura](https://img.shields.io/badge/macOS-Chrome%20Extension%20%2B%20Native%20Host-4285F4)

## Una precisazione importante su “non perdere niente”

Questa implementazione segue esattamente il flusso manuale richiesto, senza Google
Takeout e senza attendere export periodici. Il file scaricato è quello fornito dal
comando Download dell'interfaccia Google Foto e non viene aperto, modificato o
ricompresso dall'app.

Tuttavia **⇧D non esporta tutte le informazioni gestite separatamente da Google**:
album, persone, commenti e alcuni metadati applicativi non vengono consegnati come
sidecar. Nessuno script che imiti il download manuale può preservare dati che Google
non include nel download. Per una copia forense completa di quei dati resta
necessario Takeout. L'app non nasconde questo limite né promette una garanzia che il
sito web non può offrire.

Anche l'interfaccia di Google Foto è privata e può cambiare senza preavviso. Il
motore interrompe il processo mostrando chiaramente l'errore invece di cancellare o
sovrascrivere file. Il limite configurabile è al massimo 500 elementi per lotto per
evitare richieste massive che Chrome/Google potrebbero rifiutare.

## Interfaccia

Il pannello laterale di Chrome è la GUI macOS dell'app e mostra:

- fase corrente, messaggio e contatore della selezione;
- due barre grafiche separate per la fase del processo e il lotto/download corrente;
- percorso del volume SMB, cartella Download locale e spazio disponibile;
- nome della cartella unica che raccoglie tutti i file estratti;
- dimensione dei lotti, ritardo tra click e attesa di caricamento della griglia;
- attivazione/disattivazione della verifica SHA-256;
- avanzamento reale file-per-file durante estrazione e pubblicazione sul NAS;
- comandi **Avvia backup** e **Interrompi**;
- registro cronologico dettagliato con orario, livello, ID selezionati, posizione di
  scorrimento, byte scaricati, nomi estratti, destinazione ed eventuali errori;
- conteggio degli identificativi scoperti e già trasferiti, con ripresa dopo un arresto;
- comando esplicito per azzerare il registro e iniziare un backup completamente nuovo.
- retry automatico con backoff, riduzione adattiva dei lotti e watchdog dei download;

Le preferenze restano nel profilo Chrome locale. Il pannello non chiede password e
non copia cookie: opera esclusivamente nella scheda `photos.google.com` già aperta.

## Installazione su MacBook

Requisiti: macOS, Google Chrome, Python 3 di sistema o installato e My Cloud già
montato via SMB (ad esempio `/Volumes/MyCloud`).

1. Fare doppio clic su `macos/Installa.command`. macOS può richiedere **Apri** dal
   menu contestuale la prima volta. L'installer chiude Chrome in modo controllato,
   installa una copia stabile, aggiorna l'eventuale profilo che puntava alla vecchia
   cartella, verifica versione e hash, quindi riapre Chrome e Google Foto.
2. Solo se Chrome mostra per la prima volta la richiesta relativa a un'estensione
   unpacked, confermarne il caricamento. Non occorre scegliere manualmente una cartella.
3. Premere l'icona GPhoto2MyCloud, impostare ad esempio
   `/Volumes/MyCloud/GooglePhotos` e premere **Verifica disco**.
4. Premere **Avvia backup** e lasciare la scheda aperta.

L'installer crea anche `~/Applications/GPhoto2MyCloud.app`. Per le esecuzioni future
avviare questa app: riapre Chrome con le opzioni necessarie a impedire la sospensione
della timeline quando si lavora in un'altra scheda o applicazione.

> La release resiliente mostra **v3.4.0** e **FINAL-PROD-3.4-AUTO-RECOVERY**. L'installer non si limita più
> a copiare il Native Host: installa l'intera estensione sotto
> `~/Library/Application Support/GPhoto2MyCloud/extension-production`, aggiorna il
> riferimento del profilo Chrome e riavvia Chrome con quella directory. Se compaiono
> ancora `2.0` o `2.1`, non è stata eseguita questa versione di `Installa.command`.

### Posso usare il Mac nel frattempo?

Sì. La scheda Google Foto **non deve essere quella attiva**: si possono usare altre
schede e altre applicazioni. L'estensione mantiene aperta una sessione DevTools per
l'intera esecuzione e abilita focus emulato, stato pagina attivo e utente non inattivo,
mentre l'installer avvia Chrome disabilitando il throttling dei renderer e dei timer
in background. In questo modo la scansione continua anche cambiando scheda. Non bisogna comunque
ricaricare o chiudere la scheda automatizzata, chiudere Chrome o mettere il Mac in stop.

L'eventuale conferma al primo avvio è un vincolo di sicurezza imposto da Chrome alle
estensioni non pubblicate sul Chrome Web Store. Non sono necessarie API Google, OAuth
aggiuntivo o configurazioni Google Cloud.

## Flusso e sicurezza dei dati

1. Il content script estrae l'identificativo stabile dal link `/photo/<id>`, deduplica
   gli ID e considera esclusivamente checkbox appartenenti alle relative tessere.
2. Seleziona ogni elemento con un click attendibile e ne controlla subito lo stato.
   La modalità Maiusc+click è stata rimossa: Google Foto non applica in modo affidabile
   la selezione a intervallo agli eventi automatizzati, anche simulando lo stato Shift.
3. Il service worker usa il protocollo Chrome DevTools per generare un evento ⇧D
   attendibile; Chrome mostra l'avviso standard mentre il debugger è collegato.
4. Chrome salva lo ZIP nella propria cartella Download. L'app non usa più i comandi
   CDP `Page/Browser.setDownloadBehavior`, incompatibili con `chrome.debugger` nelle
   versioni che restituiscono gli errori `-32000` e `-32601`.
5. L'app aspetta che `chrome.downloads` dichiari il file completo.
6. Il servizio nativo accetta il file soltanto dalla cartella locale configurata e
   accetta destinazioni NAS solo sotto `/Volumes`.
7. Estrae lo ZIP in una directory temporanea direttamente sul My Cloud, blocca path
   traversal e symlink, forza il flush e verifica SHA-256 di ogni file estratto. Il
   Native Host mantiene un canale persistente e invia alla GUI percentuale, fase,
   contatore e nome del file dopo ogni estrazione e ogni pubblicazione.
8. Pubblica tutti i file sotto l'unica cartella configurata (`Media` di default). I
   nomi originali non vengono mai modificati: un file identico viene deduplicato;
   un omonimo differente conserva il nome ed è separato sotto `_conflitti/<hash>/`.
9. Registra nome, byte, data e SHA-256 in
   `.gphoto2mycloud-history.jsonl` sul My Cloud.
10. Soltanto dopo la copia verificata registra gli ID del lotto nel profilo Chrome;
   un riavvio riparte dall'inizio della griglia e salta esattamente quegli ID.
11. Se lo ZIP contiene meno file degli elementi selezionati, il lotto viene rifiutato
    e non viene marcato completato (più file sono ammessi, ad esempio per Live Photo).
    Lo ZIP parziale viene verificato e preservato in `IncompleteArchives`, quindi il
    programma riparte dal primo ID non completato con un lotto dimezzato.

## Ripristino automatico

Premendo **Avvia**, l'intenzione di sincronizzare viene salvata nel profilo Chrome.
Resta attiva attraverso errori, ricaricamenti della scheda e riavvii di Chrome e viene
rimossa soltanto premendo **Interrompi** o dopo la scansione completa. Ogni errore di
selezione, download, Native Host, estrazione, verifica o conteggio avvia un backoff e
un nuovo tentativo. Il lotto viene dimezzato progressivamente fino a un solo elemento;
dopo i successi cresce gradualmente verso la dimensione configurata.

Un watchdog viene rinnovato a ogni avanzamento del download. Se non arrivano byte per
il numero di minuti configurato, Chrome annulla quel tentativo e l'app lo ripete. Gli
ID sono marcati completati soltanto dopo estrazione e verifica, quindi un errore non fa
saltare elementi. File già pubblicati da un tentativo parziale vengono riconosciuti
tramite SHA-256 e non duplicati nel retry.

Se il NAS viene disconnesso, l'hash non coincide o l'estrazione fallisce, il tentativo
corrente termina ma la sincronizzazione resta attiva e riprova con backoff. Lo ZIP
locale non viene eliminato finché non è stato copiato o preservato in modo verificato.

## Permessi richiesti

- `activeTab` e accesso a `photos.google.com`: selezione nella scheda attiva;
- `debugger`: invio del comando da tastiera ⇧D;
- `downloads`: attesa del completamento e individuazione del file;
- `nativeMessaging`: copia verificata sul volume SMB;
- `storage` e `sidePanel`: configurazione e GUI.

Il servizio nativo accetta messaggi unicamente dall'ID fisso dell'estensione
`mocnnikkncmfihikmbkhlmhkjegjmime`.

## Sviluppo e test

Non ci sono dipendenze npm o Python esterne:

```bash
node --test tests/planner.test.js
python3 -m unittest discover -s tests -p 'test_*.py' -v
python3 -m py_compile native-host/gphoto2mycloud_host.py
```

### Limiti noti

- Chrome può mostrare una conferma di sicurezza al primissimo caricamento di
  un'estensione non pubblicata; gli aggiornamenti successivi sono gestiti
  dall'installer nella directory stabile.
- Il download multiplo prodotto da Google è normalmente uno ZIP: viene estratto sul
  NAS. La conservazione aggiuntiva dello ZIP in `Archives` è opzionale nella GUI.
- La scansione dipende dalla struttura accessibile della griglia Google Foto. Se
  Google la modifica, l'app fallisce esplicitamente e il selettore va aggiornato.
- Non è tecnicamente possibile confrontare gli ID trovati con un conteggio ufficiale
  dell'account, perché Google non espone più quell'inventario alle app. La schermata
  finale certifica ciò che la griglia web ha mostrato e ciò che è stato copiato, non
  un totale indipendente fornito da Google.
- Per minimizzare throttling e blocchi anti-abuso, usare l'impostazione predefinita
  e non nascondere o sospendere Chrome durante il processo.
