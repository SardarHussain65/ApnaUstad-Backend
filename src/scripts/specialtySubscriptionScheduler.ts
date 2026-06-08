import cron from 'node-cron';
import logger from '../config/logger';
import { processDueSpecialtyRenewals } from '../services/workerSpecialtyService';

export const startSpecialtySubscriptionScheduler = () => {
    cron.schedule('0 * * * *', async () => {
        try {
            const summary = await processDueSpecialtyRenewals();
            if (summary.checked > 0) {
                logger.info(`[Specialty billing] Processed ${summary.checked} subscription(s): ${summary.renewed} renewed, ${summary.paymentDue} payment due, ${summary.expired} expired.`);
            }
        } catch (error) {
            logger.error('Error in specialty subscription scheduler:', error);
        }
    });
    logger.info('Specialty subscription scheduler started (runs hourly)');
};

