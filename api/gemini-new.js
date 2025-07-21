const { VertexAI } = require('@google-cloud/vertexai');

// Basit logging
function log(message) {
    console.log(`[${new Date().toISOString()}] ${message}`);
}

// Hava durumu (basit versiyon)
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

// Akıllı Google Search
async function smartSearch(query) {
    const API_KEY = process.env.Google_Search_API_KEY;
    const SEARCH_ENGINE_ID = process.env.SEARCH_ENGINE_ID;
    
    if (!API_KEY || !SEARCH_ENGINE_ID) return null;
    
    try {
        // Birden fazla arama yap
        const searches = [
            query,
            `${query} company`,
            `${query} firma şirket`,
            `${query} website official`
        ];
        
        let allResults = [];
        
        for (const searchTerm of searches) {
            try {
                const url = `https://www.googleapis.com/customsearch/v1?key=${API_KEY}&cx=${SEARCH_ENGINE_ID}&q=${encodeURIComponent(searchTerm)}&hl=tr-TR&num=3`;
                const response = await fetch(url);
                
                if (response.ok) {
                    const data = await response.json();
                    if (data.items) {
                        data.items.forEach(item => {
                            allResults.push(`- ${item.title}: ${item.snippet}`);
                        });
                    }
                }
                
                // Kısa bekle
                await new Promise(r => setTimeout(r, 300));
                
            } catch (err) {
                continue;
            }
        }
        
        return allResults.slice(0, 8).join('\n');
        
    } catch (error) {
        log(`Search error: ${error.message}`);
        return null;
    }
}

// Ana fonksiyon
module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Only POST allowed' });

    let tempFile = null;

    try {
        log('Request started');
        
        const { prompt } = req.body;
        if (!prompt) return res.status(400).json({ error: 'Prompt required' });

        log(`Question: ${prompt}`);

        // Service account check
        if (!process.env.GCP_SERVICE_ACCOUNT_JSON) {
            return res.status(500).json({ error: 'Service account missing' });
        }

        let account;
        try {
            account = JSON.parse(process.env.GCP_SERVICE_ACCOUNT_JSON);
        } catch (e) {
            return res.status(500).json({ error: 'JSON parse failed' });
        }

        // Fix private key
        let privateKey = account.private_key;
        if (privateKey) {
            privateKey = privateKey.replace(/\\n/g, '\n').trim();
        }

        // Create temp file
        const fs = require('fs');
        const os = require('os');
        const path = require('path');
        
        tempFile = path.join(os.tmpdir(), `creds-${Date.now()}.json`);
        
        const creds = {
            type: "service_account",
            project_id: account.project_id,
            private_key_id: account.private_key_id,
            private_key: privateKey,
            client_email: account.client_email,
            client_id: account.client_id,
            auth_uri: "https://accounts.google.com/o/oauth2/auth",
            token_uri: "https://oauth2.googleapis.com/token",
            auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
            client_x509_cert_url: account.client_x509_cert_url
        };
        
        fs.writeFileSync(tempFile, JSON.stringify(creds));
        process.env.GOOGLE_APPLICATION_CREDENTIALS = tempFile;

        log('Credentials ready');

        // Vertex AI
        const vertex = new VertexAI({
            project: account.project_id,
            location: 'us-central1'
        });
        
        const model = vertex.getGenerativeModel({ model: 'gemini-2.0-flash' });

        // Context
        const now = new Date();
        let context = `Tarih: ${now.toLocaleDateString('tr-TR')}
Saat: ${now.toLocaleTimeString('tr-TR')}
Konum: Türkiye/Almanya`;

        // Hava durumu check
        if (prompt.toLowerCase().includes('hava')) {
            const weather = await getWeather('erfurt');
            if (weather) {
                context += `\n\nHAVA DURUMU: ${weather.city} ${weather.temp}°C, ${weather.desc}`;
            }
        }
        // Akıllı arama - her şey için
        else {
            log('Searching for information...');
            const searchResults = await smartSearch(prompt);
            if (searchResults) {
                context += `\n\nARAŞTIRMA SONUÇLARI:\n${searchResults}`;
                log('Search results found');
            } else {
                log('No search results');
            }
        }

        // AI Prompt
        const aiPrompt = `Sen çok akıllı bir AI asistansın. Löwentech şirketinin profesyonel temsilcisisin.

KURALLAR:
- ASLA "bilmiyorum" deme
- Araştırma sonuçları varsa kullan
- Kısa ama bilgilendirici yanıt ver
- Müşteri odaklı düşün
- "AI" veya "yapay zeka" deme

${context}

SORU: "${prompt}"

PROFESYONEL YANIT:`;

        log('Asking AI...');
        
        const result = await model.generateContent({
            contents: [{
                role: 'user',
                parts: [{ text: aiPrompt }]
            }]
        });

        const text = result.response.candidates[0].content.parts[0].text;
        
        log('Response ready');
        res.status(200).json({ text });

    } catch (error) {
        log(`Error: ${error.message}`);
        res.status(500).json({ error: error.message });
    } finally {
        // Cleanup
        if (tempFile) {
            try {
                const fs = require('fs');
                fs.unlinkSync(tempFile);
            } catch (e) {
                // Silent fail
            }
        }
    }
};