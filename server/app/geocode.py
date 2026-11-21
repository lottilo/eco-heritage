import asyncio
import os
import time

import httpx
from cachetools import TTLCache

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"

# Политиката на Nominatim изисква User-Agent, който идентифицира приложението.
USER_AGENT = os.getenv(
    "NOMINATIM_USER_AGENT", "EcoCulturalHeritageApp/0.2 (academic project)"
)

_cache: TTLCache = TTLCache(maxsize=500, ttl=24 * 3600)  # 24 часа
_lock = asyncio.Lock()
_last_call = 0.0
MIN_GAP = 1.1  # секунди между заявките (изискването е най-много 1 в секунда)
MIN_SPAN = 0.02  # минимален размер на областта в градуси, за много малки места


async def _throttle() -> None:
    """Изчаква, за да не надвишим 1 заявка в секунда към Nominatim."""
    global _last_call
    async with _lock:
        wait = MIN_GAP - (time.monotonic() - _last_call)
        if wait > 0:
            await asyncio.sleep(wait)
        _last_call = time.monotonic()


def _parse(place: dict) -> dict:
    # Nominatim връща boundingbox като [юг, север, запад, изток] (текст)
    south, north, west, east = (float(x) for x in place["boundingbox"])
    # Малките обекти имат почти нулева област. Разширяваме я.
    if north - south < MIN_SPAN:
        mid = (north + south) / 2
        south, north = mid - MIN_SPAN / 2, mid + MIN_SPAN / 2
    if east - west < MIN_SPAN:
        mid = (east + west) / 2
        west, east = mid - MIN_SPAN / 2, mid + MIN_SPAN / 2
    return {
        "name": place.get("display_name", ""),
        "category": place.get("category"),
        "kind": place.get("type"),
        "lat": float(place["lat"]),
        "lng": float(place["lon"]),
        "south": south,
        "north": north,
        "west": west,
        "east": east,
    }


async def geocode(query: str, lang: str = "en", limit: int = 5) -> list[dict]:
    """Превръща име на място (град, област, държава) в координати и област."""
    key = (query.strip().lower(), lang, limit)
    if key in _cache:
        return _cache[key]

    await _throttle()
    params = {
        "q": query,
        "format": "jsonv2",
        "limit": limit,
        "accept-language": lang,
    }
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(
            NOMINATIM_URL, params=params, headers={"User-Agent": USER_AGENT}
        )

    if r.status_code != 200:
        raise RuntimeError(f"Geocoder returned {r.status_code}")

    results = [_parse(p) for p in r.json() if "boundingbox" in p]
    _cache[key] = results
    return results