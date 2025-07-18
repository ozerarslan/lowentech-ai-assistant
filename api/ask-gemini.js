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

        // ======= DEBUG: Environment Variables Kontrolü =======
        console.log('=== ENVIRONMENT VARIABLES DEBUG ===');
        console.log('GCP_SA_PROJECT_ID:', process.env.GCP_SA_PROJECT_ID);
        console.log('GCP_SA_CLIENT_EMAIL:', process.env.GCP_SA_CLIENT_EMAIL);
        console.log('GCP_PROJECT_ID:', process.env.GCP_PROJECT_ID);
        console.log('GCP_LOCATION:', process.env.GCP_LOCATION);
        console.log('GCP_SA_PRIVATE_KEY uzunluk:', process.env.GCP_SA_PRIVATE_KEY?.length);
        console.log('GCP_SA_PRIVATE_KEY ilk 100 karakter:', process.env.GCP_SA_PRIVATE_KEY?.substring(0, 100));
        console.log('GCP_SA_PRIVATE_KEY son 100 karakter:', process.env.GCP_SA_PRIVATE_KEY?.substring(-100));

        // Environment variables kontrolü
        const requiredEnvVars = ['GCP_SA_PROJECT_ID', 'GCP_SA_CLIENT_EMAIL', 'GCP_SA_PRIVATE_KEY', 'GCP_PROJECT_ID', 'GCP_LOCATION'];
        const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);
        
        if (missingEnvVars.length > 0) {
            console.error('Eksik environment variables:', missingEnvVars);
            return res.status(500).json({ error: `Eksik environment variables: ${missingEnvVars.join(', ')}` });
        }

        // Private key'i temizle ve düzelt
        let privateKey = process.env.GCP_SA_PRIVATE_KEY;
        
        console.log('=== PRIVATE KEY İŞLEME BAŞLANGIÇ ===');
        console.log('Orijinal private key uzunluk:', privateKey?.length);
        console.log('BEGIN satırı var mı:', privateKey?.includes('-----BEGIN PRIVATE KEY-----'));
        console.log('END satırı var mı:', privateKey?.includes('-----END PRIVATE KEY-----'));
        
        if (privateKey) {
            // Fazladan tırnak işaretlerini temizle
            privateKey = privateKey.replace(/^["'](.*)["']$/, '$1');
            console.log('Tırnak temizleme sonrası uzunluk:', privateKey.length);
            
            // Literal \n'leri gerçek newline'lara çevir
            privateKey = privateKey.replace(/\\n/g, '\n');
            console.log('Newline çevirme sonrası uzunluk:', privateKey.length);
            
            // Çift END PRIVATE KEY satırlarını düzelt
            const beforeEndFix = privateKey.length;
            privateKey = privateKey.replace(/-----END PRIVATE KEY-----\s*-----END PRIVATE KEY-----/g, '-----END PRIVATE KEY-----');
            console.log('Çift END düzeltme sonrası uzunluk değişimi:', beforeEndFix, '->', privateKey.length);
            
            // Fazladan whitespace'leri temizle
            privateKey = privateKey.trim();
            console.log('Trim sonrası uzunluk:', privateKey.length);
        }

        console.log('=== PRIVATE KEY İŞLEME SONUÇ ===');
        console.log('Final private key uzunluk:', privateKey?.length);
        console.log('Satır sayısı:', privateKey?.split('\n').length);
        console.log('İlk satır:', privateKey?.split('\n')[0]);
        console.log('Son satır:', privateKey?.split('\n').slice(-1)[0]);
        console.log('BEGIN check:', privateKey?.includes('-----BEGIN PRIVATE KEY-----'));
        console.log('END check:', privateKey?.includes('-----END PRIVATE KEY-----'));

        // Service Account JSON objesi oluştur
        const serviceAccountJson = {
            type: 'service_account',
            project_id: process.env.GCP_SA_PROJECT_ID,
            private_key_id: 'key-id',
            private_key: privateKey,
            client_email: process.env.GCP_SA_CLIENT_EMAIL,
            client_id: '0',
            auth_uri: 'https://accounts.google.com/o/oauth2/auth',
            token_uri: 'https://oauth2.googleapis.com/token',
            auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
            client_x509_cert_url: `https://www.googleapis.com/robot/v1/metadata/x509/${process.env.GCP_SA_CLIENT_EMAIL}`
        };

        console.log('=== SERVICE ACCOUNT JSON OLUŞTURULDU ===');
        console.log('Service account email:', serviceAccountJson.client_email);
        console.log('Project ID:', serviceAccountJson.project_id);

        // Geçici dosya oluştur
        const fs = require('fs');
        const path = require('path');
        const os = require('os');
        
        const tempDir = os.tmpdir();
        const credentialsPath = path.join(tempDir, `service-account-${Date.now()}.json`);
        
        // Service account JSON'unu geçici dosyaya yaz
        fs.writeFileSync(credentialsPath, JSON.stringify(serviceAccountJson, null, 2));
        console.log('Service account dosyası oluşturuldu:', credentialsPath);
        
        // Environment variable'ı dosya yoluna set et
        process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialsPath;
        console.log('GOOGLE_APPLICATION_CREDENTIALS set edildi:', credentialsPath);

        // Vertex AI İstemcisini başlat
        console.log('=== VERTEX AI İNİT ===');
        console.log('Project:', process.env.GCP_PROJECT_ID);
        console.log('Location:', process.env.GCP_LOCATION);
        
        const vertex_ai = new VertexAI({
            project: process.env.GCP_PROJECT_ID,
            location: process.env.GCP_LOCATION || 'us-central1'
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

        console.log('=== VERTEX AI ÇAĞRI ===');
        console.log('Vertex AI çağrısı yapılıyor...');
        const result = await generativeModel.generateContent(finalPrompt);
        console.log('Vertex AI çağrısı başarılı!');
        
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
        console.error('=== HATA DEBUG ===');
        console.error('API Fonksiyonunda Kök Hata:', error);
        console.error('Error message:', error.message);
        console.error('Error name:', error.name);
        console.error('Error Stack:', error.stack);
        if (error.cause) {
            console.error('Error Cause:', error.cause);
        }
        if (error.response) {
            console.error('Error Response:', error.response.data);
        }
        
        res.status(500).json({ 
            error: `Sunucuda bir hata oluştu: ${error.message}`,
            details: error.cause ? error.cause.message : 'Detay yok'
        });
    }
};