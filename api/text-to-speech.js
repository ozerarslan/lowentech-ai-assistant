module.exports = async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    try {
        const { text } = req.body;
        if (!text) return res.status(400).json({ error: 'Text is required' });

        console.log(`🔊 TTS request for: ${text.substring(0, 50)}...`);

        const API_KEY = process.env.GOOGLE_TTS_API_KEY || process.env.GOOGLE_API_KEY;
        if (!API_KEY) {
            console.error('❌ API KEY missing for Google TTS');
            return res.status(500).json({ error: 'Server configuration error: API key missing' });
        }

        const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${API_KEY}`;

        // Geliştirilmiş ses ayarları - Daha doğal kadın sesi
        const requestBody = {
            input: { text: text },
            voice: { 
                languageCode: 'tr-TR', 
                ssmlGender: 'FEMALE',
                name: 'tr-TR-Wavenet-A' // Premium Neural ses - daha doğal
            },
            audioConfig: { 
                audioEncoding: 'MP3',
                speakingRate: 0.95,  // Biraz daha yavaş ve doğal
                pitch: -1.5,         // Biraz daha derin ton
                volumeGainDb: 0.0,   // Normal ses seviyesi
                effectsProfileId: ['telephony-class-application'] // Telefon kalitesi
            },
        };

        console.log('🎵 Trying Wavenet-A voice...');

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            console.log('⚠️ Wavenet-A failed, trying Standard voice...');
            
            // Fallback to standard voice
            requestBody.voice.name = 'tr-TR-Standard-A';
            requestBody.audioConfig.speakingRate = 0.9; // Standard için biraz daha yavaş
            requestBody.audioConfig.pitch = -1.0; // Standard için daha az derin
            delete requestBody.audioConfig.effectsProfileId; // Standard'da effects yok
            
            const fallbackResponse = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });
            
            if (!fallbackResponse.ok) {
                const errorData = await fallbackResponse.json().catch(() => ({ 
                    message: fallbackResponse.statusText 
                }));
                console.error('❌ Google TTS API Error:', fallbackResponse.status, errorData);
                throw new Error(`Google TTS API Error: ${errorData.message || 'Unknown Error'}`);
            }
            
            const fallbackData = await fallbackResponse.json();
            console.log('✅ TTS Standard-A voice successful');
            
            res.status(200).json({ 
                audioContent: fallbackData.audioContent,
                voiceUsed: 'tr-TR-Standard-A'
            });
            return;
        }

        const data = await response.json();
        console.log('✅ TTS Wavenet-A voice successful');
        
        res.status(200).json({ 
            audioContent: data.audioContent,
            voiceUsed: 'tr-TR-Wavenet-A'
        });

    } catch (error) {
        console.error('❌ TTS Function Error:', error);
        console.error('📚 Error Stack:', error.stack);
        
        res.status(500).json({ 
            error: `Text-to-Speech error: ${error.message || 'Unknown Error'}`,
            fallback: true,
            timestamp: new Date().toISOString()
        });
    }
};