import type { Locale } from "../../lib/quiz-types";

export interface MapPilotCopy {
  loading: string;
  empty: string;
  question: (date: string) => string;
  instructions: string;
  mapLabel: string;
  resultMapLabel: string;
  countryChoices: string;
  pickPlaceholder: string;
  answer: string;
  pickFirst: string;
  correct: string;
  incorrect: string;
  answerWas: string;
  yourAnswer: string;
  next: string;
  finish: string;
  complete: string;
  evidence: string;
  musicBrainz: string;
  scheduleNote: string;
  checkedAt: (date: string) => string;
  mapCredit: string;
  roundProgress: (current: number, total: number) => string;
}

export const MAP_PILOT_COPY: Record<Locale, MapPilotCopy> = {
  "pt-BR": {
    loading: "Preparando a rodada de hoje…",
    empty: "Não há perguntas de mapa disponíveis.",
    question: (date) => `Em qual país a agenda oficial listou um show de BLACKPINK em ${date}?`,
    instructions: "Escolha um país destacado no mapa ou na lista.",
    mapLabel: "Mapa interativo de países. Use Tab e Enter para escolher uma área destacada.",
    resultMapLabel: "Mapa com os países das datas desta rodada.",
    countryChoices: "Países desta rodada",
    pickPlaceholder: "Escolha um país",
    answer: "Responder",
    pickFirst: "Escolha um país primeiro.",
    correct: "Resposta correta.",
    incorrect: "Essa não é a resposta.",
    answerWas: "País correto",
    yourAnswer: "Sua resposta",
    next: "Próxima data",
    finish: "Ver resultado",
    complete: "Rodada concluída",
    evidence: "Agenda oficial",
    musicBrainz: "MusicBrainz",
    scheduleNote: "Estar na agenda oficial não confirma que o show aconteceu.",
    checkedAt: (date) => `Agenda conferida em ${date}.`,
    mapCredit: "Dados cartográficos: Natural Earth, domínio público.",
    roundProgress: (current, total) => `Pergunta ${current} de ${total}`,
  },
  en: {
    loading: "Preparing today's round…",
    empty: "No map questions are available.",
    question: (date) => `Which country did the official schedule list for a BLACKPINK show on ${date}?`,
    instructions: "Choose a highlighted country on the map or in the list.",
    mapLabel: "Interactive country map. Use Tab and Enter to choose a highlighted area.",
    resultMapLabel: "Map of the countries of this round's dates.",
    countryChoices: "Countries in this round",
    pickPlaceholder: "Choose a country",
    answer: "Answer",
    pickFirst: "Pick a country first.",
    correct: "Correct answer.",
    incorrect: "That is not the answer.",
    answerWas: "Correct country",
    yourAnswer: "Your answer",
    next: "Next date",
    finish: "See result",
    complete: "Round complete",
    evidence: "Official schedule",
    musicBrainz: "MusicBrainz",
    scheduleNote: "Being on the official schedule does not confirm the show took place.",
    checkedAt: (date) => `Schedule checked on ${date}.`,
    mapCredit: "Map data: Natural Earth, public domain.",
    roundProgress: (current, total) => `Question ${current} of ${total}`,
  },
};
