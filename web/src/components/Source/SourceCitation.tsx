import type { ComponentChildren } from "preact";
import type { Messages } from "../../i18n/catalog";
import { sourcePlace, sourceProject, sourceTarget } from "../../lib/source-label";

export interface SourceCitationProps {
  url: string;
  revision: number | string | null;
  /** The published locator: read as a place, kept whole in `title`. */
  locator?: string | undefined;
  /** Shown as the site when the URL cannot be linked. */
  fallbackSite?: string | undefined;
  messages: Messages;
  /** Extra text between the citation and the link, such as a cited reference. */
  children?: ComponentChildren;
}

/**
 * The site a citation names: the site and language of a linked URL
 * ("Wikipédia em inglês"), otherwise the caller's fallback.
 */
export function citedSite<F extends string | undefined>(url: string, fallbackSite: F, messages: Messages): string | F {
  const target = sourceTarget(url);
  return target ? messages.source.site(target.site) : fallbackSite;
}

/**
 * The project of a URL in words ("Wikipédia"), the fallback site for a
 * caller whose source carries no project of its own.
 */
export function projectSite(url: string, messages: Messages): string | undefined {
  const project = sourceProject(url);
  return project ? messages.source.project(project) : undefined;
}

function citationText(
  { url, revision, locator, fallbackSite, messages }: SourceCitationProps,
): string {
  const parts = [
    citedSite(url, fallbackSite, messages),
    revision !== null && revision !== "" ? messages.source.revision(Number(revision)) : undefined,
    locator ? messages.source.place(sourcePlace(locator)) : undefined,
  ];
  return `${parts.filter(Boolean).join(", ")}.`;
}

/**
 * The link to a cited revision, named after its destination ("Abrir esta
 * revisão na Wikipédia em inglês"). An unsafe or malformed URL renders
 * nothing. `locator` goes to the title, read as the link's description.
 */
export function SourceLink({ url, locator, messages }: { url: string; locator?: string | undefined; messages: Messages }) {
  const target = sourceTarget(url);
  if (!target) return null;
  return (
    <a class="source-citation-link" href={target.href} target="_blank" rel="noopener noreferrer" title={locator}>
      {messages.source.open(target.site)}
    </a>
  );
}

/**
 * One cited revision as a player reads it: "Wikipédia em inglês, revisão
 * 123, no resumo do artigo." then a link that says where it leads. The raw
 * locator, the proof of where the fact sits, stays in the link's title (read
 * as its description) and in `data-locator`; an unsafe URL is not linked.
 */
export function SourceCitation(props: SourceCitationProps) {
  const { url, locator, messages, children } = props;
  const linked = sourceTarget(url) !== null;
  return (
    <span class="source-citation" data-locator={locator}>
      <span class="source-citation-text" title={linked ? undefined : locator}>{citationText(props)}</span>
      {children}
      {linked && " "}
      <SourceLink url={url} locator={locator} messages={messages} />
    </span>
  );
}
