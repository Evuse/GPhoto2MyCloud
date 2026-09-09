#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_SUPPORT="$HOME/Library/Application Support/GPhoto2MyCloud"
CHROME_ROOT="$HOME/Library/Application Support/Google/Chrome"
HOSTS="$CHROME_ROOT/NativeMessagingHosts"
EXTENSION_DEST="$APP_SUPPORT/extension-production"
VERSION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$ROOT/extension/manifest.json")"

echo "GPhoto2MyCloud Production $VERSION"
echo "Chiusura di Chrome per sostituire realmente i file caricati…"
osascript -e 'tell application "Google Chrome" to quit' 2>/dev/null || true
for _ in {1..30}; do
  pgrep -x "Google Chrome" >/dev/null || break
  sleep 1
done
if pgrep -x "Google Chrome" >/dev/null; then
  echo "ERRORE: Chrome non si è chiuso. Chiudilo e rilancia questo installer." >&2
  exit 1
fi

mkdir -p "$APP_SUPPORT" "$HOSTS"
cp "$ROOT/native-host/gphoto2mycloud_host.py" "$APP_SUPPORT/gphoto2mycloud_host.py"
chmod 755 "$APP_SUPPORT/gphoto2mycloud_host.py"
UPDATE_RESULT="$(python3 "$ROOT/macos/update_chrome_extension.py" "$ROOT/extension" "$EXTENSION_DEST" "$CHROME_ROOT")"

cat > "$HOSTS/it.gphoto2mycloud.host.json" <<JSON
{
  "name": "it.gphoto2mycloud.host",
  "description": "Estrazione verificata Google Foto verso My Cloud",
  "path": "$APP_SUPPORT/gphoto2mycloud_host.py",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://mocnnikkncmfihikmbkhlmhkjegjmime/"]
}
JSON

INSTALLED_VERSION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$EXTENSION_DEST/manifest.json")"
if [[ "$INSTALLED_VERSION" != "$VERSION" ]]; then
  echo "ERRORE: verifica versione fallita ($INSTALLED_VERSION != $VERSION)" >&2
  exit 1
fi

echo "Installazione verificata:"
echo "  versione: $INSTALLED_VERSION"
echo "  build: FINAL-PROD-3"
echo "  estensione: $EXTENSION_DEST"
echo "  profili aggiornati: $UPDATE_RESULT"
echo -n "  SHA-256 pannello: "
shasum -a 256 "$EXTENSION_DEST/sidepanel.html" | cut -d' ' -f1

echo "Riavvio Chrome con la build di produzione…"
open -na "Google Chrome" --args --load-extension="$EXTENSION_DEST" "https://photos.google.com/"
echo "Fatto. Il pannello deve mostrare v$VERSION e FINAL-PROD-3."
sleep 4
