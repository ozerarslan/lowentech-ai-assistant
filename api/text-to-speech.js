module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    try {
        const { text } = req.body;
        if (!text) return res.status(400).json({ error: 'Text is required' });

        const API_KEY = process.env.GOOGLE_TTS_API_KEY || process.env.GOOGLE_API_KEY;
        if (!API_KEY) {
            console.error('API KEY missing for Google TTS.');
            return res.status(500).json({ error: 'Server configuration error: API key missing.' });
        }

        const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${API_KEY}`;

        // Geliştirilmiş ses ayarları - Daha doğal kadın sesi
        const requestBody = {
            input: { text: text },
            voice: { 
                languageCode: 'tr-TR', 
                ssmlGender: 'FEMALE',
                name: 'tr-TR-Wavenet-A' // Daha doğal Neural ses
            },
            audioConfig: { 
                audioEncoding: 'MP3',
                speakingRate: 0.95,  // Biraz daha yavaş ve doğal
                pitch: -2.0,         // Biraz daha derin ton
                volumeGainDb: 0.0    // Normal ses seviyesi
            },
        };

        console.log('🔊 TTS request for:', text.substring(0, 50) + '...');

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            console.log('⚠️ Wavenet failed, trying Standard voice...');
            // Fallback to standard voice
            requestBody.voice.name = 'tr-TR-Standard-A';
            const fallbackResponse = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });
            
            if (!fallbackResponse.ok) {
                const errorData = await fallbackResponse.json().catch(() => ({ message: fallbackResponse.statusText }));
                console.error('Google TTS API Hatası:', fallbackResponse.status, errorData);
                throw new Error(`Google TTS API hatası: ${errorData.message || 'Bilinmeyen Hata'}`);
            }
            
            const fallbackData = await fallbackResponse.json();
            console.log('✅ TTS Standard voice successful');
            res.status(200).json({ audioContent: fallbackData.audioContent });
            return;
        }

        const data = await response.json();
        console.log('✅ TTS Wavenet voice successful');
        res.status(200).json({ audioContent: data.audioContent });

    } catch (error) {
        console.error('TTS Fonksiyon İşleme Hatası:', error);
        res.status(500).json({ 
            error: `Ses sentezlenirken bir hata oluştu: ${error.message || 'Bilinmeyen Hata'}`,
            fallback: true
        });
    }
};