import "leaflet/dist/leaflet.css";
import "./style.css";
import L from "leaflet";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import { applyTranslations, getLang, setLang, t, type Lang } from "./i18n";

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
  lat: number | null;
  lng: number | null;
  distance_km?: number;
}

interface SearchResponse {
  total: number;
  items: Item[];
}

/* ---------- Елементи на страницата ---------- */
const $ = <T extends HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;

const form = $<HTMLFormElement>("#search-form");
const qInput = $<HTMLInputElement>("#q");
const ecoInput = $<HTMLInputElement>("#eco");
const statusEl = $<HTMLParagraphElement>("#status");
const resultsEl = $<HTMLDivElement>("#results");
const locateBtn = $<HTMLButtonElement>("#locate");
const areaBtn = $<HTMLButtonElement>("#search-area");
const radiusSel = $<HTMLSelectElement>("#radius");
const mapStatus = $<HTMLParagraphElement>("#map-status");

/* ---------- Заявки към нашия бекенд ---------- */
async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

const search = (q: string, eco: boolean) =>
  getJson<SearchResponse>(
    `/api/search?${new URLSearchParams({ q, eco: String(eco), lang: getLang() })}`,
  );

const nearby = (lat: number, lng: number, km: number) =>
  getJson<SearchResponse>(
    `/api/nearby?${new URLSearchParams({
      lat: String(lat), lng: String(lng), km: String(km), lang: getLang(),
    })}`,
  );

const area = (b: L.LatLngBounds) =>
  getJson<SearchResponse>(
    `/api/area?${new URLSearchParams({
      south: String(Math.max(-90, b.getSouth())),
      north: String(Math.min(90, b.getNorth())),
      west: String(Math.max(-180, b.getWest())),
      east: String(Math.min(180, b.getEast())),
      lang: getLang(),
    })}`,
  );

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

/* Последното действие на картата, за да го повторим при смяна на езика */
let rerun: (() => Promise<void>) | null = null;

function showError(target: HTMLElement, error: unknown, withHint = false) {
  const msg = (error as Error).message;
  target.textContent = t("error", { msg }) + (withHint ? " " + t("serverHint") : "");
}

async function runNearby(lat: number, lng: number, km: number): Promise<void> {
  clearAll();
  L.circleMarker([lat, lng], { radius: 9, color: "#2f5d8a", fillOpacity: 0.9 })
    .addTo(youLayer)
    .bindPopup(t("youAreHere"));
  L.circle([lat, lng], { radius: km * 1000, color: "#2e6b4a", fill: false, weight: 1 })
    .addTo(youLayer);

  mapStatus.textContent = t("searchingEco");
  try {
    const data = await nearby(lat, lng, km);
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
  clearAll();
  mapStatus.textContent = t("searchingEco");
  try {
    const data = await area(map.getBounds());
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
      rerun = () => runNearby(lat, lng, km);
      await rerun();
    },
    (error) => {
      mapStatus.textContent = t("geoDenied", { msg: error.message });
    },
    { timeout: 15000 },
  );
});

areaBtn.addEventListener("click", () => {
  rerun = runArea;
  void runArea();
});

/* ---------- Търсачка ---------- */
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
  meta.textContent = [item.provider, item.country].filter(Boolean).join(", ");

  const link = document.createElement("a");
  link.href = item.link;
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = t("viewOn");
  link.className = "item-link";

  card.append(title, meta, link);
  return card;
}

async function runSearch(): Promise<void> {
  statusEl.textContent = t("searching");
  resultsEl.replaceChildren();
  try {
    const data = await search(qInput.value.trim(), ecoInput.checked);
    statusEl.textContent = t("foundSearch", {
      total: data.total.toLocaleString(getLang()),
      shown: data.items.length,
    });
    resultsEl.append(...data.items.map(renderItem));
  } catch (error) {
    showError(statusEl, error, true);
  }
}

let searched = false;

form.addEventListener("submit", (event) => {
  event.preventDefault();
  searched = true;
  void runSearch();
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

function refreshLanguage(): void {
  applyTranslations();
  fillRadius();
  document.querySelectorAll<HTMLButtonElement>(".lang button").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.lang === getLang()));
  });
}

document.querySelectorAll<HTMLButtonElement>(".lang button").forEach((button) => {
  button.addEventListener("click", () => {
    setLang(button.dataset.lang as Lang);
    refreshLanguage();
    // Презареждаме последните резултати на новия език
    if (searched) void runSearch();
    if (rerun) void rerun();
  });
});

refreshLanguage();