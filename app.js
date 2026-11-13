/* ---------- State ---------- */
const CFG = window.APP_CONFIG || {};
const sb = (CFG.supabaseUrl && CFG.supabaseAnonKey && window.supabase)
    ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey) : null;

const state = {
    news: null,
    articles: [],
    user: null,
    bookmarks: new Map(),   // id -> full article snapshot (permanent)
    read: new Set(),
    chatHistory: [],
    range: '24h',           // '24h' or '7d'
};

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = iso => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/* ---------- Theme ---------- */
function initTheme() {
    const saved = localStorage.getItem('theme') || 'dark';
    document.documentElement.dataset.theme = saved;
    $('#themeBtn').textContent = saved === 'dark' ? '🌙' : '☀️';
    $('#themeBtn').onclick = () => {
        const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        document.documentElement.dataset.theme = t;
        localStorage.setItem('theme', t);
        $('#themeBtn').textContent = t === 'dark' ? '🌙' : '☀️';
    };
}

/* ---------- News ---------- */
async function loadNews() {
    try {
        const r = await fetch('./data/news.json', { cache: 'no-store' });
        if (!r.ok) throw new Error('news.json not found');
        state.news = await r.json();
        state.articles = state.news.articles || [];
        pruneStaleLocalBookmarks();
        renderAll();
        checkStaleness();
    } catch (e) {
        console.error(e);
        $('#briefingList').innerHTML = `<p class="excerpt">Could not load news yet. The workflow may not have run. ${esc(e.message)}</p>`;
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
    const STALE_HOURS = 14;   // data refreshes every midnight; >14h = run failed
    if (age > STALE_HOURS * 3600 * 1000) {
        banner.classList.remove('hidden');
        banner.innerHTML = `⚠️ Last update was ${Math.round(age / 3600000)}h ago. The scheduled workflow may be delayed — <a href="#" id="triggerNow">trigger it now</a> or use the Actions tab.`;
        const btn = $('#triggerNow');
        if (btn) btn.onclick = e => { e.preventDefault(); triggerWorkflow(); };
    } else {
        banner.classList.add('hidden');
    }
}

/* ---------- Rendering ---------- */
function scoreClass(s) { return s >= 8 ? 'high' : s >= 5 ? 'mid' : 'low'; }

function isInFeed(id) {
    return state.articles.some(a => a.id === id);
}

function cardHTML(a) {
    const saved = state.bookmarks.has(a.id);
    const archived = !isInFeed(a.id);
    return `
  <div class="card" data-id="${esc(a.id)}">
    <h3>${esc(a.title)}</h3>
    <div class="meta">
      <span>${esc(a.source)}</span>
      <span>${fmtDate(a.publishedAt)}</span>
      <span class="score ${scoreClass(a.relevanceScore || 0)}">Score ${a.relevanceScore || 0}</span>
    </div>
    <div class="tags">
      <span class="tag">${esc(a.category || 'General AI')}</span>
      ${archived ? '<span class="tag archived">📚 Saved · not in feed</span>' : ''}
    </div>
    ${a.aiSummary
            ? `<div class="ai-summary">${esc(a.aiSummary)}</div>`
            : `<div class="excerpt">${esc((a.summary || '').slice(0, 220))}${(a.summary || '').length > 220 ? '…' : ''}</div>`}
    <div class="why">Why it matters: ${esc(a.whyItMatters || '')}</div>
    <div class="row">
      <a href="${esc(a.url)}" target="_blank" rel="noopener">Read original →</a>
      <button class="save ${saved ? 'saved' : ''}" data-id="${esc(a.id)}">${saved ? '★ Saved' : '☆ Save'}</button>
    </div>
  </div>`;
}

function renderDashboard() {
    if (!state.news) return;
    $('#statUpdated').textContent = fmtDate(state.news.generatedAt);
    $('#statCount').textContent = state.articles.length;
    const cats = {};
    state.articles.forEach(a => { cats[a.category] = (cats[a.category] || 0) + 1; });
    const top = Object.entries(cats).sort((a, b) => b[1] - a[1])[0];
    $('#statTopCat').textContent = top ? top[0] : '—';
    $('#topStories').innerHTML = state.articles.slice(0, 6).map(cardHTML).join('');
}

function applyFilters(list) {
    const q = $('#searchInput').value.toLowerCase().trim();
    const cat = $('#categoryFilter').value;
    const cutoff = state.range === '24h'
        ? Date.now() - 24 * 3600 * 1000
        : Date.now() - 7 * 24 * 3600 * 1000;

    return list.filter(a => {
        if (cat && a.category !== cat) return false;
        if (new Date(a.publishedAt).getTime() < cutoff) return false;
        if (q && !`${a.title} ${a.summary} ${a.aiSummary || ''}`.toLowerCase().includes(q)) return false;
        return true;
    });
}

function initRangeTabs() {
    document.querySelectorAll('.range-btn').forEach(btn => {
        btn.onclick = () => {
            state.range = btn.dataset.range;
            document.querySelectorAll('.range-btn').forEach(b => b.classList.toggle('active', b === btn));
            renderBriefing();
        };
    });
}

function renderBriefing() {
    const list = applyFilters(state.articles);
    $('#briefingList').innerHTML = list.length
        ? list.map(cardHTML).join('')
        : '<p class="excerpt">No stories match your filters.</p>';
}

function renderCategoryDropdown() {
    const sel = $('#categoryFilter');
    const cats = [...new Set(state.articles.map(a => a.category))].sort();
    sel.innerHTML = '<option value="">All categories</option>' + cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
}

function renderResearch() {
    const list = state.articles.filter(a => a.category === 'Research');
    $('#researchList').innerHTML = list.length ? list.map(cardHTML).join('') : '<p class="excerpt">No research papers today.</p>';
}

function renderTools() {
    const list = state.articles.filter(a => ['AI Frameworks', 'Inference', 'AI Infrastructure'].includes(a.category));
    $('#toolsList').innerHTML = list.length ? list.map(cardHTML).join('') : '<p class="excerpt">No releases today.</p>';
}

function renderTrends() {
    const cats = {};
    state.articles.forEach(a => { cats[a.category] = (cats[a.category] || 0) + 1; });
    const sorted = Object.entries(cats).sort((a, b) => b[1] - a[1]);
    const max = sorted[0]?.[1] || 1;
    $('#trendsChart').innerHTML = sorted.map(([c, n]) =>
        `<div class="trend-row"><span>${esc(c)}</span><div class="trend-bar"><div style="width:${(n / max) * 100}%"></div></div><span>${n}</span></div>`
    ).join('') || '<p class="excerpt">No data yet.</p>';
}

function renderReadingList() {
    const saved = [...state.bookmarks.values()]
        .sort((a, b) => new Date(b.savedAt || b.publishedAt) - new Date(a.savedAt || a.publishedAt));
    $('#readingList').innerHTML = saved.length
        ? saved.map(cardHTML).join('')
        : '<p class="excerpt">No saved articles yet. Click ☆ Save on any card — saved articles are kept forever, even after they expire from the feed.</p>';
}

function renderAll() {
    renderDashboard();
    renderCategoryDropdown();
    renderBriefing();
    renderResearch();
    renderTools();
    renderTrends();
    renderReadingList();
    bindCardEvents();
}

function bindCardEvents() {
    document.querySelectorAll('.save').forEach(btn => {
        btn.onclick = () => toggleBookmark(btn.dataset.id);
    });
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
    const { data } = await sb.from('bookmarks').select('article_data').eq('user_id', state.user.id);
    for (const row of data || []) {
        const a = row.article_data;
        if (a && a.id) state.bookmarks.set(a.id, a);
    }
    saveLocalBookmarks();
}

async function toggleBookmark(id) {
    // Find article in live feed OR in saved library (so we can unsave archived items)
    const article = state.articles.find(a => a.id === id) || state.bookmarks.get(id);
    if (!article) return;

    if (state.bookmarks.has(id)) {
        state.bookmarks.delete(id);
        if (sb && state.user) {
            await sb.from('bookmarks').delete()
                .eq('user_id', state.user.id).eq('article_id', id);
        }
    } else {
        const snapshot = { ...article, savedAt: new Date().toISOString() };
        state.bookmarks.set(id, snapshot);
        if (sb && state.user) {
            await sb.from('bookmarks').upsert({
                user_id: state.user.id,
                article_id: id,
                article_data: snapshot,
            });
        }
    }
    saveLocalBookmarks();
    renderAll();
}

/* ---------- Auth ---------- */
async function initAuth() {
    if (!sb) {
        $('#authBtn').textContent = 'Local only';
        $('#authBtn').onclick = () => alert('Set Supabase URL + anon key in config.js to enable sync.');
        return;
    }
    const { data: { session } } = await sb.auth.getSession();
    if (session) setUser(session.user);
    sb.auth.onAuthStateChange((_e, s) => setUser(s?.user || null));

    $('#authBtn').onclick = () => {
        if (state.user) { sb.auth.signOut(); return; }
        $('#authModal').classList.remove('hidden');
    };
    $('#authClose').onclick = () => $('#authModal').classList.add('hidden');
    $('#authSend').onclick = async () => {
        const email = $('#authEmail').value.trim();
        if (!email) return;
        const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.href } });
        $('#authStatus').textContent = error ? error.message : 'Check your email for the magic link.';
    };
}

async function setUser(u) {
    state.user = u;
    $('#authBtn').textContent = u ? 'Sign out' : 'Sign in';
    if (u) await syncFromCloud();
    renderAll();
}

/* ---------- Settings ---------- */
function initSettings() {
    $('#settingsBtn').onclick = () => {
        $('#geminiKey').value = localStorage.getItem('gemini_key') || '';
        $('#ghPat').value = localStorage.getItem('gh_pat') || '';
        $('#settingsModal').classList.remove('hidden');
    };
    $('#settingsClose').onclick = () => $('#settingsModal').classList.add('hidden');
    $('#settingsSave').onclick = () => {
        localStorage.setItem('gemini_key', $('#geminiKey').value.trim());
        localStorage.setItem('gh_pat', $('#ghPat').value.trim());
        $('#settingsModal').classList.add('hidden');
    };
}

/* ---------- Manual refresh ---------- */
async function triggerWorkflow() {
    const pat = localStorage.getItem('gh_pat');
    if (!pat || !CFG.repoOwner) {
        alert('Add a GitHub PAT in Settings (needs actions:write) and set repoOwner in config.js.');
        return;
    }
    const r = await fetch(`https://api.github.com/repos/${CFG.repoOwner}/${CFG.repoName}/actions/workflows/${CFG.workflowFile}/dispatches`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${pat}`, 'Accept': 'application/vnd.github+json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: 'main' }),
    });
    alert(r.ok ? 'Workflow triggered. New data in ~2 minutes.' : `Failed (${r.status}). Check PAT permissions.`);
}
function initRefresh() { $('#refreshBtn').onclick = triggerWorkflow; }

/* ---------- Chatbot (Gemini + Google Search grounding) ---------- */
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

        const key = localStorage.getItem('gemini_key');
        if (!key) { addMsg('sys', 'Add your Gemini API key in ⚙ Settings to enable chat + web search.'); return; }

        addMsg('sys', 'Thinking…');
        try {
            const answer = await askGemini(key, text);
            msgs.querySelectorAll('.msg.sys').forEach(n => n.remove());
            addMsg('ai', answer);
        } catch (err) {
            msgs.querySelectorAll('.msg.sys').forEach(n => n.remove());
            addMsg('sys', `Error: ${err.message}`);
        }
    };

    function addMsg(role, text) {
        const div = document.createElement('div');
        div.className = `msg ${role}`;
        div.textContent = text;
        msgs.appendChild(div);
        msgs.scrollTop = msgs.scrollHeight;
    }
}

async function askGemini(key, question) {
    const top = state.articles.slice(0, 10).map(a =>
        `- [${a.category}] ${a.title} (${a.source}) — ${a.aiSummary || (a.summary || '').slice(0, 150)}`
    ).join('\n');

    const body = {
        contents: [{ parts: [{ text: question }] }],
        tools: [{ google_search: {} }],
        systemInstruction: {
            parts: [{ text: `You are an AI engineering analyst. Use the recent collected news below when helpful, and use Google Search for anything newer or broader. Be concise, practical, and cite sources when you search.\n\n=== Today's news context ===\n${top || '(none yet)'}` }]
        },
        generationConfig: { temperature: 0.4, maxOutputTokens: 800 },
    };

    const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(key)}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    );
    if (!r.ok) {
        const err = await r.text();
        throw new Error(`Gemini ${r.status}: ${err.slice(0, 200)}`);
    }
    const data = await r.json();
    const cand = data.candidates?.[0];
    const parts = cand?.content?.parts || [];
    const text = parts.map(p => p.text || '').join('').trim();
    const sources = cand?.groundingMetadata?.groundingChunks || [];
    const cites = sources.slice(0, 5).map((c, i) => c.web?.uri ? `\n[${i + 1}] ${c.web.uri}` : '').filter(Boolean).join('');
    return (text || 'No response.') + (cites ? `\n\nSources:${cites}` : '');
}

/* ---------- Boot ---------- */
async function boot() {
    initTheme();
    loadLocalBookmarks();
    initSettings();
    initRefresh();
    initChat();
    initRangeTabs();
    await initAuth();
    await loadNews();
    setInterval(checkStaleness, 60 * 60 * 1000);
    ['#searchInput', '#categoryFilter'].forEach(sel => {
        const el = $(sel);
        if (el) { el.oninput = el.onchange = renderBriefing; }
    });
}
boot();