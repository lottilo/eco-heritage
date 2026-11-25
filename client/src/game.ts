import "./style.css";
import { getLang, setLang, type Lang } from "./i18n";
import { applyGameTranslations, tg, type GKey } from "./game-i18n";
import { ta, type AKey } from "./gallery-i18n";
import { initHero } from "./hero";

const hero = initHero("game");

type QType = "artist" | "style" | "era";
type Mode = "mixed" | QType;

interface Details {
  title: string | null;
  artist: string | null;
  date: string | null;
  style: string | null;
  medium: string | null;
  origin: string | null;
  link: string | null;
  credit: string | null;
  license: string | null;
  license_url: string | null;
}

interface Question {
  id: string;
  type: QType;
  image: string;
  options: string[];
  answer: string;
  details: Details;
}

interface Entry {
  question: Question;
  correct: boolean;
}

/* ---------- Елементи ---------- */
const $ = <T extends HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;

const screens = {
  modes: $<HTMLElement>("#screen-modes"),
  play: $<HTMLElement>("#screen-play"),
  end: $<HTMLElement>("#screen-end"),
};
const statusEl = $<HTMLParagraphElement>("#game-status");
const retryBtn = $<HTMLButtonElement>("#retry-btn");

const hudProgress = $<HTMLSpanElement>("#hud-progress");
const hudScore = $<HTMLSpanElement>("#hud-score");
const hudStreak = $<HTMLSpanElement>("#hud-streak");
const timerFill = $<HTMLDivElement>("#timer-fill");
const imageEl = $<HTMLImageElement>("#game-image");
const promptEl = $<HTMLHeadingElement>("#game-prompt");
const optionsEl = $<HTMLDivElement>("#game-options");
const feedbackEl = $<HTMLDivElement>("#game-feedback");
const feedbackLine = $<HTMLParagraphElement>("#feedback-line");
const feedbackTitle = $<HTMLHeadingElement>("#feedback-title");
const feedbackDetails = $<HTMLDListElement>("#feedback-details");
const feedbackLink = $<HTMLAnchorElement>("#feedback-link");
const nextBtn = $<HTMLButtonElement>("#next-btn");

const endScore = $<HTMLParagraphElement>("#end-score");
const endCorrect = $<HTMLParagraphElement>("#end-correct");
const endBest = $<HTMLParagraphElement>("#end-best");
const reviewList = $<HTMLUListElement>("#review-list");
const againBtn = $<HTMLButtonElement>("#again-btn");
const modeBtn = $<HTMLButtonElement>("#mode-btn");

/* ---------- Настройки на играта ---------- */
const API_BASE = import.meta.env.VITE_API_URL ?? "";
const ROUND = 10;          // въпроса в един рунд
const BASE_POINTS = 100;
const MAX_SPEED_BONUS = 50;
const BONUS_MS = 15_000;   // за толкова време се дава бонус за бързина
const MAX_STREAK_BONUS = 50;

/* ---------- Състояние ---------- */
type Screen = keyof typeof screens;
let screen: Screen = "modes";
let mode: Mode = "mixed";
let index = 0;
let score = 0;
let streak = 0;
let correctCount = 0;
let current: Question | null = null;
let chosen: string | null = null;
let lastPoints = { speed: 0, streak: 0, total: 0 };
let history: Entry[] = [];
let asked: string[] = [];
let lastType: QType | null = null;
let prefetched: Promise<Question> | null = null;
let startedAt = 0;
let timerId: number | null = null;
let isNewBest = false;
let runToken = 0; // за да игнорираме остарели отговори при нова игра

/* ---------- Заявки ---------- */
const imgUrl = (u: string) => (u.startsWith("/") ? API_BASE + u : u);

function pickType(): QType {
  if (mode !== "mixed") return mode;
  const all: QType[] = ["artist", "style", "era"];
  const choices = all.filter((t) => t !== lastType);
  const type = choices[Math.floor(Math.random() * choices.length)];
  lastType = type;
  return type;
}

function preload(src: string): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => resolve(); // картината ще се опита да се зареди и после
    img.src = src;
  });
}

async function fetchQuestion(): Promise<Question> {
  const params = new URLSearchParams({ type: pickType() });
  if (asked.length) params.set("exclude", asked.join(","));
  const response = await fetch(`${API_BASE}/api/art/quiz?${params}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const question = (await response.json()) as Question;
  await preload(imgUrl(question.image));
  return question;
}

/* ---------- Рекорд (само в този браузър) ---------- */
const bestKey = (m: Mode) => `game-best-${m}`;

function loadBest(m: Mode): number {
  try {
    return Number(localStorage.getItem(bestKey(m))) || 0;
  } catch {
    return 0;
  }
}

function saveBest(m: Mode, value: number): void {
  try {
    localStorage.setItem(bestKey(m), String(value));
  } catch {
    /* няма проблем, просто не пазим рекорда */
  }
}

/* ---------- Екрани ---------- */
function showScreen(name: Screen): void {
  screen = name;
  for (const [key, el] of Object.entries(screens)) el.hidden = key !== name;
}

function optionLabel(q: Question, value: string): string {
  if (q.type === "style") return ta(`st_${value}` as AKey);
  if (q.type === "era") return ta(`p_${value}` as AKey);
  return value;
}

const promptKey: Record<QType, GKey> = {
  artist: "qArtist",
  style: "qStyle",
  era: "qEra",
};

function renderHud(): void {
  hudProgress.textContent = tg("progress", { n: Math.min(index + 1, ROUND), total: ROUND });
  hudScore.textContent = tg("score", { score });
  hudStreak.textContent = tg("streak", { n: streak });
}

function stopTimer(): void {
  if (timerId !== null) {
    window.clearInterval(timerId);
    timerId = null;
  }
}

function startTimer(): void {
  stopTimer();
  timerFill.style.width = "100%";
  timerId = window.setInterval(() => {
    const left = Math.max(0, 1 - (performance.now() - startedAt) / BONUS_MS);
    timerFill.style.width = `${left * 100}%`;
    if (left === 0) stopTimer();
  }, 100);
}

function addRow(label: GKey, value: string | null): void {
  if (!value) return;
  const dt = document.createElement("dt");
  dt.textContent = tg(label);
  const dd = document.createElement("dd");
  dd.textContent = value;
  feedbackDetails.append(dt, dd);
}

function renderFeedback(): void {
  if (!current || chosen === null) {
    feedbackEl.hidden = true;
    return;
  }
  const d = current.details;
  const ok = chosen === current.answer;
  feedbackEl.hidden = false;
  feedbackEl.dataset.result = ok ? "correct" : "wrong";
  feedbackLine.textContent = ok
    ? tg("correct", { points: lastPoints.total, speed: lastPoints.speed, streak: lastPoints.streak })
    : tg("wrong", { answer: optionLabel(current, current.answer) });

  feedbackTitle.textContent = d.title ?? "";
  feedbackDetails.replaceChildren();
  addRow("lblArtist", d.artist || tg("unknownArtist"));
  addRow("lblDate", d.date);
  addRow("lblStyle", d.style);
  addRow("lblMedium", d.medium);
  addRow("lblOrigin", d.origin);
  addRow("lblCredit", d.credit);
  if (d.license) addRow("lblLicense", d.license);

  if (d.link) {
    feedbackLink.hidden = false;
    feedbackLink.href = d.link;
    feedbackLink.textContent = tg("viewAtSource");
  } else {
    feedbackLink.hidden = true;
  }
  nextBtn.textContent = index + 1 >= ROUND ? tg("finish") : tg("next");
}

function renderQuestion(): void {
  if (!current) return;
  const q = current;
  renderHud();
  promptEl.textContent = tg(promptKey[q.type]);
  imageEl.src = imgUrl(q.image);
  imageEl.alt = chosen === null
    ? tg("imageAlt")
    : [q.details.title, q.details.artist].filter(Boolean).join(" — ");

  optionsEl.replaceChildren(
    ...q.options.map((value, i) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "option";
      button.dataset.value = value;

      const key = document.createElement("kbd");
      key.textContent = String(i + 1);
      const label = document.createElement("span");
      label.textContent = optionLabel(q, value);
      const mark = document.createElement("span");
      mark.className = "option-mark";
      mark.setAttribute("aria-hidden", "true");

      if (chosen !== null) {
        button.disabled = true;
        if (value === q.answer) {
          button.classList.add("correct");
          mark.textContent = "✓";
        } else if (value === chosen) {
          button.classList.add("wrong");
          mark.textContent = "✗";
        } else {
          button.classList.add("dim");
        }
      } else {
        button.addEventListener("click", () => answer(value));
      }
      button.append(key, label, mark);
      return button;
    }),
  );
  renderFeedback();
}

function renderEnd(): void {
  endScore.textContent = tg("finalScore", { score });
  endCorrect.textContent = tg("finalCorrect", { correct: correctCount, total: ROUND });
  endBest.textContent = isNewBest
    ? tg("newBest")
    : tg("bestLine", { best: loadBest(mode) });

  reviewList.replaceChildren(
    ...history.map(({ question, correct }) => {
      const li = document.createElement("li");
      li.className = correct ? "review-ok" : "review-miss";
      const mark = document.createElement("span");
      mark.textContent = correct ? "✓ " : "✗ ";
      mark.setAttribute("aria-hidden", "true");
      const text = [question.details.title, question.details.artist].filter(Boolean).join(" — ");
      if (question.details.link) {
        const a = document.createElement("a");
        a.href = question.details.link;
        a.target = "_blank";
        a.rel = "noopener";
        a.textContent = text;
        li.append(mark, a);
      } else {
        li.append(mark, text);
      }
      return li;
    }),
  );
}

/* ---------- Ход на играта ---------- */
function setStatus(text: string, canRetry = false): void {
  statusEl.textContent = text;
  retryBtn.hidden = !canRetry;
  retryBtn.textContent = tg("retry");
}

async function loadQuestion(): Promise<void> {
  const token = runToken;
  setStatus(tg("loading"));
  try {
    const question = await (prefetched ?? fetchQuestion());
    prefetched = null;
    if (token !== runToken) return;
    current = question;
    asked.push(question.id);
    chosen = null;
    setStatus("");
    showScreen("play");
    renderQuestion();
    startedAt = performance.now();
    startTimer();
    // Следващият въпрос се подготвя, докато играчът мисли
    if (index + 1 < ROUND) {
      prefetched = fetchQuestion();
      prefetched.catch(() => {
        /* ако не успее, ще се опитаме пак, когато е нужен */
      });
    }
  } catch (error) {
    prefetched = null;
    if (token !== runToken) return;
    setStatus(tg("error", { msg: (error as Error).message }), true);
  }
}

function startGame(selected: Mode): void {
  runToken++;
  mode = selected;
  index = 0;
  score = 0;
  streak = 0;
  correctCount = 0;
  history = [];
  asked = [];
  lastType = null;
  prefetched = null;
  current = null;
  chosen = null;
  isNewBest = false;
  stopTimer();
  void loadQuestion();
}

function answer(value: string): void {
  if (!current || chosen !== null) return;
  stopTimer();
  const elapsed = performance.now() - startedAt;
  chosen = value;
  const ok = value === current.answer;

  if (ok) {
    streak += 1;
    const speed = Math.max(0, Math.round(MAX_SPEED_BONUS * (1 - elapsed / BONUS_MS)));
    const streakBonus = Math.min(MAX_STREAK_BONUS, 10 * (streak - 1));
    const total = BASE_POINTS + speed + streakBonus;
    lastPoints = { speed, streak: streakBonus, total };
    score += total;
    correctCount += 1;
  } else {
    streak = 0;
    lastPoints = { speed: 0, streak: 0, total: 0 };
  }
  history.push({ question: current, correct: ok });
  renderQuestion();
  nextBtn.focus();
}

function finishGame(): void {
  stopTimer();
  const best = loadBest(mode);
  isNewBest = score > best;
  if (isNewBest) saveBest(mode, score);
  showScreen("end");
  renderEnd();
}

nextBtn.addEventListener("click", () => {
  index += 1;
  if (index >= ROUND) finishGame();
  else void loadQuestion();
});

retryBtn.addEventListener("click", () => {
  if (screen === "modes") return;
  void loadQuestion();
});

againBtn.addEventListener("click", () => startGame(mode));

modeBtn.addEventListener("click", () => {
  runToken++;
  stopTimer();
  setStatus("");
  showScreen("modes");
});

document.querySelectorAll<HTMLButtonElement>(".mode-card").forEach((card) => {
  card.addEventListener("click", () => startGame(card.dataset.mode as Mode));
});

// Клавиши 1–4 отговарят на въпроса
document.addEventListener("keydown", (event) => {
  if (screen !== "play" || !current || chosen !== null) return;
  const n = Number(event.key);
  if (n >= 1 && n <= current.options.length) answer(current.options[n - 1]);
});

/* ---------- Език ---------- */
function refresh(): void {
  document.documentElement.lang = getLang();
  applyGameTranslations();
  hero.refresh();
  document.querySelectorAll<HTMLButtonElement>(".lang button").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.lang === getLang()));
  });
  if (screen === "play") renderQuestion();
  if (screen === "end") renderEnd();
  retryBtn.textContent = tg("retry");
}

document.querySelectorAll<HTMLButtonElement>(".lang button").forEach((button) => {
  button.addEventListener("click", () => {
    setLang(button.dataset.lang as Lang);
    refresh();
  });
});

refresh();
showScreen("modes");