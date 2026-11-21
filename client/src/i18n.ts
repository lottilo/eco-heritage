export type Lang = "bg" | "en";

const dict = {
  bg: {
    title: "Eco-Cultural Heritage App",
    searchPlaceholder: "Дума за търсене (по желание), напр. крепост",
    ecoOnly: "Само еко теми",
    search: "Търси",
    place: "Място",
    placePlaceholder: "Град, област или държава, напр. Варна",
    searchingPlace: "Търся мястото…",
    placeNotFound: "Не намерих такова място. Опитай друго изписване.",
    searchingIn: "Търся в: {place}…",
    foundInPlace: "{place}: {n} обекта (общо в областта: {total}).",
    otherMatches: "Други съвпадения:",
    prev: "← Назад",
    next: "Напред →",
    pageOf: "Страница {page} от {pages}",
    limitNote: "Показани са само първите {n} от {total} резултата. Стесни търсенето с филтри, за да стигнеш до останалите.",
    filters: "Филтри (за търсенето и за картата)",
    category: "Категория",
    allCategories: "Всички категории",
    cat_archaeology: "Археология",
    cat_architecture: "Архитектура",
    cat_history: "История и събития",
    cat_politics: "Политика",
    cat_religion: "Религия",
    cat_folklore: "Фолклор и традиции",
    cat_photography: "Фотография",
    cat_maps: "Карти",
    materialType: "Тип материал",
    allTypes: "Всички типове",
    type_IMAGE: "Изображения",
    type_TEXT: "Текстове",
    type_SOUND: "Звук",
    type_VIDEO: "Видео",
    type_3D: "3D",
    country: "Държава",
    allCountries: "Всички държави",
    yearFrom: "От година",
    yearTo: "До година",
    reusableOnly: "Само свободно ползваеми",
    clearFilters: "Изчисти филтрите",
    badYears: "Началната година не може да е по-голяма от крайната.",
    nearMeTitle: "На картата",
    locate: "Покажи обекти около мен",
    radius: "Радиус",
    km: "км",
    searchArea: "Търси в тази област",
    resultsTitle: "Резултати от търсенето",
    viewOn: "Виж в Europeana",
    searching: "Търся…",
    locating: "Определям къде си…",
    searchingMap: "Търся обекти…",
    foundSearch: "Намерени: {total}. Показани: {shown}.",
    foundRadius: "Намерени обекти в {km} км: {n}.",
    foundArea: "Намерени обекти в тази област: {n}.",
    noObjects: "Няма намерени обекти. Опитай друга област, по-голям радиус или по-малко филтри.",
    noResults: "Няма резултати. Опитай с по-малко филтри.",
    zoomIn: "Приближи картата (поне ниво 5), за да търсиш в областта.",
    youAreHere: "Ти си тук",
    noGeo: "Браузърът ти не поддържа геолокация.",
    geoDenied: "Няма достъп до местоположението ({msg}). Разреши го в браузъра.",
    error: "Грешка: {msg}.",
    serverHint: "Работи ли Python сървърът?",
  },
  en: {
    title: "Eco-Cultural Heritage App",
    searchPlaceholder: "Search word (optional), e.g. fortress",
    ecoOnly: "Eco topics only",
    search: "Search",
    place: "Place",
    placePlaceholder: "City, region or country, e.g. Varna",
    searchingPlace: "Looking up the place…",
    placeNotFound: "Place not found. Try a different spelling.",
    searchingIn: "Searching in: {place}…",
    foundInPlace: "{place}: {n} items (total in the area: {total}).",
    otherMatches: "Other matches:",
    prev: "← Previous",
    next: "Next →",
    pageOf: "Page {page} of {pages}",
    limitNote: "Only the first {n} of {total} results are browsable. Narrow the search with filters to reach the rest.",
    filters: "Filters (apply to search and map)",
    category: "Category",
    allCategories: "All categories",
    cat_archaeology: "Archaeology",
    cat_architecture: "Architecture",
    cat_history: "History and events",
    cat_politics: "Politics",
    cat_religion: "Religion",
    cat_folklore: "Folklore and traditions",
    cat_photography: "Photography",
    cat_maps: "Maps",
    materialType: "Material type",
    allTypes: "All types",
    type_IMAGE: "Images",
    type_TEXT: "Texts",
    type_SOUND: "Sound",
    type_VIDEO: "Video",
    type_3D: "3D",
    country: "Country",
    allCountries: "All countries",
    yearFrom: "From year",
    yearTo: "To year",
    reusableOnly: "Freely reusable only",
    clearFilters: "Clear filters",
    badYears: "The start year cannot be later than the end year.",
    nearMeTitle: "On the map",
    locate: "Show places near me",
    radius: "Radius",
    km: "km",
    searchArea: "Search this area",
    resultsTitle: "Search results",
    viewOn: "View on Europeana",
    searching: "Searching…",
    locating: "Finding your location…",
    searchingMap: "Looking for places…",
    foundSearch: "Found: {total}. Shown: {shown}.",
    foundRadius: "Places within {km} km: {n}.",
    foundArea: "Places in this area: {n}.",
    noObjects: "Nothing found. Try another area, a larger radius or fewer filters.",
    noResults: "No results. Try fewer filters.",
    zoomIn: "Zoom in (at least level 5) to search the area.",
    youAreHere: "You are here",
    noGeo: "Your browser does not support geolocation.",
    geoDenied: "Cannot access your location ({msg}). Please allow it in the browser.",
    error: "Error: {msg}.",
    serverHint: "Is the Python server running?",
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