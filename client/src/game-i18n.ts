import { getLang } from "./i18n";

const dict = {
  bg: {
    pageTitle: "Игра: познай картината",
    title: "Eco-Cultural Heritage App",
    navHome: "Карта и търсене",
    navGallery: "Картини",
    navGame: "Игра",
    heroTitle: "Познай картината",
    modeTitle: "Избери вид игра",
    howTo: "10 въпроса. 100 точки за верен отговор, до +50 за бързина (първите 15 секунди) и +10 за всеки верен отговор подред. Клавиши 1–4 също отговарят.",
    modeMixed: "Смесена",
    modeMixedHint: "Всичко по малко",
    modeArtist: "Кой е художникът?",
    modeArtistHint: "Разпознай автора по картината",
    modeStyle: "Кой е стилът?",
    modeStyleHint: "Определи художественото направление",
    modeEra: "Кога е нарисувана?",
    modeEraHint: "Определи периода",
    loading: "Подготвям въпрос…",
    progress: "Въпрос {n} от {total}",
    score: "Точки: {score}",
    streak: "Серия: {n}",
    qArtist: "Кой е нарисувал тази картина?",
    qStyle: "В какъв стил е тази картина?",
    qEra: "От кой период е тази картина?",
    imageAlt: "Картина за разпознаване",
    correct: "Верно! +{points} точки (бързина +{speed}, серия +{streak})",
    wrong: "Не е вярно. Верният отговор е: {answer}",
    next: "Следващ въпрос",
    finish: "Виж резултата",
    lblArtist: "Художник",
    lblDate: "Година",
    lblStyle: "Стил",
    lblMedium: "Техника",
    lblOrigin: "Произход",
    lblCredit: "Източник",
    lblLicense: "Лиценз",
    viewAtSource: "Виж в колекцията",
    unknownArtist: "Неизвестен художник",
    endTitle: "Край на рунда",
    finalScore: "{score} точки",
    finalCorrect: "Верни отговори: {correct} от {total}",
    bestLine: "Рекорд за този вид игра: {best}",
    newBest: "Нов рекорд!",
    playAgain: "Играй пак",
    changeMode: "Друг вид игра",
    review: "Картините от този рунд",
    error: "Не успях да заредя въпрос ({msg}). Опитай пак.",
    retry: "Опитай пак",
    attribution: "Картини: Art Institute of Chicago (CC0). Точките се пазят само в твоя браузър.",
  },
  en: {
    pageTitle: "Game: guess the painting",
    title: "Eco-Cultural Heritage App",
    navHome: "Map and search",
    navGallery: "Paintings",
    navGame: "Game",
    heroTitle: "Guess the painting",
    modeTitle: "Choose a game",
    howTo: "10 questions. 100 points for a correct answer, up to +50 for speed (first 15 seconds) and +10 for each correct answer in a row. Keys 1–4 also answer.",
    modeMixed: "Mixed",
    modeMixedHint: "A bit of everything",
    modeArtist: "Who is the artist?",
    modeArtistHint: "Recognise the author from the painting",
    modeStyle: "What is the style?",
    modeStyleHint: "Identify the artistic movement",
    modeEra: "When was it painted?",
    modeEraHint: "Identify the period",
    loading: "Preparing a question…",
    progress: "Question {n} of {total}",
    score: "Points: {score}",
    streak: "Streak: {n}",
    qArtist: "Who painted this?",
    qStyle: "What style is this painting?",
    qEra: "Which period is this painting from?",
    imageAlt: "Painting to identify",
    correct: "Correct! +{points} points (speed +{speed}, streak +{streak})",
    wrong: "Not quite. The correct answer is: {answer}",
    next: "Next question",
    finish: "See the result",
    lblArtist: "Artist",
    lblDate: "Year",
    lblStyle: "Style",
    lblMedium: "Medium",
    lblOrigin: "Origin",
    lblCredit: "Credit",
    lblLicense: "License",
    viewAtSource: "View in the collection",
    unknownArtist: "Unknown artist",
    endTitle: "Round over",
    finalScore: "{score} points",
    finalCorrect: "Correct answers: {correct} of {total}",
    bestLine: "Best for this game: {best}",
    newBest: "New record!",
    playAgain: "Play again",
    changeMode: "Another game",
    review: "Paintings from this round",
    error: "Could not load a question ({msg}). Please try again.",
    retry: "Try again",
    attribution: "Paintings: Art Institute of Chicago (CC0). Scores are kept only in your browser.",
  },
} as const;

export type GKey = keyof typeof dict.bg;

/** Превежда ключ и замества {name} със стойности. */
export function tg(key: GKey, vars: Record<string, string | number> = {}): string {
  let text: string = dict[getLang()][key];
  for (const [name, value] of Object.entries(vars)) {
    text = text.replace(`{${name}}`, String(value));
  }
  return text;
}

/** Превежда елементите с data-g. */
export function applyGameTranslations(): void {
  document.querySelectorAll<HTMLElement>("[data-g]").forEach((el) => {
    el.textContent = tg(el.dataset.g as GKey);
  });
  document.title = tg("pageTitle");
}