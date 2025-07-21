// En basit test endpoint'i - api/test.js
module.exports = async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    // OPTIONS request için
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    try {
        console.log('✅ TEST ENDPOINT ÇALIŞTI');
        console.log('📝 Method:', req.method);
        console.log('📦 Headers:', req.headers);
        console.log('🔍 Body:', req.body);
        console.log('🌐 URL:', req.url);
        console.log('⏰ Timestamp:', new Date().toISOString());
        
        // Environment variables kontrol
        const envVars = {
            GCP_SERVICE_ACCOUNT_JSON: !!process.env.GCP_SERVICE_ACCOUNT_JSON,
            OPENWEATHER_API_KEY: !!process.env.OPENWEATHER_API_KEY,
            Google_Search_API_KEY: !!process.env.Google_Search_API_KEY,
            SEARCH_ENGINE_ID: !!process.env.SEARCH_ENGINE_ID
        };
        
        console.log('🔧 Environment Variables:', envVars);
        
        if (req.method === 'POST') {
            const { prompt } = req.body || {};
            
            console.log('📝 Received prompt:', prompt);
            
            // Basit yanıt döndür
            res.status(200).json({
                success: true,
                message: 'Test endpoint working perfectly!',
                data: {
                    receivedPrompt: prompt,
                    timestamp: new Date().toISOString(),
                    method: req.method,
                    environmentVariables: envVars,
                    nodeVersion: process.version,
                    platform: process.platform
                }
            });
        } else if (req.method === 'GET') {
            // GET request için
            res.status(200).json({
                success: true,
                message: 'Test endpoint is alive and working!',
                data: {
                    timestamp: new Date().toISOString(),
                    method: req.method,
                    environmentVariables: envVars,
                    nodeVersion: process.version,
                    platform: process.platform
                }
            });
        } else {
            // Diğer HTTP methodları
            res.status(405).json({
                success: false,
                error: 'Method not allowed',
                allowedMethods: ['GET', 'POST', 'OPTIONS']
            });
        }
        
    } catch (error) {
        console.error('❌ Test endpoint error:', error);
        console.error('📚 Error stack:', error.stack);
        
        res.status(500).json({
            success: false,
            error: 'Internal server error in test endpoint',
            details: error.message,
            timestamp: new Date().toISOString()
        });
    }
};
