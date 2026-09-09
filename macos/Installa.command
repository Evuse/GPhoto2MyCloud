#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_SUPPORT="$HOME/Library/Application Support/GPhoto2MyCloud"
HOSTS="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
mkdir -p "$APP_SUPPORT" "$HOSTS"
cp "$ROOT/native-host/gphoto2mycloud_host.py" "$APP_SUPPORT/gphoto2mycloud_host.py"
chmod 755 "$APP_SUPPORT/gphoto2mycloud_host.py"
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

Servizio macOS installato.
In Chrome: abilita “Modalità sviluppatore”, premi “Carica estensione non pacchettizzata”
e scegli la cartella extension contenuta in questo progetto. Questa operazione è
richiesta una sola volta; l'app userà il profilo Google già aperto in Chrome.
TEXT
read -r -p "Premi Invio per chiudere…" _
