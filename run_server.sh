#!/usr/bin/env bash
cd "$(dirname "$0")/dist" || exit 1
python -m http.server 8787
