#!/bin/bash
# Double-click this file to start Nullp. Keep the window open while you play.
cd "$(dirname "$0")" || exit 1
[ -d node_modules ] || npm install
( sleep 1.5; open "http://localhost:4173/games" ) &
npm start
