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

        // Environment variables kontrolü
        const requiredEnvVars = ['GCP_SA_PROJECT_ID', 'GCP_SA_CLIENT_EMAIL', 'GCP_SA_PRIVATE_KEY', 'GCP_PROJECT_ID', 'GCP_LOCATION'];
        const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);
        
        if (missingEnvVars.length > 0) {
            console.error('Eksik environment variables:', missingEnvVars);
            return res.status(500).json({ error: `Eksik environment variables: ${missingEnvVars.join(', ')}` });
        }

        // Private key'i temizle ve düzelt
        let privateKey = process.env.GCP_SA_PRIVATE_KEY;
        
        if (privateKey) {
            // Fazladan tırnak işaretlerini temizle
            privateKey = privateKey.replace(/^["'](.*)["']$/, '$1');
            
            // Literal \n'leri gerçek newline'lara çevir
            privateKey = privateKey.replace(/\\n/g, '\n');
            
            // ÖNEMLI: Çift END PRIVATE KEY satırlarını düzelt
            privateKey = privateKey.replace(/-----END PRIVATE KEY-----\s*-----END PRIVATE KEY-----/g, '-----END PRIVATE KEY-----');
            
            // Başlangıç ve bitiş kontrolü
            if (!privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
                throw new Error('Private key BEGIN satırı bulunamadı');
            }
            
            if (!privateKey.includes('-----END PRIVATE KEY-----')) {
                throw new Error('Private key END satırı bulunamadı');
            }
            
            // Fazladan whitespace'leri temizle
            privateKey = privateKey.trim();
        }

        console.log('Private Key Debug:', {
            hasBegin: privateKey?.includes('-----BEGIN PRIVATE KEY-----'),
            hasEnd: privateKey?.includes('-----END PRIVATE KEY-----'),
            lineCount: privateKey?.split('\n').length,
            firstLine: privateKey?.split('\n')[0],
            lastLine: privateKey?.split('\n').slice(-1)[0]
        });

        // VertexAI'ı direkt credentials ile başlat - GOOGLE_APPLICATION_CREDENTIALS kullanma
        const vertex_ai = new VertexAI({
            project: process.env.GCP_PROJECT_ID,
            location: process.env.GCP_LOCATION || 'us-central1',
            // Direkt credentials objesi ver
            credentials: {
                client_email: process.env.GCP_SA_CLIENT_EMAIL,
                private_key: privateKey
            }
        });
        
        const model = 'gemini-1.5-flash-001';
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