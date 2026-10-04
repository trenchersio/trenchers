#!/usr/bin/env bash
# Installs the three solc versions this project needs into ~/.svm (where forge looks for them offline),
# from the official GitHub release binaries. foundry's own installer/binary host is not needed.
set -euo pipefail
for v in 0.8.17 0.8.24 0.8.26; do
  d="$HOME/.svm/$v"; f="$d/solc-$v"
  if [ -x "$f" ]; then echo "solc $v: present"; continue; fi
  mkdir -p "$d"
  curl -sSL -o "$f" "https://github.com/ethereum/solidity/releases/download/v$v/solc-static-linux"
  chmod +x "$f"; "$f" --version | tail -1
done
