const { GoogleGenerativeAI } = require("@google/generative-ai");
const fetch = require('node-fetch');

// --- API ve Model Kurulumu ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });

// --- Gerçek İnternet Araması Yapan Fonksiyon ---
async function performGoogleSearch(query) {
    const API_KEY = process.env.GOOGLE_API_KEY;
    const SEARCH_ENGINE_ID = process.env.SEARCH_ENGINE_ID;
    const url = `https://www.googleapis.com/customsearch/v1?key=${API_KEY}&cx=${SEARCH_ENGINE_ID}&q=${encodeURIComponent(query)}&gl=tr&hl=tr`;

    try {
        console.log(`[SEARCH] Google araması yapılıyor: ${query}`);
        const response = await fetch(url);
        if (!response.ok) {
            return `"${query}" için arama yapılırken bir sunucu hatası oluştu.`;
        }
        const data = await response.json();

        if (data.items && data.items.length > 0) {
            return data.items.slice(0, 4).map(item => `Başlık: ${item.title}\nÖzet: ${item.snippet}`).join('\n\n---\n\n');
        } else {
            return `"${query}" için internette anlamlı bir sonuç bulunamadı.`;
        }
    } catch (error) {
        return "İnternet araması sırasında teknik bir sorunla karşılaşıldı.";
    }
}

// --- Ana Netlify Fonksiyonu ---
exports.handler = async function(event, context) {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const { prompt: userPrompt } = JSON.parse(event.body);
        if (!userPrompt) {
            return { statusCode: 400, body: 'Prompt is required.' };
        }

        const userQuestionMatch = userPrompt.match(/Kullanıcı Sorusu: "([^"]+)"/);
        const userQuestion = userQuestionMatch ? userQuestionMatch[1] : userPrompt;
        const lowerCaseQuestion = userQuestion.toLowerCase();
        
        let searchResultsContext = "";
        const searchKeywords = ["kimdir", "nedir", "ne zaman", "nerede", "nasıl", "hangi", "yazarlar", "haberler", "başlıkları", "araştır", "bilgi ver"];

        // Eğer kullanıcı sorusu anahtar kelimelerden birini içeriyorsa arama yap
        if (searchKeywords.some(keyword => lowerCaseQuestion.includes(keyword))) {
            searchResultsContext = await performGoogleSearch(userQuestion);
        }

        // Gemini için son talimatı oluştur
        const finalPrompt = `
            Senin adın Löwentech AI Asistant. Profesyonel bir asistansın.
            Kullanıcının sorusu şu: "${userQuestion}".
            Eğer aşağıda bir arama sonucu varsa, cevabını bu sonuca dayandırarak oluştur. Eğer yoksa veya alakasızsa, genel bilgilerinle cevap ver.
            --- ARAMA SONUÇLARI ---
            ${searchResultsContext}
            --- ARAMA SONUCLARI SONU ---
        `;

        // Gemini'ye sadece TEK BİR istek gönder
        const result = await model.generateContent(finalPrompt);
        const response = result.response;
        const text = response.text();

        return {
            statusCode: 200,
            body: JSON.stringify({ text: text })
        };

    } catch (error) {
        console.error('Ana Handler Hatası:', error);
        return { statusCode: 500, body: JSON.stringify({ error: 'Gemini ile konuşurken bir hata oluştu.' }) };
    }
};
