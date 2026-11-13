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

const KEYWORDS = {
    'LLM Engineering': ['llm', 'gpt', 'transformer', 'tokenization', 'language model', 'claude', 'gemini', 'llama'],
    'RAG': ['rag', 'retrieval', 'embedding', 'vector database', 'vector search', 'semantic search'],
    'AI Agents': ['agent', 'mcp', 'tool calling', 'orchestration', 'autonomous', 'multi-agent'],
    'Model Training': ['fine-tun', 'lora', 'rlhf', 'training', 'pre-train', 'distillation'],
    'Inference': ['inference', 'vllm', 'quantization', 'serving', 'throughput', 'latency', 'optimization'],
    'AI Infrastructure': ['gpu', 'cuda', 'distributed', 'cluster', 'h100', 'a100', 'tpu', 'infrastructure'],
    'MLOps': ['deployment', 'monitoring', 'pipeline', 'evaluation', 'observability', 'mlops'],
    'Multimodal AI': ['multimodal', 'vision', 'speech', 'audio', 'video', 'image generation'],
    'AI Security': ['prompt injection', 'guardrail', 'safety', 'jailbreak', 'alignment', 'red team'],
    'AI Frameworks': ['pytorch', 'tensorflow', 'langchain', 'llamaindex', 'jax', 'transformers'],
};

const parser = new Parser();
const clean = (h = '') => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const norm = t => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/* Stable id — same URL always produces the same id across runs */
function hashId(url) {
    let h = 0;
    for (let i = 0; i < url.length; i++) h = (Math.imul(31, h) + url.charCodeAt(i)) | 0;
    return 'a' + Math.abs(h).toString(36);
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
        const f = await parser.parseURL(s.url);
        return (f.items || []).slice(0, 15).map(i => ({
            title: i.title || '', summary: clean(i.contentSnippet || i.content || ''),
            url: canon(i.link || ''), publishedAt: i.isoDate || i.pubDate || new Date().toISOString(),
            source: s.name, category: s.category, trusted: s.trusted,
        }));
    } catch (e) { console.warn(`RSS ${s.name}: ${e.message}`); return []; }
}
async function hn(s) {
    try {
        const r = await fetch(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(s.query)}&tags=story&numericFilters=points>${s.minPoints || 50}&hitsPerPage=15`);
        const d = await r.json();
        return (d.hits || []).map(h => ({
            title: h.title || '', summary: `${h.points} points · ${h.num_comments || 0} comments`,
            url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
            publishedAt: h.created_at || new Date().toISOString(),
            source: s.name, category: 'General AI', trusted: false,
        }));
    } catch (e) { console.warn(`HN: ${e.message}`); return []; }
}
async function devto(s) {
    try {
        const r = await fetch(`https://dev.to/api/articles?tag=${encodeURIComponent(s.tag)}&per_page=${s.perPage || 15}`);
        const d = await r.json();
        return d.map(a => ({
            title: a.title || '', summary: clean(a.description || ''),
            url: canon(a.url || ''), publishedAt: a.published_at || new Date().toISOString(),
            source: s.name, category: 'AI Frameworks', trusted: false,
        }));
    } catch (e) { console.warn(`Dev.to: ${e.message}`); return []; }
}
async function gnews(s) {
    try {
        const f = await parser.parseURL(`https://news.google.com/rss/search?q=${encodeURIComponent(s.query)}&hl=en-US&gl=US&ceid=US:en`);
        return (f.items || []).slice(0, 10).map(i => ({
            title: i.title || '', summary: clean(i.contentSnippet || i.content || ''),
            url: canon(i.link || ''), publishedAt: i.isoDate || i.pubDate || new Date().toISOString(),
            source: s.name, category: 'General AI', trusted: false,
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

/* ---------- Scoring & categorisation ---------- */
function detectCat(text, fallback) {
    const lower = text.toLowerCase();
    let best = { cat: fallback || 'General AI', hits: 0 };
    for (const [cat, kws] of Object.entries(KEYWORDS)) {
        const h = kws.filter(k => lower.includes(k)).length;
        if (h > best.hits) best = { cat, hits: h };
    }
    return best.cat;
}
function score(a) {
    let s = 0;
    const t = (a.title || '').toLowerCase(), d = (a.summary || '').toLowerCase();
    for (const kws of Object.values(KEYWORDS)) {
        for (const k of kws) {
            if (t.includes(k)) s += 5;
            if (d.includes(k)) s += 2;
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

/* ---------- AI summaries (GitHub Models) ---------- */
async function aiSummary(client, a) {
    const r = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{
            role: 'user', content:
                `You are an AI engineering editor. In 2 concise sentences, explain what this news means for AI engineers (practical impact, no marketing).\n\nTitle: ${a.title}\nSource: ${a.source}\nCategory: ${a.category}\nExcerpt: ${a.summary.slice(0, 800)}`
        }],
        max_tokens: 120, temperature: 0.3,
    });
    return r.choices[0].message.content.trim();
}
async function enrich(list) {
    const token = process.env.GITHUB_TOKEN;
    if (!token) return list.map(a => ({ ...a, aiSummary: null }));
    const client = new OpenAI({ baseURL: 'https://models.github.ai/inference', apiKey: token });
    const map = new Map();
    for (const a of list) {
        try { map.set(a.id, await aiSummary(client, a)); console.log(`AI ✓ ${a.title.slice(0, 50)}`); }
        catch (e) { console.warn(`AI ✗ ${a.title.slice(0, 40)}: ${e.message}`); }
        await new Promise(r => setTimeout(r, AI_DELAY_MS));
    }
    return list.map(a => ({ ...a, aiSummary: map.get(a.id) ?? a.aiSummary ?? null }));
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
    try {
        const old = JSON.parse(await fs.readFile(NEWS_FILE, 'utf8'));
        existing = old.articles || [];
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
    const seenUrl = new Set(), seenTitle = new Set();
    const freshScored = [];
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
            aiSummary: null,
            addedAt: now.toISOString(),
        });
    }

    /* 5. Merge with existing, existing wins for already-summarised items */
    const byId = new Map();
    for (const a of existing) byId.set(a.id, a);       // older
    let newCount = 0;
    for (const a of freshScored) {
        if (!byId.has(a.id)) newCount++;
        byId.set(a.id, { ...(byId.get(a.id) || {}), ...a }); // new data overrides stale fields
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

    /* 7. AI-summarise NEW items only (top by score) */
    const newItems = kept.filter(a => !a.aiSummary).sort((x, y) => y.relevanceScore - x.relevanceScore).slice(0, MAX_AI_SUMMARIES);
    const summarised = await enrich(newItems);
    const summaryById = new Map(summarised.map(a => [a.id, a.aiSummary]));
    const finalArticles = kept.map(a => ({ ...a, aiSummary: a.aiSummary ?? summaryById.get(a.id) ?? null }));

    /* 8. Sort, cap total to keep JSON small */
    finalArticles.sort((a, b) =>
        b.relevanceScore - a.relevanceScore ||
        new Date(b.publishedAt) - new Date(a.publishedAt)
    );

    const ist = new Date(now.getTime() + 5.5 * 3600 * 1000);
    const payload = {
        generatedAt: ist.toISOString().replace('Z', '+05:30'),
        retentionDays: 7,
        totalStories: finalArticles.length,
        newToday: finalArticles.filter(a => new Date(a.addedAt || a.publishedAt).getTime() >= freshCutoff).length,
        articles: finalArticles,
    };

    /* 9. Write news.json + today's archive */
    await fs.writeFile(NEWS_FILE, JSON.stringify(payload, null, 2));
    await fs.writeFile(
        path.join(ARCHIVE_DIR, `${now.toISOString().slice(0, 10)}.json`),
        JSON.stringify(payload, null, 2)
    );
    await fs.writeFile(path.join(ARCHIVE_DIR, 'daily-news.json'), JSON.stringify(payload, null, 2));

    /* 10. Delete archive files older than 7 days */
    await pruneArchive(now);

    console.log(`✓ Wrote ${finalArticles.length} articles (${newCount} new today)`);
}

main().catch(e => { console.error(e); process.exit(1); });