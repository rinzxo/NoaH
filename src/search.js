/**
 * Web Search Engine untuk NoaH
 * Dilengkapi Knowledge Base Resmi Laksmana Ibrahim Rino & Rinz Group Inovasi
 * + Google News RSS & Wikipedia API untuk pencarian umum
 */

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

async function searchWeb(query) {
    if (!query) return 'Kata kunci pencarian kosong.';
    const qLower = query.toLowerCase();

    const results = [];

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
        results.push(OWNER_KNOWLEDGE.trim());
    }

    // 2. Google News RSS (untuk berita & kejadian terkini)
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
                results.push(`- [Berita] ${title} (${date})`);
                count++;
            }
        }
    } catch (e) {}

    // 3. Wikipedia Indonesia API (untuk pengetahuan umum, sains, definisi, tokoh nasional)
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
                results.push(`- [Ensiklopedia] ${item.title}: ${snippet}`);
            }
        }
    } catch (e) {}

    if (results.length === 0) {
        return `Hasil pencarian web untuk "${query}": Data publik spesifik belum terindeks di portal berita atau ensiklopedia saat ini.`;
    }

    return results.join('\n\n');
}

module.exports = {
    searchWeb,
    OWNER_KNOWLEDGE
};
