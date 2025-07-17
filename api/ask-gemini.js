const { GoogleGenerativeAI } = require('@google/generative-ai');

async function performGoogleSearch(query) {
    const API_KEY = process.env.Google Search_API_KEY;
    const SEARCH_ENGINE_ID = process.env.SEARCH_ENGINE_ID;

    if (!API_KEY || !SEARCH_ENGINE_ID) {
        console.error('Google Search API key or Search Engine ID is missing.');
        throw new Error('Sunucu yapılandırma hatası: Arama anahtarı/motor ID eksik.');
    }

    const url = `https://www.googleapis.com/customsearch/v1?key=${API_KEY}&cx=${SEARCH_ENGINE_ID}&q=${encodeURIComponent(query)}&hl=tr-TR`;

    try {
        const response = await fetch(url);
        if (!response.ok) {
            const errorText = await response.text();
            console.error('Google Arama Hatası:', response.status, errorText);
            throw new Error(`İç arama sırasında bir hata oluştu (${response.status}).`);
        }
        const data = await response.json();
        if (data.items && data.items.length > 0) {
            return data.items.slice(0, 5).map(item => `- ${item.title}: ${item.snippet}`).join('\n');
        }
        return null;
    } catch (error) {
        console.error('performGoogleSearch içinde hata:', error);
        throw new Error(`İç arama isteği gönderilirken hata oluştu: ${error.message}`);
    }
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    try {
        const { prompt } = req.body;
        if (!prompt) return res.status(400).json({ error: 'Prompt is required.' });

        const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
        if (!GEMINI_API_KEY) {
            console.error('GEMINI_API_KEY missing.');
            return res.status(500).json({ error: 'Server configuration error: Gemini API key missing.' });
        }

        // --- BİLGİ TOPLAMA AŞAMASI ---

        // 1. Tarih Bilgisi (Her zaman mevcut)
        const today = new Date();
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Europe/Istanbul' };
        const formattedDate = today.toLocaleDateString('tr-TR', options);
        let context = `SİSTEM BİLGİSİ:\n- Bugünün tarihi: ${formattedDate}.\n`;

        // 2. Hava Durumu Bilgisi (Eğer istenirse)
        const promptLower = prompt.toLowerCase();
        if (promptLower.includes('hava')) {
            console.log("Hava durumu tespiti yapılıyor...");
            // Basit bir yöntemle şehir adını çıkarmaya çalışalım
            const words = prompt.split(' ');
            const cityIndex = words.findIndex(word => word.toLowerCase().includes('hava')) - 1;
            const city = cityIndex >= 0 ? words[cityIndex] : 'sorulan yerdeki';
            
            try {
                const weatherQuery = `${city} hava durumu`;
                console.log(`İnternet araması yapılıyor: "${weatherQuery}"`);
                const weatherResults = await performGoogleSearch(weatherQuery);
                if (weatherResults) {
                    context += `- ${city} için bulunan hava durumu bilgileri şunlardır:\n${weatherResults}\n`;
                } else {
                    context += `- ${city} için hava durumu bilgisi internette bulunamadı.\n`;
                }
            } catch (searchError) {
                console.error("Hava durumu aramasında hata:", searchError);
                context += `- Hava durumu bilgisi alınırken bir hata oluştu.\n`;
            }
        }
        
        // 3. Genel İnternet Araması (Eğer gerekirse ve hava durumu değilse)
        const searchKeywords = ["kimdir", "nedir", "ne zaman", "nerede", "nasıl", "hangi", "araştır", "bilgi ver"];
        if (!promptLower.includes('hava') && searchKeywords.some(keyword => promptLower.includes(keyword))) {
             console.log(`Genel internet araması yapılıyor: "${prompt}"`);
             try {
                const searchResults = await performGoogleSearch(prompt);
                if(searchResults) {
                    context += `- Genel internet arama sonuçları:\n${searchResults}\n`;
                }
             } catch(searchError) {
                 console.error("Genel arama hatası:", searchError);
                 context += `- Genel internet araması sırasında hata oluştu.\n`;
             }
        }

        // --- YANIT OLUŞTURMA AŞAMASI ---

        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });

        const finalPrompt = `Sen bir sesli asistansın. Sana aşağıda sistem bilgileri ve kullanıcının sorusu verilecek. Bu bilgileri kullanarak, kullanıcıya tek ve akıcı bir cevap oluştur.
        
${context}
KULLANICI SORUSU: "${prompt}"

Lütfen cevabını kısa, net ve doğal bir dille Türkçe olarak ver.`;

        console.log("Nihai Prompt Gemini'ye Gönderiliyor:\n", finalPrompt);

        const result = await model.generateContent(finalPrompt);
        const response = await result.response;
        const text = response.text();
        
        res.status(200).json({ text: text });

    } catch (error) {
        console.error('API Fonksiyonunda Kök Hata:', error);
        res.status(500).json({ error: `Sunucuda bir hata oluştu: ${error.message}` });
    }
};