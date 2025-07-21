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
    if (req.method !== 'POST') return res.status(405).json({ error: 'Only POST allowed' });

    let credPath = null;

    try {
        log('🚀 Request started');
        
        const { prompt } = req.body;
        if (!prompt) return res.status(400).json({ error: 'Prompt required' });

        log('📝 Prompt: ' + prompt.substring(0, 50) + '...');

        // Service account check
        if (!process.env.GCP_SERVICE_ACCOUNT_JSON) {
            log('❌ No service account JSON');
            return res.status(500).json({ error: 'GCP_SERVICE_ACCOUNT_JSON environment variable missing' });
        }

        let account;
        try {
            account = JSON.parse(process.env.GCP_SERVICE_ACCOUNT_JSON);
            log('✅ Service account parsed successfully');
        } catch (e) {
            log('❌ JSON parse error: ' + e.message);
            return res.status(500).json({ error: 'Invalid service account JSON: ' + e.message });
        }

        // Validate required fields
        if (!account.project_id || !account.private_key || !account.client_email) {
            log('❌ Missing required fields in service account');
            return res.status(500).json({ error: 'Service account missing required fields' });
        }

        // Fix private key
        let privateKey = account.private_key;
        if (privateKey) {
            // Remove quotes if present
            privateKey = privateKey.replace(/^["'](.*)["']$/, '$1');
            // Replace \\n with actual newlines
            privateKey = privateKey.replace(/\\n/g, '\n');
            // Remove any duplicate end markers
            privateKey = privateKey.replace(/-----END PRIVATE KEY-----\s*-----END PRIVATE KEY-----/g, '-----END PRIVATE KEY-----');
            privateKey = privateKey.trim();
            
            if (!privateKey.includes('-----BEGIN PRIVATE KEY-----') || !privateKey.includes('-----END PRIVATE KEY-----')) {
                log('❌ Invalid private key format');
                return res.status(500).json({ error: 'Private key format is invalid' });
            }
        }

        log('🔑 Private key processed successfully');

        // Create temporary credentials file
        const fs = require('fs');
        const os = require('os');
        const path = require('path');
        
        credPath = path.join(os.tmpdir(), `gemini-creds-${Date.now()}.json`);
        const credData = {
            type: account.type || "service_account",
            project_id: account.project_id,
            private_key_id: account.private_key_id,
            private_key: privateKey,
            client_email: account.client_email,
            client_id: account.client_id,
            auth_uri: account.auth_uri || "https://accounts.google.com/o/oauth2/auth",
            token_uri: account.token_uri || "https://oauth2.googleapis.com/token",
            auth_provider_x509_cert_url: account.auth_provider_x509_cert_url || "https://www.googleapis.com/oauth2/v1/certs",
            client_x509_cert_url: account.client_x509_cert_url
        };
        
        fs.writeFileSync(credPath, JSON.stringify(credData, null, 2));
        process.env.GOOGLE_APPLICATION_CREDENTIALS = credPath;
        
        log('📁 Credentials file created at: ' + credPath);

        // Initialize Vertex AI
        const vertex = new VertexAI({
            project: account.project_id,
            location: 'us-central1'
        });
        
        const model = vertex.getGenerativeModel({ 
            model: 'gemini-2.0-flash',
            generationConfig: {
                maxOutputTokens: 1000,
                temperature: 0.7,
            }
        });
        
        log('🤖 Vertex AI initialized successfully');

        // Prepare context
        const now = new Date();
        const dateStr = now.toLocaleDateString('tr-TR', {
            weekday: 'long',
            year: 'numeric', 
            month: 'long',
            day: 'numeric',
            timeZone: 'Europe/Istanbul'
        });
        const timeStr = now.toLocaleTimeString('tr-TR', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'Europe/Istanbul'
        });

        let context = `SISTEM BİLGİLERİ:
- Tarih: ${dateStr}
- Saat: ${timeStr} (Türkiye saati)
- Konum: Türkiye
- Dil: Türkçe`;

        // Weather detection
        const promptLower = prompt.toLowerCase();
        if (promptLower.includes('hava') || promptLower.includes('sıcaklık') || promptLower.includes('derece')) {
            log('🌤️ Weather query detected');
            
            // Detect city
            const cities = ['istanbul', 'ankara', 'izmir', 'erfurt', 'berlin', 'münchen', 'hamburg', 'paris', 'london'];
            let detectedCity = 'erfurt'; // default
            
            for (const city of cities) {
                if (promptLower.includes(city)) {
                    detectedCity = city;
                    break;
                }
            }
            
            log('🏙️ Detected city: ' + detectedCity);
            
            const weather = await getWeather(detectedCity);
            if (weather) {
                context += `\n\n=== GÜNCEL HAVA DURUMU ===
Şehir: ${weather.city}
Sıcaklık: ${weather.temp}°C
Durum: ${weather.desc}
Kaynak: OpenWeather API`;
                log('✅ Weather data added to context');
            } else {
                context += `\n\n- ${detectedCity} için hava durumu bilgisi şu anda mevcut değil.`;
                log('⚠️ Weather data not available');
            }
        }

        // System prompt
        const systemPrompt = `Sen Löwentech AI Assistant'sın. Kurallar:
- Türkçe konuş, doğal ve samimi ol
- Kısa ve net yanıtlar ver
- Mevcut sistem bilgilerini kullan
- Hava durumu sorularında sıcaklık ve durumu belirt
- "Yapay zeka" veya "AI" kelimelerini kullanma`;

        // Generate response
        const fullPrompt = `${systemPrompt}

${context}

KULLANICI SORUSU: "${prompt}"

YANIT:`;

        log('🚀 Sending request to Vertex AI');
        
        const result = await model.generateContent({
            contents: [{
                role: 'user',
                parts: [{ text: fullPrompt }]
            }]
        });

        if (!result.response.candidates?.[0]?.content?.parts?.[0]?.text) {
            log('❌ No valid response from Vertex AI');
            throw new Error('Vertex AI\'dan geçerli yanıt alınamadı');
        }
        
        const responseText = result.response.candidates[0].content.parts[0].text;
        
        log('✅ Response generated successfully');
        log('📝 Response length: ' + responseText.length + ' characters');
        
        res.status(200).json({ 
            text: responseText,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        log('❌ Error occurred: ' + error.message);
        log('🔍 Error stack: ' + error.stack);
        
        res.status(500).json({ 
            error: 'Sunucu hatası: ' + error.message,
            timestamp: new Date().toISOString()
        });
    } finally {
        // Cleanup credentials file
        if (credPath) {
            try {
                const fs = require('fs');
                fs.unlinkSync(credPath);
                log('🗑️ Credentials file cleaned up');
            } catch (cleanupError) {
                log('⚠️ Cleanup failed: ' + cleanupError.message);
            }
        }
    }
};