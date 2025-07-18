const { VertexAI } = require('@google-cloud/vertexai');

// Hava durumu API fonksiyonu (OpenWeather API kullanarak)
async function getWeatherData(city) {
    const API_KEY = process.env.OPENWEATHER_API_KEY; // Yeni environment variable
    if (!API_KEY) {
        console.log('OpenWeather API anahtarı yok, Google arama kullanılacak');
        return null;
    }
    
    try {
        const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${API_KEY}&units=metric&lang=tr`;
        const response = await fetch(url);
        
        if (!response.ok) {
            console.error('OpenWeather API hatası:', response.status);
            return null;
        }
        
        const data = await response.json();
        
        return {
            temperature: Math.round(data.main.temp),
            feelsLike: Math.round(data.main.feels_like),
            humidity: data.main.humidity,
            description: data.weather[0].description,
            windSpeed: Math.round(data.wind.speed * 3.6), // m/s to km/h
            pressure: data.main.pressure,
            city: data.name,
            country: data.sys.country
        };
    } catch (error) {
        console.error('Hava durumu API hatası:', error);
        return null;
    }
}
// Gelişmiş Google Arama fonksiyonu - daha spesifik sorgular
async function performGoogleSearch(query) {
    const API_KEY = process.env.Google_Search_API_KEY;
    const SEARCH_ENGINE_ID = process.env.SEARCH_ENGINE_ID;
    if (!API_KEY || !SEARCH_ENGINE_ID) {
        throw new Error('Google Search API anahtarları eksik.');
    }
    
    // Hava durumu için özel sorgular
    let searchQuery = query;
    if (query.toLowerCase().includes('hava durumu')) {
        const today = new Date().toISOString().split('T')[0];
        searchQuery = `${query} bugün ${today} site:mgm.gov.tr OR site:havadurumu15gunluk.xyz OR site:weather.com`;
    }
    
    const url = `https://www.googleapis.com/customsearch/v1?key=${API_KEY}&cx=${SEARCH_ENGINE_ID}&q=${encodeURIComponent(searchQuery)}&hl=tr-TR&num=10`;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Google Search API hatası (${response.status}).`);
    }
    const data = await response.json();
    if (data.items && data.items.length > 0) {
        return data.items.slice(0, 8).map(item => {
            // Tarih bilgisi varsa ekle
            const snippet = item.snippet || '';
            const title = item.title || '';
            return `- ${title}: ${snippet}`;
        }).join('\n');
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
        
        // Gelişmiş ve spesifik arama sistemi
        const promptLower = prompt.toLowerCase();
        
        // Hava durumu tespiti
        const isWeatherQuery = /\b(hava durumu|hava|sıcaklık|derece|yağmur|kar|güneş|bulut|rüzgar)\b/.test(promptLower);
        
        if (isWeatherQuery) {
            try {
                console.log('Hava durumu sorgusu tespit edildi');
                
                // Şehir tespiti - daha geniş liste
                const cityMatch = promptLower.match(/\b(istanbul|ankara|izmir|bursa|antalya|adana|konya|gaziantep|şanlıurfa|kocaeli|mersin|diyarbakır|kayseri|eskişehir|urfa|malatya|erzurum|van|batman|elazığ|tekirdağ|balıkesir|kütahya|manisa|aydın|denizli|muğla|trabzon|ordu|giresun|rize|artvin|erzincan|tunceli|bingöl|muş|bitlis|siirt|şırnak|hakkari|erfurt|tarsus|mersin|samsun|zonguldak|düzce|bolu|kastamonu|sinop|amasya|tokat|sivas|yozgat|nevşehir|kırşehir|aksaray|niğde|karaman|isparta|burdur|afyon|uşak|kütahya|bilecik|sakarya|yalova|kırklareli|edirne|çanakkale|balikesir)\b/);
                const city = cityMatch ? cityMatch[0] : 'erfurt';
                
                console.log('Şehir tespit edildi:', city);
                
                // Önce Weather API'yi dene
                const weatherData = await getWeatherData(city);
                
                if (weatherData) {
                    context += `\n=== GÜNCEL HAVA DURUMU BİLGİSİ ===
Şehir: ${weatherData.city}
Sıcaklık: ${weatherData.temperature}°C
Hissedilen: ${weatherData.feelsLike}°C
Durum: ${weatherData.description}
Nem: %${weatherData.humidity}
Rüzgar: ${weatherData.windSpeed} km/h
Basınç: ${weatherData.pressure} hPa
Veri Kaynağı: OpenWeather (Gerçek zamanlı)

Bu bilgileri kullanarak detaylı hava durumu raporu ver.\n`;
                } else {
                    // Weather API çalışmazsa Google araması yap
                    console.log('Weather API çalışmadı, Google arama deneniyor');
                    const searchResults = await performGoogleSearch(`${city} hava durumu sıcaklık site:mgm.gov.tr OR site:havadurumu15gunluk.xyz`);
                    if (searchResults) {
                        context += `\n=== HAVA DURUMU ARAMA SONUÇLARI ===\n${searchResults}\n`;
                        context += `Bu arama sonuçlarından ${city} şehrinin kesin sıcaklık bilgisini çıkararak detaylı rapor ver. Sayısal değerleri mutlaka belirt.\n`;
                    } else {
                        context += `\n- ${city} için güncel hava durumu bilgisine şu an erişemiyorum. Daha sonra tekrar deneyebilirsiniz.\n`;
                    }
                }
            } catch (error) {
                console.error('Hava durumu sorgu hatası:', error);
                context += `\n- Hava durumu bilgisine şu an erişemiyorum, teknik sorun var.\n`;
            }
        } else {
            // Diğer güncel bilgi gerektiren sorgular
            const needsCurrentInfo = [
                /\b(bugün|yarın|dün|şu an|güncel|son|yeni)\b/,
                /\b(2024|2025)\b/,
                /\b(fiyat|kurs|borsa|dolar|euro|altın)\b/,
                /\b(haber|olay|gelişme|açıklama)\b/,
                /\b(maç|skor|sonuç|puan|tablo)\b/
            ].some(pattern => pattern.test(promptLower));
            
            const shouldSearch = needsCurrentInfo || 
                               ["kimdir", "nedir", "ne zaman", "nerede", "nasıl", "hangi", "araştır", "bilgi ver"].some(keyword => promptLower.includes(keyword));

            if (shouldSearch) {
                try {
                    console.log('Genel arama yapılıyor:', prompt);
                    const searchResults = await performGoogleSearch(prompt);
                    if (searchResults) {
                        context += `\n=== GÜNCEL BİLGİLER ===\n${searchResults}\n`;
                        context += `Bu güncel bilgileri kullanarak kesin yanıt ver.\n`;
                    } else {
                        context += `\n- Bu konuda güncel bilgi bulunamadı.\n`;
                    }
                } catch (searchError) {
                    console.error("Arama hatası:", searchError);
                    context += `\n- Güncel bilgilere şu an erişemiyorum.\n`;
                }
            }
        }
        
        // Gemini'ye gönderilecek nihai prompt'un oluşturulması
        const systemPrompt = `Sen profesyonel bir asistansın. Bu kurallara uyacaksın:

DAVRANIR KURALLARI:
- Kendini tanıtma, direkt yardım et
- "Yapay zeka" veya "AI" kelimelerini kullanma
- Gereksiz açıklamalar yapma
- Robot gibi konuşma

GÜNCEL BİLGİ İÇİN:
- Eğer arama sonuçları varsa, onları kaynak olarak kullan
- Tarih, saat, hava durumu gibi güncel bilgileri mutlaka arama sonuçlarından al
- Tahmin yapma, sadece arama sonuçlarındaki verileri kullan
- Arama sonucu yoksa "güncel bilgiye erişemiyorum" de

HAVA DURUMU İÇİN:
- Mutlaka sıcaklık derecesi ver (°C)
- Hava durumu açıklaması yap (güneşli, bulutlu, yağmurlu)
- Nem, rüzgar bilgisi varsa ekle
- Hangi kaynaktan aldığını belirtme

YANIT STİLİ:
- Kısa ve net ol
- Önemli bilgiyi başta ver
- Somut sayılar ve detaylar kullan
- Doğal konuş, samimi ol`;

        const finalPrompt = {
            contents: [{
                role: 'user',
                parts: [{
                    text: `${systemPrompt}

${context}

SORU: "${prompt}"

Bu bilgileri kullanarak direkt, kesin ve güncel yanıt ver.`
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
            details: error.cause ? error.cause.message : ' Detay yok'
        });
    }
};