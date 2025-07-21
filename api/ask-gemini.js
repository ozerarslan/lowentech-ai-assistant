const { VertexAI } = require('@google-cloud/vertexai');

// Şehir normalizasyonu
function normalizeCity(city) {
    const cityMap = {
        'erfurt': 'Erfurt,DE',
        'istanbul': 'Istanbul,TR',
        'ankara': 'Ankara,TR',
        'izmir': 'Izmir,TR',
        'berlin': 'Berlin,DE'
    };
    return cityMap[city.toLowerCase()] || city;
}

// Hava durumu API
async function getWeatherData(city) {
    const API_KEY = process.env.OPENWEATHER_API_KEY;
    if (!API_KEY) return null;
    
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
        console.error('Weather error:', error);
        return null;
    }
}

// Google Search
async function performGoogleSearch(query) {
    const API_KEY = process.env.Google_Search_API_KEY;
    const SEARCH_ENGINE_ID = process.env.SEARCH_ENGINE_ID;
    
    if (!API_KEY || !SEARCH_ENGINE_ID) return null;
    
    try {
        const url = `https://www.googleapis.com/customsearch/v1?key=${API_KEY}&cx=${SEARCH_ENGINE_ID}&q=${encodeURIComponent(query)}&hl=tr-TR&num=5`;
        const response = await fetch(url);
        
        if (!response.ok) return null;
        
        const data = await response.json();
        
        if (data.items && data.items.length > 0) {
            return data.items.slice(0, 3).map(item => 
                `- ${item.title}: ${item.snippet}`
            ).join('\n');
        }
        return null;
    } catch (error) {
        console.error('Search error:', error);
        return null;
    }
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
        return null;
    }
    
    return fixed;
}

// Ana fonksiyon
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
        console.log('🚀 API request started');
        
        const { prompt } = req.body;
        if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required.' });
        }

        console.log('📝 Prompt received');

        // Environment check
        if (!process.env.GCP_SERVICE_ACCOUNT_JSON) {
            console.error('❌ GCP_SERVICE_ACCOUNT_JSON missing');
            return res.status(500).json({ error: 'Service account JSON missing' });
        }

        // Parse service account
        let serviceAccountJson;
        try {
            serviceAccountJson = JSON.parse(process.env.GCP_SERVICE_ACCOUNT_JSON);
            console.log('✅ Service account parsed');
        } catch (parseError) {
            console.error('❌ JSON parse failed:', parseError);
            return res.status(500).json({ error: 'Invalid service account JSON' });
        }

        // Fix private key
        const fixedPrivateKey = fixPrivateKey(serviceAccountJson.private_key);
        if (!fixedPrivateKey) {
            console.error('❌ Private key invalid');
            return res.status(500).json({ error: 'Private key invalid' });
        }

        console.log('🔑 Private key fixed');

        // Create temp credentials file
        const fs = require('fs');
        const path = require('path');
        const os = require('os');
        
        credentialsPath = path.join(os.tmpdir(), `creds-${Date.now()}.json`);
        
        const credentialsData = {
            ...serviceAccountJson,
            private_key: fixedPrivateKey
        };
        
        fs.writeFileSync(credentialsPath, JSON.stringify(credentialsData, null, 2));
        process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialsPath;
        
        console.log('📁 Credentials file created');

        // Initialize Vertex AI
        const vertex_ai = new VertexAI({
            project: serviceAccountJson.project_id,
            location: 'us-central1'
        });
        
        const generativeModel = vertex_ai.getGenerativeModel({ 
            model: 'gemini-2.0-flash' 
        });
        
        console.log('🤖 Vertex AI initialized');

        // Prepare context
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
- Konum: Türkiye
- Dil: Türkçe`;

        // Weather detection
        const promptLower = prompt.toLowerCase();
        const isWeatherQuery = /\b(hava durumu|hava|sıcaklık|derece)\b/.test(promptLower);
        
        if (isWeatherQuery) {
            console.log('🌤️ Weather query detected');
            
            const cityPattern = /\b(istanbul|ankara|izmir|erfurt|berlin)\b/i;
            const cityMatch = promptLower.match(cityPattern);
            const city = cityMatch ? cityMatch[0] : 'erfurt';
            
            console.log('🏙️ City:', city);
            
            const weatherData = await getWeatherData(city);
            
            if (weatherData) {
                context += `\n\n=== HAVA DURUMU ===
Şehir: ${weatherData.city}
Sıcaklık: ${weatherData.temperature}°C
Hissedilen: ${weatherData.feelsLike}°C
Durum: ${weatherData.description}
Nem: %${weatherData.humidity}
Rüzgar: ${weatherData.windSpeed} km/h`;
                console.log('✅ Weather data added');
            } else {
                console.log('⚠️ Weather data not available');
                context += `\n\n- ${city} için hava durumu bilgisi mevcut değil.`;
            }
        }

        // System prompt
        const systemPrompt = `Sen yardımcı bir asistansın. Kurallaran:
- Doğal ve samimi konuş
- Kısa ve net yanıtlar ver
- Mevcut bilgileri kullan`;

        const finalPrompt = {
            contents: [{
                role: 'user',
                parts: [{
                    text: `${systemPrompt}\n\n${context}\n\nSORU: "${prompt}"\n\nYanıt:`
                }]
            }]
        };

        console.log('🚀 Sending to Vertex AI');
        
        const result = await generativeModel.generateContent(finalPrompt);
        
        if (!result.response.candidates?.[0]?.content?.parts?.[0]?.text) {
            throw new Error('Invalid response from Vertex AI');
        }
        
        const text = result.response.candidates[0].content.parts[0].text;
        
        console.log('✅ Response generated');
        res.status(200).json({ text });

    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error('Stack:', error.stack);
        
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
                console.log('🗑️ Cleanup done');
            } catch (err) {
                console.warn('⚠️ Cleanup failed:', err.message);
            }
        }
    }
};