/** Boot contract for a smoke route. */
export type SmokeRoute =
  | {
      name: string;
      path: string;
      kind: "quiz-setup";
      /** The daily file the route needs; see DailyArtifact. */
      artifact?: DailyArtifact;
    }
  | {
      name: string;
      path: string;
      kind: "board-direct";
      /** The daily file the route needs; see DailyArtifact. */
      artifact?: DailyArtifact;
      /**
       * When the daily artifact may be absent (grid), accept a missing-state
       * region + retry CTA instead of game-board.
       */
      optionalArtifact?: boolean;
      /**
       * With optionalArtifact, the only data-error-kind values the missing
       * state may carry. Any other kind (e.g. "invalid") fails the boot.
       */
      missingKinds?: readonly string[];
    }
  | {
      name: string;
      path: string;
      kind: "privacy";
    };

/**
 * A daily file the partial publish policy may leave out of a day. When it is
 * published under data/ the page must show its board. When it is not, the
 * page must show the missing state (data-error-kind "missing"); a loader that
 * can still find a board elsewhere (fallback) may show that board instead.
 */
export interface DailyArtifact {
  file: string;
  fallback?: "next" | "catalog";
}

type LocaleLabel = "pt-BR" | "en";

type SmokePairDef =
  | {
      id: string;
      kind: "quiz-setup";
      ptPath: string;
      enPath: string;
      artifact?: DailyArtifact;
    }
  | {
      id: string;
      kind: "board-direct";
      ptPath: string;
      enPath: string;
      optionalArtifact?: boolean;
      missingKinds?: readonly string[];
      artifact?: DailyArtifact;
    }
  | {
      id: string;
      kind: "privacy";
      ptPath: string;
      enPath: string;
    };

/** Locale-paired boot matrix; expand once into SMOKE_ROUTES. */
const SMOKE_PAIRS: readonly SmokePairDef[] = [
  {
    id: "quiz",
    kind: "quiz-setup",
    ptPath: "/pt-br/",
    enPath: "/en/",
    // A general round may come from the question catalog when it is published.
    artifact: { file: "manifest-v2.json", fallback: "catalog" },
  },
  {
    id: "grid",
    kind: "board-direct",
    ptPath: "/pt-br/grid/",
    enPath: "/en/grid/",
    // Softens “artifact published” for grid until CI tickets decide env-strictness.
    optionalArtifact: true,
  },
  {
    id: "connections",
    kind: "board-direct",
    ptPath: "/pt-br/conexoes/",
    enPath: "/en/connections/",
    artifact: { file: "connections.daily.json" },
  },
  {
    id: "name-guess",
    kind: "board-direct",
    ptPath: "/pt-br/adivinhe/",
    enPath: "/en/guess/",
    artifact: { file: "name-guess.daily.json" },
  },
  {
    id: "word-search",
    kind: "board-direct",
    ptPath: "/pt-br/caca-palavras/",
    enPath: "/en/word-search/",
    artifact: { file: "word-search.daily.json" },
  },
  {
    id: "map",
    kind: "board-direct",
    ptPath: "/pt-br/mapa/",
    enPath: "/en/map/",
  },
  {
    id: "timeline",
    kind: "board-direct",
    ptPath: "/pt-br/linha-do-tempo/",
    enPath: "/en/timeline/",
    // The timeline loader reads data/next/ when data/ has no file.
    artifact: { file: "timeline.daily.json", fallback: "next" },
  },
  {
    id: "code",
    kind: "board-direct",
    ptPath: "/pt-br/codigo/",
    enPath: "/en/code/",
    // Partial publish: the day may ship without code-groups.daily.json.
    optionalArtifact: true,
  },
  {
    id: "crossword",
    kind: "board-direct",
    ptPath: "/pt-br/cruzadinha/",
    enPath: "/en/crossword/",
    // Daily envelope: the build ships none until the first publication, and a
    // day may be omitted. An invalid artifact must still fail the boot.
    optionalArtifact: true,
    missingKinds: ["missing", "omitted", "unavailable"],
  },
  {
    id: "privacy",
    kind: "privacy",
    ptPath: "/pt-br/privacidade/",
    enPath: "/en/privacy/",
  },
] as const;

function smokeRoute(
  def: SmokePairDef,
  locale: LocaleLabel,
  path: string,
): SmokeRoute {
  const name = `${def.id} ${locale}`;
  if (def.kind === "board-direct") {
    if (def.artifact) return { name, path, kind: "board-direct", artifact: def.artifact };
    if (!def.optionalArtifact) return { name, path, kind: "board-direct" };
    return def.missingKinds
      ? { name, path, kind: "board-direct", optionalArtifact: true, missingKinds: def.missingKinds }
      : { name, path, kind: "board-direct", optionalArtifact: true };
  }
  if (def.kind === "quiz-setup" && def.artifact) return { name, path, kind: def.kind, artifact: def.artifact };
  return { name, path, kind: def.kind };
}

function expandPairs(pairs: readonly SmokePairDef[]): SmokeRoute[] {
  const routes: SmokeRoute[] = [];
  for (const def of pairs) {
    routes.push(smokeRoute(def, "pt-BR", def.ptPath));
    routes.push(smokeRoute(def, "en", def.enPath));
  }
  return routes;
}

/**
 * Local smoke matrix: every game + privacy in pt-BR and en.
 * quiz-setup clicks game-start; board-direct asserts shell + board
 * (or missing+retry when optionalArtifact).
 */
export const SMOKE_ROUTES: readonly SmokeRoute[] = expandPairs(SMOKE_PAIRS);
