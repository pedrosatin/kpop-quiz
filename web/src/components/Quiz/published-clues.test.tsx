import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getMessages } from "../../i18n/catalog";
import type { Locale, PlayMode, QuizSession } from "../../lib/quiz-types";
import { isQuizSession } from "../../lib/quiz-types";
import { HintTray } from "./HintTray";
import { QuestionCard } from "./QuestionCard";

const DATA_DIR = join(import.meta.dirname, "../../../public/data");

interface ManifestEntry {
  path: string;
}

interface Manifest {
  sessions: Record<string, ManifestEntry>;
}

/** The 18 sessions the quiz-clues E2E matrix walks (locale × mode × scenario). */
const PUBLISHED_KEYS: readonly { key: string; dir: string; locale: Locale; mode: PlayMode }[] = [
  ...(["assisted", "standard", "expert"] as const).flatMap((mode) =>
    (["pt-BR", "en"] as const).flatMap((locale) => [
      { key: `daily.${locale}.${mode}`, dir: DATA_DIR, locale, mode },
      { key: `daily.${locale}.${mode}`, dir: join(DATA_DIR, "next"), locale, mode },
      { key: `decade.2000.${locale}.${mode}`, dir: DATA_DIR, locale, mode },
    ]),
  ),
];

function readManifest(dir: string): Manifest {
  return JSON.parse(readFileSync(join(dir, "manifest-v2.json"), "utf-8")) as Manifest;
}

function loadSession(dir: string, key: string): QuizSession {
  const manifest = readManifest(dir);
  const entry = manifest.sessions[key];
  if (!entry) throw new Error(`manifest in ${dir} has no session ${key}`);
  const payload: unknown = JSON.parse(readFileSync(join(dir, entry.path), "utf-8"));
  if (!isQuizSession(payload)) throw new Error(`session ${key} in ${dir} failed isQuizSession`);
  return payload;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("published quiz sessions: clue, notice, cost and answer", () => {
  it("lists the 18 sessions the pairwise matrix covers", () => {
    expect(PUBLISHED_KEYS).toHaveLength(18);
    for (const { key, dir } of PUBLISHED_KEYS) {
      expect(existsSync(join(dir, "manifest-v2.json")), `${dir} manifest`).toBe(true);
      expect(readManifest(dir).sessions[key], `${dir} ${key}`).toBeDefined();
    }
  });

  for (const { key, dir, locale, mode } of PUBLISHED_KEYS) {
    const label = dir.endsWith("next") ? `next/${key}` : key;
    it(`${label}: every question shows the published clue state, cost and answer`, () => {
      const session = loadSession(dir, key);
      expect(session.config.language).toBe(locale);
      expect(session.config.play_mode).toBe(mode);
      const messages = getMessages(locale);

      for (const question of session.questions) {
        const answer = question.options.find((option) => option.id === question.answer_option_id);
        expect(answer, `answer of ${question.id}`).toBeDefined();

        render(
          <QuestionCard
            prompt={question.prompt}
            options={question.options}
            selectedOptionId={null}
            onSelectOption={vi.fn()}
            answered={false}
            correctOptionId={question.answer_option_id}
            legendLabel={messages.chooseAnswer}
          >
            <HintTray
              questionId={question.id}
              playMode={mode}
              cluesAvailable={question.clues_available}
              cluesShown={question.clues_shown}
              revealedClues={[]}
              hintCost={question.hint_cost}
              answered={false}
              onRevealClue={vi.fn()}
              messages={messages}
            />
          </QuestionCard>,
        );

        expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(question.prompt);
        expect(screen.getByText(answer!.label)).toBeInTheDocument();

        if (mode === "expert") {
          expect(question.clues_available).toEqual([]);
          expect(screen.queryByTestId("quiz-no-clue")).not.toBeInTheDocument();
          expect(screen.queryByRole("button", { name: /pista|clue/i })).not.toBeInTheDocument();
        } else if (question.clues_available.length === 0) {
          expect(screen.getByTestId("quiz-no-clue")).toHaveTextContent(
            locale === "pt-BR" ? "Sem pista nesta pergunta." : "No clue for this question.",
          );
          expect(screen.queryByRole("button", { name: /pista|clue/i })).not.toBeInTheDocument();
        } else {
          const clue = question.clues_available[0]!;
          expect(screen.queryByTestId("quiz-no-clue")).not.toBeInTheDocument();
          if (mode === "assisted") {
            expect(screen.getByText(clue.text)).toBeInTheDocument();
            expect(screen.queryByRole("button", { name: /pista|clue/i })).not.toBeInTheDocument();
          } else {
            const open = screen.getByRole("button", {
              name:
                locale === "pt-BR"
                  ? `Ver pista (-${question.hint_cost} pontos)`
                  : `Show clue (-${question.hint_cost} points)`,
            });
            expect(screen.queryByText(clue.text)).not.toBeInTheDocument();
            fireEvent.click(open);
            // The tray itself does not reveal on click; the parent stores the id.
            // Re-render with the clue marked shown, as QuizRound does after onRevealClue.
            cleanup();
            render(
              <HintTray
                questionId={question.id}
                playMode={mode}
                cluesAvailable={question.clues_available}
                cluesShown={question.clues_shown}
                revealedClues={[clue.id]}
                hintCost={question.hint_cost}
                answered={false}
                onRevealClue={vi.fn()}
                messages={messages}
              />,
            );
            expect(screen.getByText(clue.text)).toBeInTheDocument();
          }
        }
        cleanup();
      }
    });
  }
});
