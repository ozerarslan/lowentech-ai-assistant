const { VertexAI } = require('@google-cloud/vertexai');

// Debug logging
function log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${level}: ${message}`);
    if (data) console.log(JSON.stringify(data, null, 2));
}

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

// Hava durumu API
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
            windSpeed: Math.round((data.wind?.speed || 0) * 3.6),
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

// Akıllı Google Search - çoklu sorgu sistemi
async function performIntelligentSearch(query) {
    const API_KEY = process.env.Google_Search_API_KEY;
    const SEARCH_ENGINE_ID = process.env.SEARCH_ENGINE_ID;
    
    if (!API_KEY || !SEARCH_ENGINE_ID) {
        log('WARN', 'Google Search API anahtarları eksik');
        return null;
    }
    
    try {
        // Çoklu arama stratejisi
        const searchQueries = [
            query, // Orijinal sorgu
            `${query} company website`, // Şirket sitesi
            `${query} about information`, // Hakkında bilgi
            `${query} Germany company`, // Almanya şirketi (eğer Almanya ile ilgiliyse)
            `"${query}" official`, // Resmi bilgi
        ];
        
        let allResults = [];
        
        for (const searchQuery of searchQueries) {
            try {
                const url = `https://www.googleapis.com/customsearch/v1?key=${API_KEY}&cx=${SEARCH_ENGINE_ID}&q=${encodeURIComponent(searchQuery)}&hl=tr-TR&num=5`;
                const response = await fetch(url);
                
                if (response.ok) {
                    const data = await response.json();
                    if (data.items && data.items.length > 0) {
                        const results = data.items.slice(0, 3).map(item => ({
                            title: item.title,
                            snippet: item.snippet,
                            link: item.link
                        }));
                        allResults = allResults.concat(results);
                    }
                }
                
                // Rate limiting için kısa bekleme
                await new Promise(resolve => setTimeout(resolve, 200));
                
            } catch (searchError) {
                log('WARN', `Search query failed: ${searchQuery}`, searchError.message);
                continue;
            }
        }
        
        if (allResults.length > 0) {
            // En alakalı sonuçları seç
            const uniqueResults = [];
            const seenTitles = new Set();
            
            for (const result of allResults) {
                if (!seenTitles.has(result.title) && uniqueResults.length < 8) {
                    seenTitles.add(result.title);
                    uniqueResults.push(result);
                }
            }
            
            return uniqueResults.map(item => 
                `- ${item.title}: ${item.snippet}`
            ).join('\n');
        }
        
        return null;
        
    } catch (error) {
        log('ERROR', 'Google Search error', error.message);
        return null;
    }
}

// Sorgu analizi ve otomatik arama kararı
function shouldPerformSearch(prompt) {
    const promptLower = prompt.toLowerCase();
    
    // Her zaman arama yapılacak durumlar
    const alwaysSearch = [
        /\b(kimdir|nedir|ne zaman|nerede|nasıl|hangi|firm|şirket|company)\b/,
        /\b(hakkında|bilgi|araştır|anlat|açıkla)\b/,
        /\b(güncel|son|yeni|bugün|2024|2025)\b/,
        /\b(fiyat|kurs|borsa|haber|sonuç)\b/,
    ];
    
    // Şirket/marka isimleri için arama
    const companyIndicators = [
        /\b[A-Z][a-z]+\s+(company|firma|şirket|corporation|corp|inc|gmbh|ag|ltd)\b/i,
        /\b[A-Z][a-z]{3,}\b/, // Büyük harfle başlayan 4+ karakter (marka adı olabilir)
    ];
    
    return alwaysSearch.some(pattern => pattern.test(promptLower)) ||
           companyIndicators.some(pattern => pattern.test(prompt));
}

// Private key düzeltme
function fixPrivateKey(privateKey) {
    if (!privateKey) return null;
    
    let fixed = privateKey
        .replace(/^["'](.*)["']$/, '$1')
        .replace(/\\n/g, '\n')
        .replace(/-----END PRIVATE KEY-----\s*-----END PRIVATE KEY-----/g, '-----END PRIVATE KEY-----')
        .trim();
    
    if (!fixed.includes('-----BEGIN PRIVATE KEY-----') || 
        !fixed.includes('-----END PRIVATE KEY-----')) {
        log('ERROR', 'Private key format invalid');
        return null;
    }
    
    return fixed;
}

// Mevsim hesaplama
function getSeason(month) {
    if (month >= 3 && month <= 5) return "İlkbahar";
    if (month >= 6 && month <= 8) return "Yaz";
    if (month >= 9 && month <= 11) return "Sonbahar";
    return "Kış";
}

// Ana Vercel Fonksiyonu
module.exports = async (req, res) => {
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

        log('INFO', `Prompt received: ${prompt}`);

        // Environment variables kontrolü
        if (!process.env.GCP_SERVICE_ACCOUNT_JSON) {
            log('ERROR', 'GCP_SERVICE_ACCOUNT_JSON missing');
            return res.status(500).json({ error: 'GCP_SERVICE_ACCOUNT_JSON eksik' });
        }

        // Service Account JSON'unu parse et
        let serviceAccountJson;
        try {
            serviceAccountJson = JSON.parse(process.env.GCP_SERVICE_ACCOUNT_JSON);
            log('SUCCESS', 'Service account JSON parsed');
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
        
        credentialsPath = path.join(os.tmpdir(), `service-account-${Date.now()}.json`);
        
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
        
        const generativeModel = vertex_ai.getGenerativeModel({ model: 'gemini-2.0-flash' });
        
        log('SUCCESS', 'Vertex AI initialized');

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
        const season = getSeason(today.getMonth() + 1);
        
        let context = `SISTEM BİLGİLERİ:
- Bugünün tarihi: ${formattedDate}
- Şu anki saat: ${formattedTime} (Türkiye saati)
- Mevsim: ${season}
- Kullanıcı konumu: Türkiye/Almanya
- Dil: Türkçe
- Asistan versiyonu: Löwentech AI v3.0 (Akıllı Araştırma)`;

        const promptLower = prompt.toLowerCase();
        
        // Hava durumu kontrolü
        const isWeatherQuery = /\b(hava durumu|hava|sıcaklık|derece|yağmur|kar|güneş|bulut|rüzgar)\b/.test(promptLower);
        
        if (isWeatherQuery) {
            log('INFO', 'Weather query detected');
            
            const cityMatch = promptLower.match(/\b(istanbul|ankara|izmir|bursa|antalya|adana|konya|gaziantep|şanlıurfa|kocaeli|mersin|diyarbakır|kayseri|eskişehir|urfa|malatya|erzurum|van|batman|elazığ|tekirdağ|balıkesir|kütahya|manisa|aydın|denizli|muğla|trabzon|ordu|giresun|rize|artvin|erzincan|tunceli|bingöl|muş|bitlis|siirt|şırnak|hakkari|erfurt|tarsus|mersin|samsun|zonguldak|düzce|bolu|kastamonu|sinop|amasya|tokat|sivas|yozgat|nevşehir|kırşehir|aksaray|niğde|karaman|isparta|burdur|afyon|uşak|kütahya|bilecik|sakarya|yalova|kırklareli|edirne|çanakkale|balikesir|berlin|münchen|hamburg)\b/);
            const city = cityMatch ? cityMatch[0] : 'erfurt';
            
            log('INFO', 'City detected: ' + city);
            
            const weatherData = await getWeatherData(city);
            
            if (weatherData) {
                context += `\n\n=== GÜNCEL HAVA DURUMU ===
Şehir: ${weatherData.city}, ${weatherData.country}
Sıcaklık: ${weatherData.temperature}°C
Hissedilen: ${weatherData.feelsLike}°C
Durum: ${weatherData.description}
Nem: %${weatherData.humidity}
Rüzgar: ${weatherData.windSpeed} km/h
Basınç: ${weatherData.pressure} hPa`;
                log('SUCCESS', 'Weather data added');
            } else {
                context += `\n\n- ${city} için hava durumu bilgisi şu an mevcut değil.`;
            }
        } 
        // AKILLI ARAMA SİSTEMİ - Her bilmediği şey için otomatik arama
        else if (shouldPerformSearch(prompt) || true) { // Her şey için arama yap
            log('INFO', 'Intelligent search triggered for: ' + prompt);
            
            const searchResults = await performIntelligentSearch(prompt);
            
            if (searchResults) {
                log('SUCCESS', 'Search results found');
                context += `\n\n=== ARAŞTIRMA SONUÇLARI ===
${searchResults}

Bu güncel bilgileri kullanarak soruyu yanıtla. Eğer yeterli bilgi varsa detaylı açıklama yap.`;
            } else {
                log('WARN', 'No search results found');
                context += `\n\n- Bu konu hakkında güncel bilgi bulunamadı, genel bilgilerle yanıt verilecek.`;
            }
        }

        // Süper akıllı sistem promptu
        const systemPrompt = `Sen Claude seviyesinde akıllı bir AI asistansın. Löwentech şirketinin profesyonel temsilcisisin.

TEMEL PRİNSİPLER:
- ASLA "bilmiyorum" deme! Her zaman araştır ve yanıt bul
- Müşteri memnuniyeti en önemli öncelik
- Profesyonel ama samimi dil kullan
- Her soruya değer katacak yanıt ver

YANITLAMA STRATEJİSİ:
1. Eğer araştırma sonuçları varsa, onları kullanarak detaylı bilgi ver
2. Eğer sonuç yoksa, mantıklı çıkarımlar ve genel bilgilerle yardım et
3. Şirket/firma sorularında: kuruluş, alan, konum, özellikler gibi bilgileri ver
4. Her zaman en son "Size başka nasıl yardımcı olabilirim?" diye sor

ÖNEMLİ KURALLAR:
- "Yapay zeka", "AI", "bot" kelimelerini kullanma
- Çeviri veya anlam açıklaması yapma (örnek: hello=merhaba)
- Kısa ama bilgilendirici yanıtlar ver (2-4 cümle)
- Müşterinin zamanını boşa harcama

PROFESYONEL DAVRANIR:
- Her soruyu ciddiye al
- Yardımcı olmaya odaklan
- Şirket imajını koru
- Güvenilir bilgi ver`;

        const finalPrompt = {
            contents: [{
                role: 'user',
                parts: [{
                    text: `${systemPrompt}

${context}

MÜŞTERİ SORUSU: "${prompt}"

PROFESYONEL VE BİLGİLENDİRİCİ YANIT:`
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