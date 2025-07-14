// Dosya Yolu: netlify/functions/text-to-speech.js

// Node-fetch'i en üstte import etmek yerine, fonksiyon içinde çağıracağız.
// Bu, "is not a function" hatasını çözer.

exports.handler = async function(event) {
    // Sadece POST isteklerini kabul et
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    // Google TTS API anahtarını güvenli bir şekilde ortam değişkeninden al
    const GOOGLE_TTS_API_KEY = process.env.GOOGLE_TTS_API_KEY;
    if (!GOOGLE_TTS_API_KEY) {
        return { statusCode: 500, body: JSON.stringify({ error: 'TTS API key is not configured.' }) };
    }

    try {
        const { text } = JSON.parse(event.body);
        if (!text) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Text is required.' }) };
        }

        const TTS_API_URL = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${GOOGLE_TTS_API_KEY}`;
        
        // Node-fetch kütüphanesini burada dinamik olarak yüklüyoruz.
        const fetch = (await import('node-fetch')).default;

        const apiResponse = await fetch(TTS_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                input: { text: text },
                voice: { languageCode: 'tr-TR', name: 'tr-TR-Standard-A' },
                audioConfig: { audioEncoding: 'MP3' }
            })
        });

        if (!apiResponse.ok) {
            const errorText = await apiResponse.text();
            // Hata detayını daha iyi görmek için loglayalım
            console.error("Google TTS API Error:", errorText);
            throw new Error(`Google TTS API returned status ${apiResponse.status}`);
        }

        const data = await apiResponse.json();
        
        // Başarılı olursa, ses verisini frontend'e geri gönder
        return {
            statusCode: 200,
            body: JSON.stringify({ audioContent: data.audioContent })
        };

    } catch (error) {
        console.error('TTS Function Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};
