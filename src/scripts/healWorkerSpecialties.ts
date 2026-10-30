import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Workers from '../models/Workers';
import { ensureLegacyPrimarySpecialty } from '../services/workerSpecialtyService';
import logger from '../config/logger';

dotenv.config();

const runHeal = async () => {
  try {
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!mongoUri) {
      throw new Error('MONGO_URI is not defined in environment variables');
    }

    await mongoose.connect(mongoUri);
    logger.info('Connected to MongoDB for specialty healing');

    const workers = await Workers.find({ 'specialties.1': { $exists: true } });
    logger.info(`Found ${workers.length} worker(s) with multiple specialties.`);

    let fixedCount = 0;
    for (const worker of workers) {
      const freeCount = (worker.specialties || []).filter(
        (s: any) => s.subscriptionStatus === 'free' || Number(s.priority) === 1
      ).length;

      const priorities = (worker.specialties || []).map((s: any) => Number(s.priority) || 1);
      const hasDuplicates = new Set(priorities).size !== priorities.length;

      if (freeCount > 1 || hasDuplicates) {
        logger.info(`Healing worker: ${worker._id} (${worker.fullName || worker.phone}) - freeCount: ${freeCount}, priorities: ${priorities.join(',')}`);
        await ensureLegacyPrimarySpecialty(worker);
        fixedCount++;
      }
    }

    logger.info(`Specialty healing completed. Fixed ${fixedCount} worker(s).`);
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    logger.error('Specialty healing failed', error);
    process.exit(1);
  }
};

runHeal();

