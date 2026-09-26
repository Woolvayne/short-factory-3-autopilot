#!/bin/sh
# ── ShortsFactory — EIN Knopf für sehr einfache Rechner (z. B. Raspberry Pi) ──
#
#   ./start.sh
#
# Macht alles nötige: Dependencies installieren (falls noch nicht geschehen),
# App einmal bauen (falls noch nicht geschehen), Server starten.
# Danach im Browser öffnen:  http://localhost:8080  bzw.  http://<IP>:8080
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "✖ Node.js fehlt. Installieren (Debian/Raspberry Pi OS):"
  echo "    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -"
  echo "    sudo apt-get install -y nodejs"
  exit 1
fi

if [ ! -d node_modules ] || [ package.json -nt node_modules/.package-lock.json ] 2>/dev/null; then
  echo "→ installiere Dependencies (einmalig)…"
  npm install --no-audit --no-fund
fi

exec npm start
