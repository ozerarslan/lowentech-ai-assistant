const { VertexAI } = require('@google-cloud/vertexai');

function log(msg) {
    console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function getWeather(city) {
    const key = process.env.OPENWEATHER_API_KEY;
    if (!key) return null;
    
    try {
        const url = `https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${key}&units=metric&lang=tr`;
        const res = await fetch(url);
        if (!res.ok) return null;
        
        const data = await res.json();
        return {
            temp: Math.round(data.main.temp),
            desc: data.weather[0].description,
            city: data.name
        };
    } catch (e) {
        return null;
    }
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Only POST' });

    try {
        log('🚀 Request started');
        
        const { prompt } = req.body;
        if (!prompt) return res.status(400).json({ error: 'Prompt required' });

        log('📝 Prompt: ' + prompt.substring(0, 50));

        // Service account check
        if (!process.env.GCP_SERVICE_ACCOUNT_JSON) {
            log('❌ No service account');
            return res.status(500).json({ error: 'No service account' });
        }

        let account;
        try {
            account = JSON.parse(process.env.GCP_SERVICE_ACCOUNT_JSON);
            log('✅ Service account parsed');
        } catch (e) {
            log('❌ Parse error: ' + e.message);
            return res.status(500).json({ error: 'Parse error' });
        }

        // Fix private key
        let key = account.private_key;
        if (key) {
            key = key.replace(/\\n/g, '\n').trim();
            if (!key.includes('BEGIN PRIVATE KEY') || !key.includes('END PRIVATE KEY')) {
                log('❌ Invalid private key');
                return res.status(500).json({ error: 'Invalid private key' });
            }
        }

        log('🔑 Private key OK');

        // Create credentials
        const fs = require('fs');
        const os = require('os');
        const path = require('path');
        
        const credPath = path.join(os.tmpdir(), `cred-${Date.now()}.json`);
        const credData = { ...account, private_key: key };
        
        fs.writeFileSync(credPath, JSON.stringify(credData));
        process.env.GOOGLE_APPLICATION_CREDENTIALS = credPath;
        
        log('📁 Credentials created');

        // Vertex AI
        const vertex = new VertexAI({
            project: account.project_id,
            location: 'us-central1'
        });
        
        const model = vertex.getGenerativeModel({ model: 'gemini-2.0-flash' });
        
        log('🤖 Vertex AI ready');

        // Context
        const now = new Date();
        let context = `Tarih: ${now.toLocaleDateString('tr-TR')}
Saat: ${now.toLocaleTimeString('tr-TR')}`;

        // Weather check
        if (prompt.toLowerCase().includes('hava')) {
            log('🌤️ Weather query');
            const weather = await getWeather('erfurt');
            if (weather) {
                context += `\nHAVA DURUMU: ${weather.city} ${weather.temp}°C, ${weather.desc}`;
                log('✅ Weather added');
            }
        }

        // Generate
        const result = await model.generateContent({
            contents: [{
                role: 'user',
                parts: [{ text: `${context}\n\nSoru: ${prompt}\n\nKısa yanıt ver:` }]
            }]
        });

        const text = result.response.candidates[0].content.parts[0].text;
        
        log('✅ Response ready');
        
        // Cleanup
        try {
            fs.unlinkSync(credPath);
            log('🗑️ Cleaned up');
        } catch (e) {
            log('⚠️ Cleanup failed');
        }
        
        res.status(200).json({ text });

    } catch (error) {
        log('❌ Error: ' + error.message);
        res.status(500).json({ error: error.message });
    }
};