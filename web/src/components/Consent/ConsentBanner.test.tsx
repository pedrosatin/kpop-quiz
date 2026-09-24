import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, describe, expect, it } from "vitest";
import { CONSENT_STORAGE_KEY, ConsentBanner } from "./ConsentBanner";
import { getMessages } from "../../i18n/catalog";

const GA_ID = "G-TEST123456";
const PRIVACY_URL = "/pt-br/privacidade/";
const messages = getMessages("pt-BR");

function gaScripts(): HTMLScriptElement[] {
  return Array.from(document.head.querySelectorAll("script")).filter((s) =>
    s.src.includes("googletagmanager.com")
  );
}

afterEach(() => {
  window.localStorage.clear();
  for (const s of gaScripts()) {
    s.remove();
  }
  delete (window as unknown as Record<string, unknown>).gtag;
  delete (window as unknown as Record<string, unknown>).dataLayer;
  delete (window as unknown as Record<string, unknown>)[`ga-disable-${GA_ID}`];
  document.body.innerHTML = "";
});

describe("ConsentBanner", () => {
  it("shows the banner with accept and reject actions when undecided", async () => {
    render(<ConsentBanner locale="pt-BR" ga4Id={GA_ID} privacyUrl={PRIVACY_URL} />);
    await waitFor(() => {
      expect(screen.getByText(messages.consentText)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: messages.consentAccept })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: messages.consentReject })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: messages.consentPrivacyLink })).toHaveAttribute("href", PRIVACY_URL);
    expect(gaScripts()).toHaveLength(0);
  });

  it("loads Google Analytics and stores the choice on accept", async () => {
    render(<ConsentBanner locale="pt-BR" ga4Id={GA_ID} privacyUrl={PRIVACY_URL} />);
    const accept = await screen.findByRole("button", { name: messages.consentAccept });
    fireEvent.click(accept);
    expect(window.localStorage.getItem(CONSENT_STORAGE_KEY)).toBe("accepted");
    await waitFor(() => {
      expect(gaScripts()).toHaveLength(1);
    });
    expect(gaScripts()[0]?.src).toContain(`id=${GA_ID}`);
    expect(screen.queryByText(messages.consentText)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: messages.consentPreferences })).toBeInTheDocument();
  });

  it("stores rejection and never loads Google Analytics", async () => {
    render(<ConsentBanner locale="pt-BR" ga4Id={GA_ID} privacyUrl={PRIVACY_URL} />);
    const reject = await screen.findByRole("button", { name: messages.consentReject });
    fireEvent.click(reject);
    expect(window.localStorage.getItem(CONSENT_STORAGE_KEY)).toBe("rejected");
    expect(gaScripts()).toHaveLength(0);
    expect(screen.queryByText(messages.consentText)).not.toBeInTheDocument();
  });

  it("skips the banner and loads analytics for a stored acceptance", async () => {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, "accepted");
    render(<ConsentBanner locale="pt-BR" ga4Id={GA_ID} privacyUrl={PRIVACY_URL} />);
    await waitFor(() => {
      expect(gaScripts()).toHaveLength(1);
    });
    expect(screen.queryByText(messages.consentText)).not.toBeInTheDocument();
  });

  it("lets a visitor revoke acceptance and disables future GA4 measurement", async () => {
    render(<ConsentBanner locale="pt-BR" ga4Id={GA_ID} privacyUrl={PRIVACY_URL} />);
    fireEvent.click(await screen.findByRole("button", { name: messages.consentAccept }));
    await waitFor(() => {
      expect(gaScripts()).toHaveLength(1);
    });
    fireEvent.click(screen.getByRole("button", { name: messages.consentPreferences }));
    fireEvent.click(screen.getByRole("button", { name: messages.consentReject }));

    expect(window.localStorage.getItem(CONSENT_STORAGE_KEY)).toBe("rejected");
    expect((window as unknown as Record<string, unknown>)[`ga-disable-${GA_ID}`]).toBe(true);
    expect(screen.getByRole("button", { name: messages.consentPreferences })).toBeInTheDocument();
  });

  it("reenables GA4 when a visitor accepts again after revoking consent", async () => {
    render(<ConsentBanner locale="pt-BR" ga4Id={GA_ID} privacyUrl={PRIVACY_URL} />);
    fireEvent.click(await screen.findByRole("button", { name: messages.consentAccept }));
    fireEvent.click(screen.getByRole("button", { name: messages.consentPreferences }));
    fireEvent.click(screen.getByRole("button", { name: messages.consentReject }));
    fireEvent.click(screen.getByRole("button", { name: messages.consentPreferences }));
    fireEvent.click(screen.getByRole("button", { name: messages.consentAccept }));

    expect(window.localStorage.getItem(CONSENT_STORAGE_KEY)).toBe("accepted");
    expect((window as unknown as Record<string, unknown>)[`ga-disable-${GA_ID}`]).toBe(false);
  });
});
