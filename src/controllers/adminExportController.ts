import { Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { BadRequestError } from '../utils/ApiError';
import { AdminAuthRequest } from '../middlewares/admin.middleware';
import { recordAdminAction } from '../services/adminAuditLog';
import { CSV_BOM, csvRow } from '../utils/csv';
import { parseRange } from '../utils/adminRange';
import { maskCnic } from '../utils/cnic';
import User from '../models/User';
import Worker from '../models/Workers';
import Booking from '../models/Booking';
import Payment from '../models/Payment';
import AdminAuditLog from '../models/AdminAuditLog';
import WalletTopUpRequest from '../models/WalletTopUpRequest';
import Dispute from '../models/Dispute';

export const streamExport = asyncHandler(async (req: AdminAuthRequest, res: Response) => {
  const entity = String(req.params.entity || '');
  const range = parseRange(req.query.from, req.query.to, undefined, 90);

  const filename = `${entity}-export-${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.write(CSV_BOM);

  await recordAdminAction(req, {
    action: 'export.stream',
    entityType: entity,
    metadata: { from: range.from.toISOString(), to: range.to.toISOString() },
  });

  if (entity === 'users') {
    res.write(csvRow(['ID', 'Full Name', 'Phone', 'Email', 'City', 'Active', 'Joined At']));
    const cursor = User.find({ createdAt: { $gte: range.from, $lt: range.to } })
      .select('fullName phone email city isActive createdAt')
      .sort({ createdAt: -1 })
      .cursor();

    for await (const doc of cursor) {
      res.write(
        csvRow([
          doc._id.toString(),
          doc.fullName || '',
          doc.phone || '',
          doc.email || '',
          doc.city || '',
          doc.isActive ? 'Yes' : 'No',
          doc.createdAt ? doc.createdAt.toISOString() : '',
        ])
      );
    }
  } else if (entity === 'workers') {
    res.write(csvRow(['ID', 'Full Name', 'Phone', 'Category', 'CNIC (Masked)', 'Rating', 'Jobs', 'Verified', 'Active', 'Joined At']));
    const cursor = Worker.find({ createdAt: { $gte: range.from, $lt: range.to } })
      .select('fullName phone category cnicNumber rating totalJobs isVerified isActive createdAt')
      .sort({ createdAt: -1 })
      .cursor();

    for await (const doc of cursor) {
      res.write(
        csvRow([
          doc._id.toString(),
          doc.fullName || '',
          doc.phone || '',
          doc.category || '',
          maskCnic(doc.cnicNumber || ''),
          doc.rating || 0,
          doc.totalJobs || 0,
          doc.isVerified ? 'Yes' : 'No',
          doc.isActive ? 'Yes' : 'No',
          doc.createdAt ? doc.createdAt.toISOString() : '',
        ])
      );
    }
  } else if (entity === 'bookings') {
    res.write(csvRow(['ID', 'Category', 'Status', 'Payment Status', 'Total (PKR)', 'Platform Fee (PKR)', 'Worker Earning (PKR)', 'Created At']));
    const cursor = Booking.find({ createdAt: { $gte: range.from, $lt: range.to } })
      .select('category status paymentStatus totalAmount platformFee workerEarning createdAt')
      .sort({ createdAt: -1 })
      .cursor();

    for await (const doc of cursor) {
      res.write(
        csvRow([
          doc._id.toString(),
          doc.category || '',
          doc.status || '',
          doc.paymentStatus || '',
          doc.totalAmount || 0,
          doc.platformFee || 0,
          doc.workerEarning || 0,
          doc.createdAt ? doc.createdAt.toISOString() : '',
        ])
      );
    }
  } else if (entity === 'payments') {
    res.write(csvRow(['ID', 'Receipt Number', 'Method', 'Status', 'Amount (PKR)', 'Platform Fee (PKR)', 'Worker Earning (PKR)', 'Paid At', 'Created At']));
    const cursor = Payment.find({ createdAt: { $gte: range.from, $lt: range.to } })
      .select('receiptNumber method status amount platformFee workerEarning paidAt createdAt')
      .sort({ createdAt: -1 })
      .cursor();

    for await (const doc of cursor) {
      res.write(
        csvRow([
          doc._id.toString(),
          doc.receiptNumber || '',
          doc.method || '',
          doc.status || '',
          doc.amount || 0,
          doc.platformFee || 0,
          doc.workerEarning || 0,
          doc.paidAt ? doc.paidAt.toISOString() : '',
          doc.createdAt ? doc.createdAt.toISOString() : '',
        ])
      );
    }
  } else if (entity === 'audit-logs') {
    res.write(csvRow(['ID', 'Actor ID', 'Actor Role', 'Action', 'Entity Type', 'Entity ID', 'Reason', 'IP', 'Created At']));
    const cursor = AdminAuditLog.find({ createdAt: { $gte: range.from, $lt: range.to } })
      .select('actor actorRole action entityType entityId reason ip createdAt')
      .sort({ createdAt: -1 })
      .cursor();

    for await (const doc of cursor) {
      res.write(
        csvRow([
          doc._id.toString(),
          doc.actor?.toString() || '',
          doc.actorRole || '',
          doc.action || '',
          doc.entityType || '',
          doc.entityId || '',
          doc.reason || '',
          doc.ip || '',
          doc.createdAt ? doc.createdAt.toISOString() : '',
        ])
      );
    }
  } else if (entity === 'wallet-topups') {
    res.write(csvRow(['ID', 'Request ID', 'Worker ID', 'Amount (PKR)', 'Method', 'Status', 'Rejection Reason', 'Created At']));
    const cursor = WalletTopUpRequest.find({ createdAt: { $gte: range.from, $lt: range.to } })
      .select('requestId worker amount method status rejectionReason createdAt')
      .sort({ createdAt: -1 })
      .cursor();

    for await (const doc of cursor) {
      res.write(
        csvRow([
          doc._id.toString(),
          doc.requestId || '',
          doc.worker?.toString() || '',
          doc.amount || 0,
          doc.method || '',
          doc.status || '',
          doc.rejectionReason || '',
          doc.createdAt ? doc.createdAt.toISOString() : '',
        ])
      );
    }
  } else if (entity === 'disputes') {
    res.write(csvRow(['ID', 'Booking ID', 'Raised By Type', 'Reason', 'Status', 'Created At']));
    const cursor = Dispute.find({ createdAt: { $gte: range.from, $lt: range.to } })
      .select('booking raisedByType reason status createdAt')
      .sort({ createdAt: -1 })
      .cursor();

    for await (const doc of cursor) {
      res.write(
        csvRow([
          doc._id.toString(),
          doc.booking?.toString() || '',
          doc.raisedByType || '',
          doc.reason || '',
          doc.status || '',
          doc.createdAt ? doc.createdAt.toISOString() : '',
        ])
      );
    }
  } else {
    throw new BadRequestError(`Unknown export entity: ${entity}`);
  }

  res.end();
});
