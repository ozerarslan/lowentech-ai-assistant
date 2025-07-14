import { TextToSpeechClient } from '@google-cloud/text-to-speech';

// Google kimlik bilgilerini ortam değişkeninden al
const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
const client = new TextToSpeechClient({ credentials });

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { text } = req.body;
        if (!text) {
            return res.status(400).json({ error: 'Text is required' });
        }

        const request = {
            input: { text: text },
            voice: { languageCode: 'tr-TR', ssmlGender: 'FEMALE', name: 'tr-TR-Standard-A' },
            audioConfig: { audioEncoding: 'MP3' },
        };

        const [response] = await client.synthesizeSpeech(request);
        
        // Cevabı Vercel formatında gönder
        res.status(200).json({ audioContent: response.audioContent.toString('base64') });

    } catch (error) {
        console.error('TTS Error:', error);
        res.status(500).json({ error: 'Failed to synthesize speech.' });
    }
}
