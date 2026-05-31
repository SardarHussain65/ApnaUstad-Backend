import Payment from "../models/Payment";
import Worker from "../models/Workers";
import mongoose from "mongoose";
import { settleCommissionReservation } from "./commissionReservationService";

const buildReceiptNumber = (bookingId: string) => {
    const suffix = bookingId.slice(-6).toUpperCase();
    return `CASH-${suffix}-${Date.now().toString(36).toUpperCase()}`;
};

const getBookingId = (booking: any) => booking._id?.toString?.() || booking.id?.toString?.();

const buildLedgerPayload = (booking: any) => ({
    booking: booking._id,
    customer: booking.customer,
    worker: booking.worker,
    method: 'cash' as const,
    currency: 'PKR' as const,
    amount: Number(booking.agreement?.cashDue ?? booking.totalAmount ?? 0),
    subtotal: Number(booking.subtotal || 0),
    platformFee: Number(booking.platformFee || 0),
    workerEarning: Number(booking.workerEarning || 0),
    bookingStatusSnapshot: booking.status || 'pending',
});

export const ensurePaymentForBooking = async (booking: any, session?: mongoose.ClientSession) => {
    const payload = buildLedgerPayload(booking);

    return Payment.findOneAndUpdate(
        { booking: booking._id },
        {
            $setOnInsert: {
                status: 'pending',
                workerLedgerApplied: false,
            },
            $set: payload,
        },
        { new: true, upsert: true, setDefaultsOnInsert: true, ...(session ? { session } : {}) }
    );
};

export const syncPaymentForBookingStatus = async (booking: any, session?: mongoose.ClientSession) => {
    const payment = await ensurePaymentForBooking(booking, session);

    if (payment.status === 'paid') {
        return payment;
    }

    if (booking.status === 'cancelled') {
        payment.status = 'cancelled';
        payment.cancelledAt = payment.cancelledAt || new Date();
        payment.bookingStatusSnapshot = booking.status;
        return payment.save(session ? { session } : {});
    }

    if (booking.status === 'completed') {
        payment.status = booking.paymentStatus === 'paid' ? 'paid' : 'payable';
        payment.payableAt = payment.payableAt || new Date();
        payment.bookingStatusSnapshot = booking.status;
        return payment.save(session ? { session } : {});
    }

    payment.status = 'pending';
    payment.bookingStatusSnapshot = booking.status || 'pending';
    return payment.save(session ? { session } : {});
};

export const confirmCashPaymentForBooking = async (
    booking: any,
    confirmedBy: 'customer' | 'worker' | 'admin' = 'customer',
    notes = ''
) => {
    const session = await mongoose.startSession();
    let confirmedPayment: any = null;

    try {
        await session.withTransaction(async () => {
            const payment = await ensurePaymentForBooking(booking, session);
            const shouldApplyWorkerLedger = !payment.workerLedgerApplied;

            payment.status = 'paid';
            payment.method = 'cash';
            payment.confirmedBy = confirmedBy;
            payment.notes = notes;
            payment.payableAt = payment.payableAt || new Date();
            payment.paidAt = payment.paidAt || new Date();
            payment.receiptNumber = payment.receiptNumber || buildReceiptNumber(getBookingId(booking));
            payment.bookingStatusSnapshot = booking.status || 'completed';

            booking.paymentStatus = 'paid';
            booking.paymentMethod = 'cash';
            await booking.save({ session });

            if (shouldApplyWorkerLedger) {
                await settleCommissionReservation(
                    booking.worker,
                    booking._id,
                    payment._id,
                    Number(booking.agreement?.commissionAmount ?? booking.platformFee ?? 0),
                    { session }
                );
                await Worker.findByIdAndUpdate(
                    booking.worker,
                    {
                        $inc: {
                            totalEarnings: Number(booking.agreement?.workerNetIncome ?? booking.workerEarning ?? 0),
                            totalJobs: 1,
                        }
                    },
                    { session }
                );
                payment.workerLedgerApplied = true;
            }

            confirmedPayment = await payment.save({ session });
        });
    } finally {
        await session.endSession();
    }

    return confirmedPayment;
};
