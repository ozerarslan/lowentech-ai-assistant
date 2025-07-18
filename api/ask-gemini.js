console.log("--- BU YENİ KOD VERSİYONU ÇALIŞIYOR ---"); // Test mesajı

const { VertexAI } = require('@google-cloud/vertexai');

// Google Arama fonksiyonu (değişiklik yok)
async function performGoogleSearch(query) {
    const API_KEY = process.env.Google_Search_API_KEY;
    const SEARCH_ENGINE_ID = process.env.SEARCH_ENGINE_ID;
    if (!API_KEY || !SEARCH_ENGINE_ID) {
        throw new Error('Google Search API anahtarları eksik.');
    }
    const url = `https://www.googleapis.com/customsearch/v1?key=${API_KEY}&cx=${SEARCH_ENGINE_ID}&q=${encodeURIComponent(query)}&hl=tr-TR`;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Google Search API hatası (${response.status}).`);
    }
    const data = await response.json();
    if (data.items && data.items.length > 0) {
        return data.items.slice(0, 5).map(item => `- ${item.title}: ${item.snippet}`).join('\n');
    }
    return null;
}

// Ana Vercel Fonksiyonu
module.exports = async (req, res) => {
    // CORS ve method kontrolleri
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    try {
        const { prompt } = req.body;
        if (!prompt) return res.status(400).json({ error: 'Prompt is required.' });

        // --- YENİ HATA AYIKLAMA BLOĞU ---
        const credentialsJSON = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
        if (!credentialsJSON || credentialsJSON.length < 50) { // Check if it exists and has a reasonable length
            console.error("HATA: GOOGLE_APPLICATION_CREDENTIALS_JSON ortam değişkeni bulunamadı veya çok kısa. Lütfen Vercel ayarlarını kontrol edin.");
            throw new Error("Sunucu yapılandırma hatası: Kimlik bilgileri ortam değişkeni eksik veya hatalı.");
        }

        // Güvenlik için anahtarın sadece başını, sonunu ve uzunluğunu loglayalım.
        console.log(`Kimlik bilgisi metni alındı. Uzunluk: ${credentialsJSON.length}, Başlangıcı: '${credentialsJSON.substring(0, 30)}...', Bitişi: '...${credentialsJSON.substring(credentialsJSON.length - 30)}'`);

        let credentials;
        try {
            // JSON'ı ayrıştırmaya çalışalım
            credentials = JSON.parse(credentialsJSON);
        } catch (parseError) {
            // Eğer hata olursa, detaylı bir mesaj loglayalım
            console.error("JSON.parse() HATASI: Vercel'deki GOOGLE_APPLICATION_CREDENTIALS_JSON değişkeninin değeri geçerli bir JSON değil. Kopyalama hatası olabilir. Hata:", parseError.message);
            throw new Error("Kimlik bilgileri ayrıştırılamadı. Lütfen Vercel'deki değişkenin değerini dikkatlice kontrol edin.");
        }
        // --- HATA AYIKLAMA BLOĞU SONU ---

        const vertex_ai = new VertexAI({
            project: process.env.GCP_PROJECT_ID,
            location: process.env.GCP_LOCATION,
            credentials: credentials
        });
        
        const model = 'gemini-1.5-flash-001';
        const generativeModel = vertex_ai.getGenerativeModel({ model });
        
        const today = new Date();
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Europe/Istanbul' };
        const formattedDate = today.toLocaleDateString('tr-TR', options);
        let context = `SİSTEM BİLGİSİ:\n- Bugünün tarihi: ${formattedDate}.\n`;
        
        const promptLower = prompt.toLowerCase();
        const searchKeywords = ["kimdir", "nedir", "ne zaman", "nerede", "nasıl", "hangi", "araştır", "bilgi ver", "hava durumu"];

        if (searchKeywords.some(keyword => promptLower.includes(keyword))) {
            try {
                const searchResults = await performGoogleSearch(prompt);
                if (searchResults) {
                    context += `- Kullanıcının sorusuyla ilgili internet arama sonuçları:\n${searchResults}\n`;
                }
            } catch (searchError) {
                context += `- İnternet araması sırasında bir hata oluştu.\n`;
            }
        }
        
        const finalPrompt = {
            contents: [{
                role: 'user',
                parts: [{
                    text: `Sen bir sesli asistansın. Sana aşağıda sistem bilgileri ve kullanıcının sorusu verilecek. Bu bilgileri kullanarak, kullanıcıya tek ve akıcı bir cevap oluştur.
                    ${context}
                    KULLANICI SORUSU: "${prompt}"
                    Lütfen cevabını kısa, net ve doğal bir dille Türkçe olarak ver.`
                }]
            }]
        };

        const result = await generativeModel.generateContent(finalPrompt);
        
        if (!result.response.candidates || result.response.candidates.length === 0 || !result.response.candidates[0].content.parts[0].text) {
             throw new Error('Vertex AI\'dan geçerli bir yanıt alınamadı.');
        }
        
        const text = result.response.candidates[0].content.parts[0].text;
        
        res.status(200).json({ text });

    } catch (error) {
        console.error('API Fonksiyonunda Kök Hata:', error);
        res.status(500).json({ error: `Sunucuda bir hata oluştu: ${error.message}` });
    }
};