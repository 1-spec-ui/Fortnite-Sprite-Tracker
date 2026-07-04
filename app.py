from flask import Flask, render_template, request, jsonify
import json
import os

app = Flask(__name__)
DATA_FILE = "fortnite_sprites.json"

SPRITE_DIRECTORY = {
    "Water Sprite":       {"rarity": "Rare",      "ability": "Replenishes shield while in water for you and your nearby Squad.",                        "costs": {"Normal": 100,  "Gold": 4000,  "Gummy": 4000,  "Galaxy": 15000}},
    "Earth Sprite":       {"rarity": "Rare",      "ability": "Gives a chance to find additional rare items when opening chests.",                        "costs": {"Normal": 100,  "Gold": 4000,  "Gummy": 4000,  "Galaxy": 15000}},
    "Fire Sprite":        {"rarity": "Rare",      "ability": "Creates a fiery burst when you deal enough damage to an enemy.",                           "costs": {"Normal": 100,  "Gold": 4000,  "Gummy": 4000,  "Galaxy": 15000}},
    "Fishy Sprite":       {"rarity": "Rare",      "ability": "Increases swimming speed and gives a movement boost after taking damage.",                 "costs": {"Normal": 100,  "Gold": 4000,  "Gummy": 4000,  "Galaxy": 15000}},
    "Duck Sprite":        {"rarity": "Epic",      "ability": "Emoting or Jamming on the battlefield slowly replenishes your shields.",                   "costs": {"Normal": 3000, "Gold": 6000,  "Gummy": 6000,  "Galaxy": 15000}},
    "Ghost Sprite":       {"rarity": "Epic",      "ability": "Grants a temporary active cloak duration immediately upon reloading.",                     "costs": {"Normal": 3000, "Gold": 6000,  "Gummy": 6000,  "Galaxy": 15000}},
    "Demon Sprite":       {"rarity": "Epic",      "ability": "Siphons a portion of health and shields when you eliminate an opponent.",                  "costs": {"Normal": 3000, "Gold": 6000,  "Gummy": 6000,  "Galaxy": 15000}},
    "King Sprite":        {"rarity": "Epic",      "ability": "Your Harvesting Tool Pickaxe deals significantly more swing damage.",                      "costs": {"Normal": 3000, "Gold": 6000,  "Gummy": 6000,  "Galaxy": 15000}},
    "Aura Sprite":        {"rarity": "Epic",      "ability": "Gain a Shock Rock consumable charge when you deal enough enemy damage.",                   "costs": {"Normal": 3000, "Gold": 6000,  "Gummy": 6000,  "Galaxy": 15000}},
    "Striker Sprite":     {"rarity": "Epic",      "ability": "Gain a functional speed Overdrive buff whenever you Mantle or Hurdle.",                    "costs": {"Normal": 3000, "Gold": 6000,  "Gummy": 6000,  "Galaxy": 15000}},
    "Punk Sprite":        {"rarity": "Legendary", "ability": "Grants high-tier combat wildcard advantages and passive status traits.",                    "costs": {"Normal": 5000, "Gold": 10000, "Gummy": 10000, "Galaxy": 15000}},
    "Dream Sprite":       {"rarity": "Legendary", "ability": "Grants a random item at each level, exploding with legendary loot at Max Level.",          "costs": {"Normal": 5000, "Gold": 10000, "Gummy": 10000, "Galaxy": 15000}},
    "Boss Sprite":        {"rarity": "Legendary", "ability": "Increases maximum health and shield limits. Dropped by defeating roaming map bosses.",      "costs": {"Normal": 5000, "Gold": 10000, "Gummy": 10000, "Galaxy": 15000}},
    "Grim Reaper Sprite": {"rarity": "Legendary", "ability": "Extremely rare chest drop providing lethal execution and scouting advantages.",             "costs": {"Normal": 5000, "Gold": 10000, "Gummy": 10000, "Galaxy": 15000}},
    "Zero Point Sprite":  {"rarity": "Mythic",    "ability": "Deploy a defensive Shield Bubble Jr. protecting you automatically as you heal.",            "costs": {"Normal": 7500, "Gold": 15000, "Gummy": 15000, "Galaxy": 15000}},
}

VARIANTS = ["Normal", "Gold", "Gummy", "Galaxy"]

VARIANT_PERKS = {
    "Normal": "Core standard baseline ability of that Sprite.",
    "Gold":   "3x Sprite XP for every elimination secured during a match.",
    "Gummy":  "+20% extra Sprite Dust whenever successfully extracted.",
    "Galaxy": "+30% more ammunition when opening ammo crates and looting.",
}


def make_key(sprite_name, variant):
    return f"{sprite_name}||{variant}"


def load_data():
    if os.path.exists(DATA_FILE):
        try:
            with open(DATA_FILE, "r") as f:
                return json.load(f)
        except json.JSONDecodeError:
            return {}
    return {}


def save_data(collection):
    with open(DATA_FILE, "w") as f:
        json.dump(collection, f, indent=4)


def get_status(level, summoned):
    mastered = level == 5
    if mastered and not summoned:
        return {"icon": "🔒", "text": "Mastered & Not Summoned", "cls": "status-mastered-locked"}
    elif mastered and summoned:
        return {"icon": "👑", "text": "Mastered & Summoned",     "cls": "status-crown"}
    elif mastered:
        return {"icon": "⭐", "text": "Mastered",                "cls": "status-mastered"}
    elif not summoned:
        return {"icon": "💀", "text": "Not Summoned",            "cls": "status-dead"}
    else:
        return {"icon": "🏃", "text": f"Summoned (Lv {level})",  "cls": "status-active"}


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/directory")
def get_directory():
    return jsonify({"sprites": SPRITE_DIRECTORY, "variants": VARIANTS, "variant_perks": VARIANT_PERKS})


@app.route("/api/collection")
def get_collection():
    """Return the full checklist: every sprite+variant combo with owned/unowned state."""
    collection = load_data()
    rarity_order = ["Rare", "Epic", "Legendary", "Mythic"]
    rows = []
    for sprite_name, info in SPRITE_DIRECTORY.items():
        for variant in VARIANTS:
            key = make_key(sprite_name, variant)
            entry = collection.get(key)
            owned = entry is not None
            level = entry["level"] if owned else 0
            summoned = entry.get("summoned", False) if owned else False
            cost = info["costs"][variant]
            status = get_status(level, summoned) if owned else None
            rows.append({
                "key":       key,
                "name":      sprite_name,
                "variant":   variant,
                "rarity":    info["rarity"],
                "ability":   info["ability"],
                "cost":      cost,
                "owned":     owned,
                "level":     level,
                "summoned":  summoned,
                "mastered":  level == 5,
                "status":    status,
            })
    # Sort by rarity then name
    rows.sort(key=lambda r: (rarity_order.index(r["rarity"]), r["name"], VARIANTS.index(r["variant"])))
    owned_count    = sum(1 for r in rows if r["owned"])
    mastered_count = sum(1 for r in rows if r["mastered"])
    summoned_count = sum(1 for r in rows if r["summoned"])
    return jsonify({
        "rows": rows,
        "stats": {
            "total":     owned_count,
            "mastered":  mastered_count,
            "summoned":  summoned_count,
            "unsummoned": owned_count - summoned_count,
        }
    })


@app.route("/api/collection/<path:key>", methods=["PUT"])
def upsert_entry(key):
    """Mark a sprite+variant as owned and set its data."""
    body = request.get_json()
    level = body.get("level", 1)
    summoned = body.get("summoned", False)
    try:
        level = int(level)
    except (TypeError, ValueError):
        return jsonify({"error": "Level must be a number."}), 400
    if not (1 <= level <= 5):
        return jsonify({"error": "Level must be between 1 and 5."}), 400

    # Validate key
    parts = key.split("||")
    if len(parts) != 2 or parts[0] not in SPRITE_DIRECTORY or parts[1] not in VARIANTS:
        return jsonify({"error": "Invalid sprite or variant."}), 400

    sprite_name, variant = parts[0], parts[1]
    cost = SPRITE_DIRECTORY[sprite_name]["costs"][variant]

    collection = load_data()
    collection[key] = {"level": level, "summoned": bool(summoned), "summon_cost": cost}
    save_data(collection)
    return jsonify({"ok": True})


@app.route("/api/collection/<path:key>", methods=["DELETE"])
def remove_entry(key):
    """Mark a sprite+variant as not owned."""
    collection = load_data()
    if key in collection:
        del collection[key]
        save_data(collection)
    return jsonify({"ok": True})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
