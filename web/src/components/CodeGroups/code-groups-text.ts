import type { CodeGroupsGuess, CodeGroupsPuzzle } from "../../data/code-groups";
import type { Locale } from "../../lib/quiz-types";
import { getMessages, type Messages } from "../../i18n/catalog";
import { resolveDisplayLabels } from "../../lib/display-name";
import { seoShareUrl } from "../../lib/seo-routes";
import { withShareUrl } from "../Results/share-text";
import type { CodeGroupsFeedback } from "./code-groups-state";

/**
 * The display name of each symbol by QID. `resolveDisplayLabels` drops a
 * trailing Wikipedia note such as "(band)", unless two names would then read
 * the same.
 */
export function groupNamesByQid(puzzle: CodeGroupsPuzzle): Map<string, string> {
  const symbolNames = resolveDisplayLabels(
    puzzle.symbols.map((s) => ({ label: s.name, canonical: s.name })),
  );
  return new Map(puzzle.symbols.map((s, index) => [s.qid, symbolNames[index]!] as const));
}

/** One share row: green for exact, yellow for misplaced, white for the rest. */
export function sharePegs(guess: Pick<CodeGroupsGuess, "exact" | "misplaced">): string {
  return [
    ...Array<string>(guess.exact).fill("🟩"),
    ...Array<string>(guess.misplaced).fill("🟨"),
    ...Array<string>(4 - guess.exact - guess.misplaced).fill("⬜"),
  ].join("");
}

/**
 * The result text without spoilers: the date, the verdict, the attempts line
 * and one row of pegs per guess. Exact (green) comes before misplaced
 * (yellow) and misses (white) fill the rest, so the share shows the same
 * aggregate counts the game does, never which positions were right.
 */
export function generateShareText(
  puzzle: CodeGroupsPuzzle,
  history: ReadonlyArray<{ ids: string[]; exact: number; misplaced: number }>,
  locale: Locale,
): string {
  const messages = getMessages(locale);
  const header = messages.codeShareHeader(puzzle.reference_date);
  const verdict = history.at(-1)?.exact === 4
    ? messages.codeShareWon(history.length)
    : messages.codeShareLost;
  const rows = history.map(sharePegs);
  return withShareUrl(
    `${header}\n${verdict}\n${messages.codeShareAttemptsLine(history.length)}\n\n${rows.join("\n")}`,
    seoShareUrl("code", locale),
  );
}

const REJECTION_MESSAGE = {
  chooseAll: "codeChooseAll",
  chooseDistinct: "codeChooseDistinct",
  alreadyGuessed: "codeAlreadyGuessed",
} as const;

/** The live-region text for the last rejection or guess. */
export function feedbackMessage(
  feedback: CodeGroupsFeedback,
  history: readonly CodeGroupsGuess[],
  attemptsLeft: number,
  messages: Messages,
): string {
  if (!feedback) return "";
  if (feedback.kind !== "attempt") return messages[REJECTION_MESSAGE[feedback.kind]];
  if (!feedback.attempt) return "";
  const attemptNumber = history.indexOf(feedback.attempt) + 1;
  return messages.codeAttemptFeedback(attemptNumber, feedback.attempt.exact, feedback.attempt.misplaced, attemptsLeft);
}
