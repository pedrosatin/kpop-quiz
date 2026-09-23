import { useEffect, useState } from "preact/hooks";
import type { Locale } from "../../lib/quiz-types";
import { getMessages } from "../../i18n/catalog";

export const CONSENT_STORAGE_KEY = "kpop-quiz-consent";
export type ConsentChoice = "accepted" | "rejected";

export interface ConsentBannerProps {
  locale: Locale;
  ga4Id: string;
}

function loadGoogleAnalytics(ga4Id: string): void {
  try {
    const w = window as unknown as Record<string, unknown>;
    if (typeof w.gtag === "function") return;
    w.dataLayer = w.dataLayer ?? [];
    const gtag = (...args: unknown[]) => {
      (w.dataLayer as unknown[]).push(args);
    };
    w.gtag = gtag;
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ga4Id)}`;
    document.head.appendChild(script);
    gtag("js", new Date());
    gtag("config", ga4Id);
  } catch {
    // Measurement must never break the page.
  }
}

export function readConsentChoice(): ConsentChoice | null {
  try {
    const stored = window.localStorage.getItem(CONSENT_STORAGE_KEY);
    return stored === "accepted" || stored === "rejected" ? stored : null;
  } catch {
    return null;
  }
}

export function ConsentBanner({ locale, ga4Id }: ConsentBannerProps) {
  const messages = getMessages(locale);
  const [choice, setChoice] = useState<ConsentChoice | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = readConsentChoice();
    setChoice(stored);
    setReady(true);
    if (stored === "accepted") {
      loadGoogleAnalytics(ga4Id);
    }
  }, [ga4Id]);

  if (!ready || choice !== null) {
    return null;
  }

  const decide = (next: ConsentChoice) => {
    try {
      window.localStorage.setItem(CONSENT_STORAGE_KEY, next);
    } catch {
      // Private mode: still honor the in-memory choice for this visit.
    }
    setChoice(next);
    if (next === "accepted") {
      loadGoogleAnalytics(ga4Id);
    }
  };

  return (
    <div class="consent-banner" role="region" aria-label={messages.consentLabel} aria-live="polite">
      <p class="consent-banner-text">{messages.consentText}</p>
      <div class="consent-banner-actions">
        <button type="button" class="consent-banner-reject" onClick={() => decide("rejected")}>
          {messages.consentReject}
        </button>
        <button type="button" class="consent-banner-accept" onClick={() => decide("accepted")}>
          {messages.consentAccept}
        </button>
      </div>
    </div>
  );
}
