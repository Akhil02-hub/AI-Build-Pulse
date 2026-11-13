/* ---------- State ---------- */
const CFG = window.APP_CONFIG || {};
const sb = (CFG.supabaseUrl && CFG.supabaseAnonKey && window.supabase)
    ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey) : null;

const state = {
    news: null,
    articles: [],
    user: null,
    bookmarks: new Map(),
    view: 'today', // 'today', 'weekly', 'reading'
};

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = iso => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

// Security: Ensure URLs are safe (prevent javascript: XSS injection)
const safeUrl = (url) => {
    if (!url) return '';
    return /^(http|https):\/\//i.test(url) ? url : '';
};

window.togglePwd = function (id) {
    const input = document.getElementById(id);
    input.type = input.type === 'password' ? 'text' : 'password';
};

// Toast System
function toast(msg, type = 'info') {
    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:9999;display:flex;flex-direction:column;gap:10px;';
        document.body.appendChild(container);
    }
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = `background:var(--surface);color:var(--text);padding:10px 20px;border-radius:8px;box-shadow:var(--shadow-lg);border:1px solid var(--border);font-size:0.9rem;opacity:0;transition:opacity 0.3s;`;
    container.appendChild(t);
    setTimeout(() => t.style.opacity = '1', 10);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 2500);
}

/* ---------- Theme ---------- */
function initTheme() {
    const saved = localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.dataset.theme = saved;
    localStorage.setItem('theme', saved);
    updateThemeIcon(saved);
    $('#themeBtn').onclick = () => {
        const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        document.documentElement.dataset.theme = t;
        localStorage.setItem('theme', t);
        updateThemeIcon(t);
    };
}
function updateThemeIcon(t) {
    $('#themeBtn').innerHTML = t === 'dark'
        ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>'
        : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>';
}

/* ---------- Navigation & Routing ---------- */
const routes = {
    '/today': 'today',
    '/weekly': 'weekly',
    '/briefy': 'briefing',
    '/research': 'research',
    '/tools': 'tools',
    '/trends': 'trends',
    '/radar': 'radar',
    '/github': 'github',
    '/jobs': 'jobs',
    '/reading': 'reading'
};

function getRouteFromPath() {
    let path = window.location.pathname.replace(/\/$/, '');
    if (path === '' || path === '/') return 'today';
    const view = routes[path];
    if (!view) {
        history.replaceState({ view: 'today' }, '', '/today');
        return 'today';
    }
    return view;
}

function navigateTo(view, push = true) {
    let path = '/today';
    for (const [key, val] of Object.entries(routes)) {
        if (val === view) {
            path = key;
            break;
        }
    }

    if (push) {
        history.pushState({ view }, '', path);
    }

    state.view = view;

    // Reset filters on view change so lists don't mysteriously empty
    if ($('#searchInput')) $('#searchInput').value = '';
    if ($('#categoryFilter')) $('#categoryFilter').value = '';

    document.querySelectorAll('.sidebar-nav .nav-item').forEach(el => {
        if (el.dataset.view === view) el.classList.add('active');
        else el.classList.remove('active');
    });

    updateHeader();
    renderFeed();
    closeSidebar();
}

function initNav() {
    document.querySelectorAll('.sidebar-nav .nav-item').forEach(el => {
        el.onclick = (e) => {
            e.preventDefault();
            const view = el.dataset.view;
            if (view) navigateTo(view);
        };
    });

    // Handle Footer Navigation Links
    document.querySelectorAll('.footer-nav-link').forEach(el => {
        el.onclick = (e) => {
            e.preventDefault();
            const href = el.getAttribute('href');
            const view = routes[href];
            if (view) {
                navigateTo(view);
            } else if (href === '/reading') {
                navigateTo('reading');
            }
        };
    });

    // Handle Footer Sign In Button
    const footerAuthBtn = document.getElementById('footerAuthBtn');
    if (footerAuthBtn) {
        footerAuthBtn.onclick = (e) => {
            e.preventDefault();
            if (state.user) {
                if (sb) sb.auth.signOut();
            } else {
                document.getElementById('authModal').classList.remove('hidden');
            }
        };
    }

    $('#openSidebarBtn').onclick = () => {
        $('#sidebar').classList.add('open');
        $('#sidebarOverlay').classList.remove('hidden');
    };
    window.closeSidebar = () => {
        $('#sidebar').classList.remove('open');
        $('#sidebarOverlay').classList.add('hidden');
    };
    $('#closeSidebarBtn').onclick = window.closeSidebar;
    $('#sidebarOverlay').onclick = window.closeSidebar;
}

function updateHeader() {
    const titles = {
        'today': "Today's Overview",
        'weekly': "Weekly Overview",
        'briefing': "Daily AI Briefing",
        'research': "Research Papers",
        'tools': "Tools & Releases",
        'trends': "Weekly Trends",
        'radar': "Technology Radar",
        'github': "GitHub Trending AI",
        'jobs': "AI Job Radar",
        'reading': "My Reading List"
    };
    document.title = titles[state.view] + ' | AI Engineer Pulse';
    const subs = {
        'today': "Free AI engineering news from the last 24 hours.",
        'weekly': "Free AI news collected over the last 7 days.",
        'briefing': "All recent AI engineering updates.",
        'research': "Latest papers and academic breakthroughs.",
        'tools': "New frameworks, models, and infrastructure.",
        'trends': "Most active categories this week.",
        'radar': "Adopt, Trial, Assess, and Watch emerging AI tech.",
        'github': "Trending AI repositories and open-source projects.",
        'jobs': "Latest AI Engineer and ML Engineer roles.",
        'reading': "Saved articles, kept forever."
    };
    $('#pageTitle').textContent = titles[state.view];
    $('#pageSubtitle').textContent = subs[state.view];

    if (['reading', 'trends', 'radar', 'github', 'jobs'].includes(state.view)) {
        $('#controlsBar').classList.add('hidden');
    } else {
        $('#controlsBar').classList.remove('hidden');
    }
}

/* ---------- News ---------- */
async function loadNews() {
    $('#newsFeed').innerHTML = Array(3).fill('<div class="skeleton-card"></div>').join('');
    try {
        const r = await fetch('/data/news.json', { cache: 'no-store' });
        if (!r.ok) throw new Error('news.json not found');
        state.news = await r.json();

        // Data Contract Validation
        const REQUIRED = ['id', 'title', 'url', 'publishedAt'];
        state.articles = (state.news.articles || []).filter(a =>
            a && REQUIRED.every(k => typeof a[k] === 'string' && a[k].trim())
        );

        pruneStaleLocalBookmarks();
        renderCategoryDropdown();
        renderFeed();
        checkStaleness();
    } catch (e) {
        console.error(e);
        $('#newsFeed').innerHTML = `<p style="color:var(--muted); padding: 2rem;">Could not load news yet. The workflow may not have run. ${esc(e.message)}</p>`;
    }
}

function pruneStaleLocalBookmarks() {
    // A saved snapshot is valid if it has at least an id, title and url.
    // Old-format bookmarks (bare strings) are dropped.
    let changed = false;
    for (const [id, val] of [...state.bookmarks.entries()]) {
        if (!val || typeof val !== 'object' || !val.id || !val.title) {
            state.bookmarks.delete(id);
            changed = true;
        }
    }
    if (changed) saveLocalBookmarks();
}

function checkStaleness() {
    const banner = $('#staleBanner');
    if (!state.news) return;
    const age = Date.now() - new Date(state.news.generatedAt).getTime();
    const STALE_HOURS = 26;   // 24h + 2h buffer for GitHub Action delay
    if (age > STALE_HOURS * 3600 * 1000) {
        banner.classList.remove('hidden');
        banner.innerHTML = `⚠️ Last update was ${Math.round(age / 3600000)}h ago. The scheduled workflow may be delayed.`;
    } else {
        banner.classList.add('hidden');
    }
}

/* ---------- Rendering & Cards ---------- */
function getCategorySVG(cat) {
    const icons = {
        'LLM Engineering': '<path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"></path>',
        'RAG': '<circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line>',
        'AI Agents': '<rect x="3" y="11" width="18" height="10" rx="2"></rect><circle cx="12" cy="5" r="2"></circle><path d="M12 7v4"></path><line x1="8" y1="16" x2="8" y2="16"></line><line x1="16" y1="16" x2="16" y2="16"></line>',
        'Model Training': '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>',
        'Inference': '<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path>',
        'AI Infrastructure': '<rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect><rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect><line x1="6" y1="6" x2="6.01" y2="6"></line><line x1="6" y1="18" x2="6.01" y2="18"></line>',
        'MLOps': '<path d="M22 12h-4l-3 9L9 3l-3 9H2"></path>',
        'Multimodal AI': '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>',
        'AI Security': '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path>',
        'AI Frameworks': '<polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline>',
        'General AI': '<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line>',
        'Research': '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>'
    };
    return icons[cat] || icons['General AI'];
}

function cardHTML(a) {
    const saved = state.bookmarks.has(a.id);
    const imgSrc = safeUrl(a.image);
    const imageContent = imgSrc
        ? `<img src="${imgSrc}" alt="${esc(a.title)}" loading="lazy" decoding="async" class="card-img-real" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
           <div class="card-img-fallback" style="display:none;">
             <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
               ${getCategorySVG(a.category)}
             </svg>
           </div>`
        : `<div class="card-img-fallback" style="display:flex;">
             <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
               ${getCategorySVG(a.category)}
             </svg>
           </div>`;

    // Real impact score based on recency (60 to 99), guard against invalid dates
    const ts = Date.parse(a.publishedAt);
    const fresh = Number.isFinite(ts) ? Math.max(60, Math.min(99, 99 - Math.round((Date.now() - ts) / 7200000))) : null;
    const scoreBadge = fresh !== null ? `<span class="impact-badge" title="Freshness score">★ ${fresh}</span>` : '';

    return `
  <article class="card" data-id="${esc(a.id)}" tabindex="0" role="button" aria-expanded="false" onclick="toggleCard(this, event)">
    <div class="card-image">
      <div class="card-image-tag">${esc(a.category || 'General AI')}</div>
      ${imageContent}
    </div>
    <div class="card-content">
      <div class="card-title-container">
          <h3 class="card-title">${esc(a.title)}</h3>
          <span class="card-chevron" aria-hidden="true">▾</span>
      </div>
      <div class="card-meta">
        <span>${esc(a.source)}</span>
        <span>•</span>
        <span>${fmtDate(a.publishedAt)}</span>
        ${scoreBadge}
      </div>
      <div class="card-details">
        ${a.aiSummary
            ? `<div class="ai-summary"><strong>✨ AI Summary</strong>${esc(a.aiSummary)}</div>`
            : `<div class="ai-summary"><strong>Excerpt</strong>${esc((a.summary || '').slice(0, 300))}${(a.summary || '').length > 300 ? '…' : ''}</div>`}
        <div class="why-matters"><strong>Why it matters:</strong> ${esc(a.whyItMatters || '')}</div>
        <div class="card-actions">
          <a href="${safeUrl(a.url)}" target="_blank" rel="noopener" class="btn primary">Read Original</a>
          <button class="btn save ${saved ? 'saved' : ''}" data-save-id="${esc(a.id)}" onclick="toggleBookmark('${esc(a.id)}', event)">${saved ? '★ Saved' : '☆ Save'}</button>
        </div>
      </div>
    </div>
  </article>`;
}

window.toggleCard = function (element, event) {
    if (event && event.target.closest('.card-actions')) return;
    document.querySelectorAll('.card').forEach(c => {
        if (c !== element) {
            c.classList.remove('expanded');
            c.setAttribute('aria-expanded', 'false');
        }
    });
    const isExpanded = element.classList.toggle('expanded');
    element.setAttribute('aria-expanded', String(isExpanded));
};

function applyFilters(list) {
    const q = $('#searchInput').value.toLowerCase().trim();
    const cat = $('#categoryFilter').value;

    const H = 3600 * 1000;
    let cutoff = 0;
    if (state.view === 'today') cutoff = Date.now() - 36 * H;
    else if (state.view === 'briefing') cutoff = Date.now() - 48 * H;
    else if (state.view === 'weekly') cutoff = Date.now() - 7 * 24 * H;

    return list.filter(a => {
        if (cat && a.category !== cat) return false;
        if (cutoff > 0 && new Date(a.publishedAt).getTime() < cutoff) return false;
        if (q && !`${a.title} ${a.summary} ${a.aiSummary || ''}`.toLowerCase().includes(q)) return false;
        return true;
    });
}

function renderFeed() {
    const feed = $('#newsFeed');
    const trends = $('#trendsChart');
    feed.setAttribute('aria-live', 'polite');

    if (state.view === 'trends') {
        feed.classList.add('hidden');
        trends.classList.remove('hidden');
        renderTrends();
        return;
    }

    // --- REAL FEATURE RENDERERS ---
    if (state.view === 'radar') {
        trends.classList.add('hidden');
        feed.classList.remove('hidden');

        // Dynamically calculate radar based on how many articles mention them
        const cats = {};
        state.articles.forEach(a => { cats[a.category] = (cats[a.category] || 0) + 1; });
        const sorted = Object.entries(cats).sort((a, b) => b[1] - a[1]);

        const adopt = sorted.slice(0, 3).map(c => `<span class="radar-tag">${esc(c[0])}</span>`).join('');
        const trial = sorted.slice(3, 6).map(c => `<span class="radar-tag">${esc(c[0])}</span>`).join('');
        const assess = sorted.slice(6, 9).map(c => `<span class="radar-tag">${esc(c[0])}</span>`).join('');
        const watch = sorted.slice(9).map(c => `<span class="radar-tag">${esc(c[0])}</span>`).join('');

        feed.innerHTML = `
            <div class="radar-grid" style="grid-column: 1 / -1;">
                <div class="radar-quadrant adopt">
                    <h3>Adopt (High Activity)</h3>
                    <p style="font-size:0.85rem; color:var(--muted);">Proven and heavily discussed this week.</p>
                    <div class="radar-tags">${adopt || '<span class="radar-tag">Waiting for data...</span>'}</div>
                </div>
                <div class="radar-quadrant trial">
                    <h3>Trial (Growing)</h3>
                    <p style="font-size:0.85rem; color:var(--muted);">Worth building a POC with.</p>
                    <div class="radar-tags">${trial || '<span class="radar-tag">Waiting for data...</span>'}</div>
                </div>
                <div class="radar-quadrant assess">
                    <h3>Assess (Emerging)</h3>
                    <p style="font-size:0.85rem; color:var(--muted);">Explore to understand potential.</p>
                    <div class="radar-tags">${assess || '<span class="radar-tag">Waiting for data...</span>'}</div>
                </div>
                <div class="radar-quadrant watch">
                    <h3>Watch (Niche)</h3>
                    <p style="font-size:0.85rem; color:var(--muted);">Keep an eye on, but don't build yet.</p>
                    <div class="radar-tags">${watch || '<span class="radar-tag">Waiting for data...</span>'}</div>
                </div>
            </div>
        `;
        return;
    }

    if (state.view === 'github') {
        trends.classList.add('hidden');
        feed.classList.remove('hidden');
        const repos = state.news && state.news.githubTrending ? state.news.githubTrending : [];

        if (repos.length === 0) {
            feed.innerHTML = `<p style="color:var(--muted)">No GitHub trending data yet. Run the scraper!</p>`;
            return;
        }

        feed.innerHTML = repos.map(r => `
            <div class="trending-card" style="grid-column: 1 / -1;">
                <div class="trending-header">
                    <a href="${safeUrl(r.url)}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;"><h3>${esc(r.name)}</h3></a>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
                </div>
                <p style="color:var(--muted); font-size:0.9rem;">${esc(r.description)}</p>
                <div class="repo-stats">
                    <span>⭐ ${(r.stars ?? 0).toLocaleString()}</span>
                    <span>🍴 ${(r.forks ?? 0).toLocaleString()}</span>
                    <span>💻 ${esc(r.language || 'Unknown')}</span>
                </div>
            </div>
        `).join('');
        return;
    }

    if (state.view === 'jobs') {
        trends.classList.add('hidden');
        feed.classList.remove('hidden');
        const jobs = state.news && state.news.jobs ? state.news.jobs : [];

        if (jobs.length === 0) {
            feed.innerHTML = `<p style="color:var(--muted)">No job data yet. Run the scraper!</p>`;
            return;
        }

        feed.innerHTML = jobs.map(j => `
            <div class="job-card" style="grid-column: 1 / -1;">
                <div class="job-header">
                    <h3>${esc(j.title)}</h3>
                    <span style="color:var(--muted); font-size:0.85rem;">${esc(j.company)}</span>
                </div>
                <div class="job-meta">
                    <span>📍 ${esc(j.location)}</span>
                    <span>💰 ${esc(j.salary)}</span>
                </div>
                <div class="card-actions" style="margin-top: 1rem;">
                    <a href="${safeUrl(j.url)}" target="_blank" rel="noopener noreferrer" class="btn primary">Apply Now ↗</a>
                </div>
            </div>
        `).join('');
        return;
    }
    // --- END REAL FEATURE RENDERERS ---

    trends.classList.add('hidden');
    feed.classList.remove('hidden');

    let list = [];
    if (state.view === 'reading') {
        list = [...state.bookmarks.values()].sort((a, b) => new Date(b.savedAt || b.publishedAt) - new Date(a.savedAt || a.publishedAt));
    } else {
        list = applyFilters(state.articles);

        if (state.view === 'research') {
            list = list.filter(a => a.category === 'Research');
        } else if (state.view === 'tools') {
            list = list.filter(a => ['AI Frameworks', 'Inference', 'AI Infrastructure'].includes(a.category));
        }
    }

    list.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

    if (list.length === 0) {
        const emptyStyle = "grid-column: 1 / -1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 4rem 2rem; color: var(--muted); width: 100%;";

        if (state.view === 'today' || state.view === 'briefing') {
            feed.innerHTML = `<div style="${emptyStyle}">No news from the last 24 hours.<br><br><button class="btn primary" onclick="navigateTo('weekly')">Check Weekly Overview</button></div>`;
        } else if (state.view === 'research') {
            feed.innerHTML = `<div style="${emptyStyle}">No new research papers today. Try checking the Weekly Overview.</div>`;
        } else if (state.view === 'reading') {
            feed.innerHTML = `<div style="${emptyStyle}">Your reading list is empty.<br><br><button class="btn primary" onclick="navigateTo('today')">Browse Today's News</button></div>`;
        } else if (state.view === 'tools') {
            feed.innerHTML = `<div style="${emptyStyle}">No new releases today. Check back tomorrow.</div>`;
        } else {
            feed.innerHTML = `<div style="${emptyStyle}">Nothing matched your filters.<br><br><button class="btn" onclick="document.getElementById('searchInput').value=''; document.getElementById('categoryFilter').value=''; renderFeed();">Reset Filters</button></div>`;
        }
    } else {
        // Briefing view = top 5 digest
        if (state.view === 'briefing') list = list.slice(0, 5);
        feed.innerHTML = list.map(cardHTML).join('');
    }
}

function renderTrends() {
    const cats = {};
    state.articles.forEach(a => { cats[a.category] = (cats[a.category] || 0) + 1; });
    const sorted = Object.entries(cats).sort((a, b) => b[1] - a[1]);
    const max = sorted[0]?.[1] || 1;

    $('#trendsChart').innerHTML = sorted.map(([c, n]) =>
        `<div class="trend-row"><span>${esc(c)}</span><div class="trend-bar"><div style="width:${(n / max) * 100}%"></div></div><span>${n}</span></div>`
    ).join('') || '<p style="color:var(--muted)">No data yet.</p>';
}

function renderCategoryDropdown() {
    const sel = $('#categoryFilter');
    const cats = [...new Set(state.articles.map(a => a.category))].sort();
    sel.innerHTML = '<option value="">All categories</option>' + cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
}

/* ---------- Bookmarks (local + cloud, permanent) ---------- */
function loadLocalBookmarks() {
    state.bookmarks = new Map();
    try {
        const raw = JSON.parse(localStorage.getItem('bookmarks') || '[]');
        if (Array.isArray(raw)) {
            for (const item of raw) {
                if (typeof item === 'string') continue;   // skip legacy id-only format
                if (item && item.id) state.bookmarks.set(item.id, item);
            }
        }
    } catch { /* corrupt storage — start clean */ }
}

function saveLocalBookmarks() {
    localStorage.setItem('bookmarks', JSON.stringify([...state.bookmarks.values()]));
}

async function syncFromCloud() {
    if (!sb || !state.user) return;
    const { data, error } = await sb.from('bookmarks').select('article_data').eq('user_id', state.user.id);

    if (error) { toast('Failed to sync cloud bookmarks.'); return; }
    if (data) {
        for (const row of data) {
            const a = row.article_data;
            if (a && a.id) state.bookmarks.set(a.id, a);
        }
        saveLocalBookmarks();
    }
}

window.toggleBookmark = async function (id, event) {
    if (event) event.stopPropagation();

    const article = state.articles.find(a => a.id === id) || state.bookmarks.get(id);
    if (!article) return;

    const isSaved = state.bookmarks.has(id);

    if (isSaved) {
        state.bookmarks.delete(id);
        if (sb && state.user) await sb.from('bookmarks').delete().eq('user_id', state.user.id).eq('article_id', id);
    } else {
        const snapshot = { ...article, savedAt: new Date().toISOString() };
        state.bookmarks.set(id, snapshot);
        if (sb && state.user) await sb.from('bookmarks').upsert({ user_id: state.user.id, article_id: id, article_data: snapshot });
    }
    saveLocalBookmarks();

    // Update only the button to prevent re-render jumpiness
    const btn = document.querySelector(`.save[data-save-id="${id}"]`);
    if (btn) {
        if (isSaved) { btn.classList.remove('saved'); btn.innerHTML = '☆ Save'; }
        else { btn.classList.add('saved'); btn.innerHTML = '★ Saved'; }
    }
    if (state.view === 'reading') renderFeed();
};

/* ---------- Auth ---------- */
async function initAuth() {
    const closeModals = () => { $('#authModal').classList.add('hidden'); $('#authStatus').textContent = ''; returnFocus(); };
    let lastFocused = null;

    const open = () => {
        lastFocused = document.activeElement;
        $('#authModal').classList.remove('hidden');
        $('#loginUsername').focus();
    };
    const returnFocus = () => { if (lastFocused) lastFocused.focus(); };

    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#authModal').classList.contains('hidden')) closeModals(); });

    // Single delegated password toggle
    $('#authModal').addEventListener('click', e => {
        const t = e.target.closest('.pwd-toggle');
        if (!t) return;
        const input = document.getElementById(t.dataset.pwd);
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        t.setAttribute('aria-pressed', String(show));
    });

    $('#authBtn').onclick = () => {
        if (state.user && sb) { sb.auth.signOut(); return; }
        open();
    };
    $('#authClose').onclick = closeModals;
    $('#authClose2').onclick = closeModals;
    $('#authModal').onclick = (e) => { if (e.target.id === 'authModal') closeModals(); };

    $('#tabLogin').onclick = () => switchTab('login');
    $('#tabSignup').onclick = () => switchTab('signup');
    $('#btnForgot').onclick = () => switchTab('forgot');
    $('#btnBackToLogin').onclick = () => switchTab('login');

    function switchTab(which) {
        ['loginView', 'signupView', 'forgotView', 'recoveryView'].forEach(id => $('#' + id).classList.add('hidden'));
        $('#loginView').classList.toggle('hidden', which !== 'login');
        $('#signupView').classList.toggle('hidden', which !== 'signup');
        $('#forgotView').classList.toggle('hidden', which !== 'forgot');
        $('#recoveryView').classList.toggle('hidden', which !== 'recovery');

        $('#tabLogin').classList.toggle('active', which !== 'signup');
        $('#tabSignup').classList.toggle('active', which === 'signup');
        $('#authStatus').textContent = '';
    }

    if (!sb) {
        $('#authBtn').querySelector('span').textContent = 'Local only';
        const localOnly = () => { $('#authStatus').style.color = '#f59e0b'; $('#authStatus').textContent = 'Cloud accounts are not configured.'; };
        ['loginForm', 'signupForm', 'forgotForm', 'recoveryForm'].forEach(id => {
            const f = $('#' + id); if (f) f.onsubmit = e => { e.preventDefault(); localOnly(); };
        });
        return;
    }

    $('#loginForm').onsubmit = async e => {
        e.preventDefault();
        const email = $('#loginUsername').value.trim();
        const pass = $('#loginPassword').value;
        $('#authStatus').style.color = '#ef4444';
        if (!/.+@.+\..+/.test(email) || !pass) { $('#authStatus').textContent = 'Enter a valid email and password.'; return; }

        const { error } = await sb.auth.signInWithPassword({ email, password: pass });
        if (error) { $('#authStatus').textContent = error.message; return; }
        closeModals();
    };

    $('#signupForm').onsubmit = async e => {
        e.preventDefault();
        const email = $('#signupUsername').value.trim();
        const pass = $('#signupPassword').value;
        $('#authStatus').style.color = '#ef4444';
        if (!/.+@.+\..+/.test(email)) { $('#authStatus').textContent = 'Enter a valid email.'; return; }
        if (pass.length < 8) { $('#authStatus').textContent = 'Password must be at least 8 characters.'; return; }

        const { data, error } = await sb.auth.signUp({ email, password: pass, options: { emailRedirectTo: location.origin } });
        if (error) { $('#authStatus').textContent = error.message; return; }

        $('#authStatus').style.color = '#10b981';
        $('#authStatus').textContent = data.session ? 'Account created. You are signed in.' : 'Check your email to confirm your account.';
        if (data.session) closeModals();
    };

    $('#forgotForm').onsubmit = async e => {
        e.preventDefault();
        const email = $('#forgotUsername').value.trim();
        if (!/.+@.+\..+/.test(email)) { $('#authStatus').textContent = 'Enter a valid email.'; return; }

        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + '/today' });
        $('#authStatus').style.color = error ? '#ef4444' : '#10b981';
        $('#authStatus').textContent = error ? error.message : 'Reset link sent. Check your inbox.';
    };

    $('#recoveryForm').onsubmit = async e => {
        e.preventDefault();
        const pass = $('#recoveryPassword').value;
        if (pass.length < 8) { $('#authStatus').textContent = 'Min 8 characters.'; return; }

        const { error } = await sb.auth.updateUser({ password: pass });
        $('#authStatus').style.color = error ? '#ef4444' : '#10b981';
        $('#authStatus').textContent = error ? error.message : 'Password updated. Please sign in.';
        if (!error) setTimeout(() => { switchTab('login'); }, 1200);
    };

    sb.auth.onAuthStateChange((event, session) => {
        if (event === 'PASSWORD_RECOVERY') {
            open();
            switchTab('recovery');
        } else if (['SIGNED_IN', 'SIGNED_OUT', 'INITIAL_SESSION'].includes(event)) {
            setUser(session?.user ?? null);
        }
    });

    const { data: { session } } = await sb.auth.getSession();
    setUser(session?.user ?? null);
}

let lastUserId = null;
async function setUser(u) {
    const changed = (u?.id ?? null) !== lastUserId;
    state.user = u;
    lastUserId = u?.id ?? null;
    $('#authBtn').querySelector('span').textContent = u ? 'Sign out' : 'Sign in';
    if (!changed) return;

    if (u) {
        await syncFromCloud();
    } else {
        loadLocalBookmarks();
    }
    renderFeed();
}


/* ---------- Manual Refresh ---------- */
function initRefresh() {
    $('#refreshBtn').onclick = () => {
        loadNews();
        renderCategoryDropdown();
        toast('News data reloaded from server.');
    };
}

/* ---------- Chatbot (Local Data Search) ---------- */
function initChat() {
    const panel = $('#chatPanel'), msgs = $('#chatMessages');
    $('#chatToggle').onclick = () => panel.classList.toggle('hidden');
    $('#chatClose').onclick = () => panel.classList.add('hidden');

    $('#chatForm').onsubmit = async e => {
        e.preventDefault();
        const input = $('#chatInput');
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        addMsg('user', text);

        addMsg('sys', 'Searching local data...');

        // Simulate short delay for UX
        setTimeout(() => {
            const answer = searchLocalData(text);
            msgs.querySelectorAll('.msg.sys').forEach(n => n.remove());
            addMsg('ai', answer);
        }, 500);
    };

    function addMsg(role, text) {
        const div = document.createElement('div');
        div.className = `msg ${role}`;

        if (role === 'user') {
            div.textContent = text; // Prevent XSS
        } else {
            // Convert **bold** safely
            const safeText = esc(text).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
            div.innerHTML = safeText.replace(/\n/g, '<br>');
        }

        msgs.appendChild(div);
        msgs.scrollTop = msgs.scrollHeight;
    }
}

function searchLocalData(query) {
    const q = query.toLowerCase();

    // 1. Answer App Feature Questions
    if (/\b(app|feature|save|bookmark|how to|work|free)\b/i.test(q)) {
        return "Welcome to **AI Pulse**, your free daily source for AI engineering news! Here is what you can do:<br><br>" +
            "• **Today's Overview**: See the freshest AI engineering news from the last 24 hours.<br>" +
            "• **Weekly Overview**: View everything collected in the last 7 days.<br>" +
            "• **Briefing / Research / Tools**: Click the sidebar to filter news by category.<br>" +
            "• **Trends**: See a chart of the most active categories.<br>" +
            "• **Reading List**: Click '☆ Save' on any card to save it permanently. Saved articles never expire!<br><br>" +
            "Ask me about a specific topic (e.g., 'OpenAI', 'RAG', 'Agents', 'GPU') to search today's news!";
    }

    // 2. Search for News Articles
    if (!state.articles || state.articles.length === 0) {
        return "I don't have any news data loaded right now. Please wait for the daily sync or click the refresh button.";
    }

    // Remove stop words from query
    const stopWords = ['what', 'when', 'where', 'who', 'why', 'how', 'the', 'and', 'for', 'are', 'you', 'can', 'tell', 'me', 'about', 'news', 'latest', 'today'];
    const words = q.split(/\W+/).filter(w => w.length > 2 && !stopWords.includes(w));

    if (words.length === 0) {
        return "I'm not sure what you're looking for. Try asking about 'OpenAI', 'agents', or 'what can I do here?'.";
    }

    // Find matches
    const matches = state.articles.filter(a => {
        const text = `${a.title} ${a.summary} ${a.aiSummary || ''} ${a.category} ${a.source}`.toLowerCase();
        return words.some(w => text.includes(w));
    });

    if (matches.length === 0) {
        return "I couldn't find any recent news matching those keywords in today's data.";
    }

    // Format response
    let response = `I found ${matches.length} articles matching your query:<br><br>`;

    matches.slice(0, 4).forEach(m => { // limit to top 4
        const sum = m.aiSummary || m.summary || 'No summary available.';
        response += `📌 <b>${esc(m.title)}</b><br>`;
        response += `<i>${esc(m.category)} | ${esc(m.source)}</i><br>`;
        response += `${esc(sum.slice(0, 150))}${sum.length > 150 ? '...' : ''}<br><br>`;
    });

    if (matches.length > 4) {
        response += `<i>...and ${matches.length - 4} more. Use the search bar to see all results.</i>`;
    }

    return response;
}

/* ---------- Policies ---------- */
function initPolicies() {
    const policies = {
        privacy: `
            <h3>Privacy Policy</h3>
            <p>Last updated: Today</p>
            <p>We value your privacy. AI Engineer Pulse collects minimal data to provide you with the best experience:</p>
            <ul>
                <li><strong>Local Data:</strong> Bookmarks, theme preferences, and read status are stored locally in your browser.</li>
                <li><strong>Cloud Data:</strong> If you create an account, your bookmarks and email (for login) are securely stored in Supabase.</li>
                <li><strong>No Tracking:</strong> We do not use third-party trackers, analytics, or sell your data.</li>
            </ul>
            <p>You can delete your account and all associated data at any time by contacting the author.</p>
        `,
        terms: `
            <h3>Terms of Service</h3>
            <p>Last updated: Today</p>
            <p>By using AI Engineer Pulse, you agree to the following terms:</p>
            <ul>
                <li><strong>Information Accuracy:</strong> News articles are collected automatically from public RSS feeds. We do not guarantee the accuracy, completeness, or reliability of the news.</li>
                <li><strong>Acceptable Use:</strong> You agree not to abuse the platform, scrape the website excessively, or use it for illegal purposes.</li>
                <li><strong>AI Summaries:</strong> Summaries are generated by AI models and may contain inaccuracies. Always read the original source article.</li>
            </ul>
            <p>These terms are subject to change without notice.</p>
        `
    };

    const showPolicy = (type) => {
        $('#policyTitle').textContent = type === 'privacy' ? 'Privacy Policy' : 'Terms of Service';
        $('#policyContent').innerHTML = policies[type];
        $('#policyModal').classList.remove('hidden');
    };

    const privacyLink = $('#privacyLink');
    const termsLink = $('#termsLink');
    if (privacyLink) privacyLink.onclick = (e) => { e.preventDefault(); showPolicy('privacy'); };
    if (termsLink) termsLink.onclick = (e) => { e.preventDefault(); showPolicy('terms'); };
    $('#policyClose').onclick = () => $('#policyModal').classList.add('hidden');

    // Close policy modal when clicking on the dark empty space (backdrop)
    $('#policyModal').onclick = (e) => {
        if (e.target.id === 'policyModal') {
            $('#policyModal').classList.add('hidden');
        }
    };
}

/* ---------- Boot ---------- */
async function boot() {
    initTheme();
    initNav();
    loadLocalBookmarks();
    initRefresh();
    initChat();
    initPolicies();
    await initAuth();
    await loadNews();
    renderCategoryDropdown();

    // Initialize route based on URL
    const initialView = getRouteFromPath();
    navigateTo(initialView, false);

    // Handle browser back/forward buttons
    window.addEventListener('popstate', () => {
        const view = getRouteFromPath();
        navigateTo(view, false);
    });

    setInterval(checkStaleness, 60 * 60 * 1000);

    // Debounce search input
    let searchTimer;
    $('#searchInput').oninput = () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(renderFeed, 150);
    };
    $('#categoryFilter').onchange = renderFeed;

    // Global Event Delegation for Bookmarks
    document.getElementById('newsFeed').addEventListener('click', (e) => {
        const btn = e.target.closest('.save');
        if (btn) {
            const id = btn.getAttribute('data-save-id');
            toggleBookmark(id, e);
        }
    });

    // Keyboard Navigation for Cards
    document.getElementById('newsFeed').addEventListener('keydown', (e) => {
        const card = e.target.closest('.card');
        if (!card) return;
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleCard(card, e);
        }
    });

    // Search Clear Button
    const searchInput = $('#searchInput');
    const clearBtn = $('#clearSearchBtn');
    searchInput.addEventListener('input', () => {
        clearBtn.classList.toggle('hidden', !searchInput.value);
    });
    clearBtn.addEventListener('click', () => {
        searchInput.value = '';
        clearBtn.classList.add('hidden');
        renderFeed();
    });
}

boot();