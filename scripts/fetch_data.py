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
    # Large-cap
    "WELL":  "Welltower",
    "VTR":   "Ventas",
    "DOC":   "Healthpeak Properties",
    "AHR":   "American Healthcare REIT",
    "ARE":   "Alexandria Real Estate Equities",
    # Mid-cap
    "CTRE":  "CareTrust REIT",
    "HR":    "Healthcare Realty Trust",
    "SBRA":  "Sabra Health Care REIT",
    "JAN":   "Janus Living",
    "NHI":   "National Health Investors",
    "OHI":   "Omega Healthcare Investors",
    # Small-cap
    "LTC":   "LTC Properties",
    "DHC":   "Diversified Healthcare Trust",
    "SILA":  "Sila Realty Trust",
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

            # Next earnings date — try multiple yfinance fields
            next_earnings = None
            try:
                cal = stock.calendar
                if isinstance(cal, dict):
                    ed = cal.get('Earnings Date')
                    if ed:
                        next_earnings = str(ed[0] if hasattr(ed, '__len__') else ed)[:10]
                elif cal is not None and hasattr(cal, 'columns'):
                    col = cal.get('Earnings Date')
                    if col is not None:
                        next_earnings = str(list(col.values())[0])[:10]
            except Exception:
                pass
            if not next_earnings:
                try:
                    ts = info.get('earningsTimestamp') or info.get('earningsDate')
                    if ts and isinstance(ts, (int, float)):
                        next_earnings = datetime.fromtimestamp(ts, tz=timezone.utc).strftime('%Y-%m-%d')
                except Exception:
                    pass

            results[ticker] = {
                "name":                name,
                "ticker":              ticker,
                "price":               round(curr, 2),
                "prev_close":          round(prev, 2),
                "pct_change":          round(pct, 2),
                "market_cap":          info.get("marketCap") or 0,
                "dividend_yield":      round(min((lambda y: y if y > 1 else y * 100)((info.get("dividendYield") or 0)), 30), 2),
                "fifty_two_week_high": info.get("fiftyTwoWeekHigh") or 0,
                "fifty_two_week_low":  info.get("fiftyTwoWeekLow") or 0,
                "next_earnings":       next_earnings,
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


# ── Weekly Report (generated on Sundays) ─────────────────────
def generate_weekly_report(all_news: list) -> dict:
    """Fetch 5-day price history and build end-of-week recap."""
    from datetime import timedelta

    weekly_movers = []
    for ticker, name in REITS.items():
        try:
            hist = yf.Ticker(ticker).history(period="5d").dropna(subset=["Close"])
            if len(hist) >= 2:
                start = float(hist["Close"].iloc[0])
                end   = float(hist["Close"].iloc[-1])
                wpct  = ((end - start) / start * 100) if start else 0
                weekly_movers.append({
                    "ticker":     ticker,
                    "name":       name,
                    "price":      round(end, 2),
                    "weekly_pct": round(wpct, 2),
                })
        except Exception as e:
            print(f"  Weekly history ERROR {ticker}: {e}", file=sys.stderr)

    weekly_movers.sort(key=lambda x: x["weekly_pct"], reverse=True)

    one_week_ago = datetime.now(timezone.utc) - timedelta(days=7)

    key_signals = []
    for item in all_news:
        if item.get("is_signal") and item.get("ticker"):
            try:
                pub = datetime.fromisoformat(item["published"].replace("Z", "+00:00"))
                if pub >= one_week_ago:
                    key_signals.append(f"{item['ticker']}: {item['title']}")
            except Exception:
                pass

    broad_highlights = []
    for item in all_news:
        if item.get("is_signal") and item.get("category") in ("broad", "sector"):
            try:
                pub = datetime.fromisoformat(item["published"].replace("Z", "+00:00"))
                if pub >= one_week_ago:
                    broad_highlights.append(item["title"])
            except Exception:
                pass

    advancing = sum(1 for m in weekly_movers if m["weekly_pct"] > 0)
    declining = sum(1 for m in weekly_movers if m["weekly_pct"] < 0)

    return {
        "week_ending":      datetime.now().strftime("%B %d, %Y"),
        "generated_at":     datetime.now(timezone.utc).isoformat(),
        "advancing":        advancing,
        "declining":        declining,
        "total":            len(weekly_movers),
        "top_gainers":      weekly_movers[:3],
        "top_losers":       list(reversed(weekly_movers[-3:])) if len(weekly_movers) >= 3 else weekly_movers,
        "key_signals":      key_signals[:8],
        "broad_highlights": broad_highlights[:6],
    }


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


# ── SEC EDGAR Filings (10-K, 10-Q, 8-K) ─────────────────────
EDGAR_HEADERS = {"User-Agent": "REIT Dashboard reit-dashboard@research.com"}
PRIORITY_FORMS   = {'10-K', '10-Q'}
SECONDARY_FORMS  = {'8-K'}
ALL_FILING_FORMS = PRIORITY_FORMS | SECONDARY_FORMS

def fetch_sec_filings(tickers_dict: dict) -> list:
    """Pull recent 10-K, 10-Q, and 8-K filings from SEC EDGAR."""
    try:
        r = requests.get(
            "https://www.sec.gov/files/company_tickers.json",
            headers=EDGAR_HEADERS, timeout=15
        )
        ticker_cik = {
            v['ticker'].upper(): str(v['cik_str']).zfill(10)
            for v in r.json().values()
        }
    except Exception as e:
        print(f"  EDGAR ticker map failed: {e}", file=sys.stderr)
        return []

    items = []
    for ticker, name in tickers_dict.items():
        cik = ticker_cik.get(ticker.upper())
        if not cik:
            print(f"  EDGAR: no CIK for {ticker}", file=sys.stderr)
            continue
        try:
            r = requests.get(
                f"https://data.sec.gov/submissions/CIK{cik}.json",
                headers=EDGAR_HEADERS, timeout=10
            )
            recent = r.json().get('filings', {}).get('recent', {})
            forms  = recent.get('form', [])
            dates  = recent.get('filingDate', [])
            accs   = recent.get('accessionNumber', [])
            docs   = recent.get('primaryDocument', [])

            for i, form in enumerate(forms[:80]):
                if form not in ALL_FILING_FORMS:
                    continue
                acc  = accs[i].replace('-', '') if i < len(accs) else ''
                doc  = docs[i] if i < len(docs) else ''
                date = dates[i] if i < len(dates) else ''
                link = f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{acc}/{doc}"
                items.append({
                    "ticker":      ticker,
                    "company":     name,
                    "source":      "SEC EDGAR",
                    "category":    "filing",
                    "form":        form,
                    "title":       f"{ticker} — {form} ({date})",
                    "link":        link,
                    "published":   date + "T12:00:00Z" if date else "",
                    "summary":     f"{name} filed a {form} with the SEC on {date}.",
                    "is_signal":   True,
                    "is_priority": form in PRIORITY_FORMS,
                })
            count = sum(1 for x in items if x['ticker'] == ticker)
            print(f"  EDGAR {ticker}: {count} filings")
        except Exception as e:
            print(f"  EDGAR ERROR {ticker}: {e}", file=sys.stderr)

    return items


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

    print("\nFetching SEC EDGAR filings (10-K, 10-Q, 8-K)...")
    sec_filings = fetch_sec_filings(REITS)

    all_news = tag_signals(reit_news + broad_news + api_news) + sec_filings

    sorted_stocks = sorted(stocks.values(), key=lambda s: s["pct_change"], reverse=True)

    # Weekly report: regenerate on Sundays, preserve existing on other days
    is_sunday = datetime.now().weekday() == 6
    weekly_report = None
    if is_sunday:
        print("\nGenerating weekly report (Sunday)...")
        weekly_report = generate_weekly_report(all_news)
        print(f"  Weekly report: {weekly_report['advancing']} advancing / {weekly_report['declining']} declining")
    else:
        out_path = os.path.join(os.path.dirname(__file__), "..", "data", "market_data.json")
        try:
            with open(out_path, "r") as f:
                weekly_report = json.load(f).get("weekly_report")
            if weekly_report:
                print(f"\nPreserving existing weekly report (week ending {weekly_report.get('week_ending', '?')})")
        except Exception:
            pass

    payload = {
        "last_updated":  datetime.now(timezone.utc).isoformat(),
        "market_date":   datetime.now().strftime("%B %d, %Y"),
        "stocks":        stocks,
        "top_gainers":   sorted_stocks[:3],
        "top_losers":    sorted_stocks[-3:],
        "news":          all_news,
        "weekly_report": weekly_report,
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
