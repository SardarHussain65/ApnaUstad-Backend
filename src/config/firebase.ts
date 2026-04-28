import * as admin from 'firebase-admin';
import path from 'path';
import fs from 'fs';
import { getConfig } from './env';

// Look for a serviceAccountKey.json at the root of the project
const serviceAccountPath = path.resolve(process.cwd(), 'serviceAccountKey.json');

export const initializeFirebase = () => {
    const config = getConfig();

    // Check if we should skip initialization
    if (config.skipFirebaseInit) {
        console.warn("⚠️  [WARN] Firebase initialization is SKIPPED via SKIP_FIREBASE_INIT flag.");
        return;
    }

    try {
        // Only initialize if it hasn't been initialized yet
        if (!admin.apps.length) {
            let serviceAccount;
            
            // Try to get serviceAccount from environment variable first (production/Railway)
            if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
                try {
                    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
                    console.log("🔥 Firebase credentials loaded from environment variable");
                } catch (parseError) {
                    console.error("❌ Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY from environment");
                    throw parseError;
                }
            }
            // Otherwise try to load from file (development)
            else if (fs.existsSync(serviceAccountPath)) {
                serviceAccount = require(serviceAccountPath);
                console.log("🔥 Firebase credentials loaded from serviceAccountKey.json");
            }
            
            if (serviceAccount) {
                admin.initializeApp({
                    credential: admin.credential.cert(serviceAccount)
                });
                console.log("🔥 Firebase Admin initialized successfully!");
            } else {
                const errorMessage = "Firebase serviceAccountKey.json not found and FIREBASE_SERVICE_ACCOUNT_KEY env var not set.";
                console.error(`\n❌ ${errorMessage}`);
                console.error("⚠️  OTP validation via Firebase will fail until this is provided.\n");

                // Fail-fast if not allowed to fail
                if (!config.allowFirebaseInitFailure) {
                    throw new Error(errorMessage);
                }
            }
        }
    } catch (error: any) {
        console.error("❌ Firebase Admin Initialization Error: ", error.message);

        // Rethrow if not allowed to fail
        if (!config.allowFirebaseInitFailure) {
            throw error;
        }
    }
};

export default admin;
