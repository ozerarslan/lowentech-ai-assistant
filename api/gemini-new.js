const { VertexAI } = require('@google-cloud/vertexai');

function log(level, message) {
    console.log(`[${new Date().toISOString()}] ${level}: ${message}`);
}

// Şehir normalizasyonu
function normalizeCity(city) {
    const cityMap = {
        'erfurt': 'Erfurt,DE',
        'istanbul': 'Istanbul,TR',
        'ankara': 'Ankara,TR',
        'izmir': 'Izmir,TR',
        'berlin': 'Berlin,DE',
        'münchen': 'Munich,DE',
        'hamburg': 'Hamburg,DE'
    };
    return cityMap[city.toLowerCase()] || city;
}

// Hava durumu API
async function getWeatherData(city) {
    const API_KEY = process.env.OPENWEATHER_API_KEY;
    if (!API_KEY) {
        log('WARN', 'OpenWeather API key missing');
        return null;
    }
    
    try {
        const normalizedCity = normalizeCity(city);
        const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(normalizedCity)}&appid=${API_KEY}&units=metric&lang=tr`;
        
        const response = await fetch(url);
        if (!response.ok) return null;
        
        const data = await response.json();
        
        return {
            temperature: Math.round(data.main.temp),
            feelsLike: Math.round(data.main.feels_like),
            humidity: data.main.humidity,
            description: data.weather[0].description,
            windSpeed: Math.round((data.wind?.speed || 0) * 3.6),
            pressure: data.main.pressure,
            city: data.name,
            country: data.sys.country
        };
    } catch (error) {
        log('ERROR', `Weather API error: ${error.message}`);
        return null;
    }
}

// SÜPER AKILLI ÇOKLU ARAMA SİSTEMİ
async function performIntelligentSearch(query) {
    const API_KEY = process.env.Google_Search_API_KEY;
    const SEARCH_ENGINE_ID = process.env.SEARCH_ENGINE_ID;
    
    if (!API_KEY || !SEARCH_ENGINE_ID) {
        log('WARN', 'Google Search API keys missing');
        return null;
    }
    
    try {
        // 5 farklı arama stratejisi
        const searchQueries = [
            query, // Orijinal sorgu
            `${query} company information`, // Şirket bilgisi
            `${query} Germany firma`, // Almanya firması
            `"${query}" official website`, // Resmi site
            `${query} about nedir kimdir hakkında` // Hakkında bilgi
        ];
        
        let allResults = [];
        
        for (let i = 0; i < searchQueries.length; i++) {
            try {
                const searchQuery = searchQueries[i];
                const url = `https://www.googleapis.com/customsearch/v1?key=${API_KEY}&cx=${SEARCH_ENGINE_ID}&q=${encodeURIComponent(searchQuery)}&hl=tr-TR&num=3`;
                
                const response = await fetch(url);
                
                if (response.ok) {
                    const data = await response.json();
                    if (data.items && data.items.length > 0) {
                        data.items.forEach(item => {
                            allResults.push(`- ${item.title}: ${item.snippet}`);
                        });
                    }
                }
                
                // Rate limiting - 300ms bekle
                await new Promise(resolve => setTimeout(resolve, 300));
                
            } catch (searchError) {
                log('WARN', `Search ${i} failed: ${searchError.message}`);
                continue;
            }
        }
        
        if (allResults.length > 0) {
            // En iyi 8 sonucu döndür
            return allResults.slice(0, 8).join('\n');
        }
        
        return null;
        
    } catch (error) {
        log('ERROR', `Intelligent search error: ${error.message}`);
        return null;
    }
}

// Arama gereksinimi kontrolü
function shouldPerformSearch(prompt) {
    const promptLower = prompt.toLowerCase();
    
    // Arama gerektiren durumlar
    const searchTriggers = [
        /\b(kimdir|nedir|ne zaman|nerede|nasıl|hangi|firm|şirket|company)\b/,
        /\b(hakkında|bilgi|araştır|anlat|açıkla)\b/,
        /\b(güncel|son|yeni|bugün|2024|2025)\b/,
        /\b[A-Z][a-z]{3,}\b/, // Büyük harfle başlayan kelimeler (marka/şirket adları)
    ];
    
    return searchTriggers.some(pattern => pattern.test(prompt));
}

// Private key düzeltme
function fixPrivateKey(privateKey) {
    if (!privateKey) return null;
    
    let fixed = privateKey
        .replace(/^["'](.*)["']$/, '$1')
        .replace(/\\n/g, '\n')
        .trim();
    
    if (!fixed.includes('-----BEGIN PRIVATE KEY-----') || 
        !fixed.includes('-----END PRIVATE KEY-----')) {
        log('ERROR', 'Private key format invalid');
        return null;
    }
    
    return fixed;
}

// Ana Vercel Fonksiyonu
module.exports = async (req, res) => {
    // CORS headers
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
            return res.status(500).json({ error: 'Service account JSON missing' });
        }

        // Service Account JSON parse
        let serviceAccountJson;
        try {
            serviceAccountJson = JSON.parse(process.env.GCP_SERVICE_ACCOUNT_JSON);
            log('SUCCESS', 'Service account JSON parsed');
        } catch (parseError) {
            log('ERROR', `JSON parse failed: ${parseError.message}`);
            return res.status(500).json({ error: 'Invalid service account JSON' });
        }

        // Private key düzeltme
        const fixedPrivateKey = fixPrivateKey(serviceAccountJson.private_key);
        if (!fixedPrivateKey) {
            return res.status(500).json({ error: 'Private key invalid' });
        }

        // Geçici credentials dosyası oluştur
        const fs = require('fs');
        const path = require('path');
        const os = require('os');
        
        credentialsPath = path.join(os.tmpdir(), `credentials-${Date.now()}.json`);
        
        const credentialsData = {
            ...serviceAccountJson,
            private_key: fixedPrivateKey
        };
        
        fs.writeFileSync(credentialsPath, JSON.stringify(credentialsData, null, 2));
        process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialsPath;
        
        log('SUCCESS', 'Credentials file created');

        // Vertex AI başlatma
        const vertex_ai = new VertexAI({
            project: serviceAccountJson.project_id,
            location: 'us-central1'
        });
        
        const generativeModel = vertex_ai.getGenerativeModel({ 
            model: 'gemini-2.0-flash',
            generationConfig: {
                maxOutputTokens: 1000,
                temperature: 0.7
            }
        });
        
        log('SUCCESS', 'Vertex AI initialized');

        // Context hazırlama
        const today = new Date();
        const formattedDate = today.toLocaleDateString('tr-TR', { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric', 
            timeZone: 'Europe/Istanbul' 
        });
        const formattedTime = today.toLocaleTimeString('tr-TR', { 
            hour: '2-digit', 
            minute: '2-digit', 
            timeZone: 'Europe/Istanbul' 
        });
        
        let context = `SISTEM BİLGİLERİ:
- Tarih: ${formattedDate}
- Saat: ${formattedTime}
- Konum: Türkiye/Almanya
- Dil: Türkçe
- Asistan: Löwentech AI v3.0 (Süper Akıllı)`;

        const promptLower = prompt.toLowerCase();
        
        // Hava durumu kontrolü
        const isWeatherQuery = /\b(hava durumu|hava|sıcaklık|derece|yağmur|kar|güneş|bulut|rüzgar)\b/.test(promptLower);
        
        if (isWeatherQuery) {
            log('INFO', 'Weather query detected');
            
            const cityPattern = /\b(istanbul|ankara|izmir|erfurt|berlin|münchen|hamburg)\b/i;
            const cityMatch = promptLower.match(cityPattern);
            const city = cityMatch ? cityMatch[0] : 'erfurt';
            
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
                log('WARN', 'Weather data not available');
            }
        }
        // SÜPER AKILLI ARAMA SİSTEMİ
        else if (shouldPerformSearch(prompt)) {
            log('INFO', 'Intelligent search triggered for query');
            
            const searchResults = await performIntelligentSearch(prompt);
            
            if (searchResults) {
                context += `\n\n=== ARAŞTIRMA SONUÇLARI ===
${searchResults}

Bu güncel bilgileri kullanarak soruyu detaylı şekilde yanıtla.`;
                log('SUCCESS', 'Search results added to context');
            } else {
                context += `\n\n- Bu konu hakkında araştırma sonucu bulunamadı, genel bilgilerle yardım edilecek.`;
                log('WARN', 'No search results found');
            }
        }

        // SÜPER AKILLI SYSTEM PROMPT
        const systemPrompt = `Sen Claude seviyesinde akıllı bir AI asistansın. Löwentech şirketinin profesyonel temsilcisisin.

TEMEL PRİNSİPLER:
- ASLA "bilmiyorum", "bilgim yok", "emin değilim", "bilgi sahibi değilim" deme!
- Her soruya değerli ve faydalı yanıt ver
- Müşteri memnuniyeti en önemli öncelik
- Profesyonel ama samimi ve doğal dil kullan

YANITLAMA STRATEJİSİ:
- Araştırma sonuçları varsa onları kullanarak detaylı bilgi ver
- Sonuç yoksa mantıklı çıkarımlar ve genel bilgilerle yardım et
- Şirket/firma sorularında: ne yaptıkları, nerede oldukları, hangi alanda çalıştıkları
- Her yanıtın sonunda "Başka nasıl yardımcı olabilirim?" sor

MUTLAK YASAKLAR:
- "Yapay zeka", "AI", "bot" kelimelerini kullanma
- Çeviri açıklaması yapma (örnek: hello=merhaba)
- Kısa ama bilgilendirici ol (2-4 cümle ideal)
- Müşterinin zamanını boşa harcama

PROFESYONEL DAVRANIR:
- Her soruyu ciddiye al ve önemsendiğini hissettir
- Yardımcı olmaya odaklan
- Şirket imajını koru
- Güvenilir bilgi ver`;

        const finalPrompt = {
            contents: [{
                role: 'user',
                parts: [{
                    text: `${systemPrompt}\n\n${context}\n\nMÜŞTERİ SORUSU: "${prompt}"\n\nPROFESYONEL VE BİLGİLENDİRİCİ YANIT:`
                }]
            }]
        };

        log('INFO', 'Sending request to Vertex AI');
        
        const result = await generativeModel.generateContent(finalPrompt);
        
        if (!result.response.candidates?.[0]?.content?.parts?.[0]?.text) {
            throw new Error('Invalid response from Vertex AI');
        }
        
        const text = result.response.candidates[0].content.parts[0].text;
        
        log('SUCCESS', 'Response generated successfully');
        
        res.status(200).json({ 
            text: text,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        log('ERROR', `Main function error: ${error.message}`);
        
        res.status(500).json({ 
            error: `Server error: ${error.message}`,
            timestamp: new Date().toISOString()
        });
    } finally {
        // Cleanup
        if (credentialsPath) {
            try {
                const fs = require('fs');
                fs.unlinkSync(credentialsPath);
                log('INFO', 'Temp file cleaned up');
            } catch (err) {
                log('WARN', `Cleanup failed: ${err.message}`);
            }
        }
    }
};