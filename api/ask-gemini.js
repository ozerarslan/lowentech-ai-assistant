module.exports = async (req, res) => {
    console.log("--- TEST KODU ÇALIŞIYOR ---");

    // Vercel'e eklediğimiz basit test değişkenini okumayı dene
    const testVar = process.env.TEST_VARIABLE;

    // Okunan değeri loglara yazdır
    console.log(`TEST_VARIABLE Değeri: ${testVar}`);

    if (testVar) {
        // Eğer değişken okunabildiyse, başarılı bir cevap döndür
        res.status(200).json({ 
            message: `Değişken başarıyla okundu. Değeri: ${testVar}` 
        });
    } else {
        // Eğer değişken okunamadıysa, hata döndür
        res.status(500).json({ 
            error: "TEST_VARIABLE ortam değişkeni okunamadı veya boş." 
        });
    }
};