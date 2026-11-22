import asyncio
import os
import time

import httpx
from cachetools import TTLCache

# Публични сървъри на Overpass. Пробват се по ред, ако първият е зает.
OVERPASS_ENDPOINTS = [
    e.strip()
    for e in os.getenv(
        "OVERPASS_ENDPOINTS",
        "https://overpass-api.de/api/interpreter,"
        "https://overpass.private.coffee/api/interpreter",
    ).split(",")
    if e.strip()
]

USER_AGENT = os.getenv(
    "NOMINATIM_USER_AGENT", "EcoCulturalHeritageApp/0.3 (academic project)"
)

MAX_SPAN = 1.0       # най-много 1 градус по ширина и дължина (около голям град)
RAW_LIMIT = 800      # най-много елементи от една заявка към Overpass
ATTEMPTS = 3         # колко пъти обхождаме сървърите
DEADLINE = 55        # секунди, след които се отказваме

_raw_cache: TTLCache = TTLCache(maxsize=100, ttl=24 * 3600)    # 24 часа
_stale: TTLCache = TTLCache(maxsize=100, ttl=7 * 24 * 3600)    # резервно копие, 7 дни
_lock = asyncio.Lock()  # не пускаме две тежки заявки едновременно

# Само обекти с име. Използват се тагове на OpenStreetMap.
SELECTORS: dict[str, list[str]] = {
    "archaeology": [
        '["historic"~"^(archaeological_site|ruins|tomb)$"]["name"]',
    ],
    "architecture": [
        '["historic"~"^(castle|fort|city_gate|citywalls|manor|building|aqueduct)$"]["name"]',
    ],
    "religion": [
        '["historic"~"^(monastery|wayside_shrine|wayside_cross)$"]["name"]',
        '["amenity"="place_of_worship"]["wikidata"]["name"]',
        '["amenity"="place_of_worship"]["heritage"]["name"]',
    ],
    "history": [
        '["historic"~"^(monument|memorial|battlefield|cannon)$"]'
        '["memorial"!~"^(plaque|stolperstein|bench|ghost_bike)$"]["name"]',
    ],
    "museum": [
        '["tourism"="museum"]["name"]',
    ],
}
CATEGORIES = list(SELECTORS)

_ARCHAEOLOGY = {"archaeological_site", "ruins", "tomb"}
_ARCHITECTURE = {"castle", "fort", "city_gate", "citywalls", "manor", "building", "aqueduct"}
_RELIGION = {"monastery", "wayside_shrine", "wayside_cross"}


def build_query(box: tuple[float, float, float, float],
                category: str | None, limit: int) -> str:
    south, north, west, east = box
    bbox = f"({south},{west},{north},{east})"  # редът в Overpass: юг, запад, север, изток
    cats = [category] if category else CATEGORIES
    parts = "".join(
        f"nwr{selector}{bbox};" for c in cats for selector in SELECTORS[c]
    )
    return f"[out:json][timeout:25];({parts});out center {limit};"


def classify(tags: dict) -> str:
    historic = tags.get("historic")
    if historic in _ARCHAEOLOGY:
        return "archaeology"
    if historic in _ARCHITECTURE:
        return "architecture"
    if historic in _RELIGION or tags.get("amenity") == "place_of_worship":
        return "religion"
    if tags.get("tourism") == "museum":
        return "museum"
    if historic:
        return "history"
    return "heritage"


def normalize(el: dict, lang: str = "en") -> dict | None:
    tags = el.get("tags") or {}
    center = el.get("center") or {}
    lat = el.get("lat", center.get("lat"))
    lng = el.get("lon", center.get("lon"))
    name = tags.get(f"name:{lang}") or tags.get("name") or tags.get("name:en")
    if lat is None or lng is None or not name:
        return None
    kind = tags.get("historic") or tags.get("tourism") or tags.get("amenity") or ""
    return {
        "id": f"osm:{el['type']}/{el['id']}",
        "title": name,
        "description": tags.get(f"description:{lang}") or tags.get("description") or "",
        "category": classify(tags),
        "kind": kind,
        "lat": float(lat),
        "lng": float(lng),
        "source": "OpenStreetMap",
        "license": "ODbL",
        "link": f"https://www.openstreetmap.org/{el['type']}/{el['id']}",
        "wikidata": tags.get("wikidata"),
        "wikipedia": tags.get("wikipedia"),
    }


def _score(item: dict) -> int:
    """По-известните обекти (с Wikidata или Wikipedia) се показват първи."""
    return (2 if item["wikidata"] else 0) + (1 if item["wikipedia"] else 0)


async def _run(query: str) -> dict:
    """Праща заявката към Overpass. При заетост пробва пак и с втория сървър."""
    deadline = time.monotonic() + DEADLINE
    last_error = "unknown error"
    async with httpx.AsyncClient(
        timeout=30, headers={"User-Agent": USER_AGENT}
    ) as client:
        for attempt in range(ATTEMPTS):
            for endpoint in OVERPASS_ENDPOINTS:
                if time.monotonic() > deadline:
                    raise RuntimeError(
                        f"Places service is temporarily unavailable ({last_error})"
                    )
                try:
                    r = await client.post(endpoint, data={"data": query})
                except httpx.HTTPError as e:
                    last_error = type(e).__name__
                    continue
                if r.status_code != 200:
                    last_error = f"HTTP {r.status_code}"
                    continue
                try:
                    data = r.json()
                except ValueError:
                    last_error = "invalid response"
                    continue
                if data.get("remark") and not data.get("elements"):
                    last_error = "query error or timeout"
                    continue
                return data
            if attempt < ATTEMPTS - 1:
                await asyncio.sleep(2 * (attempt + 1))  # 2 с, после 4 с
    raise RuntimeError(f"Places service is temporarily unavailable ({last_error})")


async def _raw_elements(box: tuple[float, float, float, float]) -> tuple[list, bool]:
    """Всички културни обекти в областта. Връща (елементи, са ли_стари).

    Заявката е една за всички категории, затова смяната на категория или
    език след първото зареждане е мигновена."""
    key = tuple(round(x, 3) for x in box)
    if key in _raw_cache:
        return _raw_cache[key], False
    async with _lock:
        if key in _raw_cache:  # някой друг вече е свършил същата работа
            return _raw_cache[key], False
        try:
            data = await _run(build_query(box, None, RAW_LIMIT))
        except RuntimeError:
            if key in _stale:  # по-добре стари данни, отколкото грешка
                return _stale[key], True
            raise
        elements = data.get("elements", [])
        _raw_cache[key] = elements
        _stale[key] = elements
        return elements, False


async def find_places(
    south: float, north: float, west: float, east: float,
    category: str | None = None, lang: str = "en", limit: int = 150,
) -> dict:
    if north - south > MAX_SPAN or east - west > MAX_SPAN:
        raise ValueError("Area too large. Zoom in or choose a city.")

    elements, stale = await _raw_elements((south, north, west, east))

    items = [i for i in (normalize(e, lang) for e in elements) if i]
    if category:
        items = [i for i in items if i["category"] == category]
    # Махаме повторенията (един обект може да е в няколко селектора)
    unique = {i["id"]: i for i in items}
    ordered = sorted(unique.values(), key=lambda i: (-_score(i), i["title"]))
    return {
        "returned": len(ordered[:limit]),
        "stale": stale,
        "truncated": len(elements) >= RAW_LIMIT,
        "items": ordered[:limit],
    }