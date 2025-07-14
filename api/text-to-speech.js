const fetch = require('node-fetch');

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { text } = req.body;
        if (!text) {
            return res.status(400).json({ error: 'Text is required' });
        }

        const API_KEY = process.env.GOOGLE_TTS_API_KEY || process.env.GOOGLE_API_KEY;
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
            const errorData = await response.json();
            console.error('Google TTS API Error:', errorData);
            throw new Error('Failed to synthesize speech.');
        }

        const data = await response.json();
        
        res.status(200).json({ audioContent: data.audioContent });

    } catch (error) {
        console.error('TTS Handler Error:', error);
        res.status(500).json({ error: 'Failed to synthesize speech.' });
    }
};
