import mongoose, { Schema, Document } from 'mongoose';

export interface IAdminAuditLog extends Document {
  actor: mongoose.Types.ObjectId;
  actorRole: string;
  action: string;
  entityType: string;
  entityId?: string;
  reason?: string;
  metadata?: Record<string, any>;
  ip?: string;
  userAgent?: string;
  createdAt: Date;
  updatedAt: Date;
}

const adminAuditLogSchema = new Schema<IAdminAuditLog>(
  {
    actor: { type: Schema.Types.ObjectId, ref: 'Admin', required: true, index: true },
    actorRole: { type: String, default: 'admin', index: true },
    action: { type: String, required: true, index: true },
    entityType: { type: String, required: true, index: true },
    entityId: { type: String, index: true },
    reason: { type: String, trim: true, maxlength: 500, default: '' },
    metadata: { type: Schema.Types.Mixed, default: {} },
    ip: { type: String, default: '' },
    userAgent: { type: String, default: '' },
  },
  { timestamps: true, collection: 'admin_audit_logs' }
);

adminAuditLogSchema.index({ createdAt: -1 });
adminAuditLogSchema.index({ entityType: 1, createdAt: -1 });
adminAuditLogSchema.index({ action: 1, createdAt: -1 });
adminAuditLogSchema.index({ actor: 1, createdAt: -1 });

export default mongoose.models.AdminAuditLog
  || mongoose.model<IAdminAuditLog>('AdminAuditLog', adminAuditLogSchema);
