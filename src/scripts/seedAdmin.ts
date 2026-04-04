import mongoose from 'mongoose';
import Admin from '../models/Admin';
import { getConfig } from '../config/env';

const config = getConfig();

const seedAdmin = async () => {
    try {
        console.log('Connecting to database...');
        if (!config.mongodbUrl) {
            throw new Error('MONGODB_URL is not defined in environment variables');
        }

        await mongoose.connect(config.mongodbUrl as string);
        console.log('Connected to database successfully.');

        const adminEmail = process.env.ADMIN_EMAIL;
        const adminPassword = process.env.ADMIN_PASSWORD;

        if (!adminEmail || !adminPassword) {
            console.error('❌ Error: ADMIN_EMAIL and ADMIN_PASSWORD environment variables are required for seeding.');
            process.exit(1);
        }

        const existingAdmin = await Admin.findOne({ email: adminEmail });

        if (existingAdmin) {
            console.log('Admin already exists. Skipping seeding.');
            process.exit(0);
        }

        const admin = new Admin({
            fullName: 'Super Admin',
            email: adminEmail,
            password: adminPassword,
            role: 'superadmin'
        });

        await admin.save();
        console.log('✅ Super Admin created successfully!');
        console.log(`Email: ${adminEmail}`);

        process.exit(0);
    } catch (error) {
        console.error('❌ Error seeding admin:', error);
        process.exit(1);
    }
};

seedAdmin();
