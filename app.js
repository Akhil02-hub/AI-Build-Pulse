/* ---------- State ---------- */
const CFG = window.APP_CONFIG || {};
const sb = (CFG.supabaseUrl && CFG.supabaseAnonKey && window.supabase)
    ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey) : null;

window.sb = sb; // Expose for push notifications

const state = {
    news: null,
    articles: [],
    user: null,
    bookmarks: new Map(),
    view: 'today',
    persona: ['engineer', 'founder'].includes(localStorage.getItem('persona')) ? localStorage.getItem('persona') : 'engineer',
    currentArticleId: null,
    briefCategory: null,
    dateFilter: '',
    loadError: null,
    lastViewedArticle: null
};

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const HIGHLIGHT_WORDS = ['LLM', 'RAG', 'AI Agents', 'Agentic', 'OpenAI', 'GPT-4', 'Claude', 'Gemini', 'Llama', 'MLOps', 'GPU', 'Inference', 'Fine-tuning', 'Transformer', 'H100', 'A100', 'Vector', 'Prompt Injection', 'Multimodal'];
function highlightKeywords(str) {
    if (!str) return '';
    let safe = esc(str);
    const sorted = [...HIGHLIGHT_WORDS].sort((a, b) => b.length - a.length);
    const escWords = sorted.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const rx = new RegExp(`\\b(${escWords.join('|')})\\b`, 'gi');
    return safe.replace(rx, '<strong style="color: var(--accent); font-weight: 700;">$1</strong>');
}
const fmtDate = iso => {
    try {
        const d = new Date(iso);
        if (isNaN(d.getTime())) return 'Unknown date';
        return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch { return 'Unknown date'; }
};

// Security: Ensure URLs are safe (prevent javascript: XSS injection)
const safeUrl = (url) => {
    if (!url) return '';
    if (url.startsWith('//')) return 'https:' + url;
    return /^(http|https):\/\//i.test(url) ? url : '';
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
    if (document.body) container.appendChild(t);
    setTimeout(() => t.style.opacity = '1', 10);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 2500);
}

/* ---------- Theme ---------- */
function initTheme() {
    let rawTheme = null;
    try { rawTheme = localStorage.getItem('theme'); } catch (e) { }
    const saved = (rawTheme === 'dark' || rawTheme === 'light')
        ? rawTheme
        : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.dataset.theme = saved;
    updateThemeIcon(saved);
    const themeBtn = $('#themeBtn');
    if (themeBtn) themeBtn.onclick = () => {
        const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        document.documentElement.dataset.theme = t;
        localStorage.setItem('theme', t);
        updateThemeIcon(t);
    };
}
function updateThemeIcon(t) {
    const btn = $('#themeBtn');
    if (!btn) return;
    btn.innerHTML = t === 'dark'
        ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>'
        : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>';
}

/* ---------- Navigation & Routing ---------- */
const routes = {
    '/today': 'today',
    '/weekly': 'weekly',
    '/briefing': 'briefing',
    '/research': 'research',
    '/tools': 'tools',
    '/trends': 'trends',
    '/radar': 'radar',
    '/github': 'github',
    '/jobs': 'jobs',
    '/reading': 'reading',
    '/article': 'article'
};

// Detect deployment base (e.g. '/repo' on GitHub Pages, '' on Vercel).
// Walks the current URL pathname from the end to find the deepest known route.
const BASE_PATH = (() => {
    const known = Object.values(routes);
    const parts = window.location.pathname.split('/').filter(Boolean);
    for (let i = parts.length - 1; i >= 0; i--) {
        if (known.includes(parts[i])) {
            const prefix = parts.slice(0, i).join('/');
            return prefix ? '/' + prefix : '';
        }
    }
    // No route in path — assume a single deployment segment (e.g. GitHub Pages /repo).
    if (parts.length && !parts[parts.length - 1].endsWith('.html')) {
        return '/' + parts[0];
    }
    return '';
})();
const buildPath = p => BASE_PATH + p;

function getRouteFromPath() {
    let path = window.location.pathname;
    if (BASE_PATH && path.startsWith(BASE_PATH)) path = path.slice(BASE_PATH.length);
    path = path.replace(/\/$/, '');
    if (path === '' || path === '/') {
        safeReplaceState({ view: 'today' }, '', buildPath('/today'));
        return 'today';
    }
    const view = routes[path];
    if (!view) {
        safeReplaceState({ view: 'today' }, '', buildPath('/today'));
        return 'today';
    }
    return view;
}

function safePushState(state, title, url) {
    try { history.pushState(state, title, url); } catch (e) { console.warn('History API blocked (APK mode)'); }
}
function safeReplaceState(state, title, url) {
    try { history.replaceState(state, title, url); } catch (e) { console.warn('History API blocked (APK mode)'); }
}

function navigateTo(view, push = true, articleId = null) {
    let path = '/today';
    for (const [key, val] of Object.entries(routes)) {
        if (val === view) { path = key; break; }
    }

    // Update URL for articles
    if (view === 'article' && articleId) {
        path = `/article?id=${encodeURIComponent(articleId)}`;
    }

    if (push) {
        safePushState({
            view,
            articleId,
            search: $('#searchInput')?.value || '',
            category: $('#categoryFilter')?.value || '',
            date: $('#dateFilter')?.value || ''
        }, '', buildPath(path));
    }
    state.view = view;
    state.currentArticleId = articleId;

    if (push && view !== 'article') {
        if ($('#searchInput')) $('#searchInput').value = '';
        if ($('#categoryFilter')) $('#categoryFilter').value = '';
        if ($('#dateFilter')) $('#dateFilter').value = '';
        if ($('#clearSearchBtn')) $('#clearSearchBtn').classList.add('hidden');
    }

    document.querySelectorAll('.sidebar-nav .nav-item').forEach(el => {
        if (el.dataset.view === view) el.classList.add('active');
        else el.classList.remove('active');
    });

    updateHeader();
    renderFeed();
    closeSidebar();
}

function initNav() {
    // Persona Toggle Logic
    const personaBtns = document.querySelectorAll('.persona-btn');
    personaBtns.forEach(btn => {
        btn.onclick = () => {
            const p = btn.dataset.persona;
            if (p !== 'engineer' && p !== 'founder') return;

            personaBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.persona = p;
            localStorage.setItem('persona', state.persona);
            state.briefCategory = null;

            if (state.view === 'article') {
                navigateTo('today');
            } else {
                updateHeader();
                renderFeed();
            }
        };
    });

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
                if (window.openAuthModal) window.openAuthModal();
                else document.getElementById('authModal')?.classList.remove('hidden');
            }
        };
    }

    window.closeSidebar = () => {
        $('#sidebar')?.classList.remove('open');
        $('#sidebarOverlay')?.classList.add('hidden');
    };
    const openBtn = $('#openSidebarBtn');
    if (openBtn) {
        openBtn.onclick = () => {
            $('#sidebar')?.classList.add('open');
            $('#sidebarOverlay')?.classList.remove('hidden');
        };
    }
    if ($('#closeSidebarBtn')) $('#closeSidebarBtn').onclick = window.closeSidebar;
    if ($('#sidebarOverlay')) $('#sidebarOverlay').onclick = window.closeSidebar;
}

window.goBackFromArticle = function () {
    if (history.state?.view === 'article') {
        history.back();
    } else {
        let targetView = 'today';
        try { targetView = sessionStorage.getItem('previousView') || 'today'; } catch { }
        navigateTo(targetView, false);
        const routePath = Object.entries(routes).find(([, v]) => v === targetView)?.[0] || '/today';
        safeReplaceState({ view: targetView }, '', buildPath(routePath));
    }
};

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
        'reading': "My Reading List",
        'article': "Article Analysis"
    };
    document.title = (titles[state.view] || 'AI Pulse') + ' | AI Engineer Pulse';

    const subs = {
        'today': state.persona === 'engineer' ? "Free AI engineering news from the last 24 hours." : "Startup, funding, and AI business updates.",
        'weekly': "Free AI news collected over the last 7 days.",
        'briefing': "Today's top stories, grouped by category.",
        'research': "Latest papers and academic breakthroughs.",
        'tools': "New frameworks, models, and infrastructure.",
        'trends': "Most active categories this week.",
        'radar': "Adopt, Trial, Assess, and Watch emerging AI tech.",
        'github': "Trending AI repositories and open-source projects.",
        'jobs': "Latest AI Engineer and ML Engineer roles.",
        'reading': "Saved articles, kept forever.",
        'article': "Detailed engineering and business insights."
    };
    if ($('#pageTitle')) $('#pageTitle').textContent = titles[state.view] ?? 'AI Pulse';
    if ($('#pageSubtitle')) $('#pageSubtitle').textContent = subs[state.view] ?? '';

    const cb = $('#controlsBar');
    if (cb) {
        if (['reading', 'trends', 'radar', 'github', 'jobs', 'article', 'briefing'].includes(state.view)) {
            cb.classList.add('hidden');
        } else {
            cb.classList.remove('hidden');
        }
    }
}
/* ---------- News ---------- */
async function loadNews() {
    state.loadError = null;
    const feed = $('#newsFeed');
    if (feed) feed.innerHTML = Array(3).fill('<div class="skeleton-card"></div>').join('');
    try {
        const r = await fetch(`${BASE_PATH}/data/news.json`, { cache: 'no-store' });
        if (!r.ok) throw new Error('news.json not found');
        state.news = await r.json();
        if (!state.news || typeof state.news !== 'object' || Array.isArray(state.news)) throw new Error('Invalid news.json shape');
        state.briefCategory = null;

        // Data Contract Validation + Deduplication safety net
        const REQUIRED = ['id', 'title', 'url', 'publishedAt'];
        const seenIds = new Set();
        const sourceArticles = Array.isArray(state.news.articles) ? state.news.articles : [];
        state.articles = sourceArticles
            .filter(a => a && REQUIRED.every(k => typeof a[k] === 'string' && a[k].trim()) && Number.isFinite(Date.parse(a.publishedAt)))
            .filter(a => {
                if (seenIds.has(a.id)) return false;
                seenIds.add(a.id);
                return true;
            })
            .map(a => ({
                ...a,
                source: a.source || 'Unknown',
                category: a.category || 'General AI',
                summary: a.summary || '',
                relevanceScore: typeof a.relevanceScore === 'number' ? a.relevanceScore : 0
            }));

        pruneStaleLocalBookmarks();
        renderCategoryDropdown();
        renderDateDropdown();
        renderFeed();
        try { checkStaleness(); } catch (err) { console.warn('Staleness check failed', err); }
        return true;
    } catch (e) {
        console.error(e);
        state.loadError = `Could not load news yet. The workflow may not have run. ${e.message}`;
        renderFeed();
        return false;
    }
}

function pruneStaleLocalBookmarks() {
    let changed = false;
    for (const [id, val] of [...state.bookmarks.entries()]) {
        if (!val || typeof val !== 'object' || !val.id || !val.title) {
            state.bookmarks.delete(id);
            changed = true;
            continue;
        }
        // Migration: try to recover missing URL from state.articles
        if (!val.url) {
            const found = state.articles.find(a => a.id === id);
            if (found && found.url) {
                val.url = found.url;
                changed = true;
            }
        }
    }
    if (changed) saveLocalBookmarks();
}

function checkStaleness() {
    const banner = $('#staleBanner');
    if (!banner || !state.news) return;
    const age = Date.now() - new Date(state.news.generatedAt).getTime();
    if (!Number.isFinite(age)) {
        banner.classList.remove('hidden');
        banner.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline; vertical-align:middle; margin-right:6px;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg> Unable to determine data freshness.`;
        return;
    }
    const STALE_HOURS = 26;   // 24h + 2h buffer for GitHub Action delay
    if (age > STALE_HOURS * 3600 * 1000) {
        banner.classList.remove('hidden');
        banner.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline; vertical-align:middle; margin-right:6px;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg> Last update was ${Math.round(age / 3600000)}h ago. The scheduled workflow may be delayed.`;
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
        ? `<img src="${imgSrc}" alt="${esc(a.title)}" referrerpolicy="no-referrer" loading="lazy" decoding="async" class="card-img-real" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
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

    let summaryToDisplay = a.summary || '';
    if (a.insights) {
        if (state.persona === 'engineer' && a.insights.engineerSummary) {
            summaryToDisplay = a.insights.engineerSummary;
        } else if (state.persona === 'founder' && a.insights.founderSummary) {
            summaryToDisplay = a.insights.founderSummary;
        }
    }

    return `
  <article class="card" data-id="${esc(a.id)}" tabindex="0" role="button" onclick="navigateToArticle(this.dataset.id, event)">
    <div class="card-image">
      <div class="card-image-tag">${esc(a.category || 'General AI')}</div>
      ${imageContent}
    </div>
    <div class="card-content">
      <div class="card-title-container">
          <h3 class="card-title">${esc(a.title)}</h3>
      </div>
      <div class="card-meta">
        <span>${esc(a.source)}</span>
        <span>•</span>
        <span>${fmtDate(a.publishedAt)}</span>
        ${scoreBadge}
      </div>
      <div class="ai-summary" style="margin-top: 0.5rem; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">
        ${esc(summaryToDisplay || a.summary || 'Click to read more')}
      </div>
      <div class="card-actions" style="margin-top: 1rem; display: flex; gap: 0.5rem;" onclick="event.stopPropagation()">
        <a href="${safeUrl(a.url) || '#'}" target="_blank" rel="noopener" class="btn primary" style="flex: 1; padding: 0.4rem; font-size: 0.8rem;">Read Original</a>
        <button class="btn save ${saved ? 'saved' : ''}" data-save-id="${esc(a.id)}" onclick="toggleBookmark(this.dataset.saveId, event)" style="padding: 0.4rem; font-size: 0.8rem;">${saved ? '★ Saved' : '☆ Save'}</button>
      </div>
    </div>
  </article>`;
}

window.navigateToArticle = function (id, event) {
    if (event) {
        if (event.target.closest('.card-actions') || event.target.closest('.btn')) return;
        event.preventDefault();
    }
    // Save current view to go back later
    if (state.view !== 'article') {
        sessionStorage.setItem('previousView', state.view);
    }
    navigateTo('article', true, id);
};

// (removed unused toggleCard stub)

function applyFilters(list) {
    const q = ($('#searchInput')?.value || '').toLowerCase().trim();
    const cat = $('#categoryFilter')?.value || '';
    const dateF = $('#dateFilter')?.value || '';

    const H = 3600 * 1000;
    let cutoff = 0;
    if (state.view === 'today') cutoff = Date.now() - 36 * H;
    // (Briefing cutoff is handled inside renderBriefing)
    else if (state.view === 'weekly') cutoff = Date.now() - 7 * 24 * H;

    return list.filter(a => {
        // 1. FILTER BY PERSONA (AUDIENCE)
        if (state.persona === 'engineer' && a.audience === 'founder') return false;
        if (state.persona === 'founder' && a.audience && a.audience !== 'founder' && a.audience !== 'all') return false;

        // 2. Other filters
        if (cat && a.category !== cat) return false;

        if (dateF) {
            const d = new Date(a.publishedAt);
            const aDate = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
            if (aDate !== dateF) return false;
        }

        if (cutoff > 0 && new Date(a.publishedAt).getTime() < cutoff) return false;

        const insText = a.insights ? `${a.insights.engineerSummary || ''} ${a.insights.founderSummary || ''}` : '';
        if (q && !`${a.title} ${a.summary} ${insText}`.toLowerCase().includes(q)) return false;

        return true;
    });
}

function renderArticle() {
    const id = state.currentArticleId || new URLSearchParams(window.location.search).get('id');
    const article = state.articles.find(a => a.id === id) ||
        state.bookmarks.get(id) ||
        (state.lastViewedArticle?.id === id ? state.lastViewedArticle : null);

    if (!article) {
        const msg = state.loadError
            ? "Couldn't load article data — please retry. The network may be down."
            : "Article not found. It may have expired.";
        $('#articleView').innerHTML = `
            <div class="article-top-bar">
                <div class="top-bar-left">
                    <button class="article-nav-btn" onclick="navigateTo('today')">← Back to Today</button>
                </div>
            </div>
            <p style="text-align:center; padding: 4rem; color: var(--muted);">${msg}</p>
            ${state.loadError ? '<div style="text-align:center; padding-bottom: 4rem;"><button class="btn primary" onclick="doRefresh()">Retry Loading</button></div>' : ''}`;
        return;
    }

    const saved = state.bookmarks.has(article.id);
    const imgSrc = safeUrl(article.image);

    // --- THE FIX: Define the missing Notes variables ---
    const notesKey = `notes_${article.id}`;
    const savedNotes = safeGet(notesKey, '');
    const ins = article.insights || {};
    const textForReading = (article.summary || '') + (ins.whatHappened || '') + (ins.engineerSummary || '');
    const words = textForReading.trim().split(/\s+/).filter(Boolean).length;
    const readMins = words === 0 ? 1 : Math.max(1, Math.ceil(words / 200));
    // ---------------------------------------------------

    // If no image, show a beautiful gradient with the category icon
    const imgHTML = imgSrc
        ? `<img src="${imgSrc}" alt="${esc(article.title)}">`
        : `<div class="article-hero-fallback">
             <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${getCategorySVG(article.category)}</svg>
           </div>`;

    $('#articleView').innerHTML = `
        <!-- Top Action Bar -->
        <div class="article-top-bar">
            <div class="top-bar-left">
                <button class="article-nav-btn mobile-only" onclick="document.getElementById('sidebar')?.classList.add('open'); document.getElementById('sidebarOverlay')?.classList.remove('hidden');" style="margin-right: 0.5rem; font-size: 1.2rem;">☰</button>
                <button class="article-nav-btn" onclick="goBackFromArticle()">← Back</button>
                <span class="article-breadcrumb">${esc(article.category)}</span>
            </div>
            <div class="top-bar-right">
                <button class="article-nav-btn ${saved ? 'saved' : ''}" data-id="${esc(article.id)}" onclick="toggleBookmark(this.dataset.id, event)" id="topSaveBtn">
                    ${saved ? '★ Saved' : '☆ Save'}
                </button>
            </div>
        </div>

        <!-- Header -->
        <div class="article-header-area">
            <h1 class="article-title">${esc(article.title)}</h1>
            <div class="article-meta-line">
                <span style="display:flex; align-items:center; gap:4px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg> ${fmtDate(article.publishedAt)}</span>
                <span>•</span>
                <span style="display:flex; align-items:center; gap:4px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg> ${readMins} min read</span>
                <span>•</span>
                <span class="article-tag">${esc(article.category)}</span>
            </div>
        </div>

        <!-- Disclaimer Box -->
        <div class="article-disclaimer">
            <strong>Note:</strong> This summary is compiled from public RSS feeds (${esc(article.source)}). It is not an official publication. Please refer to the original source link at the bottom for full accuracy.
        </div>

        <!-- Hero Image (Always shows, uses fallback if no image) -->
        <div class="article-hero-container">${imgHTML}</div>

        <!-- Action Buttons -->
        <div class="article-action-row">
            <button class="action-btn ${saved ? 'active' : ''}" data-id="${esc(article.id)}" data-action="bookmark" onclick="toggleBookmark(this.dataset.id, event)">
                ${saved ? '★ Saved to Library' : '☆ Save to Library'}
            </button>
            <button class="action-btn" onclick="document.getElementById('chatToggle').click()" style="display:flex; align-items:center; gap:6px;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg> Ask AI about this</button>
            <a href="${safeUrl(article.url) || '#'}" ${safeUrl(article.url) ? 'target="_blank" rel="noopener noreferrer"' : 'onclick="event.preventDefault()"'} class="action-btn primary">Read Full Article ↗</a>
        </div>

        <!-- Two Column Layout -->
        <div class="article-two-col">
            
            <!-- Left Column: Content -->
            <div class="article-main-content">
                
                <div class="content-section">
                    <h2>What happened?</h2>
                    <p style="line-height: 1.8; word-break: break-word;">
                        ${highlightKeywords((ins.whatHappened || (state.persona === 'engineer' ? ins.engineerSummary : ins.founderSummary) || article.summary || 'No details available.').trim())}
                    </p>
                </div>

                <div class="content-section">
                    <h2>Why is it important?</h2>
                    <div class="insight-box">
                        <strong>For Engineers</strong>
                        <p>${highlightKeywords(ins.engineerSummary || article.whyItMatters || 'Engineering impact analysis pending. Please read the full original article for technical details.')}</p>
                    </div>
                    <div class="insight-box" style="border-left-color: #10b981;">
                        <strong>For Founders</strong>
                        <p>${highlightKeywords(ins.founderSummary || 'Business impact analysis pending. Please read the full original article for market context.')}</p>
                    </div>
                </div>
                
                ${ins.whatChanged ? `<div class="content-section"><h2>What changed?</h2><p>${highlightKeywords(ins.whatChanged)}</p></div>` : ''}
                ${ins.techDetails ? `<div class="content-section"><h2>Technical Details</h2><p>${highlightKeywords(ins.techDetails)}</p></div>` : ''}
                ${ins.businessImpact ? `<div class="content-section"><h2>Business Impact</h2><p>${highlightKeywords(ins.businessImpact)}</p></div>` : ''}
                ${ins.learn ? `<div class="content-section"><h2>What can I learn?</h2><p>${highlightKeywords(ins.learn)}</p></div>` : ''}
                ${ins.action ? `<div class="content-section"><h2>What should I do?</h2><p>${highlightKeywords(ins.action)}</p></div>` : ''}

                <div class="content-section">
                    <h2>References</h2>
                    <ul style="padding-left: 1.2rem; margin-top: 0.5rem; color: var(--muted);">
                        <li>Source: <strong>${esc(article.source)}</strong></li>
                        <li>Original Link: <a href="${safeUrl(article.url) || '#'}" ${safeUrl(article.url) ? 'target="_blank" rel="noopener noreferrer"' : 'onclick="event.preventDefault()"'} style="color: var(--accent);">Click here to view original</a></li>
                    </ul>
                </div>

                <div class="content-section notes-section">
                    <h2>My Notes</h2>
                    <textarea id="articleNotes" placeholder="Write down important technical insights, frameworks to check out, or project ideas here...">${esc(savedNotes)}</textarea>
                    <p class="notes-hint">Notes are saved automatically in your browser.</p>
                </div>

            </div>

            <!-- Right Column: Sidebar -->
            <div class="article-sidebar">
                <div class="sidebar-box">
                    <h3>Quick Info</h3>
                    <ul class="sidebar-meta-list">
                        <li><span>Date</span> <strong>${fmtDate(article.publishedAt)}</strong></li>
                        <li><span>Source</span> <strong>${esc(article.source)}</strong></li>
                        <li><span>Category</span> <strong>${esc(article.category)}</strong></li>
                        <li><span>Type</span> <strong>AI Engineering Update</strong></li>
                    </ul>
                </div>
                
                <div class="sidebar-box">
                    <h3>Related Tags</h3>
                    <div class="sidebar-tags">
                        <span>${esc(article.category)}</span>
                        <span>${esc(article.source)}</span>
                        <span>AI</span>
                        <span>LLM</span>
                    </div>
                </div>
            </div>

        </div>
    `;
    state.lastViewedArticle = article;
    document.title = (article.title || '').slice(0, 60) + ' | AI Engineer Pulse';
    $('#articleView').classList.remove('hidden');

    // Auto-save notes functionality
    const notesArea = $('#articleNotes');
    if (notesArea) {
        let typingTimer;
        notesArea.addEventListener('input', () => {
            clearTimeout(typingTimer);
            typingTimer = setTimeout(() => {
                safeSet(notesKey, notesArea.value);
            }, 500); // Save after 0.5s of no typing
        });
    }
} // <--- THIS WAS MISSING

function renderFeed() {
    const feed = $('#newsFeed');
    const trends = $('#trendsChart');
    const articleView = $('#articleView');
    if (!feed) return;

    if (state.loadError && state.view !== 'article') {
        feed.classList.remove('hidden');
        const topHeader = document.querySelector('.top-header');
        if (topHeader) topHeader.classList.remove('hidden');

        const hidesControls = ['reading', 'trends', 'radar', 'github', 'jobs', 'article', 'briefing'];
        if ($('#controlsBar')) {
            if (hidesControls.includes(state.view)) $('#controlsBar').classList.add('hidden');
            else $('#controlsBar').classList.remove('hidden');
        }

        if (trends) trends.classList.add('hidden');
        if (articleView) articleView.classList.add('hidden');
        feed.innerHTML = `<div style="text-align:center; padding: 4rem 2rem; color: var(--muted);">
            <p>${esc(state.loadError)}</p>
            <button class="btn primary" onclick="doRefresh()">Retry Loading</button>
        </div>`;
        return;
    }

    // Handle Article View
    if (state.view === 'article') {
        feed.classList.add('hidden');
        if (trends) trends.classList.add('hidden');
        if (articleView) articleView.classList.remove('hidden');
        const topHeader = document.querySelector('.top-header');
        if (topHeader) topHeader.classList.add('hidden');
        if ($('#controlsBar')) $('#controlsBar').classList.add('hidden');
        renderArticle();
        return;
    } else {
        if (articleView) articleView.classList.add('hidden');
        const topHeader = document.querySelector('.top-header');
        if (topHeader) topHeader.classList.remove('hidden');
        const cb = $('#controlsBar');
        if (cb && !['reading', 'trends', 'radar', 'github', 'jobs', 'briefing'].includes(state.view)) {
            cb.classList.remove('hidden');
        }
    }

    if (state.view === 'briefing') {
        renderBriefing();
        return;
    }

    if (state.view === 'trends') {
        feed.classList.add('hidden');
        if (trends) trends.classList.remove('hidden');
        renderTrends();
        return;
    }

    // --- REAL FEATURE RENDERERS ---
    if (state.view === 'radar') {
        if (trends) trends.classList.add('hidden');
        feed.classList.remove('hidden');

        const RADAR_TECHS = ['vllm', 'langchain', 'llamaindex', 'mcp', 'h100', 'a100', 'gpt-4', 'gpt-4o', 'claude', 'gemini', 'llama', 'pytorch', 'tensorflow', 'ollama', 'rag', 'fine-tuning', 'inference', 'agents', 'multimodal'];
        const techCounts = {};

        state.articles.forEach(a => {
            const text = `${a.title} ${a.summary}`.toLowerCase();
            RADAR_TECHS.forEach(tech => {
                if (text.includes(tech)) {
                    techCounts[tech] = (techCounts[tech] || 0) + 1;
                }
            });
        });

        const sorted = Object.entries(techCounts).sort((a, b) => b[1] - a[1]);

        const adopt = sorted.slice(0, 4).map(c => `<span class="radar-tag">${esc(c[0])}</span>`).join('');
        const trial = sorted.slice(4, 8).map(c => `<span class="radar-tag">${esc(c[0])}</span>`).join('');
        const assess = sorted.slice(8, 12).map(c => `<span class="radar-tag">${esc(c[0])}</span>`).join('');
        const watch = sorted.slice(12).map(c => `<span class="radar-tag">${esc(c[0])}</span>`).join('');

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
        if (trends) trends.classList.add('hidden');
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
                    <span style="display:flex; align-items:center; gap:4px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg> ${(r.stars ?? 0).toLocaleString()}</span>
                    <span style="display:flex; align-items:center; gap:4px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="18" r="3"></circle><circle cx="6" cy="6" r="3"></circle><circle cx="18" cy="6" r="3"></circle><path d="M18 9v1a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9"></path><path d="M12 12v3"></path></svg> ${(r.forks ?? 0).toLocaleString()}</span>
                    <span style="display:flex; align-items:center; gap:4px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg> ${esc(r.language || 'Unknown')}</span>
                </div>
            </div>
        `).join('');
        return;
    }

    if (state.view === 'jobs') {
        if (trends) trends.classList.add('hidden');
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
                    <span style="display:flex; align-items:center; gap:4px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg> ${esc(j.location)}</span>
                    <span style="display:flex; align-items:center; gap:4px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg> ${esc(j.salary)}</span>
                </div>
                <div class="card-actions" style="margin-top: 1rem;">
                    <a href="${safeUrl(j.url)}" target="_blank" rel="noopener noreferrer" class="btn primary">Apply Now ↗</a>
                </div>
            </div>
        `).join('');
        return;
    }
    // --- END REAL FEATURE RENDERERS ---

    if (trends) trends.classList.add('hidden');
    feed.classList.remove('hidden');

    let list = [];
    if (state.view === 'reading') {
        list = [...state.bookmarks.values()].sort((a, b) => new Date(b.savedAt || b.publishedAt) - new Date(a.savedAt || a.publishedAt));
    } else {
        list = applyFilters(state.articles);

        if (state.view === 'research') {
            list = list.filter(a => a.category === 'Research');
        } else if (state.view === 'tools') {
            list = list.filter(a => a.category === 'AI Frameworks');
        }
    }

    if (state.view !== 'reading') {
        list.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    }

    if (list.length === 0) {
        const emptyStyle = "grid-column: 1 / -1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 4rem 2rem; color: var(--muted); width: 100%;";

        if (state.view === 'today') {
            const msg = state.persona === 'founder' ? 'No founder-focused news from the last 24 hours.' : 'No news from the last 24 hours.';
            feed.innerHTML = `<div style="${emptyStyle}">${msg}<br><br><button class="btn primary" onclick="navigateTo('weekly')">Check Weekly Overview</button></div>`;
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
        feed.innerHTML = list.map(cardHTML).join('');
    }
}

function renderBriefing() {
    const feed = $('#newsFeed');
    const trends = $('#trendsChart');
    if (trends) trends.classList.add('hidden');
    if (feed) feed.classList.remove('hidden');

    // 1. Today's articles (last 36h, matches applyFilters) + persona filter
    const cutoff = Date.now() - 36 * 3600 * 1000;
    const todayArticles = state.articles.filter(a => {
        if (new Date(a.publishedAt).getTime() < cutoff) return false;
        if (state.persona === 'engineer' && a.audience === 'founder') return false;
        // STRICT FILTER: Only show articles tagged as founder or all
        if (state.persona === 'founder' && a.audience && a.audience !== 'founder' && a.audience !== 'all') return false;
        return true;
    });

    // 2. Group by category
    const byCat = {};
    todayArticles.forEach(a => (byCat[a.category] = byCat[a.category] || []).push(a));
    const categories = Object.keys(byCat).sort((a, b) => byCat[b].length - byCat[a].length);

    if (!categories.length) {
        const emptyMsg = state.persona === 'founder'
            ? 'No founder-focused stories in the last 24 hours.'
            : 'No news collected in the last 24 hours.';
        feed.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:4rem 2rem; color:var(--muted);">
            ${emptyMsg}<br><br>
            <button class="btn primary" onclick="navigateTo('weekly')">Check Weekly Overview</button>
        </div>`;
        return;
    }

    // 3. Pick selected category (fallback = first)
    const selected = state.briefCategory && byCat[state.briefCategory]
        ? state.briefCategory
        : categories[0];

    // 4. Pills
    const pills = categories.map(cat => `
        <button class="brief-cat-pill ${cat === selected ? 'active' : ''}" data-cat="${esc(cat)}">
            ${esc(cat)} <span class="brief-count">${byCat[cat].length}</span>
        </button>
    `).join('');

    // 5. Briefs for selected category — relevance first, then recency
    const items = byCat[selected]
        .sort((a, b) =>
            (b.relevanceScore || 0) - (a.relevanceScore || 0) ||
            new Date(b.publishedAt) - new Date(a.publishedAt));

    feed.innerHTML = `
        <div class="brief-wrap" style="grid-column: 1 / -1;">
            <div class="brief-cats">${pills}</div>
            <div class="brief-list">${items.map(briefCardHTML).join('')}</div>
        </div>
    `;

    feed.querySelectorAll('.brief-cat-pill').forEach(btn => {
        btn.onclick = () => {
            state.briefCategory = btn.dataset.cat;
            renderBriefing();
        };
    });
}

function briefCardHTML(a) {
    const ins = a.insights || {};
    let brief = ins.whatHappened ||
        (state.persona === 'engineer' ? ins.engineerSummary : ins.founderSummary);

    // Fallback: If AI failed, extract only the first 2 sentences from the raw RSS text
    if (!brief && a.summary) {
        const sentences = a.summary.match(/[^.!?]+[.!?]+/g) || [a.summary];
        brief = sentences.slice(0, 2).join(' ').trim();
    }

    brief = (brief || 'No brief available.').replace(/\s+/g, ' ').trim();

    const saved = state.bookmarks.has(a.id);

    return `
        <article class="brief-card" data-id="${esc(a.id)}">
            <div class="brief-head">
                <h3 class="brief-title"
                    onclick="navigateToArticle(this.closest('.brief-card').dataset.id, event)">
                    ${esc(a.title)}
                </h3>
                <button class="brief-save ${saved ? 'saved' : ''}"
                    data-save-id="${esc(a.id)}"
                    onclick="toggleBookmark(this.dataset.saveId, event)"
                    aria-label="Save">${saved ? '★' : '☆'}</button>
            </div>
            <p class="brief-body">${highlightKeywords(brief)}</p>
            <div class="brief-meta">
                <span>${esc(a.source)}</span>
                <span>•</span>
                <span>${fmtDate(a.publishedAt)}</span>
                <a href="${safeUrl(a.url)}" target="_blank" rel="noopener">Read ↗</a>
            </div>
        </article>`;
}

function renderTrends() {
    const cats = {};
    // Filter by persona ONLY (ignore search/date inputs to prevent stale filter data)
    const filtered = state.articles.filter(a => {
        if (state.persona === 'engineer' && a.audience === 'founder') return false;
        if (state.persona === 'founder' && a.audience && a.audience !== 'founder' && a.audience !== 'all') return false;
        return true;
    });
    filtered.forEach(a => { cats[a.category] = (cats[a.category] || 0) + 1; });
    const sorted = Object.entries(cats).sort((a, b) => b[1] - a[1]);
    const max = sorted[0]?.[1] || 1;

    const el = $('#trendsChart');
    if (!el) return;
    el.innerHTML = sorted.map(([c, n]) =>
        `<div class="trend-row"><span>${esc(c)}</span><div class="trend-bar"><div style="width:${(n / max) * 100}%"></div></div><span>${n}</span></div>`
    ).join('') || '<p style="color:var(--muted)">No data yet.</p>';
}

function renderCategoryDropdown() {
    const sel = $('#categoryFilter');
    if (!sel) return;
    const cats = [...new Set(state.articles.map(a => a.category))].sort();
    sel.innerHTML = '<option value="">All categories</option>' + cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
}

function renderDateDropdown() {
    const sel = $('#dateFilter');
    if (!sel) return;

    // Get unique local date strings (YYYY-MM-DD)
    const dates = [...new Set(state.articles.map(a => {
        const d = new Date(a.publishedAt);
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }))].sort().reverse();

    sel.innerHTML = '<option value="">All dates</option>' + dates.map(d => {
        const dateObj = new Date(d + 'T00:00:00');
        const formatted = dateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        return `<option value="${d}">${formatted}</option>`;
    }).join('');
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

function safeGet(k, fallback = null) { try { return localStorage.getItem(k) ?? fallback; } catch { return fallback; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } }

let _quotaWarned = false;
function saveLocalBookmarks() {
    const ok = safeSet('bookmarks', JSON.stringify([...state.bookmarks.values()]));
    if (!ok && !_quotaWarned) {
        _quotaWarned = true;
        toast('Browser storage full — new bookmarks will not persist after reload.');
    }
}

async function syncFromCloud() {
    if (!sb || !state.user) return true;
    const userId = state.user.id;
    const { data, error } = await sb.from('bookmarks').select('article_data').eq('user_id', userId);

    if (error) { toast('Failed to sync cloud bookmarks.'); return false; }
    const cloudIds = new Set();
    if (data) {
        for (const row of data) {
            const a = row.article_data;
            if (a && a.id) { state.bookmarks.set(a.id, a); cloudIds.add(a.id); }
        }
    }

    pruneStaleLocalBookmarks();
    saveLocalBookmarks();

    const toUpload = [];
    for (const [id, bm] of state.bookmarks) {
        if (!cloudIds.has(id)) toUpload.push([id, bm]);
    }

    let failed = 0;
    // Concurrency cap of 5
    for (let i = 0; i < toUpload.length; i += 5) {
        const batch = toUpload.slice(i, i + 5);
        const results = await Promise.allSettled(batch.map(async ([id, bm]) => {
            const { error } = await sb.from('bookmarks').upsert({ user_id: userId, article_id: id, article_data: bm });
            if (error) throw error;
        }));
        failed += results.filter(r => r.status === 'rejected').length;
    }

    if (failed > 0) {
        toast(`${failed} bookmark(s) failed to upload.`);
        return false;
    }

    saveLocalBookmarks();
    return true;
}

window.toggleBookmark = async function (id, event) {
    if (event) event.stopPropagation();
    if (state._bmBusy?.has(id)) return;
    (state._bmBusy = state._bmBusy || new Set()).add(id);

    try {
        const article = state.articles.find(a => a.id === id) || state.bookmarks.get(id) || (state.lastViewedArticle?.id === id ? state.lastViewedArticle : null);
        if (!article) return;

        const isSaved = state.bookmarks.has(id);

        if (isSaved) {
            state.bookmarks.delete(id);
            if (sb && state.user) {
                const { error } = await sb.from('bookmarks').delete().eq('user_id', state.user.id).eq('article_id', id);
                if (error) toast('Cloud delete failed — removed locally only.');
            }
        } else {
            const snapshot = { ...article, savedAt: new Date().toISOString() };
            state.bookmarks.set(id, snapshot);
            if (sb && state.user) {
                const { error } = await sb.from('bookmarks').upsert({ user_id: state.user.id, article_id: id, article_data: snapshot });
                if (error) toast('Cloud save failed — bookmark kept locally this session.');
            }
        }
        saveLocalBookmarks();

        // Update standard feed buttons
        const btn = document.querySelector(`.save[data-save-id="${CSS.escape(id)}"]`);
        if (btn) {
            if (isSaved) { btn.classList.remove('saved'); btn.innerHTML = '☆ Save'; }
            else { btn.classList.add('saved'); btn.innerHTML = '★ Saved'; }
        }

        const briefBtn = document.querySelector(`.brief-save[data-save-id="${CSS.escape(id)}"]`);
        if (briefBtn) {
            if (isSaved) { briefBtn.classList.remove('saved'); briefBtn.textContent = '☆'; }
            else { briefBtn.classList.add('saved'); briefBtn.textContent = '★'; }
        }

        // Update article view buttons if we are currently viewing an article
        if (state.view === 'article') {
            const topBtn = document.getElementById('topSaveBtn');
            if (topBtn) {
                if (isSaved) { topBtn.classList.remove('saved'); topBtn.innerHTML = '☆ Save'; }
                else { topBtn.classList.add('saved'); topBtn.innerHTML = '★ Saved'; }
            }
            const actionBtns = document.querySelectorAll('#articleView .action-btn');
            actionBtns.forEach(b => {
                if (b.dataset.action === 'bookmark') {
                    if (isSaved) { b.classList.remove('active'); b.innerHTML = '☆ Save to Library'; }
                    else { b.classList.add('active'); b.innerHTML = '★ Saved to Library'; }
                }
            });
        }

        if (state.view === 'reading') renderFeed();
    } finally {
        state._bmBusy.delete(id);
    }
};

/* ---------- Auth ---------- */
async function initAuth() {
    const closeModals = () => { $('#authModal')?.classList.add('hidden'); if ($('#authStatus')) $('#authStatus').textContent = ''; returnFocus(); };
    let lastFocused = null;

    const open = () => {
        lastFocused = document.activeElement;
        $('#authModal')?.classList.remove('hidden');
        if (!$('#signupView')?.classList.contains('hidden')) $('#signupUsername')?.focus();
        else if (!$('#forgotView')?.classList.contains('hidden')) $('#forgotUsername')?.focus();
        else if (!$('#recoveryView')?.classList.contains('hidden')) $('#recoveryPassword')?.focus();
        else $('#loginUsername')?.focus();
    };
    window.openAuthModal = open;
    const returnFocus = () => { if (lastFocused) lastFocused.focus(); };

    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#authModal')?.classList.contains('hidden')) closeModals(); });

    // Init password toggle ARIA state on load
    document.querySelectorAll('.pwd-toggle').forEach(t => {
        t.setAttribute('aria-pressed', 'false');
        t.setAttribute('aria-label', 'Show password');
    });
    // Single delegated password toggle
    $('#authModal')?.addEventListener('click', e => {
        const t = e.target.closest('.pwd-toggle');
        if (!t) return;
        const input = document.getElementById(t.dataset.pwd);
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        t.setAttribute('aria-pressed', String(show));
        t.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    });

    const authBtn = $('#authBtn');
    if (authBtn) authBtn.onclick = () => {
        if (state.user && sb) { sb.auth.signOut(); return; }
        open();
    };
    const on = (sel, ev, fn) => { const el = $(sel); if (el) el[ev] = fn; };

    on('#authClose', 'onclick', closeModals);
    on('#authClose2', 'onclick', closeModals);
    on('#authModal', 'onclick', (e) => { if (e.target.id === 'authModal') closeModals(); });

    on('#tabLogin', 'onclick', () => switchTab('login'));
    on('#tabSignup', 'onclick', () => switchTab('signup'));
    on('#btnForgot', 'onclick', () => switchTab('forgot'));
    on('#btnBackToLogin', 'onclick', () => switchTab('login'));

    function switchTab(which) {
        ['loginView', 'signupView', 'forgotView', 'recoveryView'].forEach(id => {
            const el = $('#' + id); if (el) el.classList.add('hidden');
        });
        const toggle = (id, visible) => { const el = $('#' + id); if (el) el.classList.toggle('hidden', !visible); };
        toggle('loginView', which === 'login');
        toggle('signupView', which === 'signup');
        toggle('forgotView', which === 'forgot');
        toggle('recoveryView', which === 'recovery');

        const tabL = $('#tabLogin'), tabS = $('#tabSignup');
        if (tabL) tabL.classList.toggle('active', which === 'login');
        if (tabS) tabS.classList.toggle('active', which === 'signup');

        const stat = $('#authStatus'); if (stat) stat.textContent = '';
    }

    if (!sb) {
        const authSpan = $('#authBtn')?.querySelector('span');
        if (authSpan) authSpan.textContent = 'Local only';
        const localOnly = () => { if ($('#authStatus')) { $('#authStatus').style.color = '#f59e0b'; $('#authStatus').textContent = 'Cloud accounts are not configured.'; } };
        ['loginForm', 'signupForm', 'forgotForm', 'recoveryForm'].forEach(id => {
            const f = $('#' + id); if (f) f.onsubmit = e => { e.preventDefault(); localOnly(); };
        });
        return;
    }

    if ($('#loginForm')) $('#loginForm').onsubmit = async e => {
        e.preventDefault();
        const email = $('#loginUsername').value.trim();
        const pass = $('#loginPassword').value;
        $('#authStatus').style.color = '#ef4444';
        if (!/.+@.+\..+/.test(email) || !pass) { $('#authStatus').textContent = 'Enter a valid email and password.'; return; }

        try {
            const { error } = await sb.auth.signInWithPassword({ email, password: pass });
            if (error) { $('#authStatus').textContent = error.message; return; }
            closeModals();
        } catch {
            $('#authStatus').textContent = 'Network error. Please try again.';
        }
    };

    if ($('#signupForm')) $('#signupForm').onsubmit = async e => {
        e.preventDefault();
        const email = $('#signupUsername').value.trim();
        const pass = $('#signupPassword').value;
        $('#authStatus').style.color = '#ef4444';
        if (!/.+@.+\..+/.test(email)) { $('#authStatus').textContent = 'Enter a valid email.'; return; }
        if (pass.length < 8) { $('#authStatus').textContent = 'Password must be at least 8 characters.'; return; }

        try {
            const { data, error } = await sb.auth.signUp({ email, password: pass, options: { emailRedirectTo: location.origin + buildPath('/today') } });
            if (error) { $('#authStatus').textContent = error.message; return; }
            $('#authStatus').style.color = '#10b981';
            $('#authStatus').textContent = data.session ? 'Account created. You are signed in.' : 'Check your email to confirm your account.';
            if (data.session) closeModals();
        } catch {
            $('#authStatus').textContent = 'Network error. Please try again.';
        }
    };

    if ($('#forgotForm')) $('#forgotForm').onsubmit = async e => {
        e.preventDefault();
        const email = $('#forgotUsername').value.trim();
        if (!/.+@.+\..+/.test(email)) { $('#authStatus').textContent = 'Enter a valid email.'; return; }

        try {
            const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + buildPath('/today') });
            $('#authStatus').style.color = error ? '#ef4444' : '#10b981';
            $('#authStatus').textContent = error ? error.message : 'Reset link sent. Check your inbox.';
        } catch {
            $('#authStatus').style.color = '#ef4444';
            $('#authStatus').textContent = 'Network error. Please try again.';
        }
    };

    if ($('#recoveryForm')) $('#recoveryForm').onsubmit = async e => {
        e.preventDefault();
        const pass = $('#recoveryPassword').value;
        if (pass.length < 8) { $('#authStatus').textContent = 'Min 8 characters.'; return; }

        try {
            const { error } = await sb.auth.updateUser({ password: pass });
            $('#authStatus').style.color = error ? '#ef4444' : '#10b981';
            $('#authStatus').textContent = error ? error.message : 'Password updated. Please sign in.';
            if (!error) setTimeout(() => { switchTab('login'); }, 1200);
        } catch {
            $('#authStatus').style.color = '#ef4444';
            $('#authStatus').textContent = 'Network error. Please try again.';
        }
    };

    sb.auth.onAuthStateChange((event, session) => {
        if (event === 'PASSWORD_RECOVERY') {
            switchTab('recovery');
            open();
        } else if (['SIGNED_IN', 'SIGNED_OUT', 'INITIAL_SESSION'].includes(event)) {
            setUser(session?.user ?? null).catch(console.error);
        }
    });

    try {
        const { data: { session } } = await sb.auth.getSession();
        setUser(session?.user ?? null).catch(console.error);
    } catch (e) {
        console.warn('Failed to get initial session:', e);
    }
}

let lastUserId = null;
async function setUser(u) {
    const changed = (u?.id ?? null) !== lastUserId;
    const signingOut = !u && lastUserId !== null;
    state.user = u;

    const authSpan = $('#authBtn')?.querySelector('span');
    if (authSpan) authSpan.textContent = u ? 'Sign out' : 'Sign in';

    if (!changed && !signingOut) return;

    let syncedOk = true;
    try {
        if (u) {
            syncedOk = await syncFromCloud();
        } else {
            loadLocalBookmarks();
        }
    } catch (e) {
        syncedOk = false;
        console.error('Sync failed:', e);
        toast('Could not sync bookmarks — will retry on next change.');
    }

    if (syncedOk) lastUserId = u?.id ?? null;
    renderFeed();
}


/* ---------- Manual Refresh ---------- */
window.doRefresh = async function () {
    const success = await loadNews();
    if (success) toast('News data reloaded from server.');
    else toast('Failed to reload news data.');
    return success;
};

function initRefresh() {
    const btn = $('#refreshBtn');
    if (btn) btn.onclick = window.doRefresh;
}

/* ---------- Chatbot (Local Data Search) ---------- */
function initChat() {
    const panel = $('#chatPanel'), msgs = $('#chatMessages');
    if (!panel || !msgs) return;
    if ($('#chatToggle')) $('#chatToggle').onclick = () => panel.classList.toggle('hidden');
    if ($('#chatClose')) $('#chatClose').onclick = () => panel.classList.add('hidden');

    let isChatPending = false;
    if ($('#chatForm')) $('#chatForm').onsubmit = async e => {
        e.preventDefault();
        if (isChatPending) return;
        const input = $('#chatInput');
        const text = input.value.trim();
        if (!text) return;

        isChatPending = true;
        input.value = '';
        addMsg('user', text);

        const sysMsg = addMsg('sys', 'Searching local data...');
        const submitBtn = $('#chatForm button[type="submit"]');
        if (submitBtn) submitBtn.disabled = true;

        // Simulate short delay for UX
        setTimeout(() => {
            try {
                const answer = searchLocalData(text);
                if (sysMsg) sysMsg.remove();
                addMsg('ai', answer);
            } catch (err) {
                console.error(err);
                if (sysMsg) sysMsg.remove();
                addMsg('ai', 'Sorry, something went wrong.');
            } finally {
                isChatPending = false;
                if (submitBtn) submitBtn.disabled = false;
            }
        }, 500);
    };

    function addMsg(role, text) {
        const div = document.createElement('div');
        div.className = `msg ${role}`;

        if (role === 'user') {
            div.textContent = text; // Prevent XSS
        } else {
            // Since searchLocalData returns raw text with \n, we format it safely
            const safeText = esc(text)
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                .replace(/\*(.*?)\*/g, '<em>$1</em>');
            div.innerHTML = safeText.replace(/\n/g, '<br>');
        }

        msgs.appendChild(div);
        msgs.scrollTop = msgs.scrollHeight;
        return div;
    }
}

function searchLocalData(query) {
    const q = query.toLowerCase();

    // 1. Answer App Feature Questions
    if (/^\s*(help|what can i do|what is this app|how (to|can) (i|you))\s*[?.!]?\s*$/i.test(q.trim())) {
        return "Welcome to **AI Pulse**, your free daily source for AI engineering news! Here is what you can do:\n\n" +
            "• **Today's Overview**: See the freshest AI engineering news from the last 24 hours.\n" +
            "• **Weekly Overview**: View everything collected in the last 7 days.\n" +
            "• **Briefing / Research / Tools**: Click the sidebar to filter news by category.\n" +
            "• **Trends**: See a chart of the most active categories.\n" +
            "• **Reading List**: Click '☆ Save' on any card to save it permanently. Saved articles never expire!\n\n" +
            "Ask me about a specific topic (e.g., 'OpenAI', 'RAG', 'Agents', 'GPU') to search today's news!";
    }

    // 2. Search for News Articles & Bookmarks
    const allArticles = [...(state.articles || []), ...state.bookmarks.values()];
    const uniqueArticles = Array.from(new Map(allArticles.map(a => [a.id, a])).values());

    if (!uniqueArticles || uniqueArticles.length === 0) {
        return "I don't have any news data loaded right now. Please wait for the daily sync or click the refresh button.";
    }

    // Remove stop words from query
    const stopWords = ['what', 'when', 'where', 'who', 'why', 'how', 'the', 'and', 'for', 'are', 'you', 'can', 'tell', 'me', 'about', 'news', 'latest', 'today'];
    const words = q.split(/[\s,;.!?]+/).filter(w => w.length > 2 && !stopWords.includes(w));

    if (words.length === 0) {
        return "I'm not sure what you're looking for. Try asking about 'OpenAI', 'agents', or 'what can I do here?'.";
    }

    const scored = uniqueArticles.map(a => {
        const ins = a.insights || {};
        const text = `${a.title} ${a.summary} ${ins.engineerSummary || ''} ${ins.founderSummary || ''} ${a.category} ${a.source}`.toLowerCase();
        const hits = words.filter(w => text.includes(w)).length;
        return { article: a, hits };
    }).filter(r => r.hits > 0);

    const strictHits = scored.filter(r => r.hits === words.length);
    const matches = (strictHits.length ? strictHits : scored)
        .sort((a, b) => b.hits - a.hits)
        .map(r => r.article);

    if (matches.length === 0) {
        return "I couldn't find any recent news matching those keywords in today's data.";
    }

    // Format response using pure text and \n (the addMsg function will render it safely)
    let response = `I found ${matches.length} articles matching your query:\n\n`;

    matches.slice(0, 4).forEach(m => { // limit to top 4
        const ins = m.insights || {};
        const sum = String(ins.engineerSummary || ins.founderSummary || m.summary || 'No summary available.');
        const safeTitle = String(m.title || '').replace(/[*_`~]/g, '');
        const safeCat = String(m.category || 'General AI').replace(/[*_`~]/g, '');
        const safeSource = String(m.source || 'Unknown').replace(/[*_`~]/g, '');
        const slicedSum = sum.length > 150 ? sum.slice(0, 150).replace(/\s+\S*$/, '') + '…' : sum;
        const safeSum = slicedSum.replace(/[*_`~]/g, '');

        response += `• **${safeTitle}**\n`;
        response += `*${safeCat} | ${safeSource}*\n`;
        response += `${safeSum}\n\n`;
    });

    if (matches.length > 4) {
        response += `*...and ${matches.length - 4} more. Use the search bar to see all results.*`;
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
        if ($('#policyTitle')) $('#policyTitle').textContent = type === 'privacy' ? 'Privacy Policy' : 'Terms of Service';
        if ($('#policyContent')) $('#policyContent').innerHTML = policies[type];
        if ($('#policyModal')) $('#policyModal').classList.remove('hidden');
    };

    const privacyLink = $('#privacyLink');
    const termsLink = $('#termsLink');
    if (privacyLink) privacyLink.onclick = (e) => { e.preventDefault(); showPolicy('privacy'); };
    if (termsLink) termsLink.onclick = (e) => { e.preventDefault(); showPolicy('terms'); };
    if ($('#policyClose')) $('#policyClose').onclick = () => $('#policyModal')?.classList.add('hidden');

    // Close policy modal when clicking on the dark empty space (backdrop)
    if ($('#policyModal')) $('#policyModal').onclick = (e) => {
        if (e.target.id === 'policyModal') {
            $('#policyModal').classList.add('hidden');
        }
    };
}

/* ---------- Boot ---------- */
async function boot() {
    const inits = [initTheme, initNav, initRefresh, initChat, initPolicies];
    for (const init of inits) {
        try { init(); } catch (e) { console.error(`${init.name} failed`, e); }
    }

    loadLocalBookmarks();
    await loadNews();

    // Initialize route based on URL (render before waiting for auth)
    const initialView = getRouteFromPath();
    const urlParams = new URLSearchParams(window.location.search);
    const articleId = urlParams.get('id');
    navigateTo(initialView, false, articleId);

    // Handle browser back/forward buttons
    window.addEventListener('popstate', () => {
        const view = getRouteFromPath();
        const urlParams = new URLSearchParams(window.location.search);
        const articleId = urlParams.get('id');

        // Restore filters from history state
        if (history.state) {
            if ($('#searchInput')) $('#searchInput').value = history.state.search || '';
            if ($('#categoryFilter')) $('#categoryFilter').value = history.state.category || '';
            if ($('#dateFilter')) $('#dateFilter').value = history.state.date || '';
        }

        navigateTo(view, false, articleId);
    });

    setInterval(() => { try { checkStaleness(); } catch (e) { console.warn(e); } }, 60 * 60 * 1000);

    // Merged search input listeners (clear button + debounce)
    const searchInput = $('#searchInput');
    const clearBtn = $('#clearSearchBtn');
    let searchTimer;

    if (searchInput && clearBtn) {
        searchInput.addEventListener('input', () => {
            clearBtn.classList.toggle('hidden', !searchInput.value);
            clearTimeout(searchTimer);
            searchTimer = setTimeout(renderFeed, 150);
        });
    }
    if ($('#categoryFilter')) $('#categoryFilter').onchange = renderFeed;
    if ($('#dateFilter')) $('#dateFilter').onchange = renderFeed;

    // Keyboard Navigation for Cards
    document.getElementById('newsFeed')?.addEventListener('keydown', (e) => {
        if (e.target.closest('.btn, a, button, .card-actions')) return;
        const card = e.target.closest('.card');
        if (!card) return;
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            navigateToArticle(card.dataset.id, e);
        }
    });

    // Search Clear Button logic
    if (clearBtn && searchInput) {
        clearBtn.addEventListener('click', () => {
            searchInput.value = '';
            clearBtn.classList.add('hidden');
            renderFeed();
        });
    }

    await initAuth();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => boot().catch(err => console.error('Boot failed:', err)));
} else {
    boot().catch(err => console.error('Boot failed:', err));
}