import * as admin from 'firebase-admin';
import path from 'path';
import fs from 'fs';

// Look for a serviceAccountKey.json at the root of the project
const serviceAccountPath = path.resolve(process.cwd(), 'serviceAccountKey.json');

export const initializeFirebase = () => {
    try {
        // Only initialize if it hasn't been initialized yet
        if (!admin.apps.length) {
            if (fs.existsSync(serviceAccountPath)) {
                // If developer provided the key
                const serviceAccount = require(serviceAccountPath);
                admin.initializeApp({
                    credential: admin.credential.cert(serviceAccount)
                });
                console.log("🔥 Firebase Admin initialized successfully!");
            } else {
                console.warn("\n⚠️  [WARN] Firebase serviceAccountKey.json not found in root directory.");
                console.warn("⚠️  [WARN] OTP validation via Firebase will fail until this is provided.\n");
            }
        }
    } catch (error: any) {
        console.error("❌ Firebase Admin Initialization Error: ", error.message);
    }
};

export default admin;
