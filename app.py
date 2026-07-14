import re
from pathlib import Path

from flask import Flask, render_template, jsonify, url_for

app = Flask(__name__)

VARIANTS = ["Normal", "Gold", "Gummy", "Galaxy", "Holofoil"]

VARIANT_PERKS = {
    "Normal": "Core standard baseline ability of that Sprite.",
    "Gold":   "3× Sprite XP for every elimination secured during a match.",
    "Gummy":  "+10% bonus Sprite Dust upon extraction.",
    "Galaxy": "+30% more ammunition when opening ammo crates and looting.",
    "Holofoil": "+30% chance to find Rare Sprites"
}

# max_level defaults to 5 for all sprites; Dream Sprite is capped at 4.
SPRITE_DIRECTORY = {
    # ── RARE ──────────────────────────────────────────────────────────────
    "Water Sprite": {
        "rarity": "Rare", "max_level": 5,
        "ability": "Replenishes shield while in water for you and your nearby Squad.",
        "costs": {"Normal": 2000, "Gold": 4000, "Gummy": 4000, "Galaxy": 4000, "Holofoil": 4000},
        "levels": {
            1: "Slowly replenishes your shield while standing in water.",
            2: "Faster shield regen in water; small shield regen extended to nearby allies.",
            3: "Shield regen rate increased significantly; squad regen radius expanded.",
            4: "Full squad receives rapid shield regen while in water.",
            5: "Maximum shield regen for entire squad; triggers instantly on water entry.",
        }
    },
    "Earth Sprite": {
        "rarity": "Rare", "max_level": 5,
        "ability": "Gives a chance to find additional rare items when opening chests.",
        "costs": {"Normal": 2000, "Gold": 4000, "Gummy": 4000, "Galaxy": 4000},
        "levels": {
            1: "Small chance to find an extra item when opening a chest.",
            2: "Improved chance; bonus item quality increased to uncommon.",
            3: "Rare item chance significantly increased; broader item pool.",
            4: "High chance of extra rare item; occasional epic bonus item.",
            5: "Guaranteed extra rare item per chest; chance for epic or legendary bonus.",
        }
    },
    "Fire Sprite": {
        "rarity": "Rare", "max_level": 5,
        "ability": "Creates a fiery burst when you deal enough damage to an enemy.",
        "costs": {"Normal": 2000, "Gold": 4000, "Gummy": 4000, "Galaxy": 4000, "Holofoil": 4000},
        "levels": {
            1: "Small fiery burst triggers after dealing 200 damage to an enemy.",
            2: "Larger burst; damage threshold reduced to 175.",
            3: "Burst deals bonus area damage; threshold reduced to 150.",
            4: "Burst deals significant area damage; threshold reduced to 125.",
            5: "Maximum burst damage; triggers after only 100 damage dealt.",
        }
    },
    "Fishy Sprite": {
        "rarity": "Rare", "max_level": 5,
        "ability": "Increases swimming speed and gives a movement boost after taking damage.",
        "costs": {"Normal": 2000, "Gold": 4000, "Gummy": 4000, "Galaxy": 4000},
        "levels": {
            1: "Minor swim speed boost; short movement burst after taking damage.",
            2: "Faster swimming; improved post-damage movement boost duration.",
            3: "Significant swim speed increase; strong extended movement buff.",
            4: "Near-maximum swim speed; long-duration post-damage movement buff.",
            5: "Maximum swim speed and extended post-damage movement overdrive.",
        }
    },

    # ── EPIC ──────────────────────────────────────────────────────────────
    "Duck Sprite": {
        "rarity": "Epic", "max_level": 5,
        "ability": "Emoting or Jamming on the battlefield slowly replenishes your shields.",
        "costs": {"Normal": 3000, "Gold": 6000, "Gummy": 6000, "Galaxy": 6000, "Holofoil": 6000},
        "levels": {
            1: "Restores 5 shield per second while emoting or jamming.",
            2: "Restores 10 shield/s; emote duration required reduced.",
            3: "Restores 15 shield/s; bonus applies to nearby squad members.",
            4: "Restores 20 shield/s; squad regen radius increased.",
            5: "Restores 25 shield/s for you and your full squad while emoting.",
        }
    },
    "Ghost Sprite": {
        "rarity": "Epic", "max_level": 5,
        "ability": "Grants a temporary active cloak duration immediately upon reloading.",
        "costs": {"Normal": 3000, "Gold": 6000, "Gummy": 6000, "Galaxy": 6000, "Holofoil": 6000},
        "levels": {
            1: "Grants 1 second of cloak immediately upon reloading.",
            2: "Cloak duration extended to 2 seconds.",
            3: "Cloak lasts 3 seconds; movement speed slightly increased while cloaked.",
            4: "Cloak lasts 4 seconds; full movement speed while cloaked.",
            5: "Maximum 5-second cloak with full speed; near-invisible while active.",
        }
    },
    "Demon Sprite": {
        "rarity": "Epic", "max_level": 5,
        "ability": "Siphons a portion of health and shields when you eliminate an opponent.",
        "costs": {"Normal": 3000, "Gold": 6000, "Gummy": 6000, "Galaxy": 6000},
        "levels": {
            1: "Siphon 10 HP/shield from each elimination.",
            2: "Siphon 20 HP/shield from each elimination.",
            3: "Siphon 30 HP/shield from each elimination.",
            4: "Siphon 40 HP/shield from each elimination.",
            5: "Siphon 50 HP/shield per elimination; excess converts to overshield.",
        }
    },
    "King Sprite": {
        "rarity": "Epic", "max_level": 5,
        "ability": "Your Harvesting Tool Pickaxe deals significantly more swing damage.",
        "costs": {"Normal": 3000, "Gold": 6000, "Gummy": 6000, "Galaxy": 6000, "Holofoil": 6000},
        "levels": {
            1: "Pickaxe deals +10% more damage per swing.",
            2: "Pickaxe deals +20% more damage per swing.",
            3: "Pickaxe deals +35% more damage; structures harvested faster.",
            4: "Pickaxe deals +50% more damage; one-shots low-HP structures.",
            5: "Maximum pickaxe damage; instant harvest on weakened materials.",
        }
    },
    "Aura Sprite": {
        "rarity": "Epic", "max_level": 5,
        "ability": "Gain a Shock Rock consumable charge when you deal enough enemy damage.",
        "costs": {"Normal": 3000, "Gold": 6000, "Gummy": 6000, "Galaxy": 6000},
        "levels": {
            1: "Earn 1 Shock Rock charge after dealing 500 damage to enemies.",
            2: "Charge earned at 400 damage; can hold up to 2 charges.",
            3: "Charge earned at 300 damage; faster recharge between procs.",
            4: "Charge earned at 200 damage; can hold up to 3 charges.",
            5: "Charge earned at 150 damage; maximum 4 charges stored.",
        }
    },
    "Striker Sprite": {
        "rarity": "Epic", "max_level": 5,
        "ability": "Gain a functional speed Overdrive buff whenever you Mantle or Hurdle.",
        "costs": {"Normal": 3000, "Gold": 6000, "Gummy": 6000, "Galaxy": 6000, "Holofoil": 6000},
        "levels": {
            1: "Brief 1-second speed boost after each Mantle or Hurdle.",
            2: "Speed boost lasts 2 seconds; slightly faster sprint.",
            3: "Speed boost lasts 3 seconds; significantly faster sprint.",
            4: "Speed boost lasts 4 seconds; chains on consecutive Mantles.",
            5: "Maximum speed overdrive lasting 5 seconds; stacks on repeated movement.",
        }
    },

    # ── LEGENDARY ─────────────────────────────────────────────────────────
    "Punk Sprite": {
        "rarity": "Legendary", "max_level": 5,
        "ability": "Has no effect below Level 5. At Level 5 (Mastered): Grants infinite ammunition for the entire match.",
        "costs": {"Normal": 5000, "Gold": 10000, "Gummy": 10000, "Galaxy": 10000},
        "levels": {
            1: "No active effect at this level.",
            2: "No active effect at this level.",
            3: "No active effect at this level.",
            4: "No active effect at this level.",
            5: "Grants infinite ammunition for the entire match.",
        }
    },
    "Dream Sprite": {
        "rarity": "Legendary", "max_level": 4,
        "ability": "Grants a random item at match start based on current level. Cannot reach Level 5 — mastery is tracked separately.",
        "costs": {"Normal": 5000, "Gold": 10000, "Gummy": 10000, "Galaxy": 10000},
        "levels": {
            1: "Grants 1 random common item at match start.",
            2: "Grants 1 random uncommon item at match start.",
            3: "Grants 1 random rare item at match start.",
            4: "Grants 1 random epic item at match start. (Maximum level for this sprite.)",
        }
    },
    "Boss Sprite": {
        "rarity": "Legendary", "max_level": 5,
        "ability": "Increases maximum health and shield limits. Dropped by defeating roaming map bosses.",
        "costs": {"Normal": 5000, "Gold": 10000, "Gummy": 10000, "Galaxy": 10000},
        "levels": {
            1: "Increases max health and shields by +25 each.",
            2: "Increases max health and shields by +50 each.",
            3: "Increases max health and shields by +75 each.",
            4: "Increases max health and shields by +100 each.",
            5: "Increases max health and shields by +150 each; enhanced passive regen.",
        }
    },

    # ── MYTHIC ────────────────────────────────────────────────────────────
    "Grim Reaper Sprite": {
        "rarity": "Mythic", "max_level": 5,
        "ability": "Instantly executes downed enemies in range and reveals nearby opponents after each elimination.",
        "costs": {"Normal": 7500, "Gold": 15000, "Gummy": 15000, "Galaxy": 15000},
        "levels": {
            1: "Executes downed enemies within 5m; reveals nearby enemies for 2 seconds.",
            2: "Execution range extends to 8m; enemy reveal lasts 3 seconds.",
            3: "Execution range extends to 12m; reveal lasts 4 seconds with location pulse.",
            4: "Execution range extends to 16m; extended reveal with directional ping.",
            5: "Maximum execution range; persistent enemy reveal for 6 seconds after each elimination.",
        }
    },
    "Zero Point Sprite": {
        "rarity": "Mythic", "max_level": 5,
        "ability": "Deploys a defensive Shield Bubble Jr. protecting you automatically as you heal.",
        "costs": {"Normal": 7500, "Gold": 15000, "Gummy": 15000, "Galaxy": 15000},
        "levels": {
            1: "Deploys a small Shield Bubble Jr. while healing; lasts 5 seconds.",
            2: "Slightly larger bubble; duration extended to 8 seconds.",
            3: "Medium bubble; lasts 10 seconds; auto-deploys on low health.",
            4: "Large bubble; lasts 12 seconds; faster auto-deploy trigger.",
            5: "Maximum bubble size; permanent auto-deploy; absorbs significantly more damage.",
        }
    },
    "Burnt Peanut Sprite": {
        "rarity": "Mythic", "max_level": 5,
        "ability": "Acts as a loot-amplifier. Grants a chance to generate bonus high-tier loot upon eliminating an opponent. At max level also adds a 10% chance for bonus loot to be Mythic rarity.",
        "costs": {"Normal": 7500},
        "levels": {
            1: "20% chance to generate bonus high-tier loot upon eliminating an opponent.",
            2: "30% chance to generate bonus high-tier loot upon elimination.",
            3: "40% chance to generate bonus high-tier loot upon elimination.",
            4: "50% chance to generate bonus high-tier loot upon elimination.",
            5: "60% chance for bonus high-tier loot upon elimination, plus a 10% chance for that bonus loot to be Mythic rarity.",
        }
    },
}

TERMINAL_SERVICES = [
    {"name": "Locate Sprites Map Marker",         "cost": 100,   "limit": None,           "category": "Utility"},
    {"name": "20,000 Battle Pass XP",              "cost": 1000,  "limit": "Once per day", "category": "XP"},
    {"name": "Portable Extractor",                 "cost": 2000,  "limit": "Once per day", "category": "Utility"},
    {"name": "Weapon Upgrade: Common → Uncommon",  "cost": 250,   "limit": None,           "category": "Weapon"},
    {"name": "Weapon Upgrade: Uncommon → Rare",    "cost": 500,   "limit": None,           "category": "Weapon"},
    {"name": "Weapon Upgrade: Rare → Epic",        "cost": 1000,  "limit": None,           "category": "Weapon"},
    {"name": "Weapon Upgrade: Epic → Legendary",   "cost": 2000,  "limit": None,           "category": "Weapon"},
]

TOTAL_VARIANTS = sum(len(info["costs"]) for info in SPRITE_DIRECTORY.values())

SPRITE_IMAGE_DIR = Path(__file__).parent / "static" / "sprites"
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"}
VARIANT_IMAGE_KEYWORDS = {
    "Normal": ["default", "ui", "normal"],
    "Gold": ["gold"],
    "Gummy": ["candy", "gummy"],
    "Galaxy": ["galaxy"],
    "Holofoil": ["holo", "holofoil"],
    "Gem": ["gem"],
    "Quack": ["quack"],
}


def _normalize_token(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (value or "").lower())


def _tokenize(value: str) -> set[str]:
    return {token for token in re.split(r"[^a-z0-9]+", (value or "").lower()) if token}


def _list_sprite_images() -> list[Path]:
    if not SPRITE_IMAGE_DIR.exists():
        return []
    return [path for path in SPRITE_IMAGE_DIR.iterdir() if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS]


def _candidate_match_score(candidate_path: Path, sprite_name: str) -> int:
    candidate_slug = _normalize_token(candidate_path.name)
    sprite_slug = _normalize_token(sprite_name).replace("sprite", "")
    if sprite_slug and sprite_slug in candidate_slug:
        return 1000 + len(sprite_slug)

    sprite_tokens = _tokenize(sprite_name) - {"sprite"}
    candidate_tokens = _tokenize(candidate_path.name) - {"sprite"}
    overlap = sprite_tokens & candidate_tokens
    if overlap:
        return len(overlap) * 100 + len(overlap)

    if sprite_slug and candidate_slug and sprite_slug[0:3] == candidate_slug[0:3]:
        return 10

    return 0


def _resolve_sprite_image(sprite_name: str, variant: str | None = None) -> str | None:
    base_slug = _normalize_token(sprite_name).replace("sprite", "")
    if not base_slug:
        return None

    candidates = [path for path in _list_sprite_images() if _candidate_match_score(path, sprite_name) > 0]
    if not candidates:
        return None

    ranked_candidates = sorted(candidates, key=lambda path: _candidate_match_score(path, sprite_name), reverse=True)
    variant_key = variant or "Normal"

    if variant_key == "Normal":
        normal_candidates = [
            candidate for candidate in ranked_candidates
            if "unvault" in _normalize_token(candidate.name)
            or not any(token in _normalize_token(candidate.name) for token in ["gold", "candy", "gummy", "galaxy", "holo", "gem", "quack"])
        ]
        if normal_candidates:
            return url_for("static", filename=f"sprites/{normal_candidates[0].name}")

    if variant_key in {"Gem", "Quack"}:
        keywords = VARIANT_IMAGE_KEYWORDS.get(variant_key, [])
        variant_matches = [
            candidate for candidate in ranked_candidates
            if any(keyword in _normalize_token(candidate.name) for keyword in keywords)
        ]
        if variant_matches:
            return url_for("static", filename=f"sprites/{variant_matches[0].name}")
        return None

    keywords = VARIANT_IMAGE_KEYWORDS.get(variant_key, [])
    variant_matches = [
        candidate for candidate in ranked_candidates
        if any(keyword in _normalize_token(candidate.name) for keyword in keywords)
    ]
    if variant_matches:
        return url_for("static", filename=f"sprites/{variant_matches[0].name}")

    fallback_candidates = [
        candidate for candidate in ranked_candidates
        if not any(token in _normalize_token(candidate.name) for token in ["gold", "candy", "gummy", "galaxy", "holo", "gem", "quack"])
    ]
    if fallback_candidates:
        return url_for("static", filename=f"sprites/{fallback_candidates[0].name}")

    return url_for("static", filename=f"sprites/{ranked_candidates[0].name}")


def _enrich_sprite_directory(sprite_directory: dict) -> dict:
    enriched = {}
    for name, info in sprite_directory.items():
        item = dict(info)
        item["image"] = _resolve_sprite_image(name, "Normal")
        item["images"] = {
            variant: _resolve_sprite_image(name, variant)
            for variant in VARIANTS + ["Gem", "Quack"]
        }
        enriched[name] = item
    return enriched


# Extraction dust yield: base amount per rarity+level
EXTRACTION_BASE = {
    "Rare":      {1: 200,  2: 300,  3: 450,  4: 600,  5: 1000},
    "Epic":      {1: 500,  2: 750,  3: 1000, 4: 1500, 5: 2500},
    "Legendary": {1: 1000, 2: 1500, 3: 2250, 4: 3500, 5: 5000},
    "Mythic":    {1: 2000, 2: 3000, 3: 4500, 4: 6000, 5: 8000},
}


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/directory")
def get_directory():
    return jsonify({
        "sprites":          _enrich_sprite_directory(SPRITE_DIRECTORY),
        "variants":         VARIANTS,
        "variant_perks":    VARIANT_PERKS,
        "terminal":         TERMINAL_SERVICES,
        "total_variants":   TOTAL_VARIANTS,
        "extraction_base":  EXTRACTION_BASE,
    })


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
