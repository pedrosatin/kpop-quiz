import { afterEach, describe, expect, it, vi } from "vitest";
import { dailyReferenceDate, preferNextDaily } from "./daily-artifact";
import { loadQuizSession } from "./session-loader";
import ptSession from "../tests/fixtures/session.pt-BR.standard.cfd5c3457b985e8171255a5b4fe7b8328ef25c5f5d9e5a4632f5179120fc1d47.json";
import manifest from "../tests/fixtures/manifest-v2.json";

type Dated = { reference_date: string; label: string };
const isDated = (value: unknown): value is Dated =>
  typeof value === "object" && value !== null && typeof (value as Dated).reference_date === "string";

function routeFetch(routes: Record<string, unknown>) {
  return vi.fn(async (url: string) => {
    if (!(url in routes)) return new Response(null, { status: 404 });
    const body = routes[url];
    // jsdom and Node use different Uint8Array realms, so check with isView.
    return new Response(ArrayBuffer.isView(body) ? (body as Uint8Array<ArrayBuffer>) : JSON.stringify(body));
  });
}

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function dailyArtifacts(date: string) {
  const session = structuredClone(ptSession);
  session.config.seed = `kpop-daily-${date}`;
  const bytes = new TextEncoder().encode(`${JSON.stringify(session)}\n`);
  const hash = await sha256(bytes);
  const dailyManifest = structuredClone(manifest) as Record<string, any>;
  const path = `session.daily.pt-BR.standard.${hash}.json`;
  dailyManifest.sessions["daily.pt-BR.standard"] = {
    path,
    sha256: hash,
    session_id: session.session_id,
  };
  return { manifest: dailyManifest, path, bytes };
}

describe("daily reference date", () => {
  it("follows the Sao Paulo calendar", () => {
    expect(dailyReferenceDate(new Date("2026-09-26T02:30:00Z"))).toBe("2026-09-25");
    expect(dailyReferenceDate(new Date("2026-09-26T03:30:00Z"))).toBe("2026-09-26");
  });
});

describe("preferNextDaily", () => {
  afterEach(() => vi.unstubAllGlobals());
  const current: Dated = { reference_date: "2026-09-24", label: "main" };

  it("keeps a current artifact without fetching next/", async () => {
    const fetch = routeFetch({});
    vi.stubGlobal("fetch", fetch);
    await expect(preferNextDaily({ ...current, reference_date: "2026-09-25" }, "grid.daily.json", "/", isDated, "2026-09-25"))
      .resolves.toMatchObject({ label: "main" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("switches to next/ once its day arrives", async () => {
    vi.stubGlobal("fetch", routeFetch({ "/base/data/next/grid.daily.json": { reference_date: "2026-09-25", label: "next" } }));
    await expect(preferNextDaily(current, "grid.daily.json", "/base", isDated, "2026-09-25"))
      .resolves.toMatchObject({ label: "next" });
  });

  it("never shows a future day", async () => {
    vi.stubGlobal("fetch", routeFetch({ "/data/next/grid.daily.json": { reference_date: "2026-09-26", label: "next" } }));
    await expect(preferNextDaily(current, "grid.daily.json", "/", isDated, "2026-09-25"))
      .resolves.toMatchObject({ label: "main" });
  });

  it("keeps the main artifact when next/ is missing or invalid", async () => {
    vi.stubGlobal("fetch", routeFetch({}));
    await expect(preferNextDaily(current, "grid.daily.json", "/", isDated, "2026-09-25")).resolves.toBe(current);
    vi.stubGlobal("fetch", routeFetch({ "/data/next/grid.daily.json": { label: "no date" } }));
    await expect(preferNextDaily(current, "grid.daily.json", "/", isDated, "2026-09-25")).resolves.toBe(current);
  });
});

describe("daily quiz session published ahead", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("loads the next/ session after midnight in Sao Paulo", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-25T04:00:00Z"));
    const main = await dailyArtifacts("2026-09-24");
    const next = await dailyArtifacts("2026-09-25");
    vi.stubGlobal("fetch", routeFetch({
      "/data/manifest-v2.json": main.manifest,
      [`/data/${main.path}`]: main.bytes,
      "/data/next/manifest-v2.json": next.manifest,
      [`/data/next/${next.path}`]: next.bytes,
    }));
    const session = await loadQuizSession("pt-BR", "standard", "daily", "/");
    expect(session.config.seed).toBe("kpop-daily-2026-09-25");
  });

  it("keeps today's session and ignores next/ for other themes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-25T02:00:00Z"));
    const main = await dailyArtifacts("2026-09-24");
    const next = await dailyArtifacts("2026-09-25");
    const fetch = routeFetch({
      "/data/manifest-v2.json": main.manifest,
      [`/data/${main.path}`]: main.bytes,
      "/data/next/manifest-v2.json": next.manifest,
      [`/data/next/${next.path}`]: next.bytes,
    });
    vi.stubGlobal("fetch", fetch);
    const session = await loadQuizSession("pt-BR", "standard", "daily", "/");
    expect(session.config.seed).toBe("kpop-daily-2026-09-24");
    expect(fetch).not.toHaveBeenCalledWith("/data/next/manifest-v2.json");
  });
});
