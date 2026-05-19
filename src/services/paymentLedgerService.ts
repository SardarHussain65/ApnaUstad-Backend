import Payment from "../models/Payment";
import Worker from "../models/Workers";

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
    amount: Number(booking.totalAmount || 0),
    subtotal: Number(booking.subtotal || 0),
    platformFee: Number(booking.platformFee || 0),
    workerEarning: Number(booking.workerEarning || 0),
    bookingStatusSnapshot: booking.status || 'pending',
});

export const ensurePaymentForBooking = async (booking: any) => {
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
        { new: true, upsert: true, setDefaultsOnInsert: true }
    );
};

export const syncPaymentForBookingStatus = async (booking: any) => {
    const payment = await ensurePaymentForBooking(booking);

    if (payment.status === 'paid') {
        return payment;
    }

    if (booking.status === 'cancelled') {
        payment.status = 'cancelled';
        payment.cancelledAt = payment.cancelledAt || new Date();
        payment.bookingStatusSnapshot = booking.status;
        return payment.save();
    }

    if (booking.status === 'completed') {
        payment.status = booking.paymentStatus === 'paid' ? 'paid' : 'payable';
        payment.payableAt = payment.payableAt || new Date();
        payment.bookingStatusSnapshot = booking.status;
        return payment.save();
    }

    payment.status = 'pending';
    payment.bookingStatusSnapshot = booking.status || 'pending';
    return payment.save();
};

export const confirmCashPaymentForBooking = async (
    booking: any,
    confirmedBy: 'customer' | 'worker' | 'admin' = 'customer',
    notes = ''
) => {
    const payment = await ensurePaymentForBooking(booking);
    const wasAlreadyPaid = payment.status === 'paid';

    payment.status = 'paid';
    payment.method = 'cash';
    payment.confirmedBy = confirmedBy;
    payment.notes = notes;
    payment.payableAt = payment.payableAt || new Date();
    payment.paidAt = payment.paidAt || new Date();
    payment.receiptNumber = payment.receiptNumber || buildReceiptNumber(getBookingId(booking));
    payment.bookingStatusSnapshot = booking.status || 'completed';

    await payment.save();

    if (!wasAlreadyPaid && !payment.workerLedgerApplied) {
        await Worker.findByIdAndUpdate(booking.worker, {
            $inc: {
                totalEarnings: Number(booking.workerEarning || 0),
                totalJobs: 1,
            }
        });
        payment.workerLedgerApplied = true;
        await payment.save();
    }

    return payment;
};
