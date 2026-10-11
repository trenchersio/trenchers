#!/usr/bin/env python3
"""Writes the ABIs and bytecode the website needs (deploy page, launcher, probe) to web/lib/v4builder/artifacts.json."""
# Needs pycryptodome for keccak: pip install pycryptodome
import json, os
here = os.path.dirname(os.path.abspath(__file__))
out = os.path.join(here, "out")
NAMES = {
    "FoundationHookDeployerV2": "FoundationHookDeployerV2.sol",
    "FoundationFactoryV3Native": "FoundationFactoryV3Native.sol",
    "FoundationHookV2": "FoundationHookV2.sol",
    "FoundationLedgerV1": "FoundationLedgerV1.sol",
    "FoundationTokenV1": "FoundationTokenV1.sol",
    "ModuleProbeV1": "ModuleProbeV1.sol",
    "BuyCooldownFactoryV1": "BuyCooldownFactoryV1.sol",
    "BuyWindowFactoryV1": "BuyWindowFactoryV1.sol",
    "PriceMoveGuardFactoryV1": "PriceMoveGuardFactoryV1.sol",
    "GrowingBuyLimitFactoryV1": "GrowingBuyLimitFactoryV1.sol",
    "LaunchWalletCapFactoryV1": "LaunchWalletCapFactoryV1.sol",
}
for n in ["BuybackBurnFactoryV1", "DipBuybackFactoryV1", "LPRewardsFactoryV1", "FullRangeLPFactoryV1", "BuyerRewardsFactoryV1",
          "NthBuyPotFactoryV1", "KingOfTheHillFactoryV1", "HotPotatoFactoryV1", "PlagueFactoryV1", "ReactivePairFactoryV1", "EntangledFactoryV1"]:
    NAMES[n] = "EconomicModuleFactoriesV1.sol"
from Crypto.Hash import keccak as _k
def keccak(b: bytes) -> str:
    h = _k.new(digest_bits=256); h.update(b); return "0x" + h.hexdigest()
res = {}
for name, file in NAMES.items():
    j = json.load(open(os.path.join(out, file, f"{name}.json")))
    keep_abi = name in ("FoundationFactoryV3Native", "FoundationHookV2", "FoundationLedgerV1", "FoundationTokenV1", "ModuleProbeV1", "FoundationHookDeployerV2")
    runtime = bytes.fromhex(j["deployedBytecode"]["object"][2:])
    # The site checks that what it talks to is exactly this code: a code hash, or for the factory (which has
    # immutables) a hash of its code with the immutable slots zeroed, plus where those slots are.
    ranges = sorted((r["start"], r["length"]) for refs in j["deployedBytecode"].get("immutableReferences", {}).values() for r in refs)
    masked = bytearray(runtime)
    for st, ln in ranges: masked[st:st + ln] = bytes(ln)
    res[name] = {"abi": j["abi"] if keep_abi else [], "bytecode": j["bytecode"]["object"],
                 "deployedBytecode": j["deployedBytecode"]["object"] if name == "ModuleProbeV1" else None,
                 "codeHash": keccak(runtime) if not ranges else None,
                 "maskedHash": keccak(bytes(masked)) if ranges else None, "immutables": ranges if ranges else None}
dest = os.path.join(here, "..", "web", "lib", "v4builder")
os.makedirs(dest, exist_ok=True)
json.dump(res, open(os.path.join(dest, "artifacts.json"), "w"), separators=(",", ":"))
print("wrote", len(res), "artifacts")
