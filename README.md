# GPhoto2MyCloud

Backup **byte-for-byte** di Google Foto su un hard disk/NAS WD My Cloud. Il progetto
scarica gli archivi ufficiali di Google Takeout da Google Drive, li estrae senza
ricodificare foto o video, conserva i sidecar JSON e (per impostazione predefinita)
anche l'archivio originale verificabile tramite SHA-256.

## Perché questo metodo

Dal 31 marzo 2025 le API Google Photos Library non consentono più a un'app di
elencare e scaricare liberamente l'intera libreria: l'accesso è limitato ai contenuti
creati dall'app. Di conseguenza strumenti basati sul vecchio scope `photoslibrary.readonly`
non sono una soluzione affidabile per un export completo. Riferimento ufficiale:
[Google Photos API updates](https://developers.google.com/photos/support/updates).

Il percorso supportato per esportare **tutti i dati** è Google Takeout. Takeout può
consegnare gli archivi in Google Drive e creare export programmati ogni due mesi per
un anno; Google precisa inoltre che il download non rimuove i dati dai suoi server.
Riferimento ufficiale: [How to download your Google data](https://support.google.com/accounts/answer/3024190).

Non esiste un interruttore ufficiale per un backup continuo e immediato dell'intera
libreria. Questa soluzione automatizza in modo affidabile tutto ciò che viene dopo
la generazione periodica di Takeout. La creazione/rinnovo annuale dell'export resta
un'operazione Google da effettuare nell'account.

## Garanzie

- nessuna libreria fotografica apre, converte o ricomprime i media;
- foto, video e file JSON vengono copiati come sequenze di byte inalterate;
- ogni archivio è identificato con SHA-256 e importato una sola volta;
- estrazione in una directory temporanea e pubblicazione atomica sul NAS;
- archivio Takeout originale conservato in `takeout-archives/`;
- ricevuta `.gphoto2mycloud.json` con hash dell'intero albero estratto per ogni
  import e manifest SQLite;
- protezione da path traversal e link malevoli negli archivi.

> “Originale” significa il file restituito da Takeout. Gli album, le descrizioni,
> le date e altre informazioni che non sono incorporate nel file restano nei JSON:
> per non perdere informazioni non eliminarli e lasciare `retain_archives = true`.

## 1. Preparare Google Takeout

1. Aprire [Google Takeout](https://takeout.google.com/).
2. Deselezionare tutto e selezionare **Google Foto**; includere tutti gli album.
3. Scegliere **Aggiungi a Drive**, export ogni 2 mesi per 1 anno, formato ZIP e una
   dimensione archivio adatta al disco (ad esempio 10 GB).
4. Creare l'export. Gli archivi appariranno nella cartella `Takeout` di Drive.

Per il primo trasferimento è prudente verificare lo spazio libero: con
`retain_archives = true` servono temporaneamente circa due volte i dati esportati,
più lo spazio di lavoro.

## 2. Montare My Cloud

Il NAS deve essere montato stabilmente sull'host, per esempio via SMB:

```bash
sudo mkdir -p /mnt/mycloud
sudo mount -t cifs //192.168.1.50/Public /mnt/mycloud \
  -o credentials=/root/.smbcredentials,uid=65532,gid=65532,file_mode=0660,dir_mode=0770
```

Usare credenziali in un file protetto (`chmod 600`), non nel repository. Per un
servizio permanente aggiungere il mount a `/etc/fstab` e testarlo prima di avviare
il container.

## 3. Collegare Google Drive con rclone

Installare rclone e creare un remote chiamato `gdrive`:

```bash
rclone config
rclone lsf gdrive:Takeout
```

Il token OAuth resta nel file locale di rclone e non entra nell'immagine o nel
repository. L'app richiede accesso a Drive perché è lì che Takeout deposita gli
archivi, non usa la limitata Photos Library API.

## 4. Avvio con Docker Compose

```bash
cp config.example.toml config.toml
export MYCLOUD_PATH=/mnt/mycloud
docker compose up -d --build
docker compose logs -f gphoto2mycloud
```

Il container controlla Drive ogni sei ore. Modificare `poll_seconds` (minimo 60)
se necessario. Directory create sul NAS:

```text
GooglePhotos/
├── takeout/           # alberi estratti, media + sidecar + ricevuta
└── takeout-archives/  # ZIP/TGZ originali nominati con prefisso SHA-256
```

## Uso senza Docker

Richiede Python 3.11+ e rclone:

```bash
python -m venv .venv
. .venv/bin/activate
pip install -e .
cp config.example.toml config.toml
gphoto2mycloud --config config.toml run
gphoto2mycloud --config config.toml verify
```

Per importare archivi già scaricati, impostare `source_mode = "local"` e `source`
alla loro directory. `run` esegue un ciclo; `watch` resta in esecuzione.

## Ripristino e deduplicazione

La struttura Takeout viene deliberatamente mantenuta: tentare di unificare file con
lo stesso nome o hash può far perdere appartenenza agli album o sidecar. Il manifest
evita solo di reimportare lo **stesso archivio**. Per un ripristino conservativo si
parte dagli archivi in `takeout-archives/`; `verify` controlla dimensione e SHA-256
di ogni archivio conservato e ricalcola l'hash di tutti i file estratti:

```bash
docker compose run --rm gphoto2mycloud --config /config/config.toml verify
```

## Sicurezza operativa

- Il backup non è completo finché `verify` non termina senza errori.
- Conservare almeno una seconda copia offline o in un luogo diverso (regola 3-2-1).
- Non esporre SMB su Internet e non committare `config.toml`, token rclone o password.
- Controllare annualmente che l'export Takeout programmato sia stato rinnovato.
