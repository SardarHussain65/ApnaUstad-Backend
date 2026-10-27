import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../models/User';
import logger from '../config/logger';

dotenv.config();

const runMigration = async () => {
  try {
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!mongoUri) {
      throw new Error('MONGO_URI is not defined in environment variables');
    }

    await mongoose.connect(mongoUri);
    logger.info('Connected to MongoDB for placeholder phone migration');

    // Find all users with placeholder phones starting with "G-"
    const filter = { phone: { $regex: '^G-' } };
    const count = await User.countDocuments(filter);
    logger.info(`Found ${count} user(s) with placeholder phone numbers.`);

    if (count > 0) {
      const result = await User.updateMany(filter, { $set: { phone: null } });
      logger.info(`Updated ${result.modifiedCount} users to phone: null.`);
    }

    logger.info('Placeholder phone migration completed successfully.');
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    logger.error('Placeholder phone migration failed', error);
    process.exit(1);
  }
};

runMigration();
