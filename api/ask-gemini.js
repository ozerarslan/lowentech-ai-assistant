const { GoogleGenerativeAI } = require("@google/generative-ai");
const fetch = require('node-fetch');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });

async function performGoogleSearch(query) {
    const API_KEY = process.env.GOOGLE_API_KEY;
    const SEARCH_ENGINE_ID = process.env.SEARCH_ENGINE_ID;
    const url = `https://www.googleapis.com/customsearch/v1?key=${API_KEY}&cx=${SEARCH_ENGINE_ID}&q=${encodeURIComponent(query)}&gl=tr&hl=tr`;
    try {
        const response = await fetch(url);
        if (!response.ok) { return `"${query}" için arama yapılırken bir sunucu hatası oluştu.`; }
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

// Vercel'in beklediği format `module.exports` veya default export'tur. `exports.handler` Netlify'a özeldir.
// Ancak Vercel genellikle `exports.handler`'ı da destekler, asıl sorun `import` syntax'ı idi.
// Güvenli tarafta kalmak için `module.exports` kullanalım.
module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { prompt: userPrompt } = req.body;
        if (!userPrompt) {
            return res.status(400).json({ error: 'Prompt is required.' });
        }

        const userQuestionMatch = userPrompt.match(/Kullanıcı Sorusu: "([^"]+)"/);
        const userQuestion = userQuestionMatch ? userQuestionMatch[1] : userPrompt;
        const lowerCaseQuestion = userQuestion.toLowerCase();
        
        let searchResultsContext = "";
        const searchKeywords = ["kimdir", "nedir", "ne zaman", "nerede", "nasıl", "hangi", "yazarlar", "haberler", "başlıkları", "araştır", "bilgi ver", "son durum"];

        if (searchKeywords.some(keyword => lowerCaseQuestion.includes(keyword))) {
            searchResultsContext = await performGoogleSearch(userQuestion);
        }

        const finalPrompt = `Senin adın Löwentech AI Asistant. Profesyonel bir asistansın. Kullanıcının sorusu şu: "${userQuestion}". Eğer aşağıda bir arama sonucu varsa, cevabını bu sonuca dayandırarak oluştur. Eğer yoksa veya alakasızsa, genel bilgilerinle cevap ver. --- ARAMA SONUÇLARI --- ${searchResultsContext} --- ARAMA SONUCLARI SONU ---`;
        
        const result = await model.generateContent(finalPrompt);
        const response = result.response;
        const text = response.text();

        res.status(200).json({ text: text });

    } catch (error) {
        console.error('Ana Handler Hatası:', error);
        res.status(500).json({ error: 'Gemini ile konuşurken bir hata oluştu.' });
    }
};
