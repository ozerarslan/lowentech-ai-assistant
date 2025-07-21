const { VertexAI } = require('@google-cloud/vertexai');

// Debug logging
function log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${level}: ${message}`);
    if (data) console.log(JSON.stringify(data, null, 2));
}

// Şehir ismi normalizasyonu (eski koddan)
function normalizeCity(city) {
    const cityMap = {
        'erfurt': 'Erfurt,DE',
        'tarsus': 'Tarsus,TR',
        'mersin': 'Mersin,TR',
        'istanbul': 'Istanbul,TR',
        'ankara': 'Ankara,TR',
        'izmir': 'Izmir,TR',
        'berlin': 'Berlin,DE',
        'münchen': 'Munich,DE',
        'münih': 'Munich,DE',
        'hamburg': 'Hamburg,DE',
        'paris': 'Paris,FR',
        'londra': 'London,GB',
        'london': 'London,GB'
    };
    
    const lowerCity = city.toLowerCase().trim();
    return cityMap[lowerCity] || city;
}

// Hava durumu API (eski koddan geliştirilmiş)
async function getWeatherData(city) {
    const API_KEY = process.env.OPENWEATHER_API_KEY;
    if (!API_KEY) {
        log('WARN', 'OpenWeather API anahtarı yok');
        return null;
    }
    
    try {
        const normalizedCity = normalizeCity(city);
        const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(normalizedCity)}&appid=${API_KEY}&units=metric&lang=tr`;
        
        log('INFO', `Weather API request for: ${normalizedCity}`);
        const response = await fetch(url);
        
        if (!response.ok) {
            log('ERROR', `Weather API failed: ${response.status}`);
            return null;
        }
        
        const data = await response.json();
        log('SUCCESS', 'Weather data retrieved');
        
        return {
            temperature: Math.round(data.main.temp),
            feelsLike: Math.round(data.main.feels_like),
            humidity: data.main.humidity,
            description: data.weather[0].description,
            windSpeed: Math.round((data.wind?.speed || 0) * 3.6), // m/s to km/h
            pressure: data.main.pressure,
            city: data.name,
            country: data.sys.country,
            source: 'OpenWeather API'
        };
    } catch (error) {
        log('ERROR', 'Weather API error', error.message);
        return null;
    }
}

// Google Search API (eski koddan)
async function performGoogleSearch(query) {
    const API_KEY = process.env.Google_Search_API_KEY;
    const SEARCH_ENGINE_ID = process.env.SEARCH_ENGINE_ID;
    
    if (!API_KEY || !SEARCH_ENGINE_ID) {
        log('WARN', 'Google Search API anahtarları eksik');
        return null;
    }
    
    try {
        // Hava durumu için özel sorgular (eski koddan)
        let searchQuery = query;
        if (query.toLowerCase().includes('hava durumu')) {
            const today = new Date().toISOString().split('T')[0];
            searchQuery = `${query} bugün ${today} site:mgm.gov.tr OR site:havadurumu15gunluk.xyz OR site:weather.com`;
        }
        
        const url = `https://www.googleapis.com/customsearch/v1?key=${API_KEY}&cx=${SEARCH_ENGINE_ID}&q=${encodeURIComponent(searchQuery)}&hl=tr-TR&num=10`;
        const response = await fetch(url);
        
        if (!response.ok) {
            log('ERROR', `Google Search failed: ${response.status}`);
            return null;
        }
        
        const data = await response.json();
        
        if (data.items && data.items.length > 0) {
            return data.items.slice(0, 8).map(item => {
                // Tarih bilgisi varsa ekle (eski koddan)
                const snippet = item.snippet || '';
                const title = item.title || '';
                return `- ${title}: ${snippet}`;
            }).join('\n');
        }
        return null;
    } catch (error) {
        log('ERROR', 'Google Search error', error.message);
        return null;
    }
}

// Hava durumu için özel arama (eski koddan)
async function searchWeatherInfo(city) {
    try {
        const queries = [
            `${city} hava durumu sıcaklık site:mgm.gov.tr OR site:weather.com`,
            `${city} weather temperature today`,
            `${city} sıcaklık derece bugün`
        ];
        
        for (const query of queries) {
            const result = await performGoogleSearch(query);
            if (result && result.includes('°')) {
                return result;
            }
        }
        return null;
    } catch (error) {
        log('ERROR', 'Weather search error', error.message);
        return null;
    }
}

// Private key düzeltme (eski koddan geliştirilmiş)
function fixPrivateKey(privateKey) {
    if (!privateKey) return null;
    
    // Tırnak işaretlerini kaldır
    let fixed = privateKey.replace(/^["'](.*)["']$/, '$1');
    
    // \\n'leri gerçek newline'lara çevir
    fixed = fixed.replace(/\\n/g, '\n');
    
    // Duplicate END tags'i düzelt
    fixed = fixed.replace(/-----END PRIVATE KEY-----\s*-----END PRIVATE KEY-----/g, '-----END PRIVATE KEY-----');
    
    // Trim
    fixed = fixed.trim();
    
    // Header ve footer kontrol et
    if (!fixed.includes('-----BEGIN PRIVATE KEY-----')) {
        log('ERROR', 'Private key BEGIN header bulunamadı');
        return null;
    }
    
    if (!fixed.includes('-----END PRIVATE KEY-----')) {
        log('ERROR', 'Private key END footer bulunamadı');
        return null;
    }
    
    return fixed;
}

// Mevsim hesaplama (eski koddan)
function getSeason(month) {
    if (month >= 3 && month <= 5) return "İlkbahar";
    if (month >= 6 && month <= 8) return "Yaz";
    if (month >= 9 && month <= 11) return "Sonbahar";
    return "Kış";
}

// Ana Vercel Fonksiyonu
module.exports = async (req, res) => {
    // CORS ve method kontrolleri
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    let credentialsPath = null;

    try {
        log('INFO', 'API request started');
        
        const { prompt } = req.body;
        if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required.' });
        }

        log('INFO', `Prompt received: ${prompt.substring(0, 50)}...`);

        // Environment variables kontrolü
        if (!process.env.GCP_SERVICE_ACCOUNT_JSON) {
            log('ERROR', 'GCP_SERVICE_ACCOUNT_JSON missing');
            return res.status(500).json({ error: 'GCP_SERVICE_ACCOUNT_JSON eksik' });
        }

        // Service Account JSON'unu parse et
        let serviceAccountJson;
        try {
            serviceAccountJson = JSON.parse(process.env.GCP_SERVICE_ACCOUNT_JSON);
            log('SUCCESS', 'Service account JSON parsed', {
                client_email: serviceAccountJson.client_email,
                project_id: serviceAccountJson.project_id,
                private_key_length: serviceAccountJson.private_key?.length
            });
        } catch (parseError) {
            log('ERROR', 'JSON parse failed', parseError.message);
            return res.status(500).json({ error: 'Service account JSON parse hatası' });
        }

        // Private key'i düzelt
        const fixedPrivateKey = fixPrivateKey(serviceAccountJson.private_key);
        if (!fixedPrivateKey) {
            return res.status(500).json({ error: 'Private key düzeltilemedi' });
        }

        // Geçici credentials dosyası oluştur
        const fs = require('fs');
        const path = require('path');
        const os = require('os');
        
        const tempDir = os.tmpdir();
        credentialsPath = path.join(tempDir, `service-account-${Date.now()}.json`);
        
        const credentialsData = {
            ...serviceAccountJson,
            private_key: fixedPrivateKey
        };
        
        fs.writeFileSync(credentialsPath, JSON.stringify(credentialsData, null, 2));
        process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialsPath;
        
        log('SUCCESS', 'Credentials file created');

        // Vertex AI başlat
        const vertex_ai = new VertexAI({
            project: serviceAccountJson.project_id,
            location: 'us-central1'
        });
        
        const model = 'gemini-2.0-flash';
        const generativeModel = vertex_ai.getGenerativeModel({ model });
        
        log('SUCCESS', 'Vertex AI initialized');

        // Context hazırlama (eski koddan geliştirilmiş)
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
- Asistan versiyonu: Löwentech AI v2.0`;

        // Gelişmiş ve spesifik arama sistemi (eski koddan)
        const promptLower = prompt.toLowerCase();
        
        // Hava durumu tespiti
        const isWeatherQuery = /\b(hava durumu|hava|sıcaklık|derece|yağmur|kar|güneş|bulut|rüzgar)\b/.test(promptLower);
        
        if (isWeatherQuery) {
            log('INFO', 'Weather query detected');
            
            // Şehir tespiti - daha geniş liste (eski koddan)
            const cityMatch = promptLower.match(/\b(istanbul|ankara|izmir|bursa|antalya|adana|konya|gaziantep|şanlıurfa|kocaeli|mersin|diyarbakır|kayseri|eskişehir|urfa|malatya|erzurum|van|batman|elazığ|tekirdağ|balıkesir|kütahya|manisa|aydın|denizli|muğla|trabzon|ordu|giresun|rize|artvin|erzincan|tunceli|bingöl|muş|bitlis|siirt|şırnak|hakkari|erfurt|tarsus|mersin|samsun|zonguldak|düzce|bolu|kastamonu|sinop|amasya|tokat|sivas|yozgat|nevşehir|kırşehir|aksaray|niğde|karaman|isparta|burdur|afyon|uşak|kütahya|bilecik|sakarya|yalova|kırklareli|edirne|çanakkale|balikesir)\b/);
            const city = cityMatch ? cityMatch[0] : 'erfurt';
            
            log('INFO', 'City detected: ' + city);
            
            // Önce Weather API'yi dene
            const weatherData = await getWeatherData(city);
            
            if (weatherData) {
                log('SUCCESS', 'OpenWeather API successful');
                context += `\n\n=== GÜNCEL HAVA DURUMU BİLGİSİ ===
Şehir: ${weatherData.city}, ${weatherData.country}
Sıcaklık: ${weatherData.temperature}°C
Hissedilen: ${weatherData.feelsLike}°C
Durum: ${weatherData.description}
Nem: %${weatherData.humidity}
Rüzgar: ${weatherData.windSpeed} km/h
Basınç: ${weatherData.pressure} hPa
Veri Kaynağı: ${weatherData.source}

Bu bilgileri kullanarak detaylı hava durumu raporu ver.\n`;
            } else {
                // Weather API çalışmazsa Google araması yap (eski koddan)
                log('WARN', 'OpenWeather failed, trying Google search');
                const searchResults = await searchWeatherInfo(city);
                if (searchResults) {
                    log('SUCCESS', 'Google weather search successful');
                    context += `\n\n=== HAVA DURUMU ARAMA SONUÇLARI ===\n${searchResults}\n`;
                    context += `Bu arama sonuçlarından ${city} şehrinin kesin sıcaklık bilgisini çıkararak detaylı rapor ver. Sayısal değerleri mutlaka belirt.\n`;
                } else {
                    context += `\n\n- ${city} için güncel hava durumu bilgisine şu an erişemiyorum. Daha sonra tekrar deneyebilirsiniz.\n`;
                }
            }
        } else {
            // Diğer güncel bilgi gerektiren sorgular (eski koddan)
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
                log('INFO', 'General search needed');
                const searchResults = await performGoogleSearch(prompt);
                if (searchResults) {
                    context += `\n\n=== GÜNCEL BİLGİLER ===\n${searchResults}\n`;
                    context += `Bu güncel bilgileri kullanarak kesin yanıt ver.\n`;
                } else {
                    context += `\n\n- Bu konuda güncel bilgi bulunamadı.\n`;
                }
            }
        }

        // Gemini'ye gönderilecek nihai prompt'un oluşturulması (eski koddan)
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

        log('INFO', 'Sending request to Vertex AI');
        const result = await generativeModel.generateContent(finalPrompt);
        
        if (!result.response.candidates || result.response.candidates.length === 0 || !result.response.candidates[0].content.parts[0].text) {
             throw new Error('Vertex AI\'dan geçerli bir yanıt alınamadı.');
        }
        
        const text = result.response.candidates[0].content.parts[0].text;
        
        log('SUCCESS', 'Response generated successfully');
        res.status(200).json({ text });

    } catch (error) {
        log('ERROR', 'Main function error', {
            message: error.message,
            stack: error.stack
        });
        
        res.status(500).json({ 
            error: `Sunucuda bir hata oluştu: ${error.message}`,
            details: error.cause ? error.cause.message : 'Detay yok'
        });
    } finally {
        // Geçici dosyayı temizle
        if (credentialsPath) {
            try {
                const fs = require('fs');
                fs.unlinkSync(credentialsPath);
                log('INFO', 'Temp credentials file cleaned up');
            } catch (err) {
                log('WARN', 'Cleanup failed', err.message);
            }
        }
    }
};