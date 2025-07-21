const { VertexAI } = require('@google-cloud/vertexai');

// Debug logging
function log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${level}: ${message}`);
    if (data) console.log(JSON.stringify(data, null, 2));
}

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
    if (!API_KEY) {
        log('WARN', 'OpenWeather API key missing');
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
            country: data.sys.country
        };
    } catch (error) {
        log('ERROR', 'Weather API error', error.message);
        return null;
    }
}

// Google Search
async function performGoogleSearch(query) {
    const API_KEY = process.env.Google_Search_API_KEY;
    const SEARCH_ENGINE_ID = process.env.SEARCH_ENGINE_ID;
    
    if (!API_KEY || !SEARCH_ENGINE_ID) {
        log('WARN', 'Google Search API keys missing');
        return null;
    }
    
    try {
        const url = `https://www.googleapis.com/customsearch/v1?key=${API_KEY}&cx=${SEARCH_ENGINE_ID}&q=${encodeURIComponent(query)}&hl=tr-TR&num=5`;
        const response = await fetch(url);
        
        if (!response.ok) {
            log('ERROR', `Google Search failed: ${response.status}`);
            return null;
        }
        
        const data = await response.json();
        
        if (data.items && data.items.length > 0) {
            return data.items.slice(0, 3).map(item => 
                `- ${item.title}: ${item.snippet}`
            ).join('\n');
        }
        return null;
    } catch (error) {
        log('ERROR', 'Google Search error', error.message);
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
        log('ERROR', 'Private key format invalid');
        return null;
    }
    
    return fixed;
}

// Ana fonksiyon
module.exports = async (req, res) => {
    // CORS
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

        // Environment check
        if (!process.env.GCP_SERVICE_ACCOUNT_JSON) {
            log('ERROR', 'GCP_SERVICE_ACCOUNT_JSON missing');
            return res.status(500).json({ error: 'Service account JSON missing' });
        }

        // Parse service account
        let serviceAccountJson;
        try {
            serviceAccountJson = JSON.parse(process.env.GCP_SERVICE_ACCOUNT_JSON);
            log('SUCCESS', 'Service account JSON parsed', {
                client_email: serviceAccountJson.client_email,
                project_id: serviceAccountJson.project_id
            });
        } catch (parseError) {
            log('ERROR', 'JSON parse failed', parseError.message);
            return res.status(500).json({ error: 'Invalid service account JSON' });
        }

        // Fix private key
        const fixedPrivateKey = fixPrivateKey(serviceAccountJson.private_key);
        if (!fixedPrivateKey) {
            return res.status(500).json({ error: 'Private key invalid' });
        }

        // Create temp credentials file
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

        // Initialize Vertex AI
        const vertex_ai = new VertexAI({
            project: serviceAccountJson.project_id,
            location: 'us-central1'
        });
        
        const generativeModel = vertex_ai.getGenerativeModel({ 
            model: 'gemini-2.0-flash' 
        });
        
        log('SUCCESS', 'Vertex AI initialized');

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
- Dil: Türk