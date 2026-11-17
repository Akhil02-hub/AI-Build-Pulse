import fs from 'node:fs/promises';
import path from 'node:path';
import Parser from 'rss-parser';
import OpenAI from 'openai';

const DATA_DIR = path.join(process.cwd(), 'data');
const NEWS_FILE = path.join(DATA_DIR, 'news.json');
const ARCHIVE_DIR = path.join(DATA_DIR, 'archive');
const SOURCES_FILE = path.join(DATA_DIR, 'sources.json');

const FRESH_WINDOW_MS = 24 * 3600 * 1000;   // collect last 24h
const RETENTION_MS = 7 * 24 * 3600 * 1000; // keep 7 days
const MAX_ARTICLES = 30;                 // per run (fresh items)
const MAX_AI_SUMMARIES = 15;
const AI_DELAY_MS = 1500;
const FETCH_TIMEOUT_MS = 15000;

const fetchWithTimeout = async (url, options = {}, timeout = FETCH_TIMEOUT_MS) => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(id);
    }
};

const timeoutPromise = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms));

const KEYWORDS = {
    'LLM Engineering': ['llm', 'gpt', 'gpt-4', 'gpt-4o', 'transformer', 'tokenization', 'language model', 'claude', 'gemini', 'llama'],
    'RAG': ['rag', 'retrieval', 'embedding', 'vector database', 'vector search', 'semantic search'],
    'AI Agents': ['agent', 'agentic', 'mcp', 'tool calling', 'orchestration', 'autonomous', 'multi-agent'],
    'Model Training': ['fine-tun', 'lora', 'rlhf', 'training', 'pre-train', 'distillation'],
    'Inference': ['inference', 'vllm', 'quantization', 'serving', 'throughput', 'latency', 'optimization'],
    'AI Infrastructure': ['gpu', 'cuda', 'distributed', 'cluster', 'h100', 'a100', 'tpu', 'infrastructure'],
    'MLOps': ['deployment', 'monitoring', 'pipeline', 'evaluation', 'observability', 'mlops'],
    'Multimodal AI': ['multimodal', 'vision', 'speech', 'audio', 'video', 'image generation'],
    'AI Security': ['prompt injection', 'guardrail', 'safety', 'jailbreak', 'alignment', 'red team'],
    'AI Frameworks': ['pytorch', 'tensorflow', 'langchain', 'llamaindex', 'jax', 'transformers'],
    'Research': ['arxiv', 'paper', 'research', 'study', 'benchmark', 'sota', 'novel', 'propose', 'empirical'],
};

// Enable custom fields so we can get the full article content
const parser = new Parser({
    customFields: {
        item: [
            ['content:encoded', 'contentEncoded'],
            ['media:content', 'mediaContent', { keepArray: true }],
            ['media:thumbnail', 'mediaThumbnail']
        ]
    }
});

// Clean HTML and preserve paragraph breaks
const clean = (h = '') => h
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
const norm = t => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

import crypto from 'node:crypto';

/* Stable id — same URL always produces the same id across runs */
function hashId(url) {
    return 'a' + crypto.createHash('sha256').update(url).digest('hex').slice(0, 12);
}

function canon(url) {
    try {
        const u = new URL(url);
        ['utm_source', 'utm_medium', 'utm_campaign', 'ref', 'fbclid'].forEach(p => u.searchParams.delete(p));
        return u.toString();
    } catch { return url; }
}

/* ---------- Fetchers (unchanged behaviour) ---------- */
async function rss(s) {
    try {
        const f = await Promise.race([
            parser.parseURL(s.url),
            timeoutPromise(FETCH_TIMEOUT_MS)
        ]);
        return (f.items || []).slice(0, 15).map(i => {
            // Try to get the full HTML content first, then fallback to snippets
            const rawContent = i.contentEncoded || i.content || i.contentSnippet || '';

            let imageUrl = null;
            // 1. Check standard enclosure
            if (i.enclosure && i.enclosure.url) imageUrl = i.enclosure.url;
            // 2. Check Media RSS
            else if (i.mediaContent && i.mediaContent[0] && i.mediaContent[0].$) imageUrl = i.mediaContent[0].$.url;
            else if (i.mediaThumbnail && i.mediaThumbnail.$) imageUrl = i.mediaThumbnail.$.url;
            // 3. Extract <img> from the raw content (handles both single and double quotes)
            else if (rawContent) {
                const match = rawContent.match(/<img[^>]+src=["']([^"']+)["']/i);
                if (match) imageUrl = match[1];
            }

            // Resolve protocol-relative and relative URLs against the article link
            if (imageUrl) {
                try { imageUrl = new URL(imageUrl, i.link || s.url).toString(); }
                catch { imageUrl = null; }
            }

            return {
                title: i.title || '',
                summary: clean(rawContent), // Now stores the full clean text
                url: canon(i.link || ''),
                publishedAt: i.isoDate || i.pubDate || new Date().toISOString(),
                source: s.name, category: s.category, trusted: s.trusted, image: imageUrl,
                audience: s.audience
            };
        });
    } catch (e) { console.warn(`RSS ${s.name}: ${e.message}`); return []; }
}
async function hn(s) {
    try {
        const r = await fetchWithTimeout(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(s.query)}&tags=story&numericFilters=points>${s.minPoints || 50}&hitsPerPage=15`);
        const d = await r.json();
        return (d.hits || []).map(h => ({
            title: h.title || '', summary: `${h.points} points · ${h.num_comments || 0} comments`,
            url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
            publishedAt: h.created_at || new Date().toISOString(),
            source: s.name, category: 'General AI', trusted: false,
            audience: s.audience
        }));
    } catch (e) { console.warn(`HN: ${e.message}`); return []; }
}
async function devto(s) {
    try {
        const r = await fetchWithTimeout(`https://dev.to/api/articles?tag=${encodeURIComponent(s.tag)}&per_page=${s.perPage || 15}`);
        const d = await r.json();
        return d.map(a => ({
            title: a.title || '', summary: clean(a.description || ''),
            url: canon(a.url || ''), publishedAt: a.published_at || new Date().toISOString(),
            source: s.name, category: 'AI Frameworks', trusted: false,
            audience: s.audience
        }));
    } catch (e) { console.warn(`Dev.to: ${e.message}`); return []; }
}
async function gnews(s) {
    try {
        const f = await Promise.race([
            parser.parseURL(`https://news.google.com/rss/search?q=${encodeURIComponent(s.query)}&hl=en-IN&gl=IN&ceid=IN:en`),
            timeoutPromise(FETCH_TIMEOUT_MS)
        ]);
        return (f.items || []).slice(0, 10).map(i => ({
            title: i.title || '', summary: clean(i.contentSnippet || i.content || ''),
            url: canon(i.link || ''), publishedAt: i.isoDate || i.pubDate || new Date().toISOString(),
            source: s.name, category: 'General AI', trusted: false,
            audience: s.audience
        }));
    } catch (e) { console.warn(`GNews ${s.name}: ${e.message}`); return []; }
}

async function fetchAll(sources) {
    const out = [];
    for (const s of sources) {
        let items = [];
        if (s.type === 'rss') items = await rss(s);
        else if (s.type === 'hn') items = await hn(s);
        else if (s.type === 'devto') items = await devto(s);
        else if (s.type === 'gnews') items = await gnews(s);
        out.push(...items);
        await new Promise(r => setTimeout(r, 300));
    }
    return out;
}

/* --- REAL GITHUB TRENDING FETCHER --- */
async function fetchGitHubTrending() {
    try {
        // Fetch top AI repos created in the last 14 days
        const d = new Date();
        d.setDate(d.getDate() - 14);
        const dateStr = d.toISOString().split('T')[0];
        const headers = { 'User-Agent': 'AI-Engineer-Pulse' };
        if (process.env.GH_TOKEN) headers.Authorization = `Bearer ${process.env.GH_TOKEN}`;

        const r = await fetchWithTimeout(`https://api.github.com/search/repositories?q=topic:artificial-intelligence+stars:>500&sort=stars&order=desc&per_page=6`, { headers });
        const data = await r.json();
        return (data.items || []).map(repo => ({
            name: repo.full_name,
            description: repo.description || 'No description provided.',
            stars: repo.stargazers_count,
            forks: repo.forks_count,
            language: repo.language || 'Unknown',
            url: repo.html_url
        }));
    } catch (e) {
        console.warn(`GitHub Trending: ${e.message}`);
        return [];
    }
}

/* --- REAL JOB RADAR FETCHER --- */
async function fetchJobs() {
    try {
        // Fetch remote AI/ML jobs from a public API
        const r = await fetchWithTimeout(`https://remoteok.com/api`, {
            headers: { 'User-Agent': 'AI-Engineer-Pulse', 'Accept': 'application/json' }
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        // Filter for AI/ML/Tech jobs using word boundaries
        const jobs = (Array.isArray(data) ? data : []).filter(j => {
            if (!j.position) return false;
            const pos = j.position.toLowerCase();
            return /\b(ai|ml|llm|machine learning|deep learning|data scien|mlops|artificial intelligence)\b/.test(pos);
        }).slice(0, 5);

        return jobs.map(job => ({
            title: job.position,
            company: job.company,
            location: job.location || 'Remote',
            salary: job.salary_min && job.salary_max ? `${Math.round(job.salary_min / 1000)}k - ${Math.round(job.salary_max / 1000)}k` : 'Competitive',
            url: job.url
        }));
    } catch (e) {
        console.warn(`Jobs: ${e.message}`);
        return [];
    }
}

/* ---------- Scoring & categorisation ---------- */
const escapeRx = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Word-boundary matcher. Keywords ending in a letter are treated as word stems
// (fine-tun → fine-tuning, pre-train → pre-training); everything else gets
// strict `\b` on both sides.
const wordMatch = (text, kw) => {
    const escaped = escapeRx(kw);
    // Allow explicit common suffixes, enforce boundaries on both sides
    return new RegExp(`\\b${escaped}(?:s|es|ed|ing|er|ers|ion|ions)?\\b`, 'i').test(text);
};

function detectCat(text, fallback) {
    let best = { cat: fallback || 'General AI', hits: 0 };
    for (const [cat, kws] of Object.entries(KEYWORDS)) {
        const h = kws.filter(k => wordMatch(text, k)).length;
        if (h > best.hits) best = { cat, hits: h };
    }
    return best.cat;
}
function score(a) {
    let s = 0;
    const t = a.title || '', d = a.summary || '';
    for (const kws of Object.values(KEYWORDS)) {
        for (const k of kws) {
            if (wordMatch(t, k)) s += 5;
            if (wordMatch(d, k)) s += 2;
        }
    }
    if (a.trusted) s += 2;
    if (a.category && a.category !== 'General AI') s += 2;
    return s;
}
const WHY = {
    'LLM Engineering': 'Directly affects how LLM-powered products are built and shipped.',
    'RAG': 'Relevant to retrieval-augmented generation accuracy and latency.',
    'AI Agents': 'Impacts agent orchestration, tool use, and reliability.',
    'Model Training': 'Influences training cost, quality, and adaptation strategy.',
    'Inference': 'Affects serving cost, throughput, and latency.',
    'AI Infrastructure': 'Impacts hardware, scaling, and deployment decisions.',
    'MLOps': 'Relevant to deployment, monitoring, and evaluation workflows.',
    'Multimodal AI': 'Expands what AI systems can perceive and generate.',
    'AI Security': 'Critical for safe, production-grade AI systems.',
    'AI Frameworks': 'Affects tooling choices and developer productivity.',
    'Research': 'New research that may shape upcoming engineering practices.',
    'General AI': 'Broadly relevant context for AI engineering decisions.',
};

/* ---------- Custom Fallback Summarizer ---------- */
function fallbackSummarizer(text) {
    if (!text) return "No details available.";
    // Remove trailing "..." from the RSS feed
    let cleanText = text.replace(/\.\.\.$/, '').trim();
    const sentences = cleanText.match(/[^.!?]+[.!?]+/g) || [cleanText];
    if (sentences.length <= 3) return cleanText; // If it's already short, return it

    // Simple word-frequency scoring to find the most important sentences
    const stopWords = new Set(['the', 'and', 'a', 'to', 'of', 'in', 'i', 'is', 'that', 'it', 'on', 'you', 'this', 'for', 'but', 'with', 'are', 'have', 'be', 'at', 'or', 'as', 'was', 'so', 'if', 'out', 'not']);
    const words = cleanText.toLowerCase().match(/\b\w+\b/g) || [];
    const freq = {};
    words.forEach(w => { if (!stopWords.has(w) && w.length > 2) freq[w] = (freq[w] || 0) + 1; });

    const scored = sentences.map(s => {
        const sWords = s.toLowerCase().match(/\b\w+\b/g) || [];
        let score = 0;
        sWords.forEach(w => { if (freq[w]) score += freq[w]; });
        return { sentence: s.trim(), score: score / (sWords.length || 1) };
    });

    // Sort by score and pick the top 4 sentences
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 4).map(s => s.sentence).join(' ');
}

/* ---------- AI summaries (GitHub Models) ---------- */
async function aiSummary(client, a) {
    const safeSummary = (a.summary || '').replace(/\.\.\.$/, '').slice(0, 1500);
    try {
        const r = await client.chat.completions.create({
            model: 'gpt-4o-mini',
            response_format: { type: "json_object" },
            messages: [{
                role: 'system', content: 'You are an expert tech analyst. Output ONLY valid JSON.'
            }, {
                role: 'user', content:
                    `Analyze this AI news for two personas: AI Engineer and Founder. Output a JSON object with these exact keys:
                    "engineerSummary" (3-4 sentences on tech impact),
                    "founderSummary" (3-4 sentences on business impact),
                    "whatHappened" (Write a highly detailed, comprehensive summary of the core news. It MUST be at least 100 words long. Do NOT cut it short),
                    "whatChanged" (1 short sentence),
                    "techDetails" (1 short sentence on models/tools),
                    "businessImpact" (1 short sentence on market),
                    "learn" (1 short sentence on what skills to learn),
                    "action" (1 short sentence on next steps).
                    
                    Title: ${a.title}
                    Source: ${a.source}
                    Excerpt: ${safeSummary}`
            }],
            max_tokens: 800, temperature: 0.3,
        });
        return JSON.parse(r.choices[0].message.content);
    } catch (err) {
        console.warn(`AI Error for "${a.title}":`, err.message);
        // Throw on transient errors (network, rate limit, server down) so we don't permanently skip
        const TRANSIENT_CODES = new Set([
            'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED',
            'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'EPIPE'
        ]);
        if (
            (typeof err.status === 'number' && (err.status >= 500 || err.status === 408 || err.status === 429)) ||
            TRANSIENT_CODES.has(err.code) ||
            (err instanceof SyntaxError)
        ) {
            throw err;
        }
        return null; // Permanent failure (e.g., content policy, bad JSON)
    }
}
async function enrich(list) {
    const token = process.env.GH_TOKEN;
    if (!token) return list.map(a => ({ ...a, insights: null, insightsAttempted: false }));
    const client = new OpenAI({ baseURL: 'https://models.github.ai/inference', apiKey: token });
    const map = new Map();
    for (const a of list) {
        try {
            const res = await aiSummary(client, a);
            map.set(a.id, res);
            console.log(res === null
                ? `AI ⊘ ${a.title.slice(0, 50)} (permanent failure — skipped)`
                : `AI ✓ ${a.title.slice(0, 50)}`);
        } catch (e) {
            console.warn(`AI ✗ ${a.title.slice(0, 40)}: ${e.message} (will retry next run)`);
        }
        await new Promise(r => setTimeout(r, AI_DELAY_MS));
    }
    return list.map(a => {
        const wasAttempted = map.has(a.id);
        let finalInsights = wasAttempted ? (map.get(a.id) ?? a.insights ?? null) : (a.insights ?? null);

        // FALLBACK BOT: If AI failed or returned null, use our custom summarizer
        if (!finalInsights) {
            const localSum = fallbackSummarizer(a.summary);
            finalInsights = {
                whatHappened: localSum,
                engineerSummary: localSum,
                founderSummary: localSum
            };
        }

        return {
            ...a,
            insights: finalInsights,
            insightsAttempted: a.insightsAttempted || wasAttempted
        };
    });
}

/* ---------- Archive cleanup ---------- */
async function pruneArchive(now) {
    const cutoff = now.getTime() - RETENTION_MS;
    let files = [];
    try { files = await fs.readdir(ARCHIVE_DIR); } catch { return; }
    for (const f of files) {
        const m = f.match(/^(\d{4}-\d{2}-\d{2})\.json$/);
        if (!m) continue;                                   // keep daily-news.json etc.
        const fileDate = new Date(m[1] + 'T00:00:00Z').getTime();
        if (fileDate < cutoff) {
            await fs.unlink(path.join(ARCHIVE_DIR, f));
            console.log(`🗑  deleted archive ${f}`);
        }
    }
}

/* ---------- MAIN ---------- */
async function main() {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.mkdir(ARCHIVE_DIR, { recursive: true });

    const now = new Date();
    const freshCutoff = now.getTime() - FRESH_WINDOW_MS;
    const retainCutoff = now.getTime() - RETENTION_MS;

    /* 1. Load existing articles (up to 7 days) */
    let existing = [];
    let existingObj = {};
    try {
        existingObj = JSON.parse(await fs.readFile(NEWS_FILE, 'utf8'));
        existing = Array.isArray(existingObj.articles) ? existingObj.articles : [];
    } catch { /* first run */ }
    console.log(`Loaded existing: ${existing.length}`);

    /* 2. Fetch sources */
    const { sources } = JSON.parse(await fs.readFile(SOURCES_FILE, 'utf8'));
    console.log(`Fetching ${sources.length} sources…`);
    const raw = await fetchAll(sources);

    /* 3. Keep only last 24h from fresh fetch */
    const freshRaw = raw.filter(a => {
        const t = new Date(a.publishedAt).getTime();
        return t >= freshCutoff;
    });
    console.log(`Fresh (last 24h): ${freshRaw.length}`);

    /* 4. Score + categorise fresh items, dedupe by URL + normalized title */
    // Pre-populate sets with existing articles to prevent duplicates across runs
    const seenUrl = new Set(existing.map(a => a.url ? canon(a.url) : ''));
    const seenTitle = new Set(existing.map(a => a.title ? norm(a.title) : ''));
    let freshScored = [];
    for (const a of freshRaw) {
        if (!a.url || !a.title) continue;
        const u = canon(a.url), t = norm(a.title);
        if (seenUrl.has(u) || seenTitle.has(t)) continue;
        seenUrl.add(u); seenTitle.add(t);

        const category = detectCat(`${a.title} ${a.summary}`, a.category);
        const enriched = { ...a, category };
        const rel = score(enriched);
        if (rel < 1) continue;

        freshScored.push({
            ...enriched,
            id: hashId(u),
            relevanceScore: rel,
            whyItMatters: WHY[category] || WHY['General AI'],
            addedAt: now.toISOString(),
        });
    }

    freshScored = freshScored.sort((a, b) => b.relevanceScore - a.relevanceScore).slice(0, MAX_ARTICLES);

    /* 5. Merge with existing, existing wins for already-summarised items */
    const byId = new Map();
    for (const a of existing) byId.set(a.id, a);       // older
    let newCount = 0;
    for (const a of freshScored) {
        if (!byId.has(a.id)) newCount++;
        const prev = byId.get(a.id);
        byId.set(a.id, { ...(prev || {}), ...a, addedAt: prev?.addedAt ?? a.addedAt }); // new data overrides stale fields, but keeps original addedAt
    }

    /* 6. PRUNE anything older than 7 days */
    const nowMs = now.getTime();
    const kept = [];
    let pruned = 0;
    for (const a of byId.values()) {
        const pub = new Date(a.publishedAt).getTime();
        if (pub >= retainCutoff && pub <= nowMs + 24 * 3600 * 1000) kept.push(a);
        else pruned++;
    }
    console.log(`Merged: ${kept.length} kept · ${newCount} new · ${pruned} pruned (>7d)`);

    /* 7. AI-summarise NEW items only (top by score) — skip entirely if no token */
    const hasAiToken = !!process.env.GH_TOKEN;

    const newItems = hasAiToken
        ? kept
            .filter(a => !a.insights && !a.insightsAttempted)
            .sort((x, y) => y.relevanceScore - x.relevanceScore)
            .slice(0, MAX_AI_SUMMARIES)
        : [];
    const summarised = await enrich(newItems);
    const summarisedMap = new Map(summarised.map(a => [a.id, a]));
    const finalArticles = kept.map(a => summarisedMap.get(a.id) || a);

    /* 8. Sort, cap total to keep JSON small */
    finalArticles.sort((a, b) =>
        b.relevanceScore - a.relevanceScore ||
        new Date(b.publishedAt) - new Date(a.publishedAt)
    );
    // Hard cap 7-day retention (keeps payload small for the SPA)
    if (finalArticles.length > 150) finalArticles.length = 150;

    const ist = new Date(now.getTime() + 5.5 * 3600 * 1000);

    // Fetch the new features
    console.log('Fetching GitHub Trending...');
    const githubTrending = await fetchGitHubTrending();
    console.log('Fetching Jobs...');
    const jobs = await fetchJobs();

    const payload = {
        generatedAt: ist.toISOString().replace('Z', '+05:30'),
        retentionDays: 7,
        totalStories: finalArticles.length,
        newToday: finalArticles.filter(a => new Date(a.addedAt || a.publishedAt).getTime() >= freshCutoff).length,
        articles: finalArticles,
        githubTrending: githubTrending.length ? githubTrending : (existingObj.githubTrending || []),
        jobs: jobs.length ? jobs : (existingObj.jobs || [])
    };

    /* 9. Write news.json + today's archive (atomic to prevent corruption) */
    const tempNewsFile = NEWS_FILE + '.tmp';
    await fs.writeFile(tempNewsFile, JSON.stringify(payload, null, 2));
    await fs.rename(tempNewsFile, NEWS_FILE);

    const tempArchiveFile = path.join(ARCHIVE_DIR, `${now.toISOString().slice(0, 10)}.json.tmp`);
    await fs.writeFile(tempArchiveFile, JSON.stringify(payload, null, 2));
    await fs.rename(tempArchiveFile, path.join(ARCHIVE_DIR, `${now.toISOString().slice(0, 10)}.json`));

    /* 10. Delete archive files older than 7 days */
    await pruneArchive(now);

    console.log(`✓ Wrote ${finalArticles.length} articles (${newCount} new this run)`);
}

main().catch(e => { console.error(e); process.exit(1); });