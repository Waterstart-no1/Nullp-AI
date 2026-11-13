#!/bin/bash
# Double-click to reset an arcade account's password. You type the new password here yourself
# (nothing shows while you type). Your saved progress stays on the account.
cd "$(dirname "$0")" || exit 1
node reset-password.js "${1:-dankingupstrul}"
echo
read -n 1 -s -r -p "Press any key to close this window…"
