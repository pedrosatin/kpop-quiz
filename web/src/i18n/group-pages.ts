import type { Locale } from "../lib/quiz-types";
import type { SeoMeta } from "./catalog";

export interface GroupFactCitation {
  label: string;
  /** Absolute URL of the cited revision. */
  sourceUrl: string;
  revisionId: number;
}

export interface GroupPageCopy {
  meta: SeoMeta;
  kicker: string;
  title: string;
  intro: string;
  /** Static body paragraphs; together with other sections they exceed 300 words. */
  about: string[];
  factsHeading: string;
  facts: GroupFactCitation[];
  rosterHeading: string;
  currentMembersHeading: string;
  formerMembersHeading: string;
  /** Display names for the roster, in stable order. */
  currentMembers: string[];
  formerMembers: Array<{ name: string; note: string }>;
  quizHeading: string;
  quizIntro: string;
  wordSearchHeading: string;
  wordSearchIntro: string;
  dailyGamesHeading: string;
  dailyGamesIntro: string;
  sourcesHeading: string;
  sourcesNote: string;
  skipLink: string;
}

const SKZ_SOURCE =
  "https://en.wikipedia.org/w/index.php?curid=56048389&oldid=1374455149";
const SKZ_REVID = 1374455149;

const strayKidsPt: GroupPageCopy = {
  meta: {
    title: "Quiz K-pop Stray Kids com fontes",
    description:
      "Quiz de K-pop do Stray Kids com 10 perguntas citáveis, caça-palavras dos integrantes e links para os jogos diários.",
  },
  kicker: "Página de grupo",
  title: "Quiz de K-pop: Stray Kids",
  intro:
    "Esta página reúne fatos aceitos do Stray Kids, cada um com link para a revisão usada, um quiz de 10 perguntas e um caça-palavras dos integrantes atuais. Os jogos diários do site continuam no menu.",
  about: [
    "O Stray Kids é um grupo de K-pop formado em 2017 na Coreia do Sul. A formação, o país de origem e as gravadoras abaixo vêm de fatos com status aceito no banco do projeto, cada um com link para a revisão da Wikipédia em inglês usada na extração.",
    "O elenco atual tem oito integrantes: Bang Chan, Lee Know, Changbin, Hyunjin, Han, Felix, Seungmin e I.N. Kim Woo-jin aparece à parte, porque o fato de vínculo com o grupo registra o fim da participação em 28 de outubro de 2019. A página lista só fatos que o projeto já publicou e validou, sem biografias nem datas de outra fonte.",
    "As datas de nascimento dos oito integrantes atuais também estão aceitas. Elas alimentam perguntas de idade e de ordem cronológica no quiz desta página. Lançamentos com vínculo ao grupo aceito entram nas perguntas de discografia; a única data de lançamento aceita no banco para o grupo, Noeasy em 2021, basta para uma pergunta de ordem, mas não basta para uma Linha do Tempo, que fica fora desta página.",
    "O caça-palavras desta página segue a regra de nomes do caça-palavras diário, que aceita nomes com pelo menos três letras depois de remover pontos e espaços. I.N normaliza para IN e fica de fora da grade. Han entra pelo alias publicado Han-Jisung, porque a forma de três letras do canônico gera ocorrências acidentais no preenchimento da grade. Os outros seis integrantes atuais entram pelo nome canônico. Kim Woo-jin, já listado como ex-integrante, também fica de fora do mini-jogo.",
  ],
  factsHeading: "Fatos aceitos do grupo",
  facts: [
    { label: "Formado em 2017", sourceUrl: SKZ_SOURCE, revisionId: SKZ_REVID },
    { label: "País de origem: Coreia do Sul", sourceUrl: SKZ_SOURCE, revisionId: SKZ_REVID },
    { label: "Gravadora: JYP Entertainment", sourceUrl: SKZ_SOURCE, revisionId: SKZ_REVID },
    { label: "Gravadora: Epic Records Japan", sourceUrl: SKZ_SOURCE, revisionId: SKZ_REVID },
    { label: "Gravadora: Republic Records", sourceUrl: SKZ_SOURCE, revisionId: SKZ_REVID },
  ],
  rosterHeading: "Integrantes",
  currentMembersHeading: "Atuais",
  formerMembersHeading: "Ex-integrantes",
  currentMembers: [
    "Bang Chan",
    "Lee Know",
    "Changbin",
    "Hyunjin",
    "Han",
    "Felix",
    "Seungmin",
    "I.N",
  ],
  formerMembers: [
    {
      name: "Kim Woo-jin",
      note: "Vínculo documentado até 28 de outubro de 2019.",
    },
  ],
  quizHeading: "Quiz de 10 perguntas",
  quizIntro:
    "Dez perguntas sobre discografia, integrantes, idades e lançamentos, todas com fatos aceitos. Cada resposta mostra a fonte.",
  wordSearchHeading: "Caça-palavras dos integrantes",
  wordSearchIntro:
    "Encontre na grade sete integrantes atuais. I.N fica de fora porque o caça-palavras exige nomes com pelo menos três letras, e Han aparece como Han-Jisung, nome alternativo já publicado.",
  dailyGamesHeading: "Jogos diários de K-pop",
  dailyGamesIntro:
    "O desafio do dia cobre vários formatos. Estas páginas não trocam o tabuleiro diário; só apontam para ele.",
  sourcesHeading: "De onde vêm os dados",
  sourcesNote:
    "Fatos e evidências saem do repositório do projeto (Wikidata CC0 e Wikipédia CC BY-SA 4.0). Cada item acima e cada resposta do quiz citam a revisão usada.",
  skipLink: "Ir para o quiz de Stray Kids",
};

const strayKidsEn: GroupPageCopy = {
  meta: {
    title: "Stray Kids K-pop quiz with sources",
    description:
      "A Stray Kids K-pop quiz with 10 citable questions, a member word search, and links to the daily games.",
  },
  kicker: "Group page",
  title: "K-pop quiz: Stray Kids",
  intro:
    "This page gathers accepted Stray Kids facts, each with a link to the revision used, a 10-question quiz, and a word search of current members. The site's daily games stay in the menu.",
  about: [
    "Stray Kids is a K-pop group formed in 2017 in South Korea. The formation year, country of origin, and record labels below come from facts with accepted status in the project database, each linking to the English Wikipedia revision used in extraction.",
    "The current lineup has eight members: Bang Chan, Lee Know, Changbin, Hyunjin, Han, Felix, Seungmin, and I.N. Kim Woo-jin is listed separately because the membership fact records an end date of 28 October 2019. This page lists only facts the project already published and validated, without biographies or dates from another source.",
    "Birth dates for all eight current members are also accepted. They feed age and chronological questions in this page's quiz. Releases with an accepted link to the group appear in discography questions; the only accepted release date for the group in the database, Noeasy in 2021, is enough for one ordering question but not enough for a Timeline, which stays off this page.",
    "The word search on this page follows the daily word-search name rule, which accepts names with at least three letters after removing dots and spaces. I.N normalizes to IN and is left out of the grid. Han enters via the published alias Han-Jisung, because the three-letter canonical form creates accidental matches when the grid is filled. The other six current members enter under their canonical names. Kim Woo-jin, already listed as a former member, is also left out of the mini-game.",
  ],
  factsHeading: "Accepted group facts",
  facts: [
    { label: "Formed in 2017", sourceUrl: SKZ_SOURCE, revisionId: SKZ_REVID },
    { label: "Country of origin: South Korea", sourceUrl: SKZ_SOURCE, revisionId: SKZ_REVID },
    { label: "Record label: JYP Entertainment", sourceUrl: SKZ_SOURCE, revisionId: SKZ_REVID },
    { label: "Record label: Epic Records Japan", sourceUrl: SKZ_SOURCE, revisionId: SKZ_REVID },
    { label: "Record label: Republic Records", sourceUrl: SKZ_SOURCE, revisionId: SKZ_REVID },
  ],
  rosterHeading: "Members",
  currentMembersHeading: "Current",
  formerMembersHeading: "Former members",
  currentMembers: [
    "Bang Chan",
    "Lee Know",
    "Changbin",
    "Hyunjin",
    "Han",
    "Felix",
    "Seungmin",
    "I.N",
  ],
  formerMembers: [
    {
      name: "Kim Woo-jin",
      note: "Documented membership until 28 October 2019.",
    },
  ],
  quizHeading: "10-question quiz",
  quizIntro:
    "Ten questions about discography, members, ages, and releases, all with accepted facts. Every answer shows its source.",
  wordSearchHeading: "Member word search",
  wordSearchIntro:
    "Find seven current members in the grid. I.N is left out because the word search needs names with at least three letters, and Han appears as Han-Jisung, a published alternate name.",
  dailyGamesHeading: "Daily K-pop games",
  dailyGamesIntro:
    "The daily challenge covers several formats. These pages do not replace today's boards; they only link to them.",
  sourcesHeading: "Where the data comes from",
  sourcesNote:
    "Facts and evidence come from the project repository (Wikidata CC0 and Wikipedia CC BY-SA 4.0). Each item above and each quiz answer cites the revision used.",
  skipLink: "Skip to the Stray Kids quiz",
};

const COPY: Record<string, Record<Locale, GroupPageCopy>> = {
  "stray-kids": { "pt-BR": strayKidsPt, en: strayKidsEn },
};

export function getGroupPageCopy(slug: string, locale: Locale): GroupPageCopy {
  const byLocale = COPY[slug];
  if (!byLocale) throw new Error(`no group page copy for slug ${slug}`);
  return byLocale[locale];
}

/** Rough word count of the static group prose (about + intro + section blurbs). */
export function groupPageWordCount(copy: GroupPageCopy): number {
  const text = [
    copy.intro,
    ...copy.about,
    copy.quizIntro,
    copy.wordSearchIntro,
    copy.dailyGamesIntro,
    copy.sourcesNote,
  ].join(" ");
  return text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}
