import type { Locale } from "../../lib/quiz-types";
import type { WordSearchPuzzle } from "../../lib/word-search-types";

export interface CellCoord {
  row: number;
  col: number;
}

export type GameStatus = "in_progress" | "completed";

export interface WordSearchGameProps {
  puzzle?: WordSearchPuzzle;
  locale: Locale;
  baseUrl?: string;
}

export interface WordSearchTranslations {
  title: string;
  subtitle: string;
  gridLabel: string;
  wordsRemaining: string;
  wordsFound: string;
  timerLabel: string;
  clueModeToggle: string;
  showClues: string;
  showWords: string;
  shareResult: string;
  copied: string;
  congratulations: string;
  allWordsFound: string;
  elapsedTime: string;
  viewEvidence: string;
  evidenceModalTitle: string;
  close: string;
  loading: string;
  loadError: string;
  artifactMissing: string;
  retry: string;
  wordFoundAnnouncement: (name: string, current: number, total: number) => string;
  gameCompleteAnnouncement: (total: number, time: string) => string;
  cellAria: (row: number, col: number, letter: string, isSelected: boolean, isFound: boolean) => string;
}

export const WORD_SEARCH_I18N: Record<Locale, WordSearchTranslations> = {
  "pt-BR": {
    title: "Caça-Palavras K-pop",
    subtitle: "Encontre os nomes temáticos escondidos na grade",
    gridLabel: "Grade de caça-palavras",
    wordsRemaining: "Restantes",
    wordsFound: "Encontradas",
    timerLabel: "Tempo decorrido",
    clueModeToggle: "Alternar modo de exibição",
    showClues: "Ver Pistas",
    showWords: "Ver Palavras",
    shareResult: "Compartilhar resultado",
    copied: "Copiado para a área de transferência!",
    congratulations: "Parabéns, você encontrou todas as palavras!",
    allWordsFound: "Todas as palavras foram localizadas.",
    elapsedTime: "Tempo total:",
    viewEvidence: "Ver fontes e evidências",
    evidenceModalTitle: "Evidências auditadas",
    close: "Fechar",
    loading: "Carregando o caça-palavras do dia...",
    loadError: "Não foi possível carregar o jogo.",
    artifactMissing: "O caça-palavras de hoje ainda não foi publicado.",
    retry: "Tentar novamente",
    wordFoundAnnouncement: (name, current, total) =>
      `Palavra encontrada: ${name}. ${current} de ${total} palavras localizadas.`,
    gameCompleteAnnouncement: (total, time) =>
      `Parabéns! Todas as ${total} palavras foram encontradas em ${time}.`,
    cellAria: (row, col, letter, isSelected, isFound) => {
      const state = isFound ? ", encontrada" : isSelected ? ", selecionada" : "";
      return `Linha ${row + 1}, Coluna ${col + 1}, Letra ${letter}${state}`;
    },
  },
  en: {
    title: "K-pop Word Search",
    subtitle: "Find the thematic names hidden in the grid",
    gridLabel: "Word search grid",
    wordsRemaining: "Remaining",
    wordsFound: "Found",
    timerLabel: "Elapsed time",
    clueModeToggle: "Toggle display mode",
    showClues: "Show Clues",
    showWords: "Show Words",
    shareResult: "Share result",
    copied: "Copied to clipboard!",
    congratulations: "Congratulations, you found all words!",
    allWordsFound: "All words have been located.",
    elapsedTime: "Total time:",
    viewEvidence: "View sources and evidence",
    evidenceModalTitle: "Audited evidence",
    close: "Close",
    loading: "Loading daily word search...",
    loadError: "Could not load the game.",
    artifactMissing: "Today's word search puzzle has not been published yet.",
    retry: "Try again",
    wordFoundAnnouncement: (name, current, total) =>
      `Word found: ${name}. ${current} of ${total} words located.`,
    gameCompleteAnnouncement: (total, time) =>
      `Congratulations! All ${total} words found in ${time}.`,
    cellAria: (row, col, letter, isSelected, isFound) => {
      const state = isFound ? ", found" : isSelected ? ", selected" : "";
      return `Row ${row + 1}, Column ${col + 1}, Letter ${letter}${state}`;
    },
  },
};
