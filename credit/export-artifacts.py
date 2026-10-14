"""Writes the ABIs and bytecode the site needs (deploy buttons, reads) to web/lib/credit/artifacts.json.
Run after `forge build`."""
import json, os
here = os.path.dirname(os.path.abspath(__file__))
out = {}
for name in ["TrenchersCreditPool", "CreditCalls", "CreditRecord", "TrenchersStakeLines", "CreditTimelock"]:
    j = json.load(open(os.path.join(here, "out", f"{name}.sol", f"{name}.json")))
    out[name] = {"abi": j["abi"], "bytecode": j["bytecode"]["object"], "linkReferences": j["bytecode"].get("linkReferences", {})}
dst = os.path.join(here, "..", "web", "lib", "credit", "artifacts.json")
os.makedirs(os.path.dirname(dst), exist_ok=True)
json.dump(out, open(dst, "w"), separators=(",", ":"))
print("wrote", dst, {k: len(v["bytecode"]) // 2 for k, v in out.items()})
