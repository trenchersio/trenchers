#!/usr/bin/env bash
# Fetches the pinned dependencies (OpenZeppelin 5.3, forge-std). Run once before `forge build`.
set -euo pipefail
cd "$(dirname "$0")" && mkdir -p lib && cd lib
get() { [ -d "$1/.git" ] && { echo "have $1"; return; }; mkdir -p "$1" && cd "$1" && git init -q && git remote add origin "$2" && git fetch -q --depth 1 origin "$3" && git checkout -q FETCH_HEAD && cd ..; echo "got $1"; }
get openzeppelin-contracts https://github.com/OpenZeppelin/openzeppelin-contracts.git 21c8312b022f495ebe3621d5daeed20552b43ff9
get forge-std https://github.com/foundry-rs/forge-std.git 3b20d60d14b343ee4f908cb8079495c07f5e8981
