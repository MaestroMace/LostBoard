#!/usr/bin/env bash
# Regenerate the self-hosted fonts in public/fonts.
#
# The app used to pull these from the Google Fonts CDN, which silently falls
# back to system mono in a sideloaded APK with no network. We vendor the latin
# subset instead. Orbitron and JetBrains Mono are variable fonts, so one file
# per family covers every weight the UI asks for.
#
# Run from the repo root:  bash scripts/fetch-fonts.sh
set -euo pipefail

export OUT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/public/fonts"
mkdir -p "$OUT"

# Google serves woff2 only to browser-like agents.
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
# The `wght@a..b` range syntax makes Google serve the VARIABLE font; a single
# weight returns a smaller static instance. Match src/styles/fonts.css:
#   Orbitron        — variable, the UI uses 500 / 700 / 900
#   JetBrains Mono  — static 400, the only weight the UI ever asks for
#   Share Tech Mono — static 400, it has no other weights
API="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=JetBrains+Mono:wght@400&family=Orbitron:wght@400..900&display=swap"

curl -sS -A "$UA" "$API" | python3 -c '
import re, sys, urllib.request, os
out = os.environ["OUT"]
css = sys.stdin.read()
# Keep only the latin subset block for each face.
blocks = [b for b in re.split(r"(?=/\*\s*[a-z-]+\s*\*/)", css) if b.strip().startswith("/* latin */")]
names = {"Share Tech Mono": "ShareTechMono", "JetBrains Mono": "JetBrainsMono", "Orbitron": "Orbitron"}
for b in blocks:
    fam = re.search(r"font-family:\s*.([^\x27\"]+).", b).group(1)
    url = re.search(r"url\((https://[^)]+\.woff2)\)", b).group(1)
    dest = os.path.join(out, names[fam] + ".woff2")
    urllib.request.urlretrieve(url, dest)
    print(f"  {os.path.basename(dest):24s} {os.path.getsize(dest)/1024:6.1f} KB")
'

echo "Fonts written to $OUT"
echo "Face declarations live in src/styles/fonts.css — update them if a family or weight range changes."
