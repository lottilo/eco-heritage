import "leaflet/dist/leaflet.css";
import "./style.css";
import L from "leaflet";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import { applyTranslations, getLang, setLang, t, type Lang } from "./i18n";
import { COUNTRIES } from "./countries";

interface Item {
  id: string;
  title: string;
  description: string;
  image: string | null;
  link: string;
  country: string;
  provider: string;
  rights: string;
  type: string | null;
  year: string | null;
  lat: number | null;
  lng: number | null;
  distance_km?: number;
}

interface SearchResponse {
  total: number;
  items: Item[];
}

interface Box {
  south: number;
  north: number;
  west: number;
  east: number;
}

interface Place extends Box {
  name: string;
  category: string | null;
  kind: string | null;
  lat: number;
  lng: number;
}

interface GeocodeResponse {
  results: Place[];
}

/* ---------- Елементи на страницата ---------- */
const $ = <T extends HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;

const form = $<HTMLFormElement>("#search-form");
const placeInput = $<HTMLInputElement>("#place");
const placeInfo = $<HTMLDivElement>("#place-info");
const qInput = $<HTMLInputElement>("#q");
const ecoInput = $<HTMLInputElement>("#eco");
const statusEl = $<HTMLParagraphElement>("#status");
const resultsEl = $<HTMLDivElement>("#results");
const locateBtn = $<HTMLButtonElement>("#locate");
const areaBtn = $<HTMLButtonElement>("#search-area");
const radiusSel = $<HTMLSelectElement>("#radius");
const mapStatus = $<HTMLParagraphElement>("#map-status");

const categorySel = $<HTMLSelectElement>("#category");
const typeSel = $<HTMLSelectElement>("#type");
const countrySel = $<HTMLSelectElement>("#country");
const yearFromInput = $<HTMLInputElement>("#year-from");
const yearToInput = $<HTMLInputElement>("#year-to");
const reusableInput = $<HTMLInputElement>("#reusable");
const clearBtn = $<HTMLButtonElement>("#clear-filters");

/* ---------- Филтри ---------- */
function filterParams(): URLSearchParams {
  const p = new URLSearchParams();
  const add = (key: string, value: string) => {
    if (value) p.set(key, value);
  };
  add("category", categorySel.value);
  add("type", typeSel.value);
  add("country", countrySel.value);
  add("year_from", yearFromInput.value.trim());
  add("year_to", yearToInput.value.trim());
  if (reusableInput.checked) p.set("reusable", "true");
  return p;
}

function yearsOk(target: HTMLElement): boolean {
  const from = yearFromInput.value.trim();
  const to = yearToInput.value.trim();
  if (from && to && Number(from) > Number(to)) {
    target.textContent = t("badYears");
    return false;
  }
  return true;
}

clearBtn.addEventListener("click", () => {
  placeInput.value = "";
  placeInfo.replaceChildren();
  categorySel.value = "";
  typeSel.value = "";
  countrySel.value = "";
  yearFromInput.value = "";
  yearToInput.value = "";
  reusableInput.checked = false;
});

/* ---------- Заявки към нашия бекенд ---------- */
// Локално е празен (ползва се Vite proxy), онлайн се задава от променлива.
const API_BASE = import.meta.env.VITE_API_URL ?? "";

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(API_BASE + url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

function withCommon(params: URLSearchParams, eco: boolean): URLSearchParams {
  params.set("eco", String(eco));
  params.set("lang", getLang());
  for (const [key, value] of filterParams()) params.set(key, value);
  return params;
}

const keyword = () => qInput.value.trim() || "*";

const PAGE_SIZE = 24;
const MAX_RESULTS = 1000; // Europeana дава достъп само до първите 1000 резултата

const search = (eco: boolean, page = 1) =>
  getJson<SearchResponse>(
    `/api/search?${withCommon(
      new URLSearchParams({
        q: keyword(), page: String(page), rows: String(PAGE_SIZE),
      }),
      eco,
    )}`,
  );

const nearby = (lat: number, lng: number, km: number, eco: boolean) =>
  getJson<SearchResponse>(
    `/api/nearby?${withCommon(
      new URLSearchParams({
        lat: String(lat), lng: String(lng), km: String(km), q: keyword(),
      }),
      eco,
    )}`,
  );

const area = (box: Box, eco: boolean, page = 1, rows = 100) =>
  getJson<SearchResponse>(
    `/api/area?${withCommon(
      new URLSearchParams({
        south: String(box.south),
        north: String(box.north),
        west: String(box.west),
        east: String(box.east),
        q: keyword(),
        page: String(page),
        rows: String(rows),
      }),
      eco,
    )}`,
  );

const geocode = (q: string) =>
  getJson<GeocodeResponse>(
    `/api/geocode?${new URLSearchParams({ q, lang: getLang() })}`,
  );

function boxOf(b: L.LatLngBounds): Box {
  return {
    south: Math.max(-90, b.getSouth()),
    north: Math.min(90, b.getNorth()),
    west: Math.max(-180, b.getWest()),
    east: Math.min(180, b.getEast()),
  };
}

/* ---------- Карта (започваме с цяла Европа) ---------- */
const map = L.map("map").setView([52, 15], 4);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 18,
  attribution: "&copy; OpenStreetMap",
}).addTo(map);

// Твоята позиция и кръгът на радиуса не се групират
const youLayer = L.layerGroup().addTo(map);
// Обектите от Europeana се групират в клъстери
const cluster = L.markerClusterGroup({ maxClusterRadius: 45 }).addTo(map);

function clearAll(): void {
  youLayer.clearLayers();
  cluster.clearLayers();
}

function popupFor(item: Item): HTMLElement {
  const box = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = item.title;
  const link = document.createElement("a");
  link.href = item.link;
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = t("viewOn");
  box.append(title, document.createElement("br"), link);
  return box;
}

function addMarkers(items: Item[]): void {
  for (const item of items) {
    if (item.lat === null || item.lng === null) continue;
    L.circleMarker([item.lat, item.lng], {
      radius: 6, color: "#2e6b4a", fillOpacity: 0.7,
    }).addTo(cluster).bindPopup(popupFor(item));
  }
}

/* Последните действия, за да ги повторим при смяна на езика.
   rerunList: търсенето и резултатите. rerunMap: бутоните на картата. */
let rerunList: (() => Promise<void>) | null = null;
let rerunMap: (() => Promise<void>) | null = null;
let runId = 0; // за да игнорираме остарели отговори

function showError(target: HTMLElement, error: unknown, withHint = false) {
  const msg = (error as Error).message;
  target.textContent = t("error", { msg }) + (withHint ? " " + t("serverHint") : "");
}

async function runNearby(lat: number, lng: number, km: number): Promise<void> {
  if (!yearsOk(mapStatus)) return;
  clearAll();
  L.circleMarker([lat, lng], { radius: 9, color: "#2f5d8a", fillOpacity: 0.9 })
    .addTo(youLayer)
    .bindPopup(t("youAreHere"));
  L.circle([lat, lng], { radius: km * 1000, color: "#2e6b4a", fill: false, weight: 1 })
    .addTo(youLayer);

  mapStatus.textContent = t("searchingMap");
  try {
    const data = await nearby(lat, lng, km, ecoInput.checked);
    addMarkers(data.items);
    mapStatus.textContent = data.items.length
      ? t("foundRadius", { km, n: data.items.length })
      : t("noObjects");
  } catch (error) {
    showError(mapStatus, error);
  }
}

async function runArea(): Promise<void> {
  if (map.getZoom() < 5) {
    mapStatus.textContent = t("zoomIn");
    return;
  }
  if (!yearsOk(mapStatus)) return;
  clearAll();
  mapStatus.textContent = t("searchingMap");
  try {
    const data = await area(boxOf(map.getBounds()), ecoInput.checked);
    addMarkers(data.items);
    mapStatus.textContent = data.items.length
      ? t("foundArea", { n: data.items.length })
      : t("noObjects");
  } catch (error) {
    showError(mapStatus, error);
  }
}

locateBtn.addEventListener("click", () => {
  if (!navigator.geolocation) {
    mapStatus.textContent = t("noGeo");
    return;
  }
  mapStatus.textContent = t("locating");

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const { latitude: lat, longitude: lng } = position.coords;
      const km = Number(radiusSel.value);
      map.setView([lat, lng], km > 50 ? 8 : km > 25 ? 9 : km > 5 ? 10 : 12);
      rerunMap = () => runNearby(lat, lng, km);
      await rerunMap();
    },
    (error) => {
      mapStatus.textContent = t("geoDenied", { msg: error.message });
    },
    { timeout: 15000 },
  );
});

areaBtn.addEventListener("click", () => {
  rerunMap = runArea;
  void runArea();
});

/* ---------- Резултати ---------- */
function renderItem(item: Item): HTMLElement {
  const card = document.createElement("article");
  card.className = "card";

  if (item.image) {
    const img = document.createElement("img");
    img.src = item.image;
    img.alt = "";
    img.loading = "lazy";
    card.append(img);
  }

  const title = document.createElement("h3");
  title.textContent = item.title;

  const meta = document.createElement("small");
  meta.textContent = [item.provider, item.country, item.year]
    .filter(Boolean)
    .join(", ");

  const link = document.createElement("a");
  link.href = item.link;
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = t("viewOn");
  link.className = "item-link";

  card.append(title, meta, link);
  return card;
}

/* ---------- Прелистване ---------- */
let page = 1;
const pagerEl = $<HTMLDivElement>("#pager");

function renderPager(total: number): void {
  pagerEl.replaceChildren();
  const maxPages = Math.floor(MAX_RESULTS / PAGE_SIZE);
  const allPages = Math.ceil(total / PAGE_SIZE);
  const pages = Math.min(allPages, maxPages);
  if (pages <= 1) return;

  const go = (delta: number) => {
    page += delta;
    void rerunList?.();
    $<HTMLElement>("#results-title").scrollIntoView({ behavior: "smooth" });
  };

  const prev = document.createElement("button");
  prev.type = "button";
  prev.textContent = t("prev");
  prev.disabled = page <= 1;
  prev.addEventListener("click", () => go(-1));

  const label = document.createElement("span");
  label.textContent = t("pageOf", { page, pages });

  const next = document.createElement("button");
  next.type = "button";
  next.textContent = t("next");
  next.disabled = page >= pages;
  next.addEventListener("click", () => go(1));

  pagerEl.append(prev, label, next);

  if (allPages > maxPages) {
    const note = document.createElement("small");
    note.textContent = t("limitNote", { n: MAX_RESULTS });
    pagerEl.append(note);
  }
}

/* Търсене без място: по дума и филтри */
async function runSearch(): Promise<void> {
  if (!yearsOk(statusEl)) return;
  const id = ++runId;
  statusEl.textContent = t("searching");
  resultsEl.replaceChildren();
  pagerEl.replaceChildren();
  try {
    const data = await search(ecoInput.checked, page);
    if (id !== runId) return;
    statusEl.textContent = data.items.length
      ? t("foundSearch", {
          total: data.total.toLocaleString(getLang()),
          shown: data.items.length,
        })
      : t("noResults");
    resultsEl.append(...data.items.map(renderItem));
    renderPager(data.total);
  } catch (error) {
    if (id === runId) showError(statusEl, error, true);
  }
}

/* Търсене в област на избрано място */
const shortName = (name: string) => name.split(",")[0].trim();

async function runPlace(place: Place): Promise<void> {
  if (!yearsOk(statusEl)) return;
  const id = ++runId;
  const label = shortName(place.name);
  clearAll();
  resultsEl.replaceChildren();
  pagerEl.replaceChildren();
  if (page === 1) {
    map.fitBounds([
      [place.south, place.west],
      [place.north, place.east],
    ]);
  }
  statusEl.textContent = t("searchingIn", { place: label });
  try {
    const data = await area(place, ecoInput.checked, page, PAGE_SIZE);
    if (id !== runId) return;
    addMarkers(data.items);
    statusEl.textContent = data.items.length
      ? t("foundInPlace", {
          place: label,
          n: data.items.length,
          total: data.total.toLocaleString(getLang()),
        })
      : t("noResults");
    resultsEl.append(...data.items.map(renderItem));
    renderPager(data.total);
  } catch (error) {
    if (id === runId) showError(statusEl, error, true);
  }
}

/* Показва другите съвпадения за мястото като бутони */
function showAlternatives(places: Place[], chosen: Place): void {
  placeInfo.replaceChildren();
  const others = places.filter((p) => p !== chosen);
  if (!others.length) return;

  const label = document.createElement("span");
  label.textContent = t("otherMatches");
  placeInfo.append(label);

  for (const p of others) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "alt-place";
    button.textContent = p.name;
    button.addEventListener("click", () => {
      page = 1;
      rerunList = () => runPlace(p);
      showAlternatives(places, p);
      void runPlace(p);
    });
    placeInfo.append(button);
  }
}

async function submitSearch(): Promise<void> {
  const placeText = placeInput.value.trim();
  placeInfo.replaceChildren();
  page = 1;

  if (!placeText) {
    rerunList = runSearch;
    await runSearch();
    return;
  }

  if (!yearsOk(statusEl)) return;
  statusEl.textContent = t("searchingPlace");
  try {
    const { results } = await geocode(placeText);
    if (!results.length) {
      statusEl.textContent = t("placeNotFound");
      return;
    }
    const chosen = results[0];
    rerunList = () => runPlace(chosen);
    rerunMap = null; // картата вече показва резултатите от мястото
    showAlternatives(results, chosen);
    await runPlace(chosen);
  } catch (error) {
    showError(statusEl, error, true);
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void submitSearch();
});

/* ---------- Език ---------- */
const RADII = [5, 10, 25, 50, 100, 200];

function fillRadius(): void {
  const selected = radiusSel.value || "25";
  radiusSel.replaceChildren(
    ...RADII.map((n) => {
      const option = document.createElement("option");
      option.value = String(n);
      option.textContent = `${n} ${t("km")}`;
      option.selected = String(n) === selected;
      return option;
    }),
  );
}

function fillCountries(): void {
  const selected = countrySel.value;
  const label = ([en, bg]: [string, string]) => (getLang() === "bg" ? bg : en);
  const sorted = [...COUNTRIES].sort((a, b) =>
    label(a).localeCompare(label(b), getLang()),
  );
  countrySel.replaceChildren(
    new Option(t("allCountries"), ""),
    ...sorted.map((c) => new Option(label(c), c[0])),
  );
  countrySel.value = selected;
}

function refreshLanguage(): void {
  applyTranslations();
  fillRadius();
  fillCountries();
  document.querySelectorAll<HTMLButtonElement>(".lang button").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.lang === getLang()));
  });
}

document.querySelectorAll<HTMLButtonElement>(".lang button").forEach((button) => {
  button.addEventListener("click", () => {
    setLang(button.dataset.lang as Lang);
    refreshLanguage();
    // Повтаряме последните действия на новия език
    if (rerunList) void rerunList();
    if (rerunMap) void rerunMap();
  });
});

refreshLanguage();