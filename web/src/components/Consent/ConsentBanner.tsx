import { useEffect, useRef, useState } from "preact/hooks";
import { getMessages } from "../../i18n/catalog";
import { setGameAnalyticsConsent } from "../../lib/game-analytics";
import { getLocalStorageItem, setLocalStorageItem } from "../../lib/local-storage";
import type { Locale } from "../../lib/quiz-types";
import { shareCampaignConfig } from "../../lib/seo-routes";

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
  setGameAnalyticsConsent(ga4Id, true);
  try {
    const w = window as unknown as Record<string, unknown>;
    w[`ga-disable-${ga4Id}`] = false;
    if (typeof w.gtag === "function") {
      (w.gtag as (...args: unknown[]) => void)("consent", "update", {
        analytics_storage: "granted",
        ad_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied",
      });
      return;
    }
    w.dataLayer = w.dataLayer ?? [];
    const gtag = function (..._args: unknown[]) {
      // oxlint-disable-next-line prefer-rest-params
      (w.dataLayer as unknown[]).push(arguments);
    };
    w.gtag = gtag;
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ga4Id)}`;
    document.head.appendChild(script);
    gtag("consent", "default", {
      analytics_storage: "denied", ad_storage: "denied",
      ad_user_data: "denied", ad_personalization: "denied",
    });
    gtag("consent", "update", {
      analytics_storage: "granted", ad_storage: "denied",
      ad_user_data: "denied", ad_personalization: "denied",
    });
    gtag("js", new Date());
    const campaign = shareCampaignConfig(window.location.search);
    if (Object.keys(campaign).length) gtag("config", ga4Id, campaign);
    else gtag("config", ga4Id);
  } catch {
  }
}

function disableGoogleAnalytics(ga4Id: string): void {
  setGameAnalyticsConsent(ga4Id, false);
  try {
    const w = window as unknown as Record<string, unknown>;
    w[`ga-disable-${ga4Id}`] = true;
    for (const cookie of document.cookie.split(";")) {
      const name = cookie.trim().split("=")[0]!;
      if (name !== "_ga" && !name.startsWith("_ga_")) continue;
      const expired = `${name}=; Max-Age=0; path=/`;
      document.cookie = expired;
      const parts = location.hostname.split(".");
      for (let i = 0; i < parts.length - 1; i++) {
        document.cookie = `${expired}; domain=${parts.slice(i).join(".")}`;
      }
    }
    if (typeof w.gtag === "function") {
      (w.gtag as (...args: unknown[]) => void)("consent", "update", {
        ad_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied",
        analytics_storage: "denied",
      });
    }
  } catch {
  }
}

function readConsentChoice(): ConsentChoice | null {
  const stored = getLocalStorageItem(CONSENT_STORAGE_KEY);
  return stored === "accepted" || stored === "rejected" ? stored : null;
}

export function ConsentBanner({ locale, ga4Id, privacyUrl }: ConsentBannerProps) {
  const messages = getMessages(locale);
  const [choice, setChoice] = useState<ConsentChoice | null>(null);
  const [ready, setReady] = useState(false);
  const bannerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const openPreferences = () => setChoice(null);
    window.addEventListener(OPEN_CONSENT_PREFERENCES_EVENT, openPreferences);
    const syncConsent = (event: StorageEvent) => {
      if (event.key !== CONSENT_STORAGE_KEY && event.key !== null) return;
      const next = readConsentChoice();
      setChoice(next);
      if (next === "accepted") loadGoogleAnalytics(ga4Id);
      else disableGoogleAnalytics(ga4Id);
    };
    window.addEventListener("storage", syncConsent);

    const stored = readConsentChoice();
    setGameAnalyticsConsent(ga4Id, stored === "accepted");
    setChoice(stored);
    setReady(true);
    if (stored === "accepted") {
      loadGoogleAnalytics(ga4Id);
    } else if (stored === "rejected") {
      disableGoogleAnalytics(ga4Id);
    }

    return () => {
      window.removeEventListener(OPEN_CONSENT_PREFERENCES_EVENT, openPreferences);
      window.removeEventListener("storage", syncConsent);
    };
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
    setLocalStorageItem(CONSENT_STORAGE_KEY, next);
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
      <p class="consent-banner-text">
        {messages.consentText}{" "}
        <a class="consent-banner-link" href={privacyUrl}>{messages.consentPrivacyLink}</a>
      </p>
      <div class="consent-banner-actions">
        <button type="button" class="btn btn-secondary btn-sm" onClick={() => decide("rejected")}>
          <ChoiceLabel verb={messages.consentReject} tool={messages.consentTool} />
        </button>
        <button type="button" class="btn btn-secondary btn-sm" onClick={() => decide("accepted")}>
          <ChoiceLabel verb={messages.consentAccept} tool={messages.consentTool} />
        </button>
      </div>
    </div>
  );
}

function ChoiceLabel({ verb, tool }: { verb: string; tool: string }) {
  return (
    <span class="consent-banner-choice">
      {verb} <span class="consent-banner-tool">{tool}</span>
    </span>
  );
}
