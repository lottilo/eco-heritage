import math
import os

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from . import europeana, geocode, places

app = FastAPI(title="Eco-Cultural Heritage API")


def parse_origins(raw: str) -> list[str]:
    """Чисти адресите: маха интервали, кавички и / накрая."""
    origins = []
    for o in raw.split(","):
        o = o.strip().strip('"').strip("'").rstrip("/")
        if o:
            origins.append(o)
    return origins


# Кои адреси на фронтенда имат право да викат бекенда.
allowed_origins = parse_origins(
    os.getenv("ALLOWED_ORIGINS", "http://localhost:5173")
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["GET"],
    allow_headers=["*"],
)

Lang = Query("en", pattern="^(bg|en)$")  # поддържани езици


def filters(
    category: str | None = None,
    theme: str | None = None,
    type: str | None = Query(None, pattern="^(IMAGE|TEXT|SOUND|VIDEO|3D)$"),
    country: str | None = Query(None, max_length=60),
    year_from: int | None = Query(None, ge=-3000, le=2100),
    year_to: int | None = Query(None, ge=-3000, le=2100),
    reusable: bool = False,
    strict: bool = True,
) -> dict:
    """Общите филтри за всички маршрути за търсене."""
    if category and category not in europeana.CATEGORIES:
        raise HTTPException(422, f"Unknown category: {category}")
    if theme and theme not in europeana.THEMES:
        raise HTTPException(422, f"Unknown theme: {theme}")
    if year_from is not None and year_to is not None and year_from > year_to:
        raise HTTPException(422, "year_from must not be greater than year_to")
    return {
        "category": category, "theme": theme, "type": type, "country": country,
        "year_from": year_from, "year_to": year_to,
        "reusable": reusable, "strict": strict,
    }


def query_from(q: str, eco: bool, f: dict) -> str:
    return europeana.build_query(q, eco, f["theme"], f["category"], f["strict"])


def filters_from(f: dict) -> list[str]:
    return europeana.build_filters(
        f["type"], f["country"], f["year_from"], f["year_to"]
    )

MAX_RESULTS = 1000  # Europeana дава достъп само до първите 1000 резултата


def paging(page: int, rows: int) -> int:
    """Превръща номер на страница в начална позиция и пази ограничението."""
    start = (page - 1) * rows + 1
    if start + rows - 1 > MAX_RESULTS:
        raise HTTPException(
            422, f"Only the first {MAX_RESULTS} results can be browsed. Narrow the search."
        )
    return start

@app.get("/")
def home():
    return {"message": "Server is running."}


@app.get("/api/categories")
def categories():
    """Списък с категориите и темите, за да ги показва фронтендът."""
    return {
        "categories": list(europeana.CATEGORIES),
        "themes": list(europeana.THEMES),
    }

@app.get("/api/geocode")
async def geocode_place(
    q: str = Query(min_length=2, max_length=100),
    lang: str = Lang,
):
    """Намира място по име и връща координати и област за картата."""
    try:
        return {"results": await geocode.geocode(q, lang)}
    except RuntimeError as e:
        raise HTTPException(502, str(e))


@app.get("/api/search")
async def search(
    q: str = "*",
    eco: bool = False,
    f: dict = Depends(filters),
    lang: str = Lang,
    page: int = Query(1, ge=1),
    rows: int = Query(24, ge=1, le=100),
):
    start = paging(page, rows)
    try:
        return await europeana.search(
            query_from(q, eco, f), rows=rows, start=start,
            qf=filters_from(f), lang=lang, reusable=f["reusable"],
        )
    except RuntimeError as e:
        raise HTTPException(502, str(e))


@app.get("/api/nearby")
async def nearby(
    lat: float = Query(ge=-90, le=90),
    lng: float = Query(ge=-180, le=180),
    km: float = Query(25, gt=0, le=200),
    q: str = "*",
    eco: bool = True,
    f: dict = Depends(filters),
    lang: str = Lang,
    page: int = Query(1, ge=1),
):
    # Груб квадрат около точката (1 градус ширина е около 111 км)
    d_lat = km / 111
    d_lng = km / (111 * math.cos(math.radians(lat)))
    qf = europeana.bbox_filters(lat - d_lat, lat + d_lat, lng - d_lng, lng + d_lng)
    qf += filters_from(f)

    try:
        data = await europeana.search(
        query_from(q, eco, f), rows=100, start=(page - 1) * 100 + 1,
        qf=qf, lang=lang, reusable=f["reusable"],
        )
    except RuntimeError as e:
        raise HTTPException(502, str(e))

    # Точен кръг: махаме обектите извън радиуса и подреждаме по близост
    items = []
    for o in data["items"]:
        if o["lat"] is None or o["lng"] is None:
            continue
        dist = europeana.haversine_km(lat, lng, o["lat"], o["lng"])
        if dist <= km:
            items.append({**o, "distance_km": round(dist, 1)})
    items.sort(key=lambda o: o["distance_km"])

    return {"total": data["total"], "returned": len(items), "items": items}


@app.get("/api/area")
async def area(
    south: float = Query(ge=-90, le=90),
    north: float = Query(ge=-90, le=90),
    west: float = Query(ge=-180, le=180),
    east: float = Query(ge=-180, le=180),
    q: str = "*",
    eco: bool = True,
    f: dict = Depends(filters),
    lang: str = Lang,
    page: int = Query(1, ge=1),
    rows: int = Query(100, ge=1, le=100),
):
    """Обекти във видимата част на картата (където и да е в Европа)."""
    if south >= north or west >= east:
        raise HTTPException(400, "Invalid area: need south < north and west < east.")

    start = paging(page, rows)
    qf = europeana.bbox_filters(south, north, west, east) + filters_from(f)

    try:
        data = await europeana.search(
            query_from(q, eco, f), rows=rows, start=start,
            qf=qf, lang=lang, reusable=f["reusable"],
        )
    except RuntimeError as e:
        raise HTTPException(502, str(e))

    items = [o for o in data["items"] if o["lat"] is not None and o["lng"] is not None]
    return {"total": data["total"], "returned": len(items), "items": items}


@app.get("/api/places")
async def places_in_area(
    south: float = Query(ge=-90, le=90),
    north: float = Query(ge=-90, le=90),
    west: float = Query(ge=-180, le=180),
    east: float = Query(ge=-180, le=180),
    category: str | None = Query(
        None, pattern="^(archaeology|architecture|religion|history|museum)$"
    ),
    lang: str = Lang,
    limit: int = Query(150, ge=1, le=300),
):
    """Исторически и културни обекти в област (от OpenStreetMap)."""
    if south >= north or west >= east:
        raise HTTPException(400, "Invalid area: need south < north and west < east.")
    try:
        return await places.find_places(south, north, west, east, category, lang, limit)
    except ValueError as e:
        raise HTTPException(422, str(e))
    except RuntimeError as e:
        raise HTTPException(503, str(e))