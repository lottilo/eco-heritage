import random

from cachetools import TTLCache

from . import art

POOL_ROWS = 40   # колко картини взимаме наведнъж, за да изберем от тях
MAX_TRIES = 6    # колко пъти опитваме да съставим въпрос
MARGIN = 5       # години от границата на периода, за да няма спорове

# Стилове, които са добре застъпени сред картините в обществено достояние.
QUIZ_STYLES = [
    "renaissance", "baroque", "rococo", "neoclassicism", "romanticism",
    "realism", "impressionism", "post-impressionism", "symbolism",
    "art-nouveau", "expressionism", "fauvism", "cubism", "surrealism",
]

# Периоди: (ключ, от година, до година). Редът е хронологичен.
ERAS: list[tuple[str, int | None, int | None]] = [
    ("medieval", None, 1400),
    ("renaissance", 1400, 1600),
    ("baroque", 1600, 1750),
    ("enlightenment", 1750, 1850),
    ("late19", 1850, 1900),
    ("modern", 1900, 1950),
]
ERA_ORDER = [e[0] for e in ERAS]

_pool_cache: TTLCache = TTLCache(maxsize=300, ttl=3600)  # по-малко заявки към музея

_STYLE_BY_TERM = {t.lower(): key for key, terms in art.STYLES.items() for t in terms}


def style_key_of(style_title: str | None) -> str | None:
    """Превръща стила от каталога на музея в наш ключ (или None)."""
    if not style_title:
        return None
    return _STYLE_BY_TERM.get(style_title.strip().lower())


def era_of(item: dict) -> str | None:
    """Периодът на картината, ако е ясно вътре в него."""
    start, end = item.get("year_from"), item.get("year_to")
    if not isinstance(start, int) or not isinstance(end, int):
        return None
    for key, low, high in ERAS:
        if (low is None or start >= low + MARGIN) and (high is None or end <= high - MARGIN):
            return key
    return None


async def _pool(style: str | None, year_from: int | None, year_to: int | None,
                page: int) -> list[dict]:
    key = (style, year_from, year_to, page)
    if key in _pool_cache:
        return _pool_cache[key]
    data = await art.search_aic(None, style, year_from, year_to, page, POOL_ROWS)
    items = data["items"]
    _pool_cache[key] = items
    return items


async def _pool_with_fallback(style, year_from, year_to, max_page, rng) -> list[dict]:
    page = rng.randint(1, max_page)
    items = await _pool(style, year_from, year_to, page)
    if not items and page > 1:  # избраната страница е извън резултатите
        items = await _pool(style, year_from, year_to, 1)
    return items


def _details(item: dict) -> dict:
    return {k: item.get(k) for k in (
        "title", "artist", "date", "style", "medium", "origin",
        "link", "credit", "license", "license_url",
    )}


def _question(item: dict, qtype: str, options: list[str], answer: str) -> dict:
    return {
        "id": item["id"],
        "type": qtype,
        "image": item["image_large"],
        "options": options,
        "answer": answer,
        "details": _details(item),
    }


async def _style_question(exclude: set[str], rng) -> dict | None:
    key = rng.choice(QUIZ_STYLES)
    items = await _pool_with_fallback(key, None, None, 4, rng)
    candidates = [i for i in items
                  if i["id"] not in exclude and style_key_of(i["style"]) == key]
    if not candidates:
        return None
    item = rng.choice(candidates)
    others = rng.sample([s for s in QUIZ_STYLES if s != key], 3)
    options = [key, *others]
    rng.shuffle(options)
    return _question(item, "style", options, key)


async def _artist_question(exclude: set[str], rng) -> dict | None:
    # Картини от един стил, за да са правдоподобни и грешните отговори
    key = rng.choice(QUIZ_STYLES)
    items = await _pool_with_fallback(key, None, None, 4, rng)
    with_artist = [i for i in items if i.get("artist")]
    artists = sorted({i["artist"] for i in with_artist})
    if len(artists) < 4:
        return None
    candidates = [i for i in with_artist if i["id"] not in exclude]
    if not candidates:
        return None
    item = rng.choice(candidates)
    others = rng.sample([a for a in artists if a != item["artist"]], 3)
    options = [item["artist"], *others]
    rng.shuffle(options)
    return _question(item, "artist", options, item["artist"])


async def _era_question(exclude: set[str], rng) -> dict | None:
    key, low, high = rng.choice(ERAS)
    items = await _pool_with_fallback(None, low, high, 3, rng)
    candidates = [i for i in items if i["id"] not in exclude and era_of(i) == key]
    if not candidates:
        return None
    item = rng.choice(candidates)
    others = rng.sample([e for e in ERA_ORDER if e != key], 3)
    options = sorted([key, *others], key=ERA_ORDER.index)  # по хронологичен ред
    return _question(item, "era", options, key)


_BUILDERS = {"style": _style_question, "artist": _artist_question, "era": _era_question}


async def make_question(qtype: str, exclude: set[str] | None = None, rng=random) -> dict:
    builder = _BUILDERS[qtype]
    skip = exclude or set()
    for _ in range(MAX_TRIES):
        question = await builder(skip, rng)
        if question:
            return question
    raise RuntimeError("Could not build a question right now. Please try again.")