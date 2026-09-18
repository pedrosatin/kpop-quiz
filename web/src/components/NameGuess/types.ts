import type { Locale, NameGuessPuzzle } from "../../lib/quiz-types";

export type LetterStatus = "correct" | "present" | "absent";
export type TileStatus = LetterStatus | "empty" | "active";
export type GameStatus = "playing" | "won" | "lost";

export interface NameGuessGameProps {
  puzzle?: NameGuessPuzzle;
  locale: Locale;
  baseUrl?: string;
}

export interface NameGuessTranslations {
  title: string;
  subtitle: string;
  attemptsLeft: string;
  enter: string;
  backspace: string;
  notEnoughLetters: string;
  notInWordList: string;
  wonTitle: string;
  lostTitle: string;
  targetWas: string;
  playAgain: string;
  copyResults: string;
  copied: string;
  highContrast: string;
  highContrastOn: string;
  highContrastOff: string;
  hints: string;
  debutYear: string;
  agency: string;
  members: string;
  evidenceLink: string;
  skipToContent: string;
  loading: string;
  loadError: string;
  artifactMissing: string;
  retry: string;
  boardAria: string;
  rowAria: (row: number) => string;
  emptyTile: (pos: number) => string;
  activeTile: (pos: number, letter: string) => string;
  correctTile: (pos: number, letter: string) => string;
  presentTile: (pos: number, letter: string) => string;
  absentTile: (pos: number, letter: string) => string;
  keyboardAria: string;
  resultsAria: string;
}

export const NAME_GUESS_I18N: Record<Locale, NameGuessTranslations> = {
  "pt-BR": {
    title: "Adivinhe o Nome",
    subtitle: "Descubra a entidade K-pop do dia",
    attemptsLeft: "Tentativas restantes",
    enter: "ENVIAR",
    backspace: "APAGAR",
    notEnoughLetters: "Letras insuficientes",
    notInWordList: "Nome não reconhecido na lista de palpites",
    wonTitle: "Parabéns, você acertou!",
    lostTitle: "Fim de jogo!",
    targetWas: "A resposta era:",
    playAgain: "Jogar novamente",
    copyResults: "Compartilhar resultado",
    copied: "Copiado para a área de transferência!",
    highContrast: "Alto contraste",
    highContrastOn: "Alto contraste ativado",
    highContrastOff: "Alto contraste desativado",
    hints: "Informações da entidade",
    debutYear: "Estreia:",
    agency: "Agência:",
    members: "Integrantes:",
    evidenceLink: "Ver evidência no Wikidata",
    skipToContent: "Pular para o jogo de adivinhação",
    loading: "Carregando o jogo do dia...",
    loadError: "Não foi possível carregar o jogo.",
    artifactMissing: "O jogo de adivinhação de hoje ainda não foi publicado.",
    retry: "Tentar novamente",
    boardAria: "Grade de palpites",
    rowAria: (row) => `Tentativa ${row}`,
    emptyTile: (pos) => `Posição ${pos}: vazio`,
    activeTile: (pos, letter) => `Posição ${pos}: letra ${letter}`,
    correctTile: (pos, letter) => `Posição ${pos}: letra ${letter}, correta`,
    presentTile: (pos, letter) => `Posição ${pos}: letra ${letter}, posição diferente`,
    absentTile: (pos, letter) => `Posição ${pos}: letra ${letter}, não faz parte`,
    keyboardAria: "Teclado virtual",
    resultsAria: "Resultados da partida",
  },
  en: {
    title: "Guess the Name",
    subtitle: "Discover the daily K-pop entity",
    attemptsLeft: "Attempts remaining",
    enter: "ENTER",
    backspace: "DEL",
    notEnoughLetters: "Not enough letters",
    notInWordList: "Name not in guess list",
    wonTitle: "Congratulations, you won!",
    lostTitle: "Game over!",
    targetWas: "The answer was:",
    playAgain: "Play again",
    copyResults: "Share result",
    copied: "Copied to clipboard!",
    highContrast: "High contrast",
    highContrastOn: "High contrast enabled",
    highContrastOff: "High contrast disabled",
    hints: "Entity clues",
    debutYear: "Debut:",
    agency: "Agency:",
    members: "Members:",
    evidenceLink: "View evidence on Wikidata",
    skipToContent: "Skip to name guess game",
    loading: "Loading daily puzzle...",
    loadError: "Could not load the game.",
    artifactMissing: "Today's name guess puzzle has not been published yet.",
    retry: "Try again",
    boardAria: "Guess grid",
    rowAria: (row) => `Attempt ${row}`,
    emptyTile: (pos) => `Position ${pos}: empty`,
    activeTile: (pos, letter) => `Position ${pos}: letter ${letter}`,
    correctTile: (pos, letter) => `Position ${pos}: letter ${letter}, correct`,
    presentTile: (pos, letter) => `Position ${pos}: letter ${letter}, different position`,
    absentTile: (pos, letter) => `Position ${pos}: letter ${letter}, absent`,
    keyboardAria: "Virtual keyboard",
    resultsAria: "Match results",
  },
};
