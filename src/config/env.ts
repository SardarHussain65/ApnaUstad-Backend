/**
 * Environment configuration and validation
 * This ensures all required environment variables are set before app starts
 */
import dotenv from 'dotenv';
dotenv.config();

// Minimum length for JWT secrets in production
const MIN_JWT_SECRET_LENGTH = 32;

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

    const isProduction = process.env.NODE_ENV === 'production';

    // Security: Enforce strong JWT secrets in production
    if (isProduction) {
        const jwtSecret = process.env.JWT_SECRET || '';
        const refreshSecret = process.env.REFRESH_TOKEN_SECRET || '';

        if (jwtSecret.length < MIN_JWT_SECRET_LENGTH) {
            console.error(`❌ JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters in production.`);
            console.error('   Generate one with: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"');
            process.exit(1);
        }

        if (refreshSecret.length < MIN_JWT_SECRET_LENGTH) {
            console.error(`❌ REFRESH_TOKEN_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters in production.`);
            process.exit(1);
        }

        // Warn about wildcard CORS in production
        const clientUrl = process.env.CLIENT_URL || '*';
        if (clientUrl === '*') {
            console.error('❌ CLIENT_URL must not be "*" in production. Set explicit allowed origins.');
            process.exit(1);
        }
    }

    // Development warnings
    if (!isProduction) {
        const jwtSecret = process.env.JWT_SECRET || '';
        if (jwtSecret.length < MIN_JWT_SECRET_LENGTH) {
            console.warn(`⚠️  JWT_SECRET is weak (${jwtSecret.length} chars). Use at least ${MIN_JWT_SECRET_LENGTH} chars for security.`);
        }
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
    minimumWalletBalance: parseFloat(process.env.MINIMUM_WALLET_BALANCE || '500'),
    walletPaymentMethods: [
        {
            method: 'easypaisa',
            label: 'Easypaisa',
            accountTitle: process.env.WALLET_EASYPAISA_ACCOUNT_TITLE || '',
            accountNumber: process.env.WALLET_EASYPAISA_NUMBER || '',
            instructions: process.env.WALLET_EASYPAISA_INSTRUCTIONS || 'Send the selected amount and upload the payment screenshot.',
            enabled: process.env.WALLET_EASYPAISA_ENABLED !== 'false',
            isConfigured: Boolean(process.env.WALLET_EASYPAISA_NUMBER),
        },
        {
            method: 'jazzcash',
            label: 'JazzCash',
            accountTitle: process.env.WALLET_JAZZCASH_ACCOUNT_TITLE || '',
            accountNumber: process.env.WALLET_JAZZCASH_NUMBER || '',
            instructions: process.env.WALLET_JAZZCASH_INSTRUCTIONS || 'Send the selected amount and upload the payment screenshot.',
            enabled: process.env.WALLET_JAZZCASH_ENABLED !== 'false',
            isConfigured: Boolean(process.env.WALLET_JAZZCASH_NUMBER),
        },
        {
            method: 'bank_transfer',
            label: 'Bank Transfer',
            accountTitle: process.env.WALLET_BANK_ACCOUNT_TITLE || '',
            accountNumber: process.env.WALLET_BANK_ACCOUNT_NUMBER || '',
            bankName: process.env.WALLET_BANK_NAME || '',
            iban: process.env.WALLET_BANK_IBAN || '',
            instructions: process.env.WALLET_BANK_INSTRUCTIONS || 'Transfer the selected amount and upload the transfer receipt.',
            enabled: process.env.WALLET_BANK_ENABLED !== 'false',
            isConfigured: Boolean(process.env.WALLET_BANK_ACCOUNT_NUMBER || process.env.WALLET_BANK_IBAN),
        },
        {
            method: 'other',
            label: process.env.WALLET_OTHER_METHOD_LABEL || 'Other Method',
            accountTitle: process.env.WALLET_OTHER_ACCOUNT_TITLE || '',
            accountNumber: process.env.WALLET_OTHER_ACCOUNT_NUMBER || '',
            instructions: process.env.WALLET_OTHER_INSTRUCTIONS || '',
            enabled: process.env.WALLET_OTHER_ENABLED === 'true',
            isConfigured: Boolean(process.env.WALLET_OTHER_ACCOUNT_NUMBER || process.env.WALLET_OTHER_INSTRUCTIONS),
        }
    ],
});

export {
    validateEnv,
    getConfig,
};
