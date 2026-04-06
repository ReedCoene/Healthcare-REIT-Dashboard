// ── Config ───────────────────────────────────────────────────
const TRACKED    = new Set(['CTRE', 'OHI', 'NHI']);
const BIG_MOVE   = 2.5;

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
  const sign = pct > 0 ? '+' : '';
  return { text: `${sign}${Number(pct).toFixed(2)}%`, cls: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat' };
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

// ── Overview: Sector Stats ────────────────────────────────────
function renderSectorStats(stocks) {
  const arr = Object.values(stocks);
  const totalCap  = arr.reduce((s, x) => s + (x.market_cap || 0), 0);
  const avgYield  = arr.filter(x => x.dividend_yield > 0).reduce((s, x) => s + x.dividend_yield, 0)
                  / arr.filter(x => x.dividend_yield > 0).length;
  const advancing = arr.filter(x => x.pct_change > 0).length;
  const declining = arr.filter(x => x.pct_change < 0).length;

  document.getElementById('sectorStats').innerHTML = `
    <div class="stat-card">
      <div class="stat-label">Sector Market Cap</div>
      <div class="stat-value">${fmtCap(totalCap)}</div>
      <div class="stat-sub">${arr.length} REITs tracked</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Avg. Dividend Yield</div>
      <div class="stat-value">${avgYield.toFixed(2)}%</div>
      <div class="stat-sub">across coverage universe</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Advancing Today</div>
      <div class="stat-value up">${advancing}</div>
      <div class="stat-sub">of ${arr.length} REITs higher</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Declining Today</div>
      <div class="stat-value down">${declining}</div>
      <div class="stat-sub">of ${arr.length} REITs lower</div>
    </div>`;
}

// ── Overview: Movers ─────────────────────────────────────────
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

// ── Overview: Signals ─────────────────────────────────────────
function renderOverviewSignals(news) {
  const signals = news.filter(n => n.is_signal).slice(0, 6);
  const el = document.getElementById('overviewSignals');
  if (!signals.length) { el.innerHTML = '<p class="empty-msg">No major signals today.</p>'; return; }
  el.innerHTML = signals.map(n => `
    <div class="signal-card">
      <div class="card-meta">
        <span class="card-source signal-src">${n.ticker || n.source || '—'}</span>
        <span class="card-date">${timeSince(n.published)}</span>
      </div>
      <div class="card-title">${n.link ? `<a href="${n.link}" target="_blank" rel="noopener">${n.title}</a>` : n.title}</div>
    </div>`).join('');
}

// ── CTRE Tab ─────────────────────────────────────────────────
function renderCTRE(data) {
  const s  = data.stocks['CTRE'];
  const cd = data.ctre_details || {};
  const { text, cls } = fmtChange(s.pct_change);

  // Hero
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
      </div>
    </div>`;

  // Thesis
  const points = cd.thesis_points || [];
  document.getElementById('ctreThesis').innerHTML = `
    <div class="panel">
      <h3>Investment Thesis</h3>
      <ul class="thesis-list">${points.map(p => `<li>${p}</li>`).join('')}</ul>
    </div>`;

  // Key Dates
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

  // Analyst Coverage
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
            <td style="color:var(--muted)">${a.date}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>`;

  // CTRE News
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

// ── Coverage Table ────────────────────────────────────────────
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
      <td class="col-num ${ch.cls}">${ch.text}</td>
      <td class="col-num">${fmtCap(s.market_cap)}</td>
      <td class="col-num">${fmtYield(s.dividend_yield)}</td>
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

// ── News Tab ─────────────────────────────────────────────────
let newsCat    = 'all';
let newsCompany = 'ALL';

function renderNewsTab(news) {
  let filtered = news;
  if (newsCat === 'reit')   filtered = filtered.filter(n => n.category === 'reit');
  if (newsCat === 'broad')  filtered = filtered.filter(n => n.category === 'broad');
  if (newsCat === 'signal') filtered = filtered.filter(n => n.is_signal);
  if (newsCompany !== 'ALL') filtered = filtered.filter(n => n.ticker === newsCompany);

  const el = document.getElementById('newsGrid');
  if (!filtered.length) { el.innerHTML = '<p class="empty-msg">No news for this filter.</p>'; return; }

  const isBroad = n => n.category === 'broad';
  el.innerHTML = `<div class="news-grid-layout">` +
    filtered.slice(0, 40).map(n => {
      const broad    = isBroad(n);
      const srcLabel = broad ? (n.source || 'Industry') : (n.ticker || '—');
      const srcCls   = broad ? 'broad' : (n.is_signal ? 'signal-src' : '');
      return `<div class="news-card ${broad ? 'broad-card' : ''}" style="margin-bottom:0">
        <div class="card-meta">
          <span class="card-source ${srcCls}">${srcLabel}</span>
          <span class="card-date">${timeSince(n.published)}</span>
        </div>
        <div class="card-title">${n.link ? `<a href="${n.link}" target="_blank" rel="noopener">${n.title}</a>` : n.title}</div>
      </div>`;
    }).join('') + `</div>`;
}

function populateCompanyFilter(stocks) {
  const sel = document.getElementById('newsFilter');
  Object.keys(stocks).sort().forEach(t => {
    const opt = document.createElement('option');
    opt.value = t;
    opt.textContent = `${t} — ${stocks[t].name}`;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', () => {
    newsCompany = sel.value;
    renderNewsTab(window._data.news || []);
  });
}

function initNewsFilters(news) {
  document.querySelectorAll('.cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      newsCat = btn.dataset.cat;
      // show/hide company dropdown — only relevant for REIT news
      document.getElementById('newsFilter').style.display =
        (newsCat === 'broad') ? 'none' : '';
      renderNewsTab(news);
    });
  });
}

// ── Bootstrap ────────────────────────────────────────────────
async function init() {
  try {
    const res  = await fetch('data/market_data.json?t=' + Date.now());
    const data = await res.json();
    window._data = data;

    document.getElementById('marketDate').textContent  = data.market_date || '—';
    document.getElementById('lastUpdated').textContent =
      'Updated: ' + new Date(data.last_updated).toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short'
      });

    renderAlert(data.stocks);
    renderSectorStats(data.stocks);
    renderMovers(data.stocks);
    renderOverviewSignals(data.news || []);
    renderCTRE(data);
    renderTable(data.stocks);
    attachTableSort();
    populateCompanyFilter(data.stocks);
    initNewsFilters(data.news || []);
    renderNewsTab(data.news || []);
    initTabs();

  } catch (err) {
    console.error(err);
    document.getElementById('lastUpdated').textContent = 'Error loading data.';
  }
}

init();
