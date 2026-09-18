"""Scoped production configuration migration. No customer balances/history are touched.

prepare COMPOSE DB BACKUP: create private backup + proposed config + price-rule plan.
apply BACKUP DB: normalize previously inactive H3 second overrides, CAS protected.
rollback BACKUP DB: restore only still-matching migrated rows (never restore whole DB).
Requires PyYAML on the deployment host. Prepared compose is installed by release operator.
"""
import copy
import json
import os
from pathlib import Path
import shutil
import sqlite3
import sys
import yaml

H3 = {"minimaxh3-720p", "minimaxh3-2k", "minimax-h3-720p", "minimax-h3-1080p", "minimax-h3-1080p-pro", "minimax-h3-c4"}

def prepare(compose_path, db_path, backup_path):
    backup = Path(backup_path)
    backup.mkdir(mode=0o700, parents=True, exist_ok=False)
    shutil.copy2(compose_path, backup / "canvas-compose.before.yml")
    config = yaml.safe_load(Path(compose_path).read_text())
    app = config["services"]["app"]
    prices = json.loads(app["environment"]["CANVAS_MODEL_PRICES_JSON"])
    original = copy.deepcopy(prices)
    for model, rule in prices.items():
        if model.lower() in H3 and rule["unit"] == "request":
            base = rule.get("creditsBySeconds", {}).get("10", rule["credits"])
            prices[model] = {"credits": round(base / 10, 6), "unit": "second"}
    assert all(prices[k] == v for k,v in original.items() if k.lower() not in H3)
    assert all(v["unit"] == "second" for k,v in prices.items() if k.lower() in H3)
    app["environment"]["CANVAS_MODEL_PRICES_JSON"] = json.dumps(prices, separators=(",", ":"))
    app["image"] = "ghcr.io/tzx666888/infinite-canvas:v3.157.42"
    (backup / "canvas-compose.after.yml").write_text(yaml.safe_dump(config, allow_unicode=True, sort_keys=False))
    db = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    db.backup(sqlite3.connect(backup / "canvas-before.sqlite"))
    rules = db.execute("SELECT r.profile_id,r.model,r.unit,r.credits_per_unit,a.is_distributor FROM billing_price_rules r JOIN billing_profiles p ON p.id=r.profile_id JOIN accounts a ON a.id=p.admin_user_id").fetchall()
    old = {k.lower(): v for k,v in original.items()}
    plan = []
    for profile, model, unit, rate, distributor in rules:
        rule = old.get(model.lower())
        if model.lower() in H3 and rule and rule["unit"] == "request" and unit != "request":
            # Old runtime ignored these mismatched units. Preserve that effective
            # wholesale price instead of accidentally activating an obsolete override.
            effective = round(rule["credits"] * (0.7 if distributor else 1), 6)
            plan.append({"profile": profile, "model": model, "before_unit": unit, "before_rate": rate, "after_unit": "request", "after_rate": effective})
    (backup / "rules-plan.json").write_text(json.dumps(plan, indent=2))
    (backup / "prices-before.json").write_text(json.dumps(original, indent=2))
    (backup / "prices-after.json").write_text(json.dumps(prices, indent=2))
    for item in backup.iterdir(): item.chmod(0o600)
    print(json.dumps({"backup": str(backup), "normalized_stale_rules": len(plan), "h3_prices": {k:v for k,v in prices.items() if k.lower() in H3}}))

def migrate(backup_path, db_path, rollback=False):
    plan = json.loads((Path(backup_path) / "rules-plan.json").read_text())
    db = sqlite3.connect(db_path, timeout=30)
    source, target = ("after", "before") if rollback else ("before", "after")
    with db:
        db.execute("BEGIN IMMEDIATE")
        for r in plan:
            current = db.execute("SELECT unit, credits_per_unit FROM billing_price_rules WHERE profile_id=? AND model=?", (r["profile"], r["model"])).fetchone()
            expected, wanted = (r[source+"_unit"], r[source+"_rate"]), (r[target+"_unit"], r[target+"_rate"])
            if current == wanted: continue
            if current != expected: raise RuntimeError("Pricing changed concurrently; stop and review, no overwrite")
            db.execute("UPDATE billing_price_rules SET unit=?,credits_per_unit=? WHERE profile_id=? AND model=?", (*wanted, r["profile"], r["model"]))
    print("rollback complete" if rollback else "scoped H3 pricing normalization complete")

if __name__ == "__main__":
    os.umask(0o077)
    if sys.argv[1] == "prepare": prepare(*sys.argv[2:])
    elif sys.argv[1] in ("apply", "rollback"): migrate(*sys.argv[2:], rollback=sys.argv[1] == "rollback")
    else: raise SystemExit("expected prepare/apply/rollback")
