import os

import httpx

from .europeana import EU_URL, error_message, first, lang_aware

AIC_SEARCH_URL = "https://api.artic.edu/api/v1/artworks/search"
AIC_IIIF_DEFAULT = "https://www.artic.edu/iiif/2"
AIC_SITE = "https://www.artic.edu/artworks"

USER_AGENT = os.getenv(
    "NOMINATIM_USER_AGENT", "EcoCulturalHeritageApp/0.3 (academic project)"
)

# Стилове: ключ -> термини (на английски), по които търсим и в двете колекции.
STYLES: dict[str, list[str]] = {
    "byzantine": ["Byzantine", "icon"],
    "renaissance": ["Renaissance"],
    "mannerism": ["Mannerism"],
    "baroque": ["Baroque"],
    "rococo": ["Rococo"],
    "neoclassicism": ["Neoclassicism", "Neo-classicism", "Neo-Classicism"],
    "romanticism": ["Romanticism"],
    "realism": ["Realism"],
    "impressionism": ["Impressionism"],
    "post-impressionism": ["Post-Impressionism"],
    "symbolism": ["Symbolism"],
    "art-nouveau": ["Art Nouveau"],
    "expressionism": ["Expressionism"],
    "fauvism": ["Fauvism"],
    "cubism": ["Cubism"],
    "surrealism": ["Surrealism"],
    "abstract": ["Abstract", "Abstract Expressionism"],
    "pop-art": ["Pop Art"],
}

AIC_FIELDS = [
    "id", "title", "artist_title", "date_display", "date_start", "date_end",
    "style_title", "classification_titles", "medium_display", "place_of_origin",
    "credit_line", "image_id", "is_public_domain",
]


def _clean(text: str) -> str:
    """Маха символи, които могат да счупят заявка към Europeana."""
    return text.replace('"', " ").replace("\\", " ").strip()[:80]


def license_label(url: str | None) -> str:
    if not url:
        return ""
    low = url.lower()
    if "publicdomain/zero" in low:
        return "CC0"
    if "publicdomain/mark" in low:
        return "Public Domain"
    if "/licenses/" in low:
        return "CC " + low.split("/licenses/")[1].split("/")[0].upper()
    if "rightsstatements.org" in low:
        code = url.rstrip("/").split("/")[-2]
        return {"InC": "In copyright", "CNE": "Copyright not evaluated"}.get(code, code)
    return ""


# ---------- Art Institute of Chicago ----------

def aic_body(artist, style, year_from, year_to, page, rows) -> dict:
    must: list[dict] = [
        {"match": {"classification_titles": "painting"}},
        {"term": {"is_public_domain": True}},   # само произведения в обществено достояние
        {"exists": {"field": "image_id"}},
    ]
    if artist:
        must.append({"match": {"artist_title": {"query": _clean(artist), "operator": "and"}}})
    if style:
        must.append({"bool": {
            "should": [{"match_phrase": {"style_titles": t}} for t in STYLES[style]],
            "minimum_should_match": 1,
        }})
    if year_from is not None:
        must.append({"range": {"date_end": {"gte": year_from}}})
    if year_to is not None:
        must.append({"range": {"date_start": {"lte": year_to}}})
    return {"query": {"bool": {"must": must}}, "fields": AIC_FIELDS,
            "limit": rows, "page": page}


def aic_item(d: dict, iiif: str) -> dict | None:
    image_id = d.get("image_id")
    if not image_id:
        return None
    base = f"{iiif}/{image_id}"
    return {
        "id": f"aic:{d['id']}",
        "source": "aic",
        "title": d.get("title") or "(untitled)",
        "artist": d.get("artist_title") or "",
        "date": d.get("date_display") or "",
        "year_from": d.get("date_start"),
        "year_to": d.get("date_end"),
        "style": d.get("style_title") or "",
        "medium": d.get("medium_display") or "",
        "origin": d.get("place_of_origin") or "",
        "image": f"{base}/full/400,/0/default.jpg",
        "image_large": f"{base}/full/843,/0/default.jpg",
        "link": f"{AIC_SITE}/{d['id']}",
        "credit": d.get("credit_line") or "Art Institute of Chicago",
        "license": "CC0",
        "license_url": "https://creativecommons.org/publicdomain/zero/1.0/",
    }


async def search_aic(artist, style, year_from, year_to, page, rows) -> dict:
    body = aic_body(artist, style, year_from, year_to, page, rows)
    headers = {"User-Agent": USER_AGENT, "AIC-User-Agent": USER_AGENT}
    async with httpx.AsyncClient(timeout=20, headers=headers) as client:
        r = await client.post(AIC_SEARCH_URL, json=body)
    if r.status_code != 200:
        raise RuntimeError(f"Art Institute returned {r.status_code}")
    data = r.json()
    iiif = (data.get("config") or {}).get("iiif_url") or AIC_IIIF_DEFAULT
    items = [i for i in (aic_item(d, iiif) for d in data.get("data", [])) if i]
    return {"total": (data.get("pagination") or {}).get("total", 0), "items": items}


# ---------- Europeana ----------

def eu_query(artist, style) -> str:
    parts = ["what:painting"]
    if artist:
        parts.append(f'who:"{_clean(artist)}"')
    if style:
        terms = " OR ".join(
            f'"{t}"' if " " in t else t for t in STYLES[style]
        )
        parts.append(f"what:({terms})")
    return " AND ".join(parts)


def eu_filters(year_from, year_to) -> list[str]:
    qf = ["TYPE:IMAGE"]
    if year_from is not None or year_to is not None:
        low = "*" if year_from is None else year_from
        high = "*" if year_to is None else year_to
        qf.append(f"YEAR:[{low} TO {high}]")
    return qf


def _label_text(value) -> str:
    """Първият текст от поле като {"def": "Име"} или ["Име"]."""
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        for v in value:
            text = _label_text(v)
            if text:
                return text
    if isinstance(value, dict):
        for v in value.values():
            text = _label_text(v)
            if text:
                return text
    return ""


def eu_artist(item: dict) -> str:
    for name in item.get("dcCreator") or []:
        if isinstance(name, str) and not name.startswith("http"):
            return name
    return _label_text(item.get("edmAgentLabel"))


def eu_item(item: dict, lang: str) -> dict | None:
    preview = first(item.get("edmPreview"))
    if not preview:
        return None
    item_id = item.get("id") or ""
    year = first(item.get("year"))
    year_num = int(year) if isinstance(year, str) and year.lstrip("-").isdigit() else None
    rights = first(item.get("rights")) or ""
    sep = "&" if "?" in preview else "?"
    provider = first(item.get("dataProvider")) or ""
    return {
        "id": f"eu:{item_id}",
        "source": "europeana",
        "title": lang_aware(item.get("dcTitleLangAware"), lang)
                 or first(item.get("title")) or "(untitled)",
        "artist": eu_artist(item),
        "date": year or "",
        "year_from": year_num,
        "year_to": year_num,
        "style": "",
        "medium": "",
        "origin": first(item.get("country")) or "",
        "image": preview,
        "image_large": f"{preview}{sep}size=w400",
        "link": f"https://www.europeana.eu/item{item_id}",
        "credit": provider,
        "license": license_label(rights),
        "license_url": rights,
    }


async def search_europeana(artist, style, year_from, year_to, start, rows,
                           lang, reusable) -> dict:
    params = [
        ("wskey", os.getenv("EUROPEANA_KEY")),
        ("query", eu_query(artist, style)),
        ("rows", rows), ("start", start), ("profile", "rich"),
        ("media", "true"), ("thumbnail", "true"),
    ]
    if reusable:
        params.append(("reusability", "open"))
    params += [("qf", f) for f in eu_filters(year_from, year_to)]
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.get(EU_URL, params=params)
    if r.status_code != 200:
        raise RuntimeError(error_message(r))
    data = r.json()
    items = [i for i in (eu_item(d, lang) for d in data.get("items", [])) if i]
    return {"total": data.get("totalResults", 0), "items": items}


# ---------- Общ вход ----------

async def search(source, artist, style, year_from, year_to, page, rows,
                 lang="en", reusable=True) -> dict:
    if source == "aic":
        data = await search_aic(artist, style, year_from, year_to, page, rows)
    else:
        start = (page - 1) * rows + 1
        data = await search_europeana(artist, style, year_from, year_to,
                                      start, rows, lang, reusable)
    return {"source": source, "page": page, "rows": rows, **data}