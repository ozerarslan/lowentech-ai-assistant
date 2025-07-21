const { VertexAI } = require('@google-cloud/vertexai');

// Şehir ismi normalizasyonu
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

// OpenWeather API ile hava durumu
async function getWeatherData(city) {
    const API_KEY = process.env.OPENWEATHER_API_KEY;
    if (!API_KEY) {
        console.log('OpenWeather API anahtarı yok');
        return null;
    }
    
    try {
        const normalizedCity = normalizeCity(city);
        const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(normalizedCity)}&appid=${API_KEY}&units=metric&lang=tr`;
        
        const response = await fetch(url);
        
        if (!response.ok) {
            console.log(`OpenWeather failed for ${city}: ${response.status}`);
            return null;
        }
        
        const data = await response.json();
        
        return {
            temperature: Math.round(data.main.temp),
            feelsLike: Math.round(data.main.feels_like),
            humidity: data.main.humidity,
            description: data.weather[0].description,
            windSpeed: Math.round((data.wind?.speed || 0) * 3.6),
            pressure: data.main.pressure,
            city: data.name,
            country: data.sys.country,
            source: 'OpenWeather API'
        };
    } catch (error) {
        console.error(`OpenWeather error for ${city}:`, error.message);
        return null;
    }
}

// Google Arama fonksiyonu
async function performGoogleSearch(query) {
    const API_KEY = process.env.Google_Search_API_KEY;
    const SEARCH_ENGINE_ID = process.env.SEARCH_ENGINE_ID;
    
    if (!API_KEY || !SEARCH_ENGINE_ID) {
        console.log('Google Search API anahtarları eksik');
        return null;
    }
    
    try {
        const url = `https://www.googleapis.com/customsearch/v1?key=${API_KEY}&cx=${SEARCH_ENGINE_ID}&q=${encodeURIComponent(query)}&hl=tr-TR&num=8`;
        const response = await fetch(url);
        
        if (!response.ok) {
            console.error(`Google Search API hatası: ${response.status}`);
            return null;
        }
        
        const data = await response.json();
        
        if (data.items && data.items.length > 0) {
            return data.items.slice(0, 6).map(item => {
                return `- ${item.title}: ${item.snippet}`;
            }).join('\n');
        }
        return null;
    } catch (error) {
        console.error('Google Search error:', error);
        return null;
    }
}

// Hava durumu için özel arama
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
        console.error('Weather search error:', error);
        return null;
    }
}

// Private key düzeltme fonksiyonu
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
        console.error('Private key BEGIN header bulunamadı');
        return null;
    }
    
    if (!fixed.includes('-----END PRIVATE KEY-----')) {
        console.error('Private key END footer bulunamadı');
        return null;
    }
    
    return fixed;
}

// Ana Vercel Fonksiyonu
module.exports = async (req, res) => {
    // CORS ve method kontrolleri
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    let credentialsPath = null;

    try {
        const { prompt } = req.body;
        if (!prompt) return res.status(400).json({ error: 'Prompt is required.' });

        // Environment variables kontrolü
        if (!process.env.GCP_SERVICE_ACCOUNT_JSON) {
            return res.status(500).json({ error: 'GCP_SERVICE_ACCOUNT_JSON eksik' });
        }

        // Service Account JSON'unu parse et
        let serviceAccountJson;
        try {
            serviceAccountJson = JSON.parse(process.env.GCP_SERVICE_ACCOUNT_JSON);
            console.log('✅ Service account JSON parse edildi');
            console.log('📧 Client email:', serviceAccountJson.client_email);
            console.log('🆔 Project ID:', serviceAccountJson.project_id);
        } catch (parseError) {
            console.error('❌ JSON parse hatası:', parseError);
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
        
        console.log('📁 Geçici credentials dosyası oluşturuldu');

        // Vertex AI başlat
        const vertex_ai = new VertexAI({
            project: serviceAccountJson.project_id,
            location: 'us-central1'
        });
        
        const model = 'gemini-2.0-flash';
        const generativeModel = vertex_ai.getGenerativeModel({ model });
        
        // Context hazırlama
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
        
        let context = `SISTEM BİLGİLERİ:
- Bugünün tarihi: ${formattedDate}
- Şu anki saat: ${formattedTime} (Türkiye saati)
- Kullanıcı konumu: Türkiye
- Dil: Türkçe`;

        // Hava durumu kontrolü
        const promptLower = prompt.toLowerCase();
        const isWeatherQuery = /\b(hava durumu|hava|sıcaklık|derece|yağmur|kar|güneş|bulut|rüzgar)\b/.test(promptLower);
        
        if (isWeatherQuery) {
            console.log('🌤️ Hava durumu sorgusu tespit edildi');
            
            // Şehir tespiti
            const cityPattern = /\b(istanbul|ankara|izmir|bursa|antalya|adana|konya|gaziantep|mersin|diyarbakır|kayseri|eskişehir|malatya|erzurum|trabzon|erfurt|tarsus|berlin|münchen|münih|hamburg|paris|london|londra)\b/i;
            const cityMatch = promptLower.match(cityPattern);
            const detectedCity = cityMatch ? cityMatch[0] : 'erfurt';
            
            console.log('🏙️ Tespit edilen şehir:', detectedCity);
            
            // Önce OpenWeather API'yi dene
            const weatherData = await getWeatherData(detectedCity);
            
            if (weatherData) {
                console.log('✅ OpenWeather API başarılı');
                context += `\n\n=== GÜNCEL HAVA DURUMU ===
Şehir: ${weatherData.city}, ${weatherData.country}
Sıcaklık: ${weatherData.temperature}°C
Hissedilen: ${weatherData.feelsLike}°C
Durum: ${weatherData.description}
Nem: %${weatherData.humidity}
Rüzgar: ${weatherData.windSpeed} km/h
Basınç: ${weatherData.pressure} hPa
Kaynak: ${weatherData.source}

Bu detaylı bilgileri kullanarak profesyonel hava durumu raporu ver.`;
            } else {
                // Google araması yap
                console.log('⚠️ OpenWeather çalışmadı, Google arama deneniyor');
                const searchResults = await searchWeatherInfo(detectedCity);
                
                if (searchResults) {
                    console.log('✅ Google arama başarılı');
                    context += `\n\n=== HAVA DURUMU ARAMA SONUÇLARI ===
${searchResults}

Bu sonuçlardan ${detectedCity} şehrinin hava durumunu çıkararak rapor ver.`;
                } else {
                    context += `\n\n- ${detectedCity} için şu an hava durumu bilgisine erişilemiyor.`;
                }
            }
        } else {
            // Diğer güncel bilgi gerektiren sorgular
            const needsCurrentInfo = [
                /\b(bugün|yarın|dün|şu an|güncel|son|yeni)\b/,
                /\b(2024|2025)\b/,
                /\b(fiyat|kurs|borsa|dolar|euro|altın)\b/,
                /\b(haber|olay|gelişme|açıklama)\b/
            ].some(pattern => pattern.test(promptLower));
            
            const shouldSearch = needsCurrentInfo || 
                               ["kimdir", "nedir", "ne zaman", "nerede", "nasıl", "hangi", "araştır", "bilgi ver"].some(keyword => promptLower.includes(keyword));

            if (shouldSearch) {
                console.log('🔍 Genel arama yapılıyor');
                const searchResults = await performGoogleSearch(prompt);
                if (searchResults) {
                    context += `\n\n=== GÜNCEL BİLGİLER ===
${searchResults}

Bu güncel bilgileri kullanarak yanıt ver.`;
                }
            }
        }

        // AI prompt hazırlama
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

HAVA DURUMU İÇİN:
- Mutlaka sıcaklık derecesi ver (°C)
- Hava durumu açıklaması yap (güneşli, bulutlu, yağmurlu)
- Nem, rüzgar bilgisi varsa ekle

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

        console.log('🚀 Vertex AI çağrısı yapılıyor...');
        const result = await generativeModel.generateContent(finalPrompt);
        
        if (!result.response.candidates || result.response.candidates.length === 0 || !result.response.candidates[0].content.parts[0].text) {
             throw new Error('Vertex AI\'dan geçerli bir yanıt alınamadı.');
        }
        
        const text = result.response.candidates[0].content.parts[0].text;
        
        console.log('✅ Başarılı yanıt alındı');
        res.status(200).json({ text });

    } catch (error) {
        console.error('❌ API Fonksiyonunda Kök Hata:', error);
        console.error('Stack:', error.stack);
        
        res.status(500).json({ 
            error: `Sunucuda bir hata oluştu: ${error.message}`,
            details: error.stack
        });
    } finally {
        // Geçici dosyayı temizle
        if (credentialsPath) {
            try {
                const fs = require('fs');
                fs.unlinkSync(credentialsPath);
                console.log('🗑️ Geçici credentials dosyası silindi');
            } catch (err) {
                console.warn('⚠️ Geçici dosya silinemedi:', err.message);
            }
        }
    }
};