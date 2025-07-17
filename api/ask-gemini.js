const { GoogleGenerativeAI } = require('@google/generative-ai');

// Google Custom Search API için
async function performGoogleSearch(query) {
    const API_KEY = process.env.Google_Search_API_KEY;
    const SEARCH_ENGINE_ID = process.env.SEARCH_ENGINE_ID;

    if (!API_KEY || !SEARCH_ENGINE_ID) {
        console.error('Google Search API key or Search Engine ID is missing in environment variables.');
        throw new Error('Sunucu yapılandırma hatası: Arama anahtarı veya motor ID eksik.');
    }

    const url = `https://www.googleapis.com/customsearch/v1?key=${API_KEY}&cx=${SEARCH_ENGINE_ID}&q=${encodeURIComponent(query)}&hl=tr-TR`;

    try {
        const response = await fetch(url);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Google Arama Hatası oluştu! Durum:', response.status, 'Yanıt:', errorText);
            let errorMessage = `İç arama sırasında bir hata oluştu (${response.status}).`;
            try {
                const errorData = JSON.parse(errorText);
                errorMessage = errorData.error?.message || errorData.message || errorMessage;
            } catch (jsonError) {
                errorMessage = `İç arama sırasında bir hata oluştu (${response.status}): ${errorText.substring(0, 150)}${errorText.length > 150 ? '...' : ''}`;
            }
            throw new Error(errorMessage);
        }

        const data = await response.json();
        
        if (data.items && data.items.length > 0) {
            return data.items.slice(0, 4).map(item => ({
                title: item.title,
                link: item.link,
                snippet: item.snippet
            }));
        } else {
            return [];
        }
    } catch (error) {
        console.error('performGoogleSearch içinde hata:', error);
        throw new Error(`İç arama isteği gönderilirken hata oluştu: ${error.message}`);
    }
}

// Yankı ve gereksiz istekleri filtrele
function isValidUserInput(prompt) {
    const trimmed = prompt.trim().toLowerCase();
    
    // Çok kısa metinleri filtrele
    if (trimmed.length < 3) {
        return false;
    }
    
    // Yaygın yankı ifadelerini filtrele
    const echoPatterns = [
        'uh', 'um', 'hmm', 'ah', 'eh', 'oh',
        'ses', 'mikrofon', 'test', 'deneme',
        'bir', 'iki', 'üç', 'dört', 'beş'
    ];
    
    // Sadece bu kelimelerden biriyse filtrele
    if (echoPatterns.includes(trimmed)) {
        return false;
    }
    
    // Tekrarlayan karakterleri filtrele (aaaaaa gibi)
    if (/^(.)\1{4,}$/.test(trimmed)) {
        return false;
    }
    
    return true;
}

module.exports = async (req, res) => {
    // CORS headers ekle
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    // OPTIONS isteği için
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Sadece POST isteklerini kabul et
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { prompt } = req.body;
        if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required.' });
        }

        // Yankı ve anlamsız girdi kontrolü
        if (!isValidUserInput(prompt)) {
            // Frontend'in anlayacağı şekilde, kullanıcıya gösterilecek bir mesajla hata döndür
            return res.status(400).json({ 
                error: 'Invalid input detected', 
                text: 'Anlaşılmadı, lütfen daha net bir şekilde tekrar eder misiniz?' 
            });
        }

        const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
        if (!GEMINI_API_KEY) {
            console.error('GEMINI_API_KEY missing in environment variables.');
            return res.status(500).json({ error: 'Server configuration error: Gemini API key missing.' });
        }

        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });

        const userQuestionLower = prompt.toLowerCase();
        const searchKeywords = ["kimdir", "nedir", "ne zaman", "nerede", "nasıl", "hangi", "araştır", "bilgi ver", "son durum", "baksana", "araştırır mısın", "hava durumu"];

        let searchResultContext = "";

        if (searchKeywords.some(keyword => userQuestionLower.includes(keyword))) {
            console.log("İnternet araması yapılıyor...");
            try {
                const searchResults = await performGoogleSearch(prompt);
                if (searchResults && searchResults.length > 0) {
                    searchResultContext = "İnternet aramasından alınan güncel bilgiler şunlardır:\n" + 
                        searchResults.map(r => `- ${r.title}: ${r.snippet}`).join('\n') + "\n\nBu bilgileri kullanarak cevap ver.\n\n";
                } else {
                    searchResultContext = "İnternette bu konuyla ilgili arama yapıldı ancak doğrudan bir sonuç bulunamadı. Genel bilgilerinle cevap ver.\n\n";
                }
            } catch (searchError) {
                console.error("Arama fonksiyonunda hata:", searchError);
                searchResultContext = "İnternet araması sırasında bir hata oluştu. Bu yüzden arama yapmadan cevap ver.\n\n";
            }
        }

        const finalPrompt = `${searchResultContext}Kullanıcı Sorusu: "${prompt}"

Lütfen yanıtınızı şu kurallara göre oluşturun:
- Kısa, net ve anlaşılır olun (bir sesli asistana uygun şekilde).
- Her zaman Türkçe cevap verin.
- Doğal ve akıcı bir konuşma tarzı kullanın.
- Çok teknik veya uzun detaylardan kaçının.`;

        console.log("Gemini'ye gönderilen prompt:", finalPrompt);

        const result = await model.generateContent(finalPrompt);
        const response = await result.response;
        const text = response.text();
        
        res.status(200).json({ text: text });

    } catch (error) {
        console.error('API Fonksiyon İşleme Hatası:', error);
        res.status(500).json({ error: `Gemini ile iletişim kurulurken bir hata oluştu: ${error.message || 'Bilinmeyen Hata'}` });
    }
};