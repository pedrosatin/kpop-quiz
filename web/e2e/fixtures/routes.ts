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

/**
 * Local smoke matrix: all pt-BR game routes + privacy, and /en/ quiz sanity.
 * quiz-setup clicks game-start; board-direct asserts shell + board
 * (or missing+retry when optionalArtifact).
 */
export const SMOKE_ROUTES: readonly SmokeRoute[] = [
  { name: "quiz pt-BR", path: "/pt-br/", kind: "quiz-setup" },
  { name: "grid pt-BR", path: "/pt-br/grid/", kind: "board-direct", optionalArtifact: true },
  { name: "connections pt-BR", path: "/pt-br/conexoes/", kind: "board-direct" },
  { name: "name-guess pt-BR", path: "/pt-br/adivinhe/", kind: "board-direct" },
  { name: "word-search pt-BR", path: "/pt-br/caca-palavras/", kind: "board-direct" },
  { name: "map pt-BR", path: "/pt-br/mapa/", kind: "board-direct" },
  { name: "timeline pt-BR", path: "/pt-br/linha-do-tempo/", kind: "board-direct" },
  { name: "privacy pt-BR", path: "/pt-br/privacidade/", kind: "privacy" },
  { name: "quiz en", path: "/en/", kind: "quiz-setup" },
] as const;
