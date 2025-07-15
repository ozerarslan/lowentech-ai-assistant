// const fetch = require('node-fetch'); // Bu satırı artık kaldırabiliriz (Node.js 18+ ve Vercel'de fetch yerleşik olarak gelir)
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
            const errorText = await response.text(); // Yanıtı metin olarak oku
            console.error('Google Arama Hatası oluştu! Durum:', response.status, 'Yanıt:', errorText);
            let errorMessage = `İç arama sırasında bir hata oluştu (${response.status}).`;
            try {
                const errorData = JSON.parse(errorText); // JSON olarak ayrıştırmayı dene
                errorMessage = errorData.error?.message || errorData.message || errorMessage;
            } catch (jsonError) {
                errorMessage = `İç arama sırasında bir hata oluştu (${response.status}): ${errorText.substring(0, 150)}${errorText.length > 150 ? '...' : ''}`;
            }
            throw new Error(errorMessage);
        }

        const data = await response.json();
        
        // Arama sonuçlarını daha derli toplu bir formatta döndür
        if (data.items && data.items.length > 0) {
            return data.items.slice(0, 4).map(item => ({
                title: item.title,
                link: item.link,
                snippet: item.snippet
            }));
        } else {
            return []; // Sonuç bulunamazsa boş dizi döndür
        }
    } catch (error) {
        console.error('performGoogleSearch içinde hata:', error);
        throw new Error(`İç arama isteği gönderilirken hata oluştu: ${error.message}`);
    }
}

module.exports = async (req, res) => {
    // Sadece POST isteklerini kabul et
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { prompt } = req.body;
        if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required.' });
        }

        const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
        if (!GEMINI_API_KEY) {
            console.error('GEMINI_API_KEY missing in environment variables.');
            return res.status(500).json({ error: 'Server configuration error: Gemini API key missing.' });
        }

        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });

        // Kullanıcı sorusunu ve arama ihtiyacını analiz et
        // Buradaki userQuestionMatch vb. fonksiyonların dışarıdan geldiğini varsayıyorum.
        // Eğer bu fonksiyonlar bu dosya içinde değilse, erişilebilir olmaları gerekir.
        // Fonksiyonların tanımlı olmadığını varsayarak şimdilik yorum satırı yapıldı,
        // veya ilgili mantığı buraya taşımanız gerekebilir.
        
        // const userQuestionMatch = userQuestionMatch(prompt); // Bu ve altındaki satırlar kodunuzda tanımlı değilse hata verir
        // const userQuestionLower = userQuestionLower(prompt);
        // const isSearchNeeded = userQuestionMatch(userQuestionLower);

        let searchResultContext = "";
        // Aşağıdaki arama mantığını etkinleştirmek için, userQuestionMatch ve ilgili fonksiyonların tanımlı olduğundan emin olun
        // const searchKeywords = ["kimdir", "nedir", "ne zaman", "nerede", "nasıl", "hangi", "yazarlar", "haberler", "başlıklar", "araştır", "bilgi ver", "son durum"];
        // if (searchKeywords.some(keyword => userQuestionLower.includes(keyword))) {
        //     const searchResults = await performGoogleSearch(prompt);
        //     if (searchResults.length > 0) {
        //         searchResultContext = "İnternet aramasından alınan bilgiler: " + searchResults.map(r => `${r.title}: ${r.snippet} (${r.link})`).join('\n') + "\n\n";
        //     } else {
        //         searchResultContext = "İnternette arama yapıldı ancak sonuç bulunamadı.";
        //     }
        // }

        // Arama mantığı aktifse `searchResultContext` ile birleştirilir.
        // Eğer arama mantığı devre dışı bırakılırsa, `finalPrompt` sadece `prompt` olacaktır.
        const finalPrompt = `Şunlara dikkat ederek cevap ver: ${prompt}`; // Geçici olarak direkt kullanıcı prompt'ını kullanıyorum

        // Eğer arama mantığını kullanacaksanız, searchResultContext'i finalPrompt'a ekleyin:
        // const finalPrompt = `${searchResultContext} Kullanıcı sorusu: "${prompt}"`;


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