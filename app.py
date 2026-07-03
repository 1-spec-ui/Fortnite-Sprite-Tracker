from flask import Flask, render_template, request, jsonify
import json
import os

app = Flask(__name__)
DATA_FILE = "fortnite_sprites.json"

SPRITE_DIRECTORY = {
    "Water Sprite":       {"rarity": "Rare",      "ability": "Replenishes shield while in water for you and your nearby Squad.",                          "costs": {"Normal": 100,  "Gold": 4000,  "Gummy": 4000,  "Galaxy": 15000}},
    "Earth Sprite":       {"rarity": "Rare",      "ability": "Gives a chance to find additional rare items when opening chests.",                          "costs": {"Normal": 100,  "Gold": 4000,  "Gummy": 4000,  "Galaxy": 15000}},
    "Fire Sprite":        {"rarity": "Rare",      "ability": "Creates a fiery burst when you deal enough damage to an enemy.",                             "costs": {"Normal": 100,  "Gold": 4000,  "Gummy": 4000,  "Galaxy": 15000}},
    "Fishy Sprite":       {"rarity": "Rare",      "ability": "Increases swimming speed and gives a movement boost after taking damage.",                   "costs": {"Normal": 100,  "Gold": 4000,  "Gummy": 4000,  "Galaxy": 15000}},
    "Duck Sprite":        {"rarity": "Epic",      "ability": "Emoting or Jamming on the battlefield slowly replenishes your shields.",                     "costs": {"Normal": 3000, "Gold": 6000,  "Gummy": 6000,  "Galaxy": 15000}},
    "Ghost Sprite":       {"rarity": "Epic",      "ability": "Grants a temporary active cloak duration immediately upon reloading.",                       "costs": {"Normal": 3000, "Gold": 6000,  "Gummy": 6000,  "Galaxy": 15000}},
    "Demon Sprite":       {"rarity": "Epic",      "ability": "Siphons a portion of health and shields when you eliminate an opponent.",                    "costs": {"Normal": 3000, "Gold": 6000,  "Gummy": 6000,  "Galaxy": 15000}},
    "King Sprite":        {"rarity": "Epic",      "ability": "Your Harvesting Tool Pickaxe deals significantly more swing damage.",                        "costs": {"Normal": 3000, "Gold": 6000,  "Gummy": 6000,  "Galaxy": 15000}},
    "Aura Sprite":        {"rarity": "Epic",      "ability": "Gain a Shock Rock consumable charge when you deal enough enemy damage.",                     "costs": {"Normal": 3000, "Gold": 6000,  "Gummy": 6000,  "Galaxy": 15000}},
    "Striker Sprite":     {"rarity": "Epic",      "ability": "Gain a functional speed Overdrive buff whenever you Mantle or Hurdle.",                      "costs": {"Normal": 3000, "Gold": 6000,  "Gummy": 6000,  "Galaxy": 15000}},
    "Punk Sprite":        {"rarity": "Legendary", "ability": "Grants high-tier combat wildcard advantages and passive status traits.",                      "costs": {"Normal": 5000, "Gold": 10000, "Gummy": 10000, "Galaxy": 15000}},
    "Dream Sprite":       {"rarity": "Legendary", "ability": "Grants a random item at each level, exploding with legendary loot at Max Level.",            "costs": {"Normal": 5000, "Gold": 10000, "Gummy": 10000, "Galaxy": 15000}},
    "Boss Sprite":        {"rarity": "Legendary", "ability": "Increases maximum health and shield limits. Dropped by defeating roaming map bosses.",        "costs": {"Normal": 5000, "Gold": 10000, "Gummy": 10000, "Galaxy": 15000}},
    "Grim Reaper Sprite": {"rarity": "Legendary", "ability": "Extremely rare chest drop providing lethal execution and scouting advantages.",               "costs": {"Normal": 5000, "Gold": 10000, "Gummy": 10000, "Galaxy": 15000}},
    "Zero Point Sprite":  {"rarity": "Mythic",    "ability": "Deploy a defensive Shield Bubble Jr. protecting you automatically as you heal.",              "costs": {"Normal": 7500, "Gold": 15000, "Gummy": 15000, "Galaxy": 15000}},
}

VARIANT_PERKS = {
    "Normal": "Core standard baseline ability of that Sprite.",
    "Gold":   "3x Sprite XP for every elimination secured during a match.",
    "Gummy":  "+20% extra Sprite Dust whenever successfully extracted.",
    "Galaxy": "+30% more ammunition when opening ammo crates and looting.",
}


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


def get_status_indicator(sprite_data):
    mastered = sprite_data["mastered"]
    summoned = sprite_data["summoned"]
    level = sprite_data["level"]

    if mastered and not summoned:
        return {"icon": "🔒", "text": "Mastered & Not Summoned", "class": "status-mastered-locked"}
    elif mastered and level >= 5:
        return {"icon": "👑", "text": "Mastered & Max Level (5)", "class": "status-crown"}
    elif mastered:
        return {"icon": "⭐", "text": f"Mastered & Level {level}", "class": "status-mastered"}
    elif not summoned:
        return {"icon": "💀", "text": "Not Summoned", "class": "status-dead"}
    else:
        return {"icon": "🏃", "text": f"Summoned (Level {level})", "class": "status-active"}


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/directory", methods=["GET"])
def get_directory():
    return jsonify({"sprites": SPRITE_DIRECTORY, "variant_perks": VARIANT_PERKS})


@app.route("/api/sprites", methods=["GET"])
def get_sprites():
    collection = load_data()
    sprites = []
    for name, data in collection.items():
        status = get_status_indicator(data)
        cost_display = f"{data['summon_cost']:,} Dust" if not data["summoned"] else "Active (0)"
        dir_info = SPRITE_DIRECTORY.get(name, {})
        sprites.append({
            "name": name,
            "variant": data["variant"],
            "level": data["level"],
            "mastered": data["mastered"],
            "summoned": data["summoned"],
            "summon_cost": data["summon_cost"],
            "cost_display": cost_display,
            "status": status,
            "rarity": dir_info.get("rarity", ""),
            "ability": dir_info.get("ability", ""),
        })
    return jsonify({"sprites": sprites, "total": len(sprites)})


@app.route("/api/sprites", methods=["POST"])
def add_sprite():
    body = request.get_json()
    name = body.get("name", "").strip()
    variant = body.get("variant", "").strip()
    level = body.get("level")
    summoned = body.get("summoned", False)
    summon_cost = body.get("summon_cost")

    if not name or not variant:
        return jsonify({"error": "Sprite name and variant are required."}), 400
    if name not in SPRITE_DIRECTORY:
        return jsonify({"error": f"'{name}' is not a valid sprite."}), 400
    if variant not in ("Normal", "Gold", "Gummy", "Galaxy"):
        return jsonify({"error": "Variant must be Normal, Gold, Gummy, or Galaxy."}), 400
    try:
        level = int(level)
        summon_cost = int(summon_cost)
    except (TypeError, ValueError):
        return jsonify({"error": "Level and Summon Cost must be numbers."}), 400
    if not (1 <= level <= 5):
        return jsonify({"error": "Level must be between 1 and 5."}), 400

    mastered = level == 5

    collection = load_data()
    collection[name] = {
        "variant": variant,
        "level": level,
        "mastered": mastered,
        "summoned": bool(summoned),
        "summon_cost": summon_cost,
    }
    save_data(collection)
    return jsonify({"message": f"Successfully saved tracking data for '{name}'!"})


@app.route("/api/sprites/<name>", methods=["DELETE"])
def delete_sprite(name):
    collection = load_data()
    if name in collection:
        del collection[name]
        save_data(collection)
        return jsonify({"message": f"Removed '{name}' from the tracker."})
    return jsonify({"error": f"Sprite '{name}' not found."}), 404


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
