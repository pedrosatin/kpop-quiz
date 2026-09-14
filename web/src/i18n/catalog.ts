import type { Locale } from "../lib/quiz-types";

export interface Messages {
  skipLink: string;
  eyebrow: string;
  title: string;
  intro: string;
  languageLabel: string;
  languageName: string;
  homeLabel: string;
  attribution: string;
  and: string;
  loading: string;
  loadError: string;
  artifactMissing: string;
  artifactInvalid: string;
  retry: string;
  empty: string;
  questionCounter: (current: number, total: number) => string;
  score: string;
  time: string;
  seconds: string;
  check: string;
  next: string;
  finish: string;
  correct: string;
  incorrect: string;
  timedOut: string;
  answerWas: string;
  evidence: string;
  revision: string;
  declaredReference: string;
  openRevision: (project: string) => string;
  resultTitle: string;
  resultText: (score: number, total: number) => string;
  restart: string;
  chooseAnswer: string;
}

const catalogs: Record<Locale, Messages> = {
  "pt-BR": {
    skipLink: "Pular para o quiz",
    eyebrow: "10 perguntas · múltipla escolha",
    title: "Você conhece a história do K-pop?",
    intro: "Grupos, integrantes e datas com fontes consultáveis a cada resposta.",
    languageLabel: "Idioma",
    languageName: "English",
    homeLabel: "K-pop Quiz, início",
    attribution: "Dados",
    and: "e",
    loading: "Preparando as perguntas...",
    loadError: "Não foi possível abrir este quiz.",
    artifactMissing: "As perguntas deste idioma ainda não foram publicadas.",
    artifactInvalid: "O arquivo de perguntas publicado é inválido.",
    retry: "Tentar novamente",
    empty: "Este quiz ainda não tem perguntas.",
    questionCounter: (current, total) => `Pergunta ${current} de ${total}`,
    score: "Pontos",
    time: "Tempo",
    seconds: "s",
    check: "Responder",
    next: "Próxima pergunta",
    finish: "Ver resultado",
    correct: "Acertou.",
    incorrect: "Não foi dessa vez.",
    timedOut: "O tempo acabou.",
    answerWas: "Resposta correta",
    evidence: "Fonte da resposta",
    revision: "revisão",
    declaredReference: "Referência declarada",
    openRevision: (project) => `Abrir revisão no ${project}`,
    resultTitle: "Fim da rodada",
    resultText: (score, total) => `Você acertou ${score} de ${total}.`,
    restart: "Jogar novamente",
    chooseAnswer: "Escolha uma resposta antes de continuar.",
  },
  en: {
    skipLink: "Skip to quiz",
    eyebrow: "10 questions · multiple choice",
    title: "How well do you know K-pop history?",
    intro: "Groups, members and dates, with a source for every answer.",
    languageLabel: "Language",
    languageName: "Português",
    homeLabel: "K-pop Quiz, home",
    attribution: "Data",
    and: "and",
    loading: "Preparing the questions...",
    loadError: "This quiz could not be opened.",
    artifactMissing: "Questions for this language have not been published yet.",
    artifactInvalid: "The published question file is invalid.",
    retry: "Try again",
    empty: "This quiz has no questions yet.",
    questionCounter: (current, total) => `Question ${current} of ${total}`,
    score: "Score",
    time: "Time",
    seconds: "s",
    check: "Submit answer",
    next: "Next question",
    finish: "See results",
    correct: "Correct.",
    incorrect: "Not this time.",
    timedOut: "Time is up.",
    answerWas: "Correct answer",
    evidence: "Answer source",
    revision: "revision",
    declaredReference: "Declared reference",
    openRevision: (project) => `Open revision on ${project}`,
    resultTitle: "Round complete",
    resultText: (score, total) => `You got ${score} out of ${total}.`,
    restart: "Play again",
    chooseAnswer: "Choose an answer before continuing.",
  },
};

export function getMessages(locale: Locale): Messages {
  return catalogs[locale];
}
