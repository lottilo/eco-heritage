import { getLang, type Lang } from "./i18n";

export type HeroKind = "home" | "gallery" | "game";

interface Quote {
  text: Record<Lang, string>; // превод за българския интерфейс
  original: string;           // оригиналът на английски
  author: Record<Lang, string>;
  source: Record<Lang, string>;
  artist: string;             // чия картина да показваме (Art Institute of Chicago)
}

// Цитатите са проверени по първоизточниците им и са от автори, чиито
// произведения са в обществено достояние.
const QUOTES: Record<HeroKind, Quote> = {
  home: {
    text: {
      bg: "При всяка разходка сред природата получаваш много повече, отколкото търсиш.",
      en: "In every walk with Nature one receives far more than he seeks.",
    },
    original: "In every walk with Nature one receives far more than he seeks.",
    author: { bg: "Джон Мюър", en: "John Muir" },
    source: { bg: "Steep Trails", en: "Steep Trails" },
    artist: "Claude Monet",
  },
  gallery: {
    text: {
      bg: "Продължавам да правя това, което още не мога, за да се науча да го мога.",
      en: "I keep on making what I can't do yet in order to learn to be able to do it.",
    },
    original: "I keep on making what I can't do yet in order to learn to be able to do it.",
    author: { bg: "Винсент ван Гог", en: "Vincent van Gogh" },
    source: { bg: "писмо до Антон ван Рапард, 1885", en: "letter to Anthon van Rappard, 1885" },
    artist: "Vincent van Gogh",
  },
  game: {
    text: {
      bg: "Най-великото, което човешката душа върши на този свят, е да види нещо и да разкаже с прости думи какво е видяла.",
      en: "The greatest thing a human soul ever does in this world is to see something, and tell what it saw in a plain way.",
    },
    original: "The greatest thing a human soul ever does in this world is to see something, and tell what it saw in a plain way.",
    author: { bg: "Джон Ръскин", en: "John Ruskin" },
    source: { bg: "Modern Painters, т. III, 1856", en: "Modern Painters, vol. III, 1856" },
    artist: "Georges Seurat",
  },
};

const API_BASE = import.meta.env.VITE_API_URL ?? "";
const POOL = 30; // от колко картини избираме „картина на деня“

interface Featured {
  title: string;
  artist: string;
  date: string;
  link: string;
  image: string;
}

const $ = <T extends HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;

/** Картина на деня: една и съща за всички през деня, различна всеки ден. */
async function loadFeatured(artist: string): Promise<Featured | null> {
  const day = Math.floor(Date.now() / 86_400_000);
  const ask = async (page: number) => {
    const params = new URLSearchParams({
      source: "aic", artist, page: String(page), rows: "1", lang: getLang(),
    });
    const response = await fetch(`${API_BASE}/api/art/search?${params}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json()) as {
      items: { title: string; artist: string; date: string; link: string; image_large: string }[];
    };
  };

  let data = await ask((day % POOL) + 1);
  if (!data.items.length) data = await ask(1); // ако в колекцията има по-малко
  const p = data.items[0];
  if (!p) return null;
  const image = p.image_large.startsWith("/") ? API_BASE + p.image_large : p.image_large;
  return { title: p.title, artist: p.artist, date: p.date, link: p.link, image };
}

export function initHero(kind: HeroKind): { refresh: () => void } {
  const hero = $<HTMLElement>("#hero");
  const quoteEl = $<HTMLParagraphElement>("#hero-quote");
  const originalEl = $<HTMLParagraphElement>("#hero-original");
  const authorEl = $<HTMLElement>("#hero-author");
  const creditEl = $<HTMLAnchorElement>("#hero-credit");
  const quote = QUOTES[kind];
  let featured: Featured | null = null;

  function refresh(): void {
    const lang = getLang();
    quoteEl.textContent = `“${quote.text[lang]}”`;
    // На български показваме и оригинала, на английски превод няма
    originalEl.textContent = lang === "bg" ? quote.original : "";
    originalEl.hidden = lang !== "bg";
    authorEl.textContent = `${quote.author[lang]} — ${quote.source[lang]}`;

    if (featured) {
      creditEl.hidden = false;
      creditEl.href = featured.link;
      creditEl.target = "_blank";
      creditEl.rel = "noopener";
      creditEl.textContent = [featured.title, featured.artist, featured.date]
        .filter(Boolean)
        .join(" · ");
    } else {
      creditEl.hidden = true;
    }
  }

  refresh();

  // Изображението се зарежда отделно. Ако не успее, остава цветният фон.
  loadFeatured(quote.artist)
    .then((item) => {
      if (!item) return;
      const img = new Image();
      img.addEventListener("load", () => {
        hero.style.setProperty("--hero-image", `url("${item.image}")`);
        hero.classList.add("has-image");
        featured = item;
        refresh();
      });
      img.src = item.image;
    })
    .catch(() => {
      /* без изображение страницата работи нормално */
    });

  return { refresh };
}