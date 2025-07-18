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

        const requestBody = {
            input: { text: text },
            voice: { languageCode: 'tr-TR', ssmlGender: 'FEMALE', name: 'tr-TR-Standard-A' },
            audioConfig: { audioEncoding: 'MP3' },
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ message: response.statusText }));
            console.error('Google TTS API Hatası:', response.status, errorData);
            throw new Error(`Google TTS API hatası: ${errorData.message || 'Bilinmeyen Hata'}`);
        }

        const data = await response.json();
        res.status(200).json({ audioContent: data.audioContent });

    } catch (error) {
        console.error('TTS Fonksiyon İşleme Hatası:', error);
        res.status(500).json({ 
            error: `Ses sentezlenirken bir hata oluştu: ${error.message || 'Bilinmeyen Hata'}`,
            fallback: true
        });
    }
};