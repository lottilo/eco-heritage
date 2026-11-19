export type Lang = "bg" | "en";

const dict = {
  bg: {
    title: "Eco-Cultural Heritage App",
    searchPlaceholder: "Напр. Рила, градина, река…",
    ecoOnly: "Само еко теми",
    search: "Търси",
    nearMeTitle: "На картата",
    locate: "Покажи обекти около мен",
    radius: "Радиус",
    km: "км",
    searchArea: "Търси в тази област",
    resultsTitle: "Резултати от търсенето",
    viewOn: "Виж в Europeana",
    searching: "Търся…",
    locating: "Определям къде си…",
    searchingEco: "Търся еко-културни обекти…",
    foundSearch: "Намерени: {total}. Показани: {shown}.",
    foundRadius: "Намерени обекти в {km} км: {n}.",
    foundArea: "Намерени обекти в тази област: {n}.",
    noObjects: "Няма намерени обекти. Опитай друга област или по-голям радиус.",
    zoomIn: "Приближи картата (поне ниво 5), за да търсиш в областта.",
    youAreHere: "Ти си тук",
    noGeo: "Браузърът ти не поддържа геолокация.",
    geoDenied: "Няма достъп до местоположението ({msg}). Разреши го в браузъра.",
    error: "Грешка: {msg}.",
    serverHint: "Работи ли Python сървърът на порт 3001?",
  },
  en: {
    title: "Eco-Cultural Heritage App",
    searchPlaceholder: "E.g. Rila, garden, river…",
    ecoOnly: "Eco topics only",
    search: "Search",
    nearMeTitle: "On the map",
    locate: "Show places near me",
    radius: "Radius",
    km: "km",
    searchArea: "Search this area",
    resultsTitle: "Search results",
    viewOn: "View on Europeana",
    searching: "Searching…",
    locating: "Finding your location…",
    searchingEco: "Looking for eco-cultural places…",
    foundSearch: "Found: {total}. Shown: {shown}.",
    foundRadius: "Places within {km} km: {n}.",
    foundArea: "Places in this area: {n}.",
    noObjects: "Nothing found. Try another area or a larger radius.",
    zoomIn: "Zoom in (at least level 5) to search the area.",
    youAreHere: "You are here",
    noGeo: "Your browser does not support geolocation.",
    geoDenied: "Cannot access your location ({msg}). Please allow it in the browser.",
    error: "Error: {msg}.",
    serverHint: "Is the Python server running on port 3001?",
  },
} as const;

export type Key = keyof typeof dict.bg;

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem("lang");
    if (saved === "bg" || saved === "en") return saved;
  } catch {
    /* localStorage може да е недостъпен */
  }
  return navigator.language.toLowerCase().startsWith("bg") ? "bg" : "en";
}

let current: Lang = initialLang();

export const getLang = (): Lang => current;

export function setLang(lang: Lang): void {
  current = lang;
  document.documentElement.lang = lang;
  try {
    localStorage.setItem("lang", lang);
  } catch {
    /* няма проблем, просто не помним избора */
  }
}

/** Превежда ключ и замества {name} със стойности. */
export function t(key: Key, vars: Record<string, string | number> = {}): string {
  let text: string = dict[current][key];
  for (const [name, value] of Object.entries(vars)) {
    text = text.replace(`{${name}}`, String(value));
  }
  return text;
}

/** Превежда всички елементи с data-i18n и data-i18n-placeholder в страницата. */
export function applyTranslations(): void {
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n as Key);
  });
  document.querySelectorAll<HTMLInputElement>("[data-i18n-placeholder]").forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder as Key);
  });
  document.title = t("title");
}