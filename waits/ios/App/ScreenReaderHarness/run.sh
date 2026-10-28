#!/bin/sh
# Builds and runs the screen-reader harness on the Mac against fixtures/{uber,justeat,deliveroo}.
# Compiles the extension's own Core files, so what passes here is the code that runs on the phone.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
CORE="$HERE/../DelivrScreenReader/Core"
OUT="${TMPDIR:-/tmp}/delivr-screenreader-harness"
swiftc -O -o "$OUT" "$HERE/main.swift" "$HERE/Expectations.swift" "$CORE"/*.swift
# Optional 2nd arg: a folder of other-app PNGs that must never produce an event.
"$OUT" "${1:-$REPO/fixtures}" ${2:+"$2"}
