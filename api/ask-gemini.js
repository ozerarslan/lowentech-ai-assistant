const { VertexAI } = require('@google-cloud/vertexai');

// Google Arama fonksiyonu
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

        // Environment variables kontrolü - SADECE JSON VE PROJECT ID
        if (!process.env.GCP_SERVICE_ACCOUNT_JSON) {
            return res.status(500).json({ error: 'GCP_SERVICE_ACCOUNT_JSON eksik' });
        }

        // Service Account JSON'unu direkt parse et
        let serviceAccountJson;
        try {
            serviceAccountJson = JSON.parse(process.env.GCP_SERVICE_ACCOUNT_JSON);
            console.log('Service account JSON parse edildi');
            console.log('Client email:', serviceAccountJson.client_email);
            console.log('Project ID:', serviceAccountJson.project_id);
            console.log('Private key uzunluk:', serviceAccountJson.private_key?.length);
        } catch (parseError) {
            console.error('JSON parse hatası:', parseError);
            return res.status(500).json({ error: 'Service account JSON parse hatası' });
        }

        // JSON'dan project ID al
        const projectId = serviceAccountJson.project_id;
        const location = process.env.GCP_LOCATION || 'us-central1';

        // Geçici dosya oluştur
        const fs = require('fs');
        const path = require('path');
        const os = require('os');
        
        const tempDir = os.tmpdir();
        const credentialsPath = path.join(tempDir, `service-account-${Date.now()}.json`);
        
        fs.writeFileSync(credentialsPath, JSON.stringify(serviceAccountJson, null, 2));
        process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialsPath;

        console.log('Service account dosyası oluşturuldu:', credentialsPath);

        // Vertex AI İstemcisini başlat
        const vertex_ai = new VertexAI({
            project: projectId, // JSON'dan alınan project ID
            location: location
        });
        
        const model = 'gemini-1.5-flash'; // -001 kaldırıldı
        const generativeModel = vertex_ai.getGenerativeModel({ model });
        
        // Sisteme ve Gemini'ye verilecek ön bilgileri (context) hazırlama
        const today = new Date();
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Europe/Istanbul' };
        const formattedDate = today.toLocaleDateString('tr-TR', options);
        let context = `SİSTEM BİLGİSİ:\n- Bugünün tarihi: ${formattedDate}.\n`;
        
        // Arama gerektiren anahtar kelimeler
        const promptLower = prompt.toLowerCase();
        const searchKeywords = ["kimdir", "nedir", "ne zaman", "nerede", "nasıl", "hangi", "araştır", "bilgi ver", "hava durumu"];

        if (searchKeywords.some(keyword => promptLower.includes(keyword))) {
            try {
                const searchResults = await performGoogleSearch(prompt);
                if (searchResults) {
                    context += `- Kullanıcının sorusuyla ilgili internet arama sonuçları:\n${searchResults}\n`;
                }
            } catch (searchError) {
                console.error("Arama hatası:", searchError);
                context += `- İnternet araması sırasında bir hata oluştu.\n`;
            }
        }
        
        // Gemini'ye gönderilecek nihai prompt'un oluşturulması
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

        console.log('Vertex AI çağrısı yapılıyor...');
        const result = await generativeModel.generateContent(finalPrompt);
        
        // Geçici dosyayı temizle
        try {
            fs.unlinkSync(credentialsPath);
            console.log('Geçici credentials dosyası silindi');
        } catch (err) {
            console.warn('Geçici dosya silinemedi:', err.message);
        }
        
        if (!result.response.candidates || result.response.candidates.length === 0 || !result.response.candidates[0].content.parts[0].text) {
             throw new Error('Vertex AI\'dan geçerli bir yanıt alınamadı.');
        }
        
        const text = result.response.candidates[0].content.parts[0].text;
        
        res.status(200).json({ text });

    } catch (error) {
        console.error('API Fonksiyonunda Kök Hata:', error);
        console.error('Error Stack:', error.stack);
        if (error.cause) {
            console.error('Error Cause:', error.cause);
        }
        
        res.status(500).json({ 
            error: `Sunucuda bir hata oluştu: ${error.message}`,
            details: error.cause ? error.cause.message : 'Detay yok'
        });
    }
};