/**
 * Environment configuration and validation
 * This ensures all required environment variables are set before app starts
 */
import dotenv from 'dotenv';
dotenv.config();
// List of required environment variables
const requiredEnvVars = [
    'PORT',
    'MONGODB_URL',
    'JWT_SECRET',
    'REFRESH_TOKEN_SECRET'
];

/**
 * Validate that all required environment variables are set
 * @throws {Error} If any required variable is missing
 */
const validateEnv = () => {
    const missingVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

    if (missingVars.length > 0) {
        console.error('❌ Missing required environment variables:');
        missingVars.forEach(varName => {
            console.error(`   - ${varName}`);
        });
        console.error('\nPlease check your .env file and ensure all required variables are set.\n');
        process.exit(1);
    }

    console.log('✅ All environment variables are configured correctly');
};

/**
 * Get environment configuration object
 * @returns {Object} Configuration object with typed values
 */
const getConfig = () => ({
    port: parseInt(process.env.PORT || '3000', 10),
    nodeEnv: process.env.NODE_ENV || 'development',
    mongodbUrl: process.env.MONGODB_URL as string,
    jwtSecret: process.env.JWT_SECRET as string,
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1h',
    refreshTokenSecret: process.env.REFRESH_TOKEN_SECRET as string,
    refreshTokenExpiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '30d',
    clientUrl: process.env.CLIENT_URL || '*',
    imagekitPrivateKey: process.env.IMAGEKIT_PRIVATE_KEY as string,
    allowFirebaseInitFailure: process.env.ALLOW_FIREBASE_INIT_FAILURE === 'true',
    skipFirebaseInit: process.env.SKIP_FIREBASE_INIT === 'true',
    platformFeePercentage: parseFloat(process.env.PLATFORM_FEE_PERCENTAGE || '10'),

});

export {
    validateEnv,
    getConfig,
};
