# GPhoto2MyCloud per macOS

Applicazione grafica per pilotare **la sessione Google Foto già aperta in Chrome**:
seleziona le foto in lotti lungo l'intera timeline, invia a Chrome il vero comando
**⇧D**, segue il download ed estrae i file nella cartella `Media` del volume My Cloud.

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
- percorso del volume SMB, cartella download di Chrome e spazio disponibile;
- nome della cartella unica che raccoglie tutti i file estratti;
- dimensione dei lotti, ritardo tra click e attesa di caricamento della griglia;
- attivazione/disattivazione della verifica SHA-256;
- comandi **Avvia backup** e **Interrompi**;
- registro cronologico dettagliato con orario, livello, ID selezionati, posizione di
  scorrimento, byte scaricati, nomi estratti, destinazione ed eventuali errori;
- conteggio degli identificativi scoperti e già trasferiti, con ripresa dopo un arresto;
- comando esplicito per azzerare il registro e iniziare un backup completamente nuovo.

Le preferenze restano nel profilo Chrome locale. Il pannello non chiede password e
non copia cookie: opera esclusivamente nella scheda `photos.google.com` già aperta.

## Installazione su MacBook

Requisiti: macOS, Google Chrome, Python 3 di sistema o installato e My Cloud già
montato via SMB (ad esempio `/Volumes/MyCloud`).

1. Fare doppio clic su `macos/Installa.command`. macOS può richiedere **Apri** dal
   menu contestuale la prima volta.
2. Nella pagina Chrome aperta, abilitare **Modalità sviluppatore**, scegliere
   **Carica estensione non pacchettizzata** e indicare la cartella `extension/`.
3. Aprire `https://photos.google.com/` nel profilo Chrome già autenticato.
4. Premere l'icona GPhoto2MyCloud, impostare ad esempio
   `/Volumes/MyCloud/GooglePhotos` e premere **Verifica disco**.
5. Premere **Avvia backup** e lasciare la scheda aperta.

> Dopo ogni aggiornamento del progetto è necessario premere **Ricarica** sulla scheda
> dell'estensione in `chrome://extensions`. Chrome mantiene in memoria la versione
> precedentemente caricata: copiare i file non ricarica automaticamente un'estensione
> unpacked. Il nuovo pannello mostra chiaramente `v2.1.0`, la pipeline in quattro fasi
> e la sezione **04 · Diagnostica installazione**. Se questi elementi non compaiono,
> Chrome sta ancora eseguendo i file vecchi.

### Posso usare il Mac nel frattempo?

Sì. La scheda Google Foto **non deve essere quella attiva**: si possono usare altre
schede e altre applicazioni. Non bisogna però interagire con quella specifica scheda,
ricaricarla, chiuderla, minimizzare/chiudere completamente Chrome o mettere il Mac in
stop. Chrome rallenta i timer delle schede in background, quindi la scansione può
procedere più lentamente. L'invio ⇧D è diretto alla scheda corretta tramite il suo ID,
non alla finestra che si sta usando.

L'installazione manuale dell'estensione è un vincolo di sicurezza imposto da Chrome
alle estensioni non pubblicate sul Chrome Web Store. Non sono necessarie API Google,
OAuth aggiuntivo o configurazioni Google Cloud.

## Flusso e sicurezza dei dati

1. Il content script estrae l'identificativo stabile dal link `/photo/<id>`, deduplica
   gli ID e considera esclusivamente checkbox appartenenti alle relative tessere.
2. Seleziona lentamente fino alla dimensione del lotto configurata.
3. Il service worker usa il protocollo Chrome DevTools per generare un evento ⇧D
   attendibile; Chrome mostra l'avviso standard mentre il debugger è collegato.
4. L'app aspetta che `chrome.downloads` dichiari il file completo.
5. Il servizio nativo accetta sorgenti solo dalla cartella Download configurata e
   destinazioni solo sotto `/Volumes`.
6. Estrae lo ZIP in una directory temporanea direttamente sul My Cloud, blocca path
   traversal e symlink, forza il flush e verifica SHA-256 di ogni file estratto.
7. Pubblica tutti i file sotto l'unica cartella configurata (`Media` di default). I
   nomi originali non vengono mai modificati: un file identico viene deduplicato;
   un omonimo differente conserva il nome ed è separato sotto `_conflitti/<hash>/`.
8. Registra nome, byte, data e SHA-256 in
   `.gphoto2mycloud-history.jsonl` sul My Cloud.
9. Soltanto dopo la copia verificata registra gli ID del lotto nel profilo Chrome;
   un riavvio riparte dall'inizio della griglia e salta esattamente quegli ID.
10. Se lo ZIP contiene meno file degli elementi selezionati, il lotto viene rifiutato
    e non viene marcato completato (più file sono ammessi, ad esempio per Live Photo).

Se il NAS viene disconnesso, l'hash non coincide o Chrome non avvia il download,
l'operazione si ferma e il file originale in Download viene lasciato intatto.

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

- La prima installazione richiede il caricamento esplicito dell'estensione; per
  eliminarlo occorre pubblicare e firmare l'estensione sul Chrome Web Store.
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
