import "./style.css";
import { getLang, setLang, type Lang } from "./i18n";
import { applyGalleryTranslations, ta, type AKey } from "./gallery-i18n";

type Source = "europeana" | "aic";

interface Painting {
  id: string;
  source: Source;
  title: string;
  artist: string;
  date: string;
  year_from: number | null;
  year_to: number | null;
  style: string;
  medium: string;
  origin: string;
  image: string;
  image_large: string;
  link: string;
  credit: string;
  license: string;
  license_url: string;
}

interface ArtResponse {
  source: Source;
  page: number;
  rows: number;
  total: number;
  items: Painting[];
}

/* ---------- Елементи ---------- */
const $ = <T extends HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;

const form = $<HTMLFormElement>("#art-form");
const artistInput = $<HTMLInputElement>("#artist");
const styleSel = $<HTMLSelectElement>("#style");
const periodSel = $<HTMLSelectElement>("#period");
const yearFromInput = $<HTMLInputElement>("#year-from");
const yearToInput = $<HTMLInputElement>("#year-to");
const reusableRow = $<HTMLLabelElement>("#reusable-row");
const reusableInput = $<HTMLInputElement>("#reusable");
const resetBtn = $<HTMLButtonElement>("#reset");
const sourceNote = $<HTMLParagraphElement>("#source-note");
const statusEl = $<HTMLParagraphElement>("#art-status");
const galleryEl = $<HTMLDivElement>("#gallery");
const pagerEl = $<HTMLDivElement>("#art-pager");
const viewer = $<HTMLDialogElement>("#viewer");
const viewerBody = $<HTMLDivElement>("#viewer-body");

/* ---------- Данни за филтрите (ключовете съвпадат с бекенда) ---------- */
const STYLE_KEYS = [
  "byzantine", "renaissance", "mannerism", "baroque", "rococo", "neoclassicism",
  "romanticism", "realism", "impressionism", "post-impressionism", "symbolism",
  "art-nouveau", "expressionism", "fauvism", "cubism", "surrealism", "abstract",
  "pop-art",
];

interface Period {
  id: string;
  from: number | null;
  to: number | null;
}

const PERIODS: Period[] = [
  { id: "medieval", from: null, to: 1400 },
  { id: "renaissance", from: 1400, to: 1600 },
  { id: "baroque", from: 1600, to: 1750 },
  { id: "enlightenment", from: 1750, to: 1850 },
  { id: "late19", from: 1850, to: 1900 },
  { id: "modern", from: 1900, to: 1950 },
  { id: "contemporary", from: 1950, to: null },
];

/* ---------- Заявки ---------- */
const API_BASE = import.meta.env.VITE_API_URL ?? "";

/** Адреси, които започват с /, са от нашия бекенд (напр. картините от Чикаго). */
const imgUrl = (u: string) => (u.startsWith("/") ? API_BASE + u : u);
const PAGE_SIZE = 24;
const MAX_RESULTS = 1000; // Europeana дава достъп само до първите 1000 резултата

let source: Source = "europeana";
let page = 1;
let runId = 0;

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(API_BASE + url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

function params(): URLSearchParams {
  const p = new URLSearchParams({
    source,
    lang: getLang(),
    page: String(page),
    rows: String(PAGE_SIZE),
  });
  const add = (key: string, value: string) => {
    if (value) p.set(key, value);
  };
  add("artist", artistInput.value.trim());
  add("style", styleSel.value);
  add("year_from", yearFromInput.value.trim());
  add("year_to", yearToInput.value.trim());
  if (source === "europeana") p.set("reusable", String(reusableInput.checked));
  return p;
}

function yearsOk(): boolean {
  const from = yearFromInput.value.trim();
  const to = yearToInput.value.trim();
  if (from && to && Number(from) > Number(to)) {
    statusEl.textContent = ta("badYears");
    return false;
  }
  return true;
}

/* ---------- Изглед на картина ---------- */
function addRow(list: HTMLElement, label: AKey, value: string): void {
  if (!value) return;
  const dt = document.createElement("dt");
  dt.textContent = ta(label);
  const dd = document.createElement("dd");
  dd.textContent = value;
  list.append(dt, dd);
}

function openViewer(p: Painting): void {
  const img = document.createElement("img");
  img.src = imgUrl(p.image_large);
  img.alt = p.title;
  img.referrerPolicy = "no-referrer";
  // Ако големият размер не се зареди, връщаме се към умалената картина
  img.addEventListener("error", () => {
     if (img.src !== new URL(imgUrl(p.image), location.href).href) img.src = imgUrl(p.image);
  }, { once: true });

  const info = document.createElement("div");
  info.className = "viewer-info";

  const title = document.createElement("h2");
  title.textContent = p.title;
  const artist = document.createElement("p");
  artist.className = "viewer-artist";
  artist.textContent = p.artist || ta("unknownArtist");

  const list = document.createElement("dl");
  addRow(list, "lblDate", p.date);
  addRow(list, "lblStyle", p.style);
  addRow(list, "lblMedium", p.medium);
  addRow(list, "lblOrigin", p.origin);
  addRow(list, "lblCredit", p.credit);

  if (p.license) {
    const dt = document.createElement("dt");
    dt.textContent = ta("lblLicense");
    const dd = document.createElement("dd");
    if (p.license_url.startsWith("http")) {
      const a = document.createElement("a");
      a.href = p.license_url;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = p.license;
      dd.append(a);
    } else {
      dd.textContent = p.license;
    }
    list.append(dt, dd);
  }

  const link = document.createElement("a");
  link.href = p.link;
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = ta("viewAtSource");

  const close = document.createElement("button");
  close.type = "button";
  close.className = "viewer-close";
  close.textContent = ta("close");
  close.addEventListener("click", () => viewer.close());

  info.append(title, artist, list, link, close);
  viewerBody.replaceChildren(img, info);
  viewer.showModal();
}

viewer.addEventListener("click", (event) => {
  if (event.target === viewer) viewer.close(); // клик извън съдържанието
});

/* ---------- Мрежа и прелистване ---------- */
function renderCard(p: Painting): HTMLElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "art-card";

  const img = document.createElement("img");
  img.src = imgUrl(p.image);
  img.alt = p.artist ? `${p.title} — ${p.artist}` : p.title;
  img.loading = "lazy";
  img.referrerPolicy = "no-referrer";

  const caption = document.createElement("span");
  caption.className = "art-caption";
  const title = document.createElement("strong");
  title.textContent = p.title;
  const meta = document.createElement("small");
  meta.textContent = [p.artist, p.date].filter(Boolean).join(", ");
  caption.append(title, meta);

  button.append(img, caption);
  button.addEventListener("click", () => openViewer(p));
  return button;
}

function renderPager(total: number): void {
  pagerEl.replaceChildren();
  const maxPages = Math.floor(MAX_RESULTS / PAGE_SIZE);
  const allPages = Math.ceil(total / PAGE_SIZE);
  const pages = Math.min(allPages, maxPages);
  if (pages <= 1) return;

  const go = (delta: number) => {
    page += delta;
    void runSearch();
    galleryEl.scrollIntoView({ behavior: "smooth" });
  };

  const prev = document.createElement("button");
  prev.type = "button";
  prev.textContent = ta("prev");
  prev.disabled = page <= 1;
  prev.addEventListener("click", () => go(-1));

  const label = document.createElement("span");
  label.textContent = ta("pageOf", { page, pages });

  const next = document.createElement("button");
  next.type = "button";
  next.textContent = ta("next");
  next.disabled = page >= pages;
  next.addEventListener("click", () => go(1));

  pagerEl.append(prev, label, next);

  if (allPages > maxPages) {
    const note = document.createElement("small");
    note.textContent = ta("limitNote", {
      n: (maxPages * PAGE_SIZE).toLocaleString(getLang()),
      total: total.toLocaleString(getLang()),
    });
    pagerEl.append(note);
  }
}

async function runSearch(): Promise<void> {
  if (!yearsOk()) return;
  const id = ++runId;
  statusEl.textContent = ta("searching");
  galleryEl.replaceChildren();
  pagerEl.replaceChildren();
  try {
    const data = await getJson<ArtResponse>(`/api/art/search?${params()}`);
    if (id !== runId) return;
    statusEl.textContent = data.items.length
      ? ta("found", {
          total: data.total.toLocaleString(getLang()),
          shown: data.items.length,
        })
      : ta("none");
    galleryEl.append(...data.items.map(renderCard));
    renderPager(data.total);
  } catch (error) {
    if (id === runId) {
      statusEl.textContent = ta("error", { msg: (error as Error).message });
    }
  }
}

/* ---------- Филтри и раздели ---------- */
function fillStyles(): void {
  const selected = styleSel.value;
  styleSel.replaceChildren(
    new Option(ta("anyStyle"), ""),
    ...STYLE_KEYS.map((k) => new Option(ta(`st_${k}` as AKey), k)),
  );
  styleSel.value = selected;
}

function fillPeriods(): void {
  const selected = periodSel.value;
  periodSel.replaceChildren(
    new Option(ta("anyPeriod"), ""),
    ...PERIODS.map((p) => new Option(ta(`p_${p.id}` as AKey), p.id)),
  );
  periodSel.value = selected;
}

periodSel.addEventListener("change", () => {
  const period = PERIODS.find((p) => p.id === periodSel.value);
  yearFromInput.value = period?.from != null ? String(period.from) : "";
  yearToInput.value = period?.to != null ? String(period.to) : "";
});

// Ако годините се променят ръчно, периодът става „свободен“
const clearPreset = () => {
  periodSel.value = "";
};
yearFromInput.addEventListener("input", clearPreset);
yearToInput.addEventListener("input", clearPreset);

function updateSourceUI(): void {
  document.querySelectorAll<HTMLButtonElement>(".tab").forEach((tab) => {
    tab.setAttribute("aria-selected", String(tab.dataset.source === source));
  });
  sourceNote.textContent = ta(source === "aic" ? "noteAic" : "noteEuropeana");
  reusableRow.hidden = source === "aic"; // Чикаго показва само CC0
}

document.querySelectorAll<HTMLButtonElement>(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    source = tab.dataset.source as Source;
    page = 1;
    updateSourceUI();
    void runSearch();
  });
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  page = 1;
  void runSearch();
});

resetBtn.addEventListener("click", () => {
  artistInput.value = "";
  styleSel.value = "";
  periodSel.value = "";
  yearFromInput.value = "";
  yearToInput.value = "";
  reusableInput.checked = true;
  page = 1;
  void runSearch();
});

/* ---------- Език ---------- */
function refresh(): void {
  document.documentElement.lang = getLang();
  applyGalleryTranslations();
  fillStyles();
  fillPeriods();
  updateSourceUI();
  document.querySelectorAll<HTMLButtonElement>(".lang button").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.lang === getLang()));
  });
}

document.querySelectorAll<HTMLButtonElement>(".lang button").forEach((button) => {
  button.addEventListener("click", () => {
    setLang(button.dataset.lang as Lang);
    refresh();
    void runSearch(); // заглавията се обновяват на новия език
  });
});

refresh();
void runSearch();