import cron from 'node-cron';
import Booking from '../models/Booking';
import logger from '../config/logger';
import { sendNotificationToRecipient } from '../services/notificationHelper';
import { addPakistanDays, formatPakistanDayKey, startOfPakistanWeek } from '../utils/pakistanTime';

export const sendWeeklyEarningsSummaries = async (referenceDate = new Date()) => {
    const currentWeekStart = startOfPakistanWeek(referenceDate);
    const weekStart = addPakistanDays(currentWeekStart, -7);
    const weekEnd = currentWeekStart;
    const weekStartKey = formatPakistanDayKey(weekStart);
    const weekEndKey = formatPakistanDayKey(addPakistanDays(weekEnd, -1));
    const completedAtExpression = { $ifNull: ['$completedAt', '$updatedAt'] };

    const summaries = await Booking.aggregate([
        {
            $match: {
                status: 'completed',
                $expr: {
                    $and: [
                        { $gte: [completedAtExpression, weekStart] },
                        { $lt: [completedAtExpression, weekEnd] },
                    ],
                },
            },
        },
        {
            $group: {
                _id: '$worker',
                earnings: { $sum: { $ifNull: ['$workerEarning', 0] } },
                jobs: { $sum: 1 },
            },
        },
        { $match: { _id: { $ne: null }, earnings: { $gt: 0 } } },
    ]);

    let sentCount = 0;
    let skippedCount = 0;

    for (const summary of summaries) {
        const workerId = summary._id.toString();
        const earnings = Math.round(Number(summary.earnings || 0));
        const idempotencyKey = `weekly_earnings/${workerId}/${weekStartKey}`;

        const result = await sendNotificationToRecipient(
            workerId,
            'worker',
            'Weekly Earnings Summary',
            `You earned Rs. ${earnings.toLocaleString()} this week!`,
            {
                type: 'weekly_earnings',
                amount: String(earnings),
                jobs: String(summary.jobs || 0),
                weekStart: weekStartKey,
                weekEnd: weekEndKey,
            },
            {
                type: 'weekly_earnings',
                icon: 'trending-up',
                color: '#00FF7F',
                idempotencyKey,
            }
        );

        if ((result as any).skipped) skippedCount += 1;
        else if (result.success) sentCount += 1;
    }

    logger.info('Weekly worker earnings summaries processed', {
        weekStart: weekStartKey,
        weekEnd: weekEndKey,
        workers: summaries.length,
        sentCount,
        skippedCount,
    });
};

export const startWeeklyEarningsSummaryScheduler = () => {
    cron.schedule('0 9 * * 1', async () => {
        try {
            await sendWeeklyEarningsSummaries();
        } catch (error) {
            logger.error('Error in weekly earnings summary scheduler:', error);
        }
    }, { timezone: 'Asia/Karachi' });

    logger.info('Weekly earnings summary scheduler started (Mondays 09:00 Asia/Karachi)');
};
