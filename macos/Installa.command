#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_SUPPORT="$HOME/Library/Application Support/GPhoto2MyCloud"
HOSTS="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
mkdir -p "$APP_SUPPORT" "$HOSTS"
cp "$ROOT/native-host/gphoto2mycloud_host.py" "$APP_SUPPORT/gphoto2mycloud_host.py"
chmod 755 "$APP_SUPPORT/gphoto2mycloud_host.py"
VERSION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$ROOT/extension/manifest.json")"
cat > "$HOSTS/it.gphoto2mycloud.host.json" <<JSON
{
  "name": "it.gphoto2mycloud.host",
  "description": "Copia verificata dei download Google Foto verso My Cloud",
  "path": "$APP_SUPPORT/gphoto2mycloud_host.py",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://mocnnikkncmfihikmbkhlmhkjegjmime/"]
}
JSON
open -a "Google Chrome" "chrome://extensions"
cat <<'TEXT'

Servizio macOS installato e file del progetto verificati.
In Chrome: abilita “Modalità sviluppatore”, premi “Carica estensione non pacchettizzata”
e scegli la cartella extension contenuta in questo progetto. Questa operazione è
richiesta una sola volta; l'app userà il profilo Google già aperto in Chrome.
TEXT
printf '\nVersione da vedere nel pannello: v%s\n' "$VERSION"
printf 'Percorso estensione aggiornato: %s/extension\n' "$ROOT"
printf 'SHA-256 pannello: '
shasum -a 256 "$ROOT/extension/sidepanel.html" | cut -d' ' -f1
echo 'Se l’estensione era già caricata, premi obbligatoriamente Ricarica in chrome://extensions.'
read -r -p "Premi Invio per chiudere…" _
