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
        const location = 'us-central1'; // Zorla us-central1 kullan

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
        
        const model = 'gemini-2.0-flash'; // Yeni erişilebilir model
        const generativeModel = vertex_ai.getGenerativeModel({ model });
        
        // Sisteme ve Gemini'ye verilecek ön bilgileri (context) hazırlama
        const today = new Date();
        const options = { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric', 
            timeZone: 'Europe/Istanbul' 
        };
        const timeOptions = { 
            hour: '2-digit', 
            minute: '2-digit', 
            timeZone: 'Europe/Istanbul' 
        };
        
        const formattedDate = today.toLocaleDateString('tr-TR', options);
        const formattedTime = today.toLocaleTimeString('tr-TR', timeOptions);
        const season = getSeason(today.getMonth() + 1);
        
        let context = `SISTEM BİLGİLERİ:
- Bugünün tarihi: ${formattedDate}
- Şu anki saat: ${formattedTime} (Türkiye saati)
- Mevsim: ${season}
- Kullanıcı konumu: Türkiye
- Dil: Türkçe
- Asistan versiyonu: Ayşe AI v2.0`;

        function getSeason(month) {
            if (month >= 3 && month <= 5) return "İlkbahar";
            if (month >= 6 && month <= 8) return "Yaz";
            if (month >= 9 && month <= 11) return "Sonbahar";
            return "Kış";
        }
        
        // Gelişmiş arama sistemi
        const promptLower = prompt.toLowerCase();
        const searchKeywords = [
            "kimdir", "nedir", "ne zaman", "nerede", "nasıl", "hangi", "araştır", "bilgi ver", 
            "hava durumu", "son haberler", "güncel", "bugün", "dün", "yarın", 
            "fiyat", "kurs", "borsa", "ekonomi", "sağlık", "teknoloji",
            "tarif", "yemek", "spor", "maç", "sonuç", "tablo"
        ];

        // Akıllı arama kararı
        const needsSearch = searchKeywords.some(keyword => promptLower.includes(keyword)) ||
                           promptLower.includes('2024') || promptLower.includes('2025') ||
                           /\b(son|güncel|yeni|şu an|bugün|dün|yarın)\b/.test(promptLower);

        if (needsSearch) {
            try {
                console.log('Arama yapılıyor:', prompt);
                const searchResults = await performGoogleSearch(prompt);
                if (searchResults) {
                    context += `\n- İNTERNET ARAMA SONUÇLARI:\n${searchResults}\n`;
                    context += `- Yukarıdaki bilgileri kullanarak güncel ve doğru yanıt ver.\n`;
                } else {
                    context += `- Arama yapıldı ancak ilgili güncel bilgi bulunamadı.\n`;
                }
            } catch (searchError) {
                console.error("Arama hatası:", searchError);
                context += `- İnternet araması sırasında teknik bir sorun oluştu.\n`;
            }
        }
        
        // Gemini'ye gönderilecek nihai prompt'un oluşturulması
        const systemPrompt = `Sen Türkiye'nin gelişmiş bir yapay zeka asistanısın. Şu kurallara sıkı sıkıya uyacaksın:

KİMLİK GİZLİLİĞİ:
- KENDİNİ ASLA TANITMA veya ismini söyleme
- "Ben bir yapay zeka asistanıyım" gibi cümleler kullanma
- Teknik detayları açıklama (hangi model olduğun, nasıl çalıştığın vs.)
- Sadece soruya odaklan ve direkt yardım et

PROFESYONEL DAVRANIR:
- Doğal ve akıcı konuş, robot gibi değil
- Sıcak ama profesyonel ton kullan
- Gereksiz açıklamalar yapma
- Kısa ve öz yanıtlar ver
- İşe yarar bilgi ver

YANITLAMA STİLİ:
- Direkt konuya gir
- Ana bilgiyi ver, sonra detayları ekle
- Örneklerle destekle
- Pratik çözümler sun
- Gerektiğinde soru sor

YASAK İFADELER:
❌ "Ben Ayşe AI"
❌ "Yapay zeka asistanı olarak"
❌ "Size nasıl yardımcı olabilirim"
❌ "Amacım yardım etmek"
❌ "Ne hakkında yardıma ihtiyacınız var"

✅ Direkt soruya yanıt ver
✅ Doğal konuş
✅ Faydalı bilgi ver`;

        const finalPrompt = {
            contents: [{
                role: 'user',
                parts: [{
                    text: `${systemPrompt}

${context}

SORU: "${prompt}"

Yukarıdaki kurallara uyarak, direkt ve faydalı bir yanıt ver. Kendini tanıtma, sadece soruya odaklan.`
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