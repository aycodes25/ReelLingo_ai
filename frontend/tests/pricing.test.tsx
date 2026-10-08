import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import LandingPage from "@/app/page";

// The plan cards show what the API sends (the backend writes the first three lines of each card from the real limits).
const plan = (overrides: Record<string, unknown>) => ({
  code: "x", name: "X", blurb: "b", price_usd: 0, price_ngn: 0, price_usd_yearly: 0, price_ngn_yearly: 0, minutes_per_month: 0, max_video_minutes: 10,
  voice_clone: true, watermark: false, priority: 1, max_targets: 1, lip_sync: false, api_access: false, team_seats: 1, saved_voices: 0, featured: false,
  features: [], permissions: {}, contact_sales: false, public: true, sort: 0, ...overrides,
});

const PLANS = [
  plan({ code: "free", name: "Free", blurb: "Try ReelLingo on a short clip.", sort: 0, features: ["2 minutes of dubbing per month (or 20 minutes of subtitles)", "Each video must be 3 minutes or shorter", "1 language per upload", "ReelLingo watermark on your videos"] }),
  plan({
    code: "starter", name: "Starter", blurb: "For hobbyists and TikTokers.", price_usd: 10, price_ngn: 15000, price_usd_yearly: 100, price_ngn_yearly: 150000, sort: 2,
    features: ["16 minutes of dubbing per month (or 160 minutes of subtitles)", "Each video can be up to 10 minutes long", "2 languages per upload", "Voice cloning (dub in your own voice)"],
  }),
  plan({
    code: "studio", name: "Studio", blurb: "For media houses.", price_usd: 75, price_ngn: 115000, price_usd_yearly: 750, price_ngn_yearly: 1150000, sort: 4,
    features: ["125 minutes of dubbing per month (or 1250 minutes of subtitles)", "Each video can be up to 60 minutes long", "10 languages per upload", "API access"],
  }),
  plan({
    code: "ministry", name: "Church & Ministry", blurb: "Every sermon.", price_usd: 150, price_ngn: 225000, price_usd_yearly: 1500, price_ngn_yearly: 2250000, minutes_per_month: 250, sort: 5,
    features: ["250 minutes of dubbing per month (or 2500 minutes of subtitles)", "Each video can be up to 120 minutes long (2 hours)", "5 languages per upload", "Pastor's saved voice"],
  }),
  plan({ code: "agency", name: "Agency & Nollywood", blurb: "Studios.", contact_sales: true, sort: 6, features: ["Each video can be up to 120 minutes long (2 hours)", "Custom minutes and pricing"] }),
];

afterEach(() => vi.restoreAllMocks());

async function renderPricing(body: Record<string, unknown> = { plans: PLANS, packs: [], yearly: true }) {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));
  render(await LandingPage());
  const card = (name: string) => screen.getByRole("heading", { level: 3, name }).closest("article") as HTMLElement;
  return { card };
}

describe("pricing cards", () => {
  it("show the exact prices in dollars and naira, what yearly costs, and what the plan includes", async () => {
    const { card } = await renderPricing();

    const starter = within(card("Starter"));
    expect(starter.getByText("$10.00")).toBeInTheDocument();
    expect(starter.getByText(/or ₦15,000\/month with Paystack/)).toBeInTheDocument();
    expect(starter.getByText(/Yearly: \$100\.00 \(₦150,000\), 2 months free/)).toBeInTheDocument();
    expect(starter.getByText("Every month you get")).toBeInTheDocument();
    expect(starter.getByText("16 minutes of dubbing per month (or 160 minutes of subtitles)")).toBeInTheDocument();
    expect(starter.getByText("Each video can be up to 10 minutes long")).toBeInTheDocument();
    expect(starter.getByText("2 languages per upload")).toBeInTheDocument();
    expect(starter.getByRole("link", { name: "Choose Starter" })).toHaveAttribute("href", "/signup?plan=starter");

    const studio = within(card("Studio"));
    expect(studio.getByText(/or ₦115,000\/month with Paystack/)).toBeInTheDocument();
    expect(studio.getByText("10 languages per upload")).toBeInTheDocument();

    const ministry = within(card("Church & Ministry"));
    expect(ministry.getByText("$150.00")).toBeInTheDocument();
    expect(ministry.getByText(/or ₦225,000\/month with Paystack/)).toBeInTheDocument();
    expect(ministry.getByText("Each video can be up to 120 minutes long (2 hours)")).toBeInTheDocument();
  });

  it("explains the free plan's limits plainly and offers no payment", async () => {
    const { card } = await renderPricing();
    const free = within(card("Free"));
    expect(free.getByText("$0")).toBeInTheDocument();
    expect(free.getByText("What you get")).toBeInTheDocument();
    expect(free.getByText("Each video must be 3 minutes or shorter")).toBeInTheDocument();
    expect(free.getByText("ReelLingo watermark on your videos")).toBeInTheDocument();
    expect(free.queryByText(/Paystack/)).not.toBeInTheDocument();
    expect(free.getByRole("link", { name: "Start free" })).toHaveAttribute("href", "/signup");
  });

  it("sends agencies to sales instead of showing a price", async () => {
    const { card } = await renderPricing();
    const agency = within(card("Agency & Nollywood"));
    expect(agency.getByText("Custom")).toBeInTheDocument();
    expect(agency.getByText("What you can expect")).toBeInTheDocument();
    expect(agency.getByRole("link", { name: "Contact sales" })).toBeInTheDocument();
  });

  it("only mentions yearly prices when yearly plans are switched on", async () => {
    const { card } = await renderPricing({ plans: PLANS, packs: [], yearly: false });
    expect(within(card("Starter")).queryByText(/Yearly:/)).not.toBeInTheDocument();
  });

  it("still shows correct paid plans when the API can't be reached", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    render(await LandingPage());
    const card = (name: string) => within(screen.getByRole("heading", { level: 3, name }).closest("article") as HTMLElement);
    expect(card("Starter").getByText(/or ₦15,000\/month with Paystack/)).toBeInTheDocument();
    expect(card("Creator").getByText(/or ₦38,000\/month with Paystack/)).toBeInTheDocument();
    expect(card("Studio").getByText(/or ₦115,000\/month with Paystack/)).toBeInTheDocument();
    expect(card("Church & Ministry").getByText(/or ₦225,000\/month with Paystack/)).toBeInTheDocument();
    expect(card("Creator").getByText("40 minutes of dubbing per month (or 400 minutes of subtitles)")).toBeInTheDocument();
  });
});
