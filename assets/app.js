// ── Theme ────────────────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem('theme');
  if (saved === 'light') document.body.classList.add('light');
  document.getElementById('themeToggle').addEventListener('click', () => {
    document.body.classList.toggle('light');
    localStorage.setItem('theme', document.body.classList.contains('light') ? 'light' : 'dark');
  });
}
initTheme();

// ── Config ───────────────────────────────────────────────────
const TRACKED  = new Set(['CTRE']);
const BIG_MOVE = 2.5;

// ── Formatters ───────────────────────────────────────────────
const fmtPrice = v => v != null ? '$' + Number(v).toFixed(2) : '—';
const fmtYield = v => (v && v > 0) ? Number(v).toFixed(2) + '%' : '—';
const fmtCap   = v => {
  if (!v) return '—';
  if (v >= 1e12) return '$' + (v/1e12).toFixed(1) + 'T';
  if (v >= 1e9)  return '$' + (v/1e9).toFixed(1) + 'B';
  if (v >= 1e6)  return '$' + (v/1e6).toFixed(0) + 'M';
  return '$' + v;
};
const fmtChange = pct => {
  if (pct == null) return { text: '—', cls: 'flat' };
  const abs  = Math.abs(pct);
  const sign = pct > 0 ? '+' : pct < 0 ? '−' : '';
  return { text: `${sign}${abs.toFixed(2)}%`, cls: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat' };
};
const timeSince = str => {
  if (!str) return '';
  const d = new Date(str);
  if (isNaN(d)) return str;
  const s = (Date.now() - d) / 1000;
  if (s < 3600)  return Math.round(s/60) + 'm ago';
  if (s < 86400) return Math.round(s/3600) + 'h ago';
  return Math.round(s/86400) + 'd ago';
};
const rangeBar = s => {
  const { price: p, fifty_two_week_low: lo, fifty_two_week_high: hi } = s;
  if (!lo || !hi || hi === lo) return '<span class="flat">—</span>';
  const pct = Math.max(0, Math.min(100, ((p - lo) / (hi - lo)) * 100));
  return `<div class="range-bar-wrap">
    <span>${fmtPrice(lo)}</span>
    <div class="range-bar-track"><div class="range-bar-fill" style="width:${pct.toFixed(1)}%"></div></div>
    <span>${fmtPrice(hi)}</span>
  </div>`;
};

// ── Tabs ─────────────────────────────────────────────────────
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.remove('hidden');
    });
  });
}

// ── Alert Banner ─────────────────────────────────────────────
function renderAlert(stocks) {
  const big = Object.values(stocks)
    .filter(s => Math.abs(s.pct_change) >= BIG_MOVE)
    .sort((a, b) => Math.abs(b.pct_change) - Math.abs(a.pct_change));
  const el = document.getElementById('alertBanner');
  if (!big.length) { el.classList.add('hidden'); return; }
  const parts = big.map(s => {
    const { text } = fmtChange(s.pct_change);
    return `<strong>${s.ticker}</strong> ${text}`;
  });
  el.innerHTML = `<strong>Notable moves today:</strong> ${parts.join(' &nbsp;&bull;&nbsp; ')}`;
  el.classList.remove('hidden');
}

// ── Daily Summary Helper ──────────────────────────────────────
function summaryBox(title, date, items, accentColor) {
  const color = accentColor || 'var(--accent)';
  const bullets = items.map(item => {
    const cls = item.cls ? ` class="${item.cls}"` : '';
    return `<li class="daily-summary-item"${cls}>${item.html}</li>`;
  }).join('');
  return `
    <div class="daily-summary" style="border-left-color:${color}">
      <div class="daily-summary-header">
        <span class="daily-summary-title" style="color:${color}">${title}</span>
        <span class="daily-summary-date">${date}</span>
      </div>
      <ul class="daily-summary-items">${bullets}</ul>
    </div>`;
}

// ── CTRE: Daily Summary ───────────────────────────────────────
function renderCTRESummary(data) {
  const s   = data.stocks['CTRE'];
  const cd  = data.ctre_details || {};
  const { text, cls } = fmtChange(s.pct_change);
  const items = [];

  // Price action
  items.push({ html: `CTRE <span class="${cls}">${text}</span> to ${fmtPrice(s.price)} today` });

  // Most recent CTRE signal
  const ctreSignals = (data.news || []).filter(n => n.ticker === 'CTRE' && n.is_signal);
  if (ctreSignals.length) {
    const n = ctreSignals[0];
    const link = n.link
      ? `<a href="${n.link}" target="_blank" rel="noopener">${n.title}</a>`
      : n.title;
    items.push({ html: `Latest signal: ${link}` });
  }

  // Next key date
  const dates = cd.key_dates || [];
  if (dates.length) {
    const next = dates[0];
    items.push({ html: `Next: <strong>${next.event}</strong> — ${next.date}` });
  }

  // Analyst coverage summary
  const analysts = cd.analyst_coverage || [];
  if (analysts.length) {
    const buys = analysts.filter(a => ['Outperform','Overweight','Buy'].includes(a.rating));
    if (buys.length) {
      const targets = buys.map(a => `${a.firm} $${a.target}`).join(', ');
      items.push({ html: `Buy-side coverage: ${targets}` });
    }
  }

  document.getElementById('ctreSummary').innerHTML =
    summaryBox("Today's Summary", data.market_date || '—', items, 'var(--accent)');
}

// ── All REITs: Daily Summary ──────────────────────────────────
function renderREITsSummary(data) {
  const arr       = Object.values(data.stocks);
  const advancing = arr.filter(x => x.pct_change > 0).length;
  const declining = arr.filter(x => x.pct_change < 0).length;
  const unchanged = arr.length - advancing - declining;
  const sorted    = [...arr].sort((a, b) => b.pct_change - a.pct_change);
  const top       = sorted[0];
  const bottom    = sorted[sorted.length - 1];

  const items = [];

  // Breadth
  const breadthCls = advancing > declining ? 'up' : advancing < declining ? 'down' : 'flat';
  items.push({
    html: `Sector breadth: <span class="up">${advancing} advancing</span> / <span class="down">${declining} declining</span>${unchanged ? ` / ${unchanged} unchanged` : ''} of ${arr.length} REITs`
  });

  // Top gainer
  if (top) {
    const { text } = fmtChange(top.pct_change);
    items.push({ html: `Top gainer: <strong>${top.ticker}</strong> <span class="up">${text}</span> to ${fmtPrice(top.price)}` });
  }

  // Top loser
  if (bottom && bottom.pct_change < 0) {
    const { text } = fmtChange(bottom.pct_change);
    items.push({ html: `Top loser: <strong>${bottom.ticker}</strong> <span class="down">${text}</span> to ${fmtPrice(bottom.price)}` });
  }

  // Any REIT signals today (last 48h)
  const cutoff = Date.now() - 48 * 3600 * 1000;
  const todaySignals = (data.news || []).filter(n =>
    n.ticker && n.is_signal && new Date(n.published).getTime() >= cutoff
  );
  if (todaySignals.length) {
    const s = todaySignals[0];
    const link = s.link
      ? `<a href="${s.link}" target="_blank" rel="noopener">${s.title}</a>`
      : s.title;
    items.push({ html: `Key signal: ${link}` });
    if (todaySignals.length > 1) {
      items.push({ html: `+${todaySignals.length - 1} more REIT signal${todaySignals.length > 2 ? 's' : ''} today` });
    }
  }

  const color = advancing >= declining ? 'var(--green)' : 'var(--accent)';
  document.getElementById('reitsSummary').innerHTML =
    summaryBox("Today's Summary", data.market_date || '—', items, color);
}

// ── Healthcare News: Daily Summary ───────────────────────────
function renderHealthcareSummary(data) {
  const broadNews = (data.news || []).filter(n => !n.ticker && n.category !== 'reit');
  const signals   = broadNews.filter(n => n.is_signal).slice(0, 3);
  const items     = [];

  if (!signals.length) {
    items.push({ html: 'No major healthcare signals today — check back after market close.' });
  } else {
    signals.forEach(n => {
      const link = n.link
        ? `<a href="${n.link}" target="_blank" rel="noopener">${n.title}</a>`
        : n.title;
      items.push({ html: `[${n.source}] ${link}` });
    });
  }

  document.getElementById('healthcareSummary').innerHTML =
    summaryBox("Today's Top Stories", data.market_date || '—', items, 'var(--purple)');
}

// ── CTRE Tab ─────────────────────────────────────────────────
function renderCTRE(data) {
  const s  = data.stocks['CTRE'];
  const cd = data.ctre_details || {};
  const { text, cls } = fmtChange(s.pct_change);

  document.getElementById('ctreHero').innerHTML = `
    <div class="ctre-hero">
      <div class="ctre-hero-left">
        <h2>CareTrust REIT &nbsp;&mdash;&nbsp; NYSE: CTRE</h2>
        <div class="ctre-price">${fmtPrice(s.price)}</div>
        <div class="ctre-change-pill ${cls}">${text} today</div>
      </div>
      <div class="ctre-metrics">
        <div class="ctre-metric-item">
          <div class="ctre-metric-label">Market Cap</div>
          <div class="ctre-metric-value">${fmtCap(s.market_cap)}</div>
        </div>
        <div class="ctre-metric-item">
          <div class="ctre-metric-label">Div. Yield</div>
          <div class="ctre-metric-value">${fmtYield(s.dividend_yield)}</div>
        </div>
        <div class="ctre-metric-item">
          <div class="ctre-metric-label">52W High</div>
          <div class="ctre-metric-value">${fmtPrice(s.fifty_two_week_high)}</div>
        </div>
        <div class="ctre-metric-item">
          <div class="ctre-metric-label">52W Low</div>
          <div class="ctre-metric-value">${fmtPrice(s.fifty_two_week_low)}</div>
        </div>
        ${s.next_earnings ? (() => {
          const days = Math.round((new Date(s.next_earnings) - new Date()) / (1000*60*60*24));
          const label = days < 0 ? 'Reported' : days === 0 ? 'Today' : `${days}d away`;
          const cls   = days >= 0 && days <= 21 ? 'up' : 'flat';
          return `<div class="ctre-metric-item">
            <div class="ctre-metric-label">Next Earnings</div>
            <div class="ctre-metric-value">${s.next_earnings} <span class="pct-pill ${cls}" style="font-size:11px">${label}</span></div>
          </div>`;
        })() : ''}
      </div>
    </div>`;

  const points = cd.thesis_points || [];
  document.getElementById('ctreThesis').innerHTML = `
    <div class="panel">
      <h3>Investment Thesis</h3>
      <ul class="thesis-list">${points.map(p => `<li>${p}</li>`).join('')}</ul>
    </div>`;

  const dates = cd.key_dates || [];
  document.getElementById('ctreDates').innerHTML = `
    <div class="panel">
      <h3>Key Dates</h3>
      <ul class="dates-list">${dates.map(d => `
        <li class="date-item">
          <div class="date-event">${d.event}</div>
          <div class="date-when">${d.date}</div>
          <div class="date-note">${d.note}</div>
        </li>`).join('')}</ul>
    </div>`;

  const analysts = cd.analyst_coverage || [];
  document.getElementById('ctreAnalysts').innerHTML = `
    <div class="panel">
      <h3>Analyst Coverage</h3>
      <table class="analyst-table">
        <thead><tr><th>Firm</th><th>Rating</th><th>Target</th><th>Date</th></tr></thead>
        <tbody>${analysts.map(a => {
          const ratingCls = 'rating-' + a.rating.toLowerCase().replace(' ', '');
          return `<tr>
            <td>${a.firm}</td>
            <td class="${ratingCls}">${a.rating}</td>
            <td>$${a.target}</td>
            <td style="color:var(--text-4)">${a.date}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>`;

  const ctreNews = (data.news || []).filter(n => n.ticker === 'CTRE');
  const ctreEl   = document.getElementById('ctreNews');
  if (!ctreNews.length) { ctreEl.innerHTML = '<p class="empty-msg">No recent news.</p>'; return; }
  ctreEl.innerHTML = ctreNews.map(n => `
    <div class="news-card" style="margin-bottom:8px">
      <div class="card-meta">
        <span class="card-source ${n.is_signal ? 'signal-src' : ''}">CTRE</span>
        <span class="card-date">${timeSince(n.published)}</span>
      </div>
      <div class="card-title">${n.link ? `<a href="${n.link}" target="_blank" rel="noopener">${n.title}</a>` : n.title}</div>
    </div>`).join('');
}

// ── All REITs: Movers ─────────────────────────────────────────
function renderMovers(stocks) {
  const sorted  = Object.values(stocks).sort((a, b) => b.pct_change - a.pct_change);
  const gainers = sorted.slice(0, 3);
  const losers  = sorted.slice(-3).reverse();
  document.getElementById('moversRow').innerHTML = [...gainers, ...losers].map(s => {
    const isGain = s.pct_change >= 0;
    const { text } = fmtChange(s.pct_change);
    const dot = TRACKED.has(s.ticker) ? '<div class="tracked-dot" title="Tracked position"></div>' : '';
    return `<div class="mover-card ${isGain ? 'gain' : 'loss'}">
      ${dot}
      <div class="mover-ticker">${s.ticker}</div>
      <div class="mover-company">${s.name}</div>
      <div class="mover-price">${fmtPrice(s.price)}</div>
      <div class="mover-change ${isGain ? 'up' : 'down'}">${text}</div>
    </div>`;
  }).join('');
}

// ── All REITs: Coverage Table ─────────────────────────────────
let sortState = { col: 'pct_change', dir: 'desc' };
function renderTable(stocks) {
  const rows = Object.values(stocks).sort((a, b) => {
    const dir = sortState.dir === 'asc' ? 1 : -1;
    const va  = a[sortState.col] ?? -Infinity;
    const vb  = b[sortState.col] ?? -Infinity;
    return (va < vb ? -1 : va > vb ? 1 : 0) * dir;
  });
  document.getElementById('tableBody').innerHTML = rows.map(s => {
    const ch      = fmtChange(s.pct_change);
    const tracked = TRACKED.has(s.ticker);
    return `<tr class="${tracked ? 'tracked-row' : ''}">
      <td><div class="ticker-cell">
        <span class="ticker-tag">${s.ticker}</span>
        ${tracked ? '<span class="tracked-badge">TRACKED</span>' : ''}
      </div></td>
      <td class="company-name">${s.name}</td>
      <td class="col-num">${fmtPrice(s.price)}</td>
      <td class="col-num"><span class="pct-pill ${ch.cls}">${ch.text}</span></td>
      <td class="col-num">${fmtCap(s.market_cap)}</td>
      <td class="col-num">${fmtYield(s.dividend_yield)}</td>
      <td class="col-num">${s.next_earnings ? (() => {
        const days = Math.round((new Date(s.next_earnings) - new Date()) / (1000*60*60*24));
        const cls  = days >= 0 && days <= 21 ? 'up' : 'flat';
        return days < 0 ? `<span style="color:var(--t3)">${s.next_earnings}</span>` :
               `<span class="pct-pill ${cls}" style="font-size:11px">${days}d</span>`;
      })() : '—'}</td>
      <td class="col-range">${rangeBar(s)}</td>
    </tr>`;
  }).join('');

  document.querySelectorAll('.reit-table th.sortable').forEach(th => {
    th.classList.remove('sorted-asc', 'sorted-desc');
    if (th.dataset.col === sortState.col)
      th.classList.add(sortState.dir === 'asc' ? 'sorted-asc' : 'sorted-desc');
  });
}
function attachTableSort() {
  document.querySelectorAll('.reit-table th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      sortState = { col, dir: sortState.col === col && sortState.dir === 'desc' ? 'asc' : 'desc' };
      renderTable(window._data.stocks);
    });
  });
}

// ── Healthcare News Tab ───────────────────────────────────────
let healthcareCat = 'all';

function renderHealthcareNewsTab(news) {
  let filtered;
  if (healthcareCat === 'filing') {
    filtered = news.filter(n => n.category === 'filing');
  } else {
    filtered = news.filter(n => !n.ticker && n.category !== 'reit' && n.category !== 'filing');
    if (healthcareCat === 'broad')  filtered = filtered.filter(n => n.category === 'broad');
    if (healthcareCat === 'sector') filtered = filtered.filter(n => n.category === 'sector');
    if (healthcareCat === 'signal') filtered = filtered.filter(n => n.is_signal);
  }

  const el = document.getElementById('healthcareNewsGrid');
  if (!filtered.length) { el.innerHTML = '<p class="empty-msg">No news for this filter.</p>'; return; }

  el.innerHTML = `<div class="news-grid-layout">` +
    filtered.slice(0, 40).map(n => {
      const isFiling = n.category === 'filing';
      const isSector = n.category === 'sector';
      const isPriority = n.is_priority;
      const srcCls = isFiling
        ? (isPriority ? 'filing-priority-src' : 'filing-src')
        : isSector ? 'sector-src' : (n.is_signal ? 'signal-src' : '');
      const cardCls = isFiling
        ? (isPriority ? 'filing-priority-card' : 'filing-card')
        : isSector ? 'sector-card' : 'broad-card';
      const formBadge = isFiling ? `<span class="form-badge ${isPriority ? 'form-priority' : 'form-secondary'}">${n.form}</span>` : '';
      return `<div class="news-card ${cardCls}" style="margin-bottom:0">
        <div class="card-meta">
          ${formBadge}<span class="card-source ${srcCls}">${n.ticker || n.source || 'Industry'}</span>
          <span class="card-date">${timeSince(n.published)}</span>
        </div>
        <div class="card-title">${n.link ? `<a href="${n.link}" target="_blank" rel="noopener">${n.title}</a>` : n.title}</div>
      </div>`;
    }).join('') + `</div>`;
}

function initHealthcareCatFilters(news) {
  document.querySelectorAll('#healthcareCatFilters .cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#healthcareCatFilters .cat-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      healthcareCat = btn.dataset.hcat;
      renderHealthcareNewsTab(news);
    });
  });
}

// ── End of Week Report ────────────────────────────────────────
function renderWeeklyReport(data) {
  const el = document.getElementById('weeklyReport');
  const wr = data.weekly_report;

  if (!wr) {
    el.innerHTML = `
      <div class="weekly-empty">
        <div class="weekly-empty-icon">📋</div>
        <h2>No report yet this week</h2>
        <p>The End of Week Report is generated every Sunday after market close and covers the full week's price action, key signals, and macro highlights.</p>
        <p class="weekly-empty-sub">Check back Sunday evening.</p>
      </div>`;
    return;
  }

  const moverRow = (movers, cls) => movers.map(m => {
    const sign = m.weekly_pct > 0 ? '+' : '';
    return `<div class="weekly-mover-item">
      <span class="weekly-mover-ticker">${m.ticker}</span>
      <span class="weekly-mover-name">${m.name}</span>
      <span class="weekly-mover-pct ${cls}">${sign}${Number(m.weekly_pct).toFixed(2)}%</span>
    </div>`;
  }).join('');

  const signalList = (items) => items.map(t =>
    `<li class="weekly-list-item">${t}</li>`
  ).join('');

  el.innerHTML = `
    <div class="weekly-report-card">
      <div class="weekly-report-header">
        <div>
          <div class="weekly-report-label">End of Week Report</div>
          <h2 class="weekly-report-title">Week Ending ${wr.week_ending}</h2>
        </div>
        <div class="weekly-breadth">
          <span class="up">${wr.advancing} advancing</span>
          <span class="weekly-breadth-sep">/</span>
          <span class="down">${wr.declining} declining</span>
          <span class="weekly-breadth-total">of ${wr.total} REITs</span>
        </div>
      </div>
    </div>

    <div class="weekly-grid">
      <div class="section">
        <div class="section-header"><h2>Top Gainers — Week</h2></div>
        <div class="panel weekly-movers-panel">
          ${wr.top_gainers && wr.top_gainers.length ? moverRow(wr.top_gainers, 'up') : '<p class="empty-msg">No data.</p>'}
        </div>
      </div>
      <div class="section">
        <div class="section-header"><h2>Top Losers — Week</h2></div>
        <div class="panel weekly-movers-panel">
          ${wr.top_losers && wr.top_losers.length ? moverRow(wr.top_losers, 'down') : '<p class="empty-msg">No data.</p>'}
        </div>
      </div>
    </div>

    ${wr.key_signals && wr.key_signals.length ? `
    <div class="section">
      <div class="section-header"><h2>Key REIT Signals This Week</h2></div>
      <div class="panel">
        <ul class="weekly-list">${signalList(wr.key_signals)}</ul>
      </div>
    </div>` : ''}

    ${wr.broad_highlights && wr.broad_highlights.length ? `
    <div class="section">
      <div class="section-header"><h2>Healthcare &amp; Macro Highlights</h2></div>
      <div class="panel">
        <ul class="weekly-list">${signalList(wr.broad_highlights)}</ul>
      </div>
    </div>` : ''}`;
}

// ── Today's Brief ─────────────────────────────────────────────
function renderBrief(data) {
  const stocks  = Object.values(data.stocks);
  const news    = data.news || [];
  const sorted  = [...stocks].sort((a, b) => b.pct_change - a.pct_change);
  const advancing = stocks.filter(s => s.pct_change > 0).length;
  const declining = stocks.filter(s => s.pct_change < 0).length;

  // Sentiment line
  const majority = advancing > declining ? 'up' : advancing < declining ? 'down' : 'flat';
  const sentimentText = majority === 'up'
    ? `${advancing} of ${stocks.length} healthcare REITs advanced today`
    : majority === 'down'
    ? `${declining} of ${stocks.length} healthcare REITs declined today`
    : `Healthcare REITs were mixed today`;
  const sentimentCls = majority === 'up' ? 'up' : majority === 'down' ? 'down' : 'flat';

  // Top movers (top 2 gainers + top loser if notable)
  const gainers = sorted.filter(s => s.pct_change > 0).slice(0, 2);
  const losers  = sorted.filter(s => s.pct_change < 0).reverse().slice(0, 2);
  const movers  = [...gainers, ...losers].slice(0, 4);

  // Key signals — earnings, dividends, analyst ratings
  const signals = news.filter(n => n.is_signal).slice(0, 5);

  // Macro headlines — broad/sector only
  const macro = news.filter(n => !n.ticker && n.category !== 'reit' && n.is_signal).slice(0, 3);

  const moverCards = movers.map(s => {
    const { text, cls } = fmtChange(s.pct_change);
    return `
      <div class="brief-mover">
        <div class="brief-mover-left">
          <span class="brief-ticker">${s.ticker}</span>
          <span class="brief-name">${s.name}</span>
        </div>
        <div class="brief-mover-right">
          <span class="brief-price">${fmtPrice(s.price)}</span>
          <span class="pct-pill ${cls}">${text}</span>
        </div>
      </div>`;
  }).join('');

  const signalItems = signals.map(n => {
    const link = n.link
      ? `<a href="${n.link}" target="_blank" rel="noopener">${n.title}</a>`
      : n.title;
    const label = n.ticker || n.source || '—';
    return `
      <div class="brief-item">
        <span class="brief-item-tag">${label}</span>
        <span class="brief-item-text">${link}</span>
      </div>`;
  }).join('');

  const macroItems = macro.map(n => {
    const link = n.link
      ? `<a href="${n.link}" target="_blank" rel="noopener">${n.title}</a>`
      : n.title;
    return `
      <div class="brief-item">
        <span class="brief-item-tag broad">${n.source}</span>
        <span class="brief-item-text">${link}</span>
      </div>`;
  }).join('');

  document.getElementById('todaysBrief').innerHTML = `
    <div class="brief-wrap">

      <div class="brief-hero">
        <div class="brief-date">${data.market_date || '—'}</div>
        <h2 class="brief-headline">
          <span class="${sentimentCls}">${sentimentText}.</span>
        </h2>
        <div class="brief-breadth">
          <span class="up">${advancing} up</span>
          <span class="brief-sep">·</span>
          <span class="down">${declining} down</span>
          <span class="brief-sep">·</span>
          <span class="flat">${stocks.length - advancing - declining} flat</span>
        </div>
      </div>

      <div class="brief-sections">

        <div class="brief-section">
          <div class="brief-section-label">Biggest Movers</div>
          <div class="brief-movers">${moverCards || '<p class="empty-msg">No data.</p>'}</div>
        </div>

        ${signals.length ? `
        <div class="brief-section">
          <div class="brief-section-label">Key Signals</div>
          <div class="brief-list">${signalItems}</div>
        </div>` : ''}

        ${macro.length ? `
        <div class="brief-section">
          <div class="brief-section-label">Healthcare &amp; Policy</div>
          <div class="brief-list">${macroItems}</div>
        </div>` : ''}

      </div>
    </div>`;
}

// ── Bootstrap ────────────────────────────────────────────────
async function init() {
  try {
    const res  = await fetch('data/market_data.json?t=' + Date.now());
    const data = await res.json();
    window._data = data;

    document.getElementById('marketDate').textContent = data.market_date || '—';
    try {
      const d = new Date(data.last_updated);
      document.getElementById('lastUpdated').textContent = data.last_updated
        ? 'Updated: ' + d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })
        : 'No data yet — workflow runs at 5:30 PM ET weekdays.';
    } catch(e) {
      document.getElementById('lastUpdated').textContent = 'No data yet — workflow runs at 5:30 PM ET weekdays.';
    }

    renderAlert(data.stocks);
    renderBrief(data);

    // CTRE tab
    renderCTRESummary(data);
    renderCTRE(data);

    // All REITs tab
    renderREITsSummary(data);
    renderMovers(data.stocks);
    renderTable(data.stocks);
    attachTableSort();

    // Healthcare News tab
    renderHealthcareSummary(data);
    initHealthcareCatFilters(data.news || []);
    renderHealthcareNewsTab(data.news || []);

    // End of Week Report tab
    renderWeeklyReport(data);

    initTabs();

  } catch (err) {
    console.error(err);
    document.getElementById('lastUpdated').textContent = 'Error loading data.';
  }
}

init();
