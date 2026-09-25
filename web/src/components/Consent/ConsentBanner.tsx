import { useEffect, useRef, useState } from "preact/hooks";
import type { Locale } from "../../lib/quiz-types";
import { getMessages } from "../../i18n/catalog";

export const CONSENT_STORAGE_KEY = "kpop-quiz-consent";
export const OPEN_CONSENT_PREFERENCES_EVENT = "kpop-quiz-open-consent-preferences";
export type ConsentChoice = "accepted" | "rejected";
/** Height of the open banner, so sticky controls at the bottom can sit above it. */
export const CONSENT_BANNER_HEIGHT_VAR = "--consent-banner-height";

export interface ConsentBannerProps {
  locale: Locale;
  ga4Id: string;
  privacyUrl: string;
}

function loadGoogleAnalytics(ga4Id: string): void {
  try {
    const w = window as unknown as Record<string, unknown>;
    w[`ga-disable-${ga4Id}`] = false;
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

function disableGoogleAnalytics(ga4Id: string): void {
  try {
    const w = window as unknown as Record<string, unknown>;
    w[`ga-disable-${ga4Id}`] = true;
    if (typeof w.gtag === "function") {
      (w.gtag as (...args: unknown[]) => void)("consent", "update", {
        ad_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied",
        analytics_storage: "denied",
      });
    }
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

export function ConsentBanner({ locale, ga4Id, privacyUrl }: ConsentBannerProps) {
  const messages = getMessages(locale);
  const [choice, setChoice] = useState<ConsentChoice | null>(null);
  const [ready, setReady] = useState(false);
  const bannerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const openPreferences = () => setChoice(null);
    window.addEventListener(OPEN_CONSENT_PREFERENCES_EVENT, openPreferences);

    const stored = readConsentChoice();
    setChoice(stored);
    setReady(true);
    if (stored === "accepted") {
      loadGoogleAnalytics(ga4Id);
    } else if (stored === "rejected") {
      disableGoogleAnalytics(ga4Id);
    }

    return () => window.removeEventListener(OPEN_CONSENT_PREFERENCES_EVENT, openPreferences);
  }, [ga4Id]);

  useEffect(() => {
    const banner = bannerRef.current;
    const root = document.documentElement.style;
    if (!banner) return;
    const publishHeight = () => root.setProperty(CONSENT_BANNER_HEIGHT_VAR, `${banner.offsetHeight}px`);
    publishHeight();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(publishHeight) : null;
    observer?.observe(banner);
    return () => {
      observer?.disconnect();
      root.removeProperty(CONSENT_BANNER_HEIGHT_VAR);
    };
  }, [ready, choice]);

  if (!ready) {
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
    } else {
      disableGoogleAnalytics(ga4Id);
    }
  };

  if (choice !== null) {
    return null;
  }

  return (
    <div ref={bannerRef} class="consent-banner" role="region" aria-label={messages.consentLabel} aria-live="polite">
      <p class="consent-banner-text">{messages.consentText}</p>
      <a class="consent-banner-link" href={privacyUrl}>{messages.consentPrivacyLink}</a>
      <div class="consent-banner-actions">
        <button type="button" class="btn btn-secondary btn-sm" onClick={() => decide("rejected")}>
          {messages.consentReject}
        </button>
        <button type="button" class="btn btn-secondary btn-sm" onClick={() => decide("accepted")}>
          {messages.consentAccept}
        </button>
      </div>
    </div>
  );
}
