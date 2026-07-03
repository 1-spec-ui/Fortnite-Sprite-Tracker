from flask import Flask, render_template, request, jsonify
import json
import os

app = Flask(__name__)
DATA_FILE = "fortnite_sprites.json"


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
        return {"icon": "👑", "text": f"Mastered & Max Level ({level})", "class": "status-crown"}
    elif mastered:
        return {"icon": "⭐", "text": f"Mastered & Level {level}", "class": "status-mastered"}
    elif not summoned:
        return {"icon": "💀", "text": "Not Summoned", "class": "status-dead"}
    else:
        return {"icon": "🏃", "text": f"Summoned (Level {level})", "class": "status-active"}


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/sprites", methods=["GET"])
def get_sprites():
    collection = load_data()
    sprites = []
    for name, data in collection.items():
        status = get_status_indicator(data)
        cost_display = f"{data['summon_cost']} Dust" if not data["summoned"] else "Active (0)"
        sprites.append({
            "name": name,
            "variant": data["variant"],
            "level": data["level"],
            "mastered": data["mastered"],
            "summoned": data["summoned"],
            "summon_cost": data["summon_cost"],
            "cost_display": cost_display,
            "status": status
        })
    return jsonify({"sprites": sprites, "total": len(sprites)})


@app.route("/api/sprites", methods=["POST"])
def add_sprite():
    body = request.get_json()
    name = body.get("name", "").strip()
    variant = body.get("variant", "").strip()
    level = body.get("level")
    mastered = body.get("mastered", False)
    summoned = body.get("summoned", False)
    summon_cost = body.get("summon_cost")

    if not name or not variant:
        return jsonify({"error": "Name and variant are required."}), 400
    try:
        level = int(level)
        summon_cost = int(summon_cost)
    except (TypeError, ValueError):
        return jsonify({"error": "Level and Summon Cost must be numbers."}), 400

    collection = load_data()
    collection[name] = {
        "variant": variant,
        "level": level,
        "mastered": bool(mastered),
        "summoned": bool(summoned),
        "summon_cost": summon_cost
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
