# Notice

The Solidity contracts in `src/` and most of the tests in `test/` are derived from the Foundation launch system
("module-foundation") published by Programmable at https://github.com/programmablehq/PROGRAMMABLE, whose source
files carry the MIT licence (SPDX-License-Identifier: MIT). Each derived file says so in its header.

Changes for Trenchers: module and system identifiers renamed, the platform fee recipient set to the Trenchers
buyback wallet, Uniswap v4 infrastructure pinned to Robinhood Chain (chain 4663) by address and code hash in
`TrenchersInfraV1`, the Ethereum-specific factories removed, the native-ETH launch factory reading WETH from
`TrenchersInfraV1`, a read-only module probe (`src/tools/ModuleProbeV1.sol`), and tests ported to a local
Uniswap v4 deployment with the real Universal Router.

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit
persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
