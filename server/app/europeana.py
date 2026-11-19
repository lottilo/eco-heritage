import math
import os

import httpx
from dotenv import load_dotenv

load_dotenv()

EU_URL = "https://api.europeana.eu/record/v2/search.json"

# Теми за еко-културни обекти. Думите са на няколко европейски езика.
# Този речник ще развиваме по-нататък.
THEMES: dict[str, list[str]] = {
    "water": [
        "river", "lake", "wetland", "waterfall", "spring water", "coast",
        "река", "езеро", "водопад", "Fluss", "See", "rivière", "lac",
        "fiume", "lago", "río", "lago",
    ],
    "forest": [
        "forest", "woodland", "old trees", "oak", "beech",
        "гора", "дъб", "Wald", "forêt", "foresta", "bosque", "bosco",
    ],
    "garden": [
        "garden", "gardens", "park", "national park", "botanical garden",
        "градина", "парк", "Garten", "jardin", "giardino", "jardín",
    ],
    "agriculture": [
        "agriculture", "farming", "vineyard", "orchard", "shepherd", "pasture",
        "земеделие", "лозе", "овчар", "Landwirtschaft", "agriculture rurale",
        "agricoltura", "agricultura",
    ],
    "mountain": [
        "mountain", "alpine", "meadow", "valley", "glacier",
        "планина", "долина", "Berg", "montagne", "montagna", "montaña",
    ],
    "wildlife": [
        "wildlife", "biodiversity", "bird", "birds", "nature reserve", "flora", "fauna",
        "природа", "птици", "резерват", "Natur", "Vögel", "nature", "natura",
    ],
}

ALL_TERMS: list[str] = list(dict.fromkeys(t for terms in THEMES.values() for t in terms))


def _quote(term: str) -> str:
    return f'"{term}"' if " " in term else term


def eco_query(q: str | None, theme: str | None = None, strict: bool = True) -> str:
    """Построява заявка за еко теми.

    strict=True: търсим само в темата (what:) и в заглавието (title:).
    strict=False: търсим думите навсякъде (по-грубо, за сравнение).
    """
    terms = THEMES.get(theme, ALL_TERMS) if theme else ALL_TERMS
    joined = " OR ".join(_quote(t) for t in terms)
    eco = f"(what:({joined}) OR title:({joined}))" if strict else f"({joined})"
    if q and q != "*":
        return f"({q}) AND {eco}"
    return eco


def first(value):
    """Europeana връща много полета като списъци. Взимаме първия елемент."""
    if isinstance(value, list):
        return value[0] if value else None
    return value


def to_float(value):
    try:
        return float(first(value))
    except (TypeError, ValueError):
        return None


def lang_aware(value, lang: str = "en"):
    """Чете полета във вида {"bg": ["текст"], "en": ["text"]}.
    Предпочита избрания език, после английски, после каквото има."""
    if not isinstance(value, dict):
        return None
    for code in (lang, "en", "def"):
        if value.get(code):
            return value[code][0]
    for texts in value.values():
        if texts:
            return texts[0]
    return None


def clean_description(text: str) -> str:
    """Част от описанията са само връзка към речник (Getty). Не ни трябват."""
    if text.startswith("http"):
        return ""
    return text


def normalize(item: dict, lang: str = "en") -> dict:
    """Превръща един суров обект от Europeana в нашия формат."""
    item_id = item.get("id") or ""
    description = (
        lang_aware(item.get("dcDescriptionLangAware"), lang)
        or first(item.get("dcDescription"))
        or ""
    )
    return {
        "id": item_id,
        "title": lang_aware(item.get("dcTitleLangAware"), lang)
                 or first(item.get("title"))
                 or "(untitled)",
        "description": clean_description(description),
        "image": first(item.get("edmPreview")),
        # Сглобяваме връзката сами, за да не изтича API ключът
        "link": f"https://www.europeana.eu/item{item_id}",
        "country": first(item.get("country")) or "",
        "provider": first(item.get("dataProvider")) or "",
        "rights": first(item.get("rights")) or "",
        "type": item.get("type"),
        "lat": to_float(item.get("edmPlaceLatitude")),
        "lng": to_float(item.get("edmPlaceLongitude")),
    }


def haversine_km(lat1, lng1, lat2, lng2) -> float:
    """Разстояние между две точки на земята, в километри."""
    r = 6371
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def bbox_filters(south: float, north: float, west: float, east: float) -> list[str]:
    """Филтри на Europeana за правоъгълна област от картата."""
    return [
        f"pl_wgs84_pos_lat:[{south} TO {north}]",
        f"pl_wgs84_pos_long:[{west} TO {east}]",
    ]


async def search(query: str, rows: int = 24, start: int = 1,
                 qf: list[str] | None = None, lang: str = "en") -> dict:
    params = [
        ("wskey", os.getenv("EUROPEANA_KEY")),
        ("query", query),
        ("rows", rows),
        ("start", start),
        ("profile", "rich"),
    ]
    params += [("qf", f) for f in (qf or [])]

    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.get(EU_URL, params=params)

    if r.status_code != 200:
        raise RuntimeError(f"Europeana отговори с {r.status_code}: {r.text[:200]}")

    data = r.json()
    return {
        "total": data.get("totalResults", 0),
        "items": [normalize(i, lang) for i in data.get("items", [])],
    }