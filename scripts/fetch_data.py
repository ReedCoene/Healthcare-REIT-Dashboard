"""
Healthcare REIT Dashboard — Daily Data Fetcher
Runs via GitHub Actions after market close Mon–Fri.
Writes data/market_data.json for the static site to consume.
"""

import json
import os
import sys
from datetime import datetime, timezone

import feedparser
import requests
import yfinance as yf

NEWS_API_KEY = os.environ.get("NEWS_API_KEY")  # set as GitHub Actions secret

# ── Coverage universe ─────────────────────────────────────────
REITS = {
    "WELL":  "Welltower",
    "VTR":   "Ventas",
    "DOC":   "Healthpeak Properties",
    "OHI":   "Omega Healthcare Investors",
    "CTRE":  "CareTrust REIT",
    "NHI":   "National Health Investors",
    "SBRA":  "Sabra Health Care REIT",
    "HR":    "Healthcare Realty Trust",
    "LTC":   "LTC Properties",
    "MPW":   "Medical Properties Trust",
    "CHCT":  "Community Healthcare Trust",
    "UHT":   "Universal Health Realty",
}

# ── Broad healthcare news RSS feeds ──────────────────────────
BROAD_FEEDS = [
    {"source": "Reuters Health",       "url": "https://feeds.reuters.com/reuters/healthNews",                    "category": "broad"},
    {"source": "Becker's Hospital",    "url": "https://www.beckershospitalreview.com/rss/articles",              "category": "broad"},
    {"source": "Skilled Nursing News", "url": "https://skillednursingnews.com/feed/",                            "category": "sector"},
    {"source": "McKnight's Senior",    "url": "https://www.mcknightsseniorliving.com/feed/",                     "category": "sector"},
    {"source": "Modern Healthcare",    "url": "https://www.modernhealthcare.com/section/rss",                    "category": "broad"},
    {"source": "STAT News",            "url": "https://www.statnews.com/feed/",                                  "category": "broad"},
    {"source": "CMS Newsroom",         "url": "https://www.cms.gov/newsroom/rss",                                "category": "broad"},
    {"source": "Nareit",               "url": "https://www.reit.com/rss.xml",                                    "category": "sector"},
    {"source": "MarketWatch Health",   "url": "https://feeds.content.dowjones.io/public/rss/mw_healthcare",     "category": "broad"},
    {"source": "MarketWatch RE",       "url": "https://feeds.content.dowjones.io/public/rss/mw_realestate",     "category": "broad"},
]

# Keywords that flag a news item as a meaningful signal
SIGNAL_KEYWORDS = [
    "earnings", "ffo", "dividend", "acquisition", "merger", "guidance",
    "upgrade", "downgrade", "price target", "initiates", "raises", "cuts",
    "cms", "medicare", "medicaid", "occupancy", "beat", "miss",
    "offering", "investment", "tenant", "operator", "rating", "coverage",
    "quarter", "annual", "outlook", "forecast", "staffing", "reimbursement",
]


# ── Price fetch ───────────────────────────────────────────────
def fetch_prices() -> dict:
    results = {}
    try:
        batch = yf.Tickers(" ".join(REITS.keys()))
    except Exception as e:
        print(f"Batch init failed: {e}", file=sys.stderr)
        batch = None

    for ticker, name in REITS.items():
        try:
            stock = batch.tickers[ticker] if batch else yf.Ticker(ticker)
            info  = stock.info or {}
            hist  = stock.history(period="5d").dropna(subset=["Close"])

            if len(hist) >= 2:
                prev  = float(hist["Close"].iloc[-2])
                curr  = float(hist["Close"].iloc[-1])
            elif len(hist) == 1:
                curr  = float(hist["Close"].iloc[-1])
                prev  = curr
            else:
                print(f"  No history: {ticker}", file=sys.stderr)
                continue

            pct = ((curr - prev) / prev * 100) if prev else 0
            results[ticker] = {
                "name":                name,
                "ticker":              ticker,
                "price":               round(curr, 2),
                "prev_close":          round(prev, 2),
                "pct_change":          round(pct, 2),
                "market_cap":          info.get("marketCap") or 0,
                "dividend_yield":      round((info.get("dividendYield") or 0) * 100, 2),
                "fifty_two_week_high": info.get("fiftyTwoWeekHigh") or 0,
                "fifty_two_week_low":  info.get("fiftyTwoWeekLow") or 0,
            }
            print(f"  {ticker}: ${curr:.2f} ({pct:+.2f}%)")
        except Exception as e:
            print(f"  ERROR {ticker}: {e}", file=sys.stderr)

    return results


# ── REIT-specific news (Yahoo Finance RSS per ticker) ─────────
def fetch_reit_news() -> list:
    items = []
    for ticker, name in REITS.items():
        url = f"https://feeds.finance.yahoo.com/rss/2.0/headline?s={ticker}&region=US&lang=en-US"
        try:
            feed = feedparser.parse(url)
            for entry in feed.entries[:4]:
                summary = entry.get("summary", "") or ""
                items.append({
                    "ticker":    ticker,
                    "company":   name,
                    "source":    ticker,
                    "category":  "reit",
                    "title":     entry.get("title", "").strip(),
                    "link":      entry.get("link", ""),
                    "published": entry.get("published", entry.get("updated", "")),
                    "summary":   summary[:300] + ("…" if len(summary) > 300 else ""),
                    "is_signal": False,
                })
        except Exception as e:
            print(f"  News ERROR {ticker}: {e}", file=sys.stderr)
    return items


# ── Broad healthcare news (industry RSS feeds) ────────────────
def fetch_broad_news() -> list:
    items = []
    for feed_cfg in BROAD_FEEDS:
        try:
            feed = feedparser.parse(feed_cfg["url"])
            for entry in feed.entries[:5]:
                summary = entry.get("summary", "") or ""
                items.append({
                    "ticker":    None,
                    "company":   None,
                    "source":    feed_cfg["source"],
                    "category":  feed_cfg["category"],
                    "title":     entry.get("title", "").strip(),
                    "link":      entry.get("link", ""),
                    "published": entry.get("published", entry.get("updated", "")),
                    "summary":   summary[:300] + ("…" if len(summary) > 300 else ""),
                    "is_signal": False,
                })
            print(f"  {feed_cfg['source']}: {min(5, len(feed.entries))} items")
        except Exception as e:
            print(f"  Feed ERROR {feed_cfg['source']}: {e}", file=sys.stderr)
    return items


# ── Tag signals ───────────────────────────────────────────────
def tag_signals(items: list) -> list:
    for item in items:
        text = (item["title"] + " " + item.get("summary", "")).lower()
        item["is_signal"] = any(kw in text for kw in SIGNAL_KEYWORDS)
    return items


# ── NewsAPI (WSJ, Bloomberg, Reuters by keyword) ─────────────
def fetch_newsapi() -> list:
    if not NEWS_API_KEY:
        print("  NEWS_API_KEY not set — skipping WSJ/Bloomberg pull")
        return []

    # Queries are already healthcare-scoped; secondary filter below
    # catches any stray off-topic articles that slip through
    queries = [
        "healthcare REIT skilled nursing",
        "senior housing real estate investment",
        "CMS Medicare Medicaid skilled nursing facility",
        "CareTrust REIT OR Omega Healthcare OR Welltower OR Ventas",
    ]

    # Article must contain at least one of these to be kept
    HEALTHCARE_TERMS = [
        "health", "hospital", "medical", "medicare", "medicaid", "nursing",
        "senior", "patient", "clinical", "pharma", "biotech", "drug", "therapy",
        "care", "reit", "assisted living", "post-acute", "cms", "fda", "insurance",
        "physician", "provider", "wellness", "aging", "dementia", "alzheimer",
    ]

    def is_healthcare_relevant(art: dict) -> bool:
        text = ((art.get("title") or "") + " " + (art.get("description") or "")).lower()
        return any(term in text for term in HEALTHCARE_TERMS)

    items = []
    seen  = set()

    for q in queries:
        try:
            resp = requests.get(
                "https://newsapi.org/v2/everything",
                params={
                    "q":        q,
                    "language": "en",
                    "sortBy":   "publishedAt",
                    "pageSize": 10,
                    "apiKey":   NEWS_API_KEY,
                },
                timeout=10,
            )
            resp.raise_for_status()
            for art in resp.json().get("articles", []):
                url = art.get("url", "")
                if url in seen or not is_healthcare_relevant(art):
                    continue
                seen.add(url)
                source_name = art.get("source", {}).get("name", "News")
                items.append({
                    "ticker":    None,
                    "company":   None,
                    "source":    source_name,
                    "category":  "broad",
                    "title":     (art.get("title") or "").strip(),
                    "link":      url,
                    "published": art.get("publishedAt", ""),
                    "summary":   (art.get("description") or "")[:300],
                    "is_signal": False,
                })
        except Exception as e:
            print(f"  NewsAPI ERROR ({q[:30]}…): {e}", file=sys.stderr)

    print(f"  NewsAPI: {len(items)} articles across {len(queries)} queries")
    return items


# ── CTRE static details (update manually each quarter) ───────
CTRE_DETAILS = {
    "key_dates": [
        {"event": "Dividend Payment",  "date": "April 15, 2026",        "note": "$0.39/share — 16.4% hike vs prior quarter"},
        {"event": "Annual Meeting",    "date": "April 29, 2026",         "note": "Director elections, Deloitte auditor ratification"},
        {"event": "Q1 2026 Earnings",  "date": "Est. early May 2026",    "note": "Watch: deployment pace, FAD/FFO guidance"},
    ],
    "analyst_coverage": [
        {"firm": "Mizuho",    "rating": "Outperform", "target": 42, "date": "Apr 2026"},
        {"firm": "JPMorgan",  "rating": "Overweight",  "target": 40, "date": "Mar 2026"},
    ],
    "thesis_points": [
        "Aggressive capital deployer — $1.8B+ invested in 2025, $142M deal announced in early 2026",
        "16% dividend hike signals management confidence in pipeline accretion and cash flow visibility",
        "Pure-play SNF/AL focus benefits from CMS 3.2% net rate increase (FY2026) and rising occupancy (~79% → 81%)",
        "SNF staffing mandate rollback removes a major structural headwind for operators",
        "Mizuho Outperform initiation ($42 PT) expands analyst coverage and adds buy-side visibility",
        "Risks: capital deployment pace slowing, Medicare Advantage expansion pressuring operator margins, interest rate sensitivity",
    ],
}


# ── Main ──────────────────────────────────────────────────────
def main():
    print("=== Healthcare REIT Dashboard Data Fetch ===")
    print(f"Run time: {datetime.now(timezone.utc).isoformat()}\n")

    print("Fetching prices...")
    stocks = fetch_prices()
    if not stocks:
        print("ERROR: No price data. Aborting.", file=sys.stderr)
        sys.exit(1)

    print("\nFetching REIT news...")
    reit_news = fetch_reit_news()

    print("\nFetching broad healthcare news...")
    broad_news = fetch_broad_news()

    print("\nFetching NewsAPI (WSJ/Bloomberg)...")
    api_news = fetch_newsapi()

    all_news = tag_signals(reit_news + broad_news + api_news)

    sorted_stocks = sorted(stocks.values(), key=lambda s: s["pct_change"], reverse=True)

    payload = {
        "last_updated":  datetime.now(timezone.utc).isoformat(),
        "market_date":   datetime.now().strftime("%B %d, %Y"),
        "stocks":        stocks,
        "top_gainers":   sorted_stocks[:3],
        "top_losers":    sorted_stocks[-3:],
        "news":          all_news,
        "ctre_details":  CTRE_DETAILS,
    }

    out = os.path.join(os.path.dirname(__file__), "..", "data", "market_data.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w") as f:
        json.dump(payload, f, indent=2)

    signals = sum(1 for n in all_news if n["is_signal"])
    print(f"\nDone. {len(stocks)} stocks | {len(reit_news)} REIT news | "
          f"{len(broad_news)} industry news | {len(api_news)} NewsAPI | {signals} signals")


if __name__ == "__main__":
    main()
