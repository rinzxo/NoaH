/**
 * Web Search Engine untuk NoaH
 * 1. Google Search API resmi (Serper.dev / Tavily) untuk googling bebas tanpa blokir
 * 2. Fallback Google News RSS + Wikipedia Indonesia
 * 3. Knowledge Base Resmi Laksmana Ibrahim Rino & Rinz Group Inovasi
 */

const config = require('./config');

const OWNER_KNOWLEDGE = `
[DATA PROFIL RESMI LAKSMANA IBRAHIM RINO & RINZ GROUP INOVASI]
- Nama Lengkap: Laksmana Ibrahim Rino (biasa disapa Pak/Mas Laksmana atau Rino)
- Jabatan/Peran: Founder & Chief Executive Officer (CEO) dari Rinz Group Inovasi
- Entitas: Rinz Group Inovasi (Inisiatif & Startup Teknologi Digital Indonesia)
- Ekosistem & Lini Produk:
  1. KitaPay (kitapay.rinzgroup.web.id): Platform pembayaran digital QRIS instan dan payment gateway untuk UMKM & merchant digital.
  2. KitaAtur (kitaatur.rinzgroup.web.id): Aplikasi PWA manajemen kas, absensi, dan sistem operasional digital organisasi.
  3. DesainKita / KitaCom: Jasa desain grafis, branding visual, dan solusi komunikasi digital.
  4. NoaH Assistant: Asisten pribadi pintar berbasis AI WhatsApp untuk automasi pengingat, penerima tamu, dan manajemen pesan darurat.
- Website & Domain Utama: rinzgroup.web.id
`;

async function searchGoogleViaSerper(query, apiKey) {
    try {
        const res = await fetch('https://google.serper.dev/search', {
            method: 'POST',
            headers: {
                'X-API-KEY': apiKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ q: query, gl: 'id', hl: 'id' }),
            signal: AbortSignal.timeout(8000)
        });
        if (!res.ok) return null;
        const data = await res.json();
        const results = [];
        if (data.knowledgeGraph) {
            results.push(`[Google Knowledge Panel] ${data.knowledgeGraph.title || ''}: ${data.knowledgeGraph.description || ''}`);
        }
        if (data.organic && data.organic.length > 0) {
            for (const item of data.organic.slice(0, 5)) {
                results.push(`- [Google] ${item.title}: ${item.snippet} (${item.link})`);
            }
        }
        return results.length > 0 ? results.join('\n\n') : null;
    } catch (e) {
        console.error('[Serper Error]:', e.message);
        return null;
    }
}

async function searchViaTavily(query, apiKey) {
    try {
        const res = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_key: apiKey, query, search_depth: 'basic' }),
            signal: AbortSignal.timeout(8000)
        });
        if (!res.ok) return null;
        const data = await res.json();
        if (data.results && data.results.length > 0) {
            return data.results.slice(0, 5).map(r => `- [Web] ${r.title}: ${r.content} (${r.url})`).join('\n\n');
        }
        return null;
    } catch (e) {
        console.error('[Tavily Error]:', e.message);
        return null;
    }
}

async function searchWeb(query) {
    if (!query) return 'Kata kunci pencarian kosong.';
    const qLower = query.toLowerCase();

    // 1. Cek Knowledge Base Internal Owner (Laksmana & Rinz Group)
    if (
        qLower.includes('laksmana') ||
        qLower.includes('rino') ||
        qLower.includes('rinz') ||
        qLower.includes('kitapay') ||
        qLower.includes('kitaatur') ||
        qLower.includes('desainkita') ||
        qLower.includes('saya') ||
        qLower.includes('founder')
    ) {
        return OWNER_KNOWLEDGE.trim();
    }

    // 2. Google Search Asli via Serper.dev jika diisi
    if (config.serperApiKey) {
        const serperRes = await searchGoogleViaSerper(query, config.serperApiKey);
        if (serperRes) return serperRes;
    }

    // 3. Web Search via Tavily jika diisi
    if (config.tavilyApiKey) {
        const tavilyRes = await searchViaTavily(query, config.tavilyApiKey);
        if (tavilyRes) return tavilyRes;
    }

    // 4. Fallback: Google News RSS + Wikipedia Indonesia
    const fallbackResults = [];

    try {
        const newsUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=id&gl=ID&ceid=ID:id`;
        const res = await fetch(newsUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            signal: AbortSignal.timeout(5000)
        });
        const xml = await res.text();
        const itemRegex = /<item>[\s\S]*?<title>(.*?)<\/title>[\s\S]*?<link>(.*?)<\/link>[\s\S]*?<pubDate>(.*?)<\/pubDate>/gi;
        let match;
        let count = 0;
        while ((match = itemRegex.exec(xml)) !== null && count < 3) {
            const title = match[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').trim();
            const date = match[3] ? match[3].trim() : '';
            if (title) {
                fallbackResults.push(`- [Berita] ${title} (${date})`);
                count++;
            }
        }
    } catch (e) {}

    try {
        const wikiUrl = `https://id.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&utf8=&format=json&srlimit=3`;
        const res = await fetch(wikiUrl, {
            headers: { 'User-Agent': 'NoaH-Assistant/1.0' },
            signal: AbortSignal.timeout(5000)
        });
        const data = await res.json();
        if (data.query && data.query.search && data.query.search.length > 0) {
            for (const item of data.query.search) {
                const snippet = item.snippet.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').trim();
                fallbackResults.push(`- [Ensiklopedia] ${item.title}: ${snippet}`);
            }
        }
    } catch (e) {}

    if (fallbackResults.length === 0) {
        return `Pencarian web untuk "${query}" tidak menemukan artikel publik di ensiklopedia/berita saat ini. Untuk pencarian Google menyeluruh, pasang SERPER_API_KEY di konfigurasi.`;
    }

    return fallbackResults.join('\n\n');
}

module.exports = {
    searchWeb,
    OWNER_KNOWLEDGE
};
