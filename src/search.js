/**
 * Web Search Engine untuk NoaH
 * Menggunakan Wikipedia API + DuckDuckGo HTML fallback + Google News RSS
 */

async function searchWeb(query) {
    if (!query) return 'Kata kunci pencarian kosong.';

    const results = [];

    // 1. Google News RSS (untuk berita & info terkini)
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
                results.push(`- [Berita/Info] ${title} (${date})`);
                count++;
            }
        }
    } catch (e) {}

    // 2. Wikipedia Indonesia API (untuk pengetahuan umum, definisi, tokoh, fakta)
    try {
        const wikiUrl = `https://id.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&utf8=&format=json&srlimit=3`;
        const res = await fetch(wikiUrl, {
            headers: { 'User-Agent': 'NoaH-Assistant/1.0' },
            signal: AbortSignal.timeout(5000)
        });
        const data = await res.json();
        if (data.query && data.query.search) {
            for (const item of data.query.search) {
                const snippet = item.snippet.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').trim();
                results.push(`- [Ensiklopedia] ${item.title}: ${snippet}`);
            }
        }
    } catch (e) {}

    // 3. DuckDuckGo Instant Answer API
    try {
        const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
        const res = await fetch(ddgUrl, { signal: AbortSignal.timeout(4000) });
        const ddgData = await res.json();
        if (ddgData.AbstractText) {
            results.push(`- [Ringkasan]: ${ddgData.AbstractText}`);
        }
    } catch (e) {}

    if (results.length === 0) {
        return `Tidak ditemukan informasi langsung dari pencarian web untuk "${query}".`;
    }

    return results.join('\n\n');
}

module.exports = {
    searchWeb
};
