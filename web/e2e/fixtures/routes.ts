/** Boot contract for a smoke route. */
export type SmokeRoute =
  | {
      name: string;
      path: string;
      kind: "quiz-setup";
    }
  | {
      name: string;
      path: string;
      kind: "board-direct";
      /**
       * When the daily artifact may be absent (grid), accept a missing-state
       * region + retry CTA instead of game-board.
       */
      optionalArtifact?: boolean;
    }
  | {
      name: string;
      path: string;
      kind: "privacy";
    };

type LocaleLabel = "pt-BR" | "en";

type SmokePairDef =
  | {
      id: string;
      kind: "quiz-setup";
      ptPath: string;
      enPath: string;
    }
  | {
      id: string;
      kind: "board-direct";
      ptPath: string;
      enPath: string;
      optionalArtifact?: boolean;
    }
  | {
      id: string;
      kind: "privacy";
      ptPath: string;
      enPath: string;
    };

/** Locale-paired boot matrix; expand once into SMOKE_ROUTES. */
const SMOKE_PAIRS: readonly SmokePairDef[] = [
  { id: "quiz", kind: "quiz-setup", ptPath: "/pt-br/", enPath: "/en/" },
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
  },
  {
    id: "name-guess",
    kind: "board-direct",
    ptPath: "/pt-br/adivinhe/",
    enPath: "/en/guess/",
  },
  {
    id: "word-search",
    kind: "board-direct",
    ptPath: "/pt-br/caca-palavras/",
    enPath: "/en/word-search/",
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
    return def.optionalArtifact
      ? { name, path, kind: "board-direct", optionalArtifact: true }
      : { name, path, kind: "board-direct" };
  }
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
