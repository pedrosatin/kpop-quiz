import { test, expect } from "./fixtures/consent";
import {
  FIXED_REFERENCE_DATE,
  serveFixedConnections,
  serveFixedDailySet,
} from "./helpers/fixed-daily";
import { ConnectionsPage } from "./pages/connections.page";

const PLAYER_STATS_KEY = "kpop-player-stats-v1";
const MAP_SAVE_KEY = `kpop-map-${FIXED_REFERENCE_DATE}`;

const PUBLISHED_WITHOUT_CONNECTIONS = [
  "quiz",
  "grid",
  "name-guess",
  "word-search",
  "timeline",
  "map",
  "code",
  "crossword",
] as const;

test("celebrates the daily set when Strands is omitted and the last published game finishes", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(90_000);
  await serveFixedConnections(page);
  await serveFixedDailySet(page, {
    omitted: { strands: "generation failed (ValueError)" },
    freezeClock: false,
  });

  await page.addInitScript(
    ({ statsKey, mapKey, date, games }) => {
      const finished = (id: string) => {
        const base: Record<string, unknown> = {
          played: 1,
          won: 1,
          currentStreak: 1,
          maxStreak: 1,
          lastPlayedDate: date,
        };
        if (id === "name-guess") {
          base.guessDistribution = { 1: 1, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
        }
        return base;
      };
      const empty = (id: string) => {
        const base: Record<string, unknown> = {
          played: 0,
          won: 0,
          currentStreak: 0,
          maxStreak: 0,
        };
        if (id === "name-guess") {
          base.guessDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
        }
        return base;
      };
      const allIds = [
        "quiz",
        "grid",
        "connections",
        "name-guess",
        "word-search",
        "timeline",
        "map",
        "code",
        "crossword",
        "strands",
      ];
      const gameStats: Record<string, Record<string, unknown>> = {};
      const lines: Record<string, string> = {};
      for (const id of allIds) {
        gameStats[id] = games.includes(id) ? finished(id) : empty(id);
        if (games.includes(id)) lines[id] = `K-pop Quiz · ${id}\nline`;
      }
      const stats = {
        version: 1,
        overall: {
          played: games.length,
          won: games.length,
          currentStreak: 1,
          maxStreak: 1,
          lastPlayedDate: date,
        },
        games: gameStats,
        dailySetsCompleted: 0,
        dailySetLines: { [date]: lines },
      };
      window.localStorage.setItem(statsKey, JSON.stringify(stats));
      window.localStorage.setItem(
        mapKey,
        JSON.stringify({ events: ["a"], answers: ["x"], index: 1 }),
      );
    },
    {
      statsKey: PLAYER_STATS_KEY,
      mapKey: MAP_SAVE_KEY,
      date: FIXED_REFERENCE_DATE,
      games: [...PUBLISHED_WITHOUT_CONNECTIONS] as string[],
    },
  );

  const connections = new ConnectionsPage(page, baseURL!);
  await connections.open({ served: true });
  await connections.loseWithWrongGuesses();
  await connections.expectResult();

  const celebration = page.getByTestId("daily-set-complete");
  await expect(celebration).toBeVisible();
  await expect(page.getByRole("heading", { name: "Set do dia completo" })).toHaveAttribute(
    "data-feedback",
    "result",
  );
  await expect(page.getByText("Você concluiu todos os jogos de hoje.")).toBeVisible();
  await expect(celebration.getByRole("link")).toHaveCount(0);

  const stored = await page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }, PLAYER_STATS_KEY);
  expect(stored.dailySetsCompleted).toBe(1);
  expect(stored.lastDailySetDate).toBe(FIXED_REFERENCE_DATE);
});
