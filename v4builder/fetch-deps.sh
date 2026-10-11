#!/usr/bin/env bash
# Fetches the exact dependency commits the Foundation contracts were written against (see Programmable's
# contracts/dependencies/source-pins.json). Run once before `forge build`.
set -euo pipefail
cd "$(dirname "$0")/lib"
get() { # name repo commit
  [ -d "$1/.git" ] && { echo "have $1"; return; }
  mkdir -p "$1" && cd "$1" && git init -q && git remote add origin "$2" && git fetch -q --depth 1 origin "$3" && git checkout -q FETCH_HEAD && cd ..
  echo "got $1 @ ${3:0:10}"
}
get v4-core https://github.com/Uniswap/v4-core.git 59d3ecf53afa9264a16bba0e38f4c5d2231f80bc
get v4-periphery https://github.com/Uniswap/v4-periphery.git ad04c9f24a170accf5ea1b2836bbafd514537ca6
get v4-periphery-v211 https://github.com/Uniswap/v4-periphery.git 3231810e39b8c4d569b9d66907fa4ef8cd2cec22
get universal-router https://github.com/Uniswap/universal-router.git 999d561c3ad58fb5cab91b602911f3c75591a9c7
get openzeppelin-contracts https://github.com/OpenZeppelin/openzeppelin-contracts.git 21c8312b022f495ebe3621d5daeed20552b43ff9
get openzeppelin-uniswap-hooks https://github.com/OpenZeppelin/uniswap-hooks.git 26dc8e53f812a1ca390d470342adb6cd8c3286ad
get permit2 https://github.com/Uniswap/permit2.git cc56ad0f3439c502c246fc5cfcc3db92bb8b7219
get forge-std https://github.com/foundry-rs/forge-std.git 3b20d60d14b343ee4f908cb8079495c07f5e8981
get solmate https://github.com/transmissions11/solmate.git 4b47a19038b798b4a33d9749d25e570443520647
get solady https://github.com/Vectorized/solady.git 33b4b98e350bbcba6aa85642957c313e98b5f911

# The Universal Router's own pinned dependencies, so tests run against the real router.
cd universal-router/lib
get forge-std https://github.com/foundry-rs/forge-std.git 1de6eecf821de7fe2c908cc48d3ab3dced20717f
get permit2 https://github.com/Uniswap/permit2.git cc56ad0f3439c502c246fc5cfcc3db92bb8b7219
get solmate https://github.com/transmissions11/solmate.git 8d910d876f51c3b2585c9109409d601f600e68e1
get v3-periphery https://github.com/uniswap/v3-periphery.git b325bb0905d922ae61fcc7df85ee802e8df5e96c
get v4-periphery https://github.com/Uniswap/v4-periphery.git 3231810e39b8c4d569b9d66907fa4ef8cd2cec22
cd v4-periphery/lib
get v4-core https://github.com/Uniswap/v4-core.git 59d3ecf53afa9264a16bba0e38f4c5d2231f80bc
get permit2 https://github.com/Uniswap/permit2.git cc56ad0f3439c502c246fc5cfcc3db92bb8b7219
cd ../../..
npm install --silent --no-audit --no-fund @openzeppelin/contracts@5.0.2 @uniswap/v2-core@1.0.1 @uniswap/v3-core@1.0.0
forge build contracts/UniversalRouter.sol --no-auto-detect
