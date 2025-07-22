const { VertexAI } = require('@google-cloud/vertexai');
const fetch = require('node-fetch');

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
                maxOutputTokens: 1500, // Daha uzun ve detaylı cevaplar için artırıldı
                temperature: 0.95,    // Daha yaratıcı cevaplar için yükseltildi
                topP: 0.95            // Çeşitliliği artırmak için eklendi
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
            let weatherData = null;
            let weatherError = null;
            try {
                weatherData = await getWeatherData(city);
            } catch (err) {
                weatherError = err.message;
            }
            if (weatherData) {
                context += `\n\n=== GÜNCEL HAVA DURUMU ===\nŞehir: ${weatherData.city}, ${weatherData.country}\nSıcaklık: ${weatherData.temperature}°C\nHissedilen: ${weatherData.feelsLike}°C\nDurum: ${weatherData.description}\nNem: %${weatherData.humidity}\nRüzgar: ${weatherData.windSpeed} km/h\nBasınç: ${weatherData.pressure} hPa`;
                log('SUCCESS', 'Weather data added');
            } else {
                context += `\n\n- ${city} için hava durumu bilgisine şu an ulaşılamıyor. ${weatherError ? 'Hata: ' + weatherError : ''} OpenWeather API anahtarınızın geçerli ve aktif olduğundan emin olun. Lütfen sistem yöneticisine başvurun veya daha sonra tekrar deneyin.`;
                log('WARN', 'Weather data not available');
            }
        }
        // HER SORUDA AKILLI ARAMA YAP - İnternet erişimi garanti
        else {
            log('INFO', 'Performing intelligent search for all queries');
            
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

        // GELİŞMİŞ SİSTEM PROMPTU
        const systemPrompt = `Sen, Löwentech'in profesyonel, insansı ve ileri seviye yapay zeka asistanısın. Kullanıcıya doğal, samimi, akıcı ve gerektiğinde detaylı, bağlamsal ve yaratıcı yanıtlar verirsin. Bilgili, çözüm odaklı, empatik ve gerektiğinde mizah ve sıcaklık katabilen bir tavrın var. Kısa, yüzeysel cevaplardan kaçınır, gerektiğinde örnekler ve açıklamalarla desteklersin. Kullanıcıyı asla yanıtsız bırakmaz, her zaman yardımcı olmaya çalışırsın.\n\nTEMEL PRENSİPLER:\n- "Bilmiyorum" veya "emin değilim" gibi ifadelerden kaçın, her zaman yardımcı olmaya çalış.\n- Kullanıcıya değerli, anlaşılır, bağlamsal ve faydalı yanıtlar ver.\n- Müşteri memnuniyeti ve güveni önceliğin.\n- Doğal, samimi ve akıcı konuş, robotik veya soğuk olma.\n- Gerektiğinde espri veya sıcak bir dil kullanabilirsin.\n- Gereksiz uzun paragraflardan kaçın, ama gerektiğinde detay ver.\n- Hatalı veya eksik bilgi varsa, empatik ve çözüm odaklı yaklaş.\n\nKRİTİK UYARI:\n- Sadece Löwentech hakkında sorulursa Löwentech bilgisi ver.\n- Başka şirketler hakkında konuşurken Löwentech'i karıştırma.\n- Her şirketin bilgisini ayrı tut, yanlış ilişkilendirme yapma.\n\nKONUŞMA STİLİ:\n- Günlük konuşma dili kullan, resmi olma.\n- Kısa ve net cümleler tercih et, ama gerektiğinde açıklayıcı ol.\n- Samimi, dostane ve güven veren bir ton kullan.\n- Gereksiz detaya girme, ama gerektiğinde bilgi ver.\n- İnsan gibi konuş, doğal akışa dikkat et.\n\nYANITLAMA STRATEJİSİ:\n- Araştırma sonuçları veya güncel bilgiler varsa bunları kullanarak detaylı bilgi ver.\n- Başka şirketler hakkındaysa, o şirkete özgü bilgi ver.\n- Löwentech sadece Löwentech sorularında devreye girer.\n- Her yanıtın sonunda "Başka nasıl yardımcı olabilirim?" diye sor.\n- Hava durumu veya başka bir konuda teknik hata varsa, kullanıcıya empatik ve çözüm odaklı açıklama yap.\n\nYASAKLAR:\n- "Yapay zeka", "AI", "bot" kelimelerini kullanma.\n- Çeviri açıklaması yapma (ör: hello=merhaba).\n- Şirket bilgilerini karıştırma.\n- Robotic ifadeler kullanma.`;

        const finalPrompt = {
            contents: [{
                role: 'user',
                parts: [{
                    text: `${systemPrompt}\n\n${context}\n\nMÜŞTERİ SORUSU: "${prompt}"\n\nDİKKAT: Eğer soru başka bir şirket hakkındaysa, o şirkete özgü yanıt ver. Löwentech'i karıştırma!\n\nDOĞAL VE SAMIMI YANIT (1-2 cümle):`
                }]
            }]
        };

        log('INFO', 'Sending request to Vertex AI');
        
        const result = await generativeModel.generateContent(finalPrompt);
        
        if (!result.response.candidates?.[0]?.content?.parts?.[0]?.text) {
            throw new Error('Invalid response from Vertex AI');
        }
        
        const text = result.response.candidates[0].content.parts[0].text;
        // Text ve spokenText aynı olacak şekilde response'u güncelle
        log('SUCCESS', 'Response generated successfully');
        res.status(200).json({ 
            text: text,
            spokenText: text,
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