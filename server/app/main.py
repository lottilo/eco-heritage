import math
import os

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from . import europeana

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
# Няколко адреса се разделят със запетая.
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
Theme = Query(None, pattern="^(water|forest|garden|agriculture|mountain|wildlife)$")


def build_query(q: str, eco: bool, theme: str | None, strict: bool) -> str:
    """Тема винаги означава еко филтър, дори eco да е изключено."""
    if eco or theme:
        return europeana.eco_query(q, theme, strict)
    return q


@app.get("/")
def home():
    return {"message": "Server is running."}


@app.get("/api/debug-cors")
def debug_cors():
    """ВРЕМЕНЕН диагностичен маршрут. Ще го махнем след проверката."""
    return {
        "variable_is_set": os.getenv("ALLOWED_ORIGINS") is not None,
        "allowed_origins": allowed_origins,
    }


@app.get("/api/themes")
def themes():
    """Списък с темите, за да ги показва фронтендът."""
    return {"themes": list(europeana.THEMES)}


@app.get("/api/search")
async def search(
    q: str = "*",
    eco: bool = False,
    theme: str | None = Theme,
    strict: bool = True,
    lang: str = Lang,
    page: int = Query(1, ge=1),
):
    query = build_query(q, eco, theme, strict)
    try:
        return await europeana.search(
            query, rows=24, start=(page - 1) * 24 + 1, lang=lang
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
    theme: str | None = Theme,
    strict: bool = True,
    lang: str = Lang,
    page: int = Query(1, ge=1),
):
    # Груб квадрат около точката (1 градус ширина е около 111 км)
    d_lat = km / 111
    d_lng = km / (111 * math.cos(math.radians(lat)))
    qf = europeana.bbox_filters(lat - d_lat, lat + d_lat, lng - d_lng, lng + d_lng)
    query = build_query(q, eco, theme, strict)

    try:
        data = await europeana.search(
            query, rows=100, start=(page - 1) * 100 + 1, qf=qf, lang=lang
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
    theme: str | None = Theme,
    strict: bool = True,
    lang: str = Lang,
    page: int = Query(1, ge=1),
):
    """Обекти във видимата част на картата (където и да е в Европа)."""
    if south >= north or west >= east:
        raise HTTPException(400, "Invalid area: need south < north and west < east.")

    qf = europeana.bbox_filters(south, north, west, east)
    query = build_query(q, eco, theme, strict)

    try:
        data = await europeana.search(
            query, rows=100, start=(page - 1) * 100 + 1, qf=qf, lang=lang
        )
    except RuntimeError as e:
        raise HTTPException(502, str(e))

    items = [o for o in data["items"] if o["lat"] is not None and o["lng"] is not None]
    return {"total": data["total"], "returned": len(items), "items": items}