import math
import os

import httpx
from dotenv import load_dotenv

load_dotenv()

EU_URL = "https://api.europeana.eu/record/v2/search.json"

# Еко теми (от Стъпка 14)
THEMES: dict[str, list[str]] = {
    "water": [
        "river", "lake", "wetland", "waterfall", "spring water", "coast",
        "река", "езеро", "водопад", "Fluss", "See", "rivière", "lac",
        "fiume", "lago", "río",
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
        "земеделие", "лозе", "овчар", "Landwirtschaft", "agricoltura", "agricultura",
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

# Културни и исторически категории. Списъкът ще се развива.
CATEGORIES: dict[str, list[str]] = {
    "archaeology": [
        "archaeology", "archaeological", "excavation", "ruins", "antiquity",
        "roman", "thracian", "necropolis", "artefact",
        "археология", "археологически", "разкопки", "антични", "тракийски",
        "некропол", "Archäologie", "archéologie", "archeologia", "arqueología",
    ],
    "architecture": [
        "architecture", "fortress", "castle", "bridge", "palace", "building",
        "архитектура", "крепост", "замък", "мост", "дворец",
        "Architektur", "architecture", "architettura", "arquitectura",
    ],
    "history": [
        "history", "historical", "battle", "war", "uprising", "revolution", "treaty",
        "история", "битка", "война", "въстание", "революция", "договор",
        "Geschichte", "histoire", "storia", "historia",
    ],
    "politics": [
        "politics", "government", "parliament", "king", "tsar", "monarchy", "election",
        "политика", "правителство", "парламент", "цар", "монархия",
        "Politik", "politique", "politica",
    ],
    "religion": [
        "church", "monastery", "icon", "cathedral", "mosque", "synagogue",
        "църква", "манастир", "икона", "катедрала", "джамия",
        "Kirche", "église", "chiesa", "iglesia",
    ],
    "folklore": [
        "folklore", "costume", "traditional", "ethnography", "folk art",
        "фолклор", "носия", "традиционен", "етнография",
        "Volkskunde", "folklore", "etnografia",
    ],
    "photography": [
        "photograph", "photography", "postcard", "daguerreotype",
        "фотография", "снимка", "пощенска картичка",
        "Fotografie", "photographie", "fotografia",
    ],
    "maps": [
        "map", "atlas", "plan", "cartography", "chart",
        "карта", "план", "картография", "Karte", "carte", "mappa", "mapa",
    ],
}

ALL_ECO_TERMS: list[str] = list(
    dict.fromkeys(t for terms in THEMES.values() for t in terms)
)


def _quote(term: str) -> str:
    return f'"{term}"' if " " in term else term


def terms_clause(terms: list[str], strict: bool = True) -> str:
    """Заявка по списък от думи.
    strict=True: само в темата (what:) и в заглавието (title:).
    strict=False: навсякъде (по-грубо)."""
    joined = " OR ".join(_quote(t) for t in terms)
    if strict:
        return f"(what:({joined}) OR title:({joined}))"
    return f"({joined})"


def build_query(
    q: str | None,
    eco: bool = False,
    theme: str | None = None,
    category: str | None = None,
    strict: bool = True,
) -> str:
    """Събира думата за търсене, категорията и темата в една заявка."""
    parts: list[str] = []
    if q and q != "*":
        parts.append(f"({q})")
    if category:
        parts.append(terms_clause(CATEGORIES[category], strict))
    if theme:
        parts.append(terms_clause(THEMES[theme], strict))
    # Общият еко филтър се прилага само ако не е избрана категория или тема
    if eco and not category and not theme:
        parts.append(terms_clause(ALL_ECO_TERMS, strict))
    return " AND ".join(parts) if parts else "*"


def build_filters(
    type: str | None = None,
    country: str | None = None,
    year_from: int | None = None,
    year_to: int | None = None,
) -> list[str]:
    """Филтри (qf) на Europeana, които не променят подредбата по релевантност."""
    qf: list[str] = []
    if type:
        qf.append(f"TYPE:{type}")
    if country:
        qf.append(f'COUNTRY:"{country.replace(chr(34), "")}"')
    if year_from is not None or year_to is not None:
        low = "*" if year_from is None else year_from
        high = "*" if year_to is None else year_to
        qf.append(f"YEAR:[{low} TO {high}]")
    return qf

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
        "year": first(item.get("year")),
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

def error_message(response: httpx.Response) -> str:
    """Безопасно съобщение за грешка: без ключове и без суров отговор."""
    text = f"Europeana returned {response.status_code}"
    try:
        data = response.json()
        detail = data.get("error") or data.get("message")
        if detail:
            text += f": {detail}"
    except ValueError:
        pass
    return text

async def search(query: str, rows: int = 24, start: int = 1,
                 qf: list[str] | None = None, lang: str = "en",
                 reusable: bool = False) -> dict:
    params = [
        ("wskey", os.getenv("EUROPEANA_KEY")),
        ("query", query),
        ("rows", rows),
        ("start", start),
        ("profile", "rich"),
    ]
    if reusable:
        params.append(("reusability", "open"))  # отделен параметър, не qf
    params += [("qf", f) for f in (qf or [])]

    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.get(EU_URL, params=params)

    if r.status_code != 200:
        raise RuntimeError(error_message(r))

    data = r.json()
    return {
        "total": data.get("totalResults", 0),
        "items": [normalize(i, lang) for i in data.get("items", [])],
    }