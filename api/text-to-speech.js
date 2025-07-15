module.exports = async (req, res) => {
    // Sadece POST isteklerini kabul et
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { text } = req.body;
        // Metin sağlanıp sağlanmadığını kontrol et
        if (!text) {
            return res.status(400).json({ error: 'Text is required' });
        }

        // Ortam değişkenlerinden API anahtarını al
        // GOOGLE_TTS_API_KEY veya GOOGLE_API_KEY ortam değişkeniniz Vercel'de ayarlı olmalı!
        const API_KEY = process.env.GOOGLE_TTS_API_KEY || process.env.GOOGLE_API_KEY;

        // API anahtarı yoksa hata döndür
        if (!API_KEY) {
            console.error('API KEY missing for Google TTS.');
            return res.status(500).json({ error: 'Server configuration error: API key missing.' });
        }

        // Google Text-to-Speech API URL'si
        const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${API_KEY}`;

        // İstek gövdesini oluştur
        const requestBody = {
            input: { text: text },
            voice: { languageCode: 'tr-TR', ssmlGender: 'FEMALE', name: 'tr-TR-Standard-A' }, // Türkçe kadın sesi
            audioConfig: { audioEncoding: 'MP3' },
        };

        // Google TTS API'ye istek gönder
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        // Yanıtın başarılı olup olmadığını kontrol et
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ message: response.statusText })); // JSON parse hatasını yakala
            console.error('Google TTS API Hatası:', response.status, errorData);
            // Daha detaylı bir hata mesajı döndür
            throw new Error(`Google TTS API hatası: ${errorData.message || 'Bilinmeyen Hata'}`);
        }

        const data = await response.json();
        
        // Başarılı yanıtı döndür
        res.status(200).json({ audioContent: data.audioContent });

    } catch (error) {
        // Hataları logla ve genel bir sunucu hatası döndür
        console.error('TTS Fonksiyon İşleme Hatası:', error);
        res.status(500).json({ error: `Ses sentezlenirken bir hata oluştu: ${error.message || 'Bilinmeyen Hata'}` });
    }
};
