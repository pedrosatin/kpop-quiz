export type GameId = "quiz" | "grid" | "connections" | "name-guess" | "word-search";

export interface GameStats {
  played: number;
  won: number;
  currentStreak: number;
  maxStreak: number;
  lastPlayedDate?: string; // YYYY-MM-DD
  guessDistribution?: Record<number, number>; // para o Name Guess (1 a 6)
}

export interface OverallStats {
  played: number;
  won: number;
  currentStreak: number;
  maxStreak: number;
  lastPlayedDate?: string; // YYYY-MM-DD
}

export interface PlayerStats {
  version: 1;
  overall: OverallStats;
  games: Record<GameId, GameStats>;
}

export const PLAYER_STATS_STORAGE_KEY = "kpop-player-stats-v1";
export const ALL_GAME_IDS: GameId[] = ["quiz", "grid", "connections", "name-guess", "word-search"];

export function getTodayDateString(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getDaysDifference(prevDateStr: string, currDateStr: string): number {
  const [y1, m1, d1] = prevDateStr.split("-").map(Number);
  const [y2, m2, d2] = currDateStr.split("-").map(Number);
  if (!y1 || !m1 || !d1 || !y2 || !m2 || !d2) return 0;
  const utc1 = Date.UTC(y1, m1 - 1, d1);
  const utc2 = Date.UTC(y2, m2 - 1, d2);
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((utc2 - utc1) / msPerDay);
}

function createDefaultGameStats(isNameGuess = false): GameStats {
  const base: GameStats = {
    played: 0,
    won: 0,
    currentStreak: 0,
    maxStreak: 0,
  };
  if (isNameGuess) {
    base.guessDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  }
  return base;
}

export function createInitialPlayerStats(): PlayerStats {
  return {
    version: 1,
    overall: {
      played: 0,
      won: 0,
      currentStreak: 0,
      maxStreak: 0,
    },
    games: {
      quiz: createDefaultGameStats(false),
      grid: createDefaultGameStats(false),
      connections: createDefaultGameStats(false),
      "name-guess": createDefaultGameStats(true),
      "word-search": createDefaultGameStats(false),
    },
  };
}

function normalizeGameStats(raw: Partial<GameStats> | undefined, isNameGuess: boolean): GameStats {
  const defaults = createDefaultGameStats(isNameGuess);
  if (!raw || typeof raw !== "object") return defaults;

  const played = typeof raw.played === "number" && raw.played >= 0 ? raw.played : 0;
  const won = typeof raw.won === "number" && raw.won >= 0 ? Math.min(raw.won, played) : 0;
  const currentStreak = typeof raw.currentStreak === "number" && raw.currentStreak >= 0 ? raw.currentStreak : 0;
  const maxStreak = typeof raw.maxStreak === "number" && raw.maxStreak >= currentStreak ? raw.maxStreak : currentStreak;
  const lastPlayedDate = typeof raw.lastPlayedDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.lastPlayedDate)
    ? raw.lastPlayedDate
    : undefined;

  let guessDistribution: Record<number, number> | undefined;
  if (isNameGuess) {
    guessDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    if (raw.guessDistribution && typeof raw.guessDistribution === "object") {
      for (let i = 1; i <= 6; i++) {
        const val = raw.guessDistribution[i];
        if (typeof val === "number" && val >= 0) {
          guessDistribution[i] = val;
        }
      }
    }
  }

  return {
    played,
    won,
    currentStreak,
    maxStreak,
    ...(lastPlayedDate ? { lastPlayedDate } : {}),
    ...(guessDistribution ? { guessDistribution } : {}),
  };
}

function normalizeOverallStats(raw: Partial<OverallStats> | undefined): OverallStats {
  if (!raw || typeof raw !== "object") {
    return { played: 0, won: 0, currentStreak: 0, maxStreak: 0 };
  }
  const played = typeof raw.played === "number" && raw.played >= 0 ? raw.played : 0;
  const won = typeof raw.won === "number" && raw.won >= 0 ? Math.min(raw.won, played) : 0;
  const currentStreak = typeof raw.currentStreak === "number" && raw.currentStreak >= 0 ? raw.currentStreak : 0;
  const maxStreak = typeof raw.maxStreak === "number" && raw.maxStreak >= currentStreak ? raw.maxStreak : currentStreak;
  const lastPlayedDate = typeof raw.lastPlayedDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.lastPlayedDate)
    ? raw.lastPlayedDate
    : undefined;

  return {
    played,
    won,
    currentStreak,
    maxStreak,
    ...(lastPlayedDate ? { lastPlayedDate } : {}),
  };
}

export function loadPlayerStats(): PlayerStats {
  if (typeof window === "undefined" || typeof localStorage === "undefined") {
    return createInitialPlayerStats();
  }
  try {
    const raw = localStorage.getItem(PLAYER_STATS_STORAGE_KEY);
    if (!raw) return createInitialPlayerStats();
    const parsed = JSON.parse(raw) as Partial<PlayerStats>;
    if (!parsed || parsed.version !== 1 || typeof parsed !== "object") {
      return createInitialPlayerStats();
    }
    return {
      version: 1,
      overall: normalizeOverallStats(parsed.overall),
      games: {
        quiz: normalizeGameStats(parsed.games?.quiz, false),
        grid: normalizeGameStats(parsed.games?.grid, false),
        connections: normalizeGameStats(parsed.games?.connections, false),
        "name-guess": normalizeGameStats(parsed.games?.["name-guess"], true),
        "word-search": normalizeGameStats(parsed.games?.["word-search"], false),
      },
    };
  } catch {
    return createInitialPlayerStats();
  }
}

export function savePlayerStats(stats: PlayerStats): void {
  if (typeof window === "undefined" || typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.setItem(PLAYER_STATS_STORAGE_KEY, JSON.stringify(stats));
  } catch {
    // Fail silently when localStorage is disabled or quota exceeded
  }
}

export function calculateNewStreak(
  prevStreak: number,
  lastPlayedDate: string | undefined,
  currentDate: string,
  isWin: boolean
): number {
  if (!lastPlayedDate) {
    return isWin ? 1 : 0;
  }

  const diff = getDaysDifference(lastPlayedDate, currentDate);

  if (diff === 0) {
    // Se foi hoje, mantém a sequência do dia
    return prevStreak;
  }

  if (diff === 1) {
    // Se foi o dia anterior, incrementa com vitória ou zera com derrota
    return isWin ? prevStreak + 1 : 0;
  }

  // Se foi anterior a ontem (diff > 1) ou relógio retroativo (diff < 0)
  return isWin ? 1 : 0;
}

export function recordGameFinish(
  gameId: GameId,
  isWin: boolean,
  dateStr?: string,
  guessCount?: number
): PlayerStats {
  const stats = loadPlayerStats();
  const currentDate = dateStr || getTodayDateString();

  const game = stats.games[gameId] || createDefaultGameStats(gameId === "name-guess");

  // Streak calculations
  game.currentStreak = calculateNewStreak(game.currentStreak, game.lastPlayedDate, currentDate, isWin);
  game.maxStreak = Math.max(game.maxStreak, game.currentStreak);
  game.lastPlayedDate = currentDate;

  stats.overall.currentStreak = calculateNewStreak(
    stats.overall.currentStreak,
    stats.overall.lastPlayedDate,
    currentDate,
    isWin
  );
  stats.overall.maxStreak = Math.max(stats.overall.maxStreak, stats.overall.currentStreak);
  stats.overall.lastPlayedDate = currentDate;

  // Counts update
  game.played += 1;
  stats.overall.played += 1;
  if (isWin) {
    game.won += 1;
    stats.overall.won += 1;

    // Guess distribution for name-guess
    if (gameId === "name-guess" && typeof guessCount === "number" && guessCount >= 1 && guessCount <= 6) {
      if (!game.guessDistribution) {
        game.guessDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
      }
      game.guessDistribution[guessCount] = (game.guessDistribution[guessCount] || 0) + 1;
    }
  }

  stats.games[gameId] = game;
  savePlayerStats(stats);
  return stats;
}

export function getMatchRecordKey(gameId: GameId, matchId: string): string {
  return `kpop-match-recorded-${gameId}-${matchId}`;
}

export function isGameMatchRecorded(gameId: GameId, matchId: string): boolean {
  if (typeof window === "undefined" || typeof localStorage === "undefined") {
    return false;
  }
  try {
    return localStorage.getItem(getMatchRecordKey(gameId, matchId)) === "1";
  } catch {
    return false;
  }
}

export function markGameMatchRecorded(gameId: GameId, matchId: string): void {
  if (typeof window === "undefined" || typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.setItem(getMatchRecordKey(gameId, matchId), "1");
  } catch {
    // Fail silently
  }
}
