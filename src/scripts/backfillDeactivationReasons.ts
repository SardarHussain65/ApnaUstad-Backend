import mongoose from 'mongoose';
import { getConfig } from '../config/env';
import User from '../models/User';
import Worker from '../models/Workers';

const DEFAULT_REASON = 'Account deactivated by admin. Please contact support for details.';

const isDryRun = process.argv.includes('--dry-run');

async function main() {
  const config = getConfig();
  await mongoose.connect(config.mongodbUrl);

  const userFilter = {
    isActive: false,
    $or: [
      { deactivationReason: { $exists: false } },
      { deactivationReason: '' },
      { deactivationReason: null },
    ],
  };
  const workerFilter = {
    isActive: false,
    $or: [
      { deactivationReason: { $exists: false } },
      { deactivationReason: '' },
      { deactivationReason: null },
    ],
  };

  const [usersToUpdate, workersToUpdate] = await Promise.all([
    User.countDocuments(userFilter),
    Worker.countDocuments(workerFilter),
  ]);

  console.log(`Inactive users missing reason: ${usersToUpdate}`);
  console.log(`Inactive workers missing reason: ${workersToUpdate}`);

  if (isDryRun) {
    console.log('Dry run complete. No documents were updated.');
    return;
  }

  const now = new Date();
  const [userResult, workerResult] = await Promise.all([
    User.updateMany(userFilter, {
      $set: {
        deactivationReason: DEFAULT_REASON,
        deactivatedAt: now,
      },
    }),
    Worker.updateMany(workerFilter, {
      $set: {
        deactivationReason: DEFAULT_REASON,
        deactivatedAt: now,
        isAvailable: false,
        isInstantAvailable: false,
        isScheduledAvailable: false,
      },
    }),
  ]);

  console.log(`Updated users: ${userResult.modifiedCount}`);
  console.log(`Updated workers: ${workerResult.modifiedCount}`);
}

main()
  .catch((error) => {
    console.error('Backfill failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
