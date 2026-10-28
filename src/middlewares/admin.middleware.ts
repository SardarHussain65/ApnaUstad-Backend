import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import Admin, { IAdmin } from '../models/Admin';
import { getConfig } from '../config/env';
import { UnauthorizedError, ForbiddenError } from '../utils/ApiError';
import { AdminPermission, hasAdminPermission } from '../config/adminPermissions';

const config = getConfig();

export interface AdminAuthRequest extends Request {
    admin?: IAdmin;
}

/**
 * Middleware to authenticate Admin using JWT
 */
export const adminAuthMiddleware = async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
    try {
        const authorization = req.headers.authorization;

        if (!authorization || !authorization.startsWith('Bearer ')) {
            throw new UnauthorizedError('Unauthorized: Admin token not found');
        }

        const token = authorization.split(' ')[1];
        if (!token) {
            throw new UnauthorizedError('Unauthorized: Invalid token format');
        }

        if (!config.jwtSecret) {
            throw new Error('JWT_SECRET is not configured');
        }

        const decoded = jwt.verify(token, config.jwtSecret) as { id: string, role: string };

        // Verify if Admin exists in database
        const admin = await Admin.findById(decoded.id);
        
        if (!admin) {
            throw new UnauthorizedError('Unauthorized: Admin not found');
        }

        if (admin.status === 'inactive') {
            throw new UnauthorizedError('Unauthorized: Admin account deactivated');
        }

        // Attach admin object to request
        req.admin = admin;
        next();
    } catch (error: any) {
        if (error.name === 'JsonWebTokenError') {
            next(new UnauthorizedError('Invalid token'));
        } else if (error.name === 'TokenExpiredError') {
            next(new UnauthorizedError('Token expired'));
        } else {
            next(error);
        }
    }
};

/**
 * Middleware to restrict access to Super Admin only
 */
export const isSuperAdmin = (req: AdminAuthRequest, res: Response, next: NextFunction) => {
    if (!req.admin || req.admin.role !== 'superadmin') {
        return next(new ForbiddenError('Forbidden: Super Admin access required'));
    }
    next();
};

import { AdminAction, canPerform } from '../config/adminActions';
import { findGuardRule, checkReason, extractReason } from '../utils/adminReason';
import { maskCnicDeep } from '../utils/cnic';
import { BadRequestError } from '../utils/ApiError';

export const requirePermission = (...permissions: AdminPermission[]) => {
    return (req: AdminAuthRequest, _res: Response, next: NextFunction) => {
        const role = req.admin?.role || '';
        const allowed = permissions.some((permission) => hasAdminPermission(role, permission));
        if (!allowed) {
            return next(new ForbiddenError('Forbidden: insufficient permissions for this action'));
        }
        next();
    };
};

export const requireAction = (...actions: AdminAction[]) => {
    return (req: AdminAuthRequest, _res: Response, next: NextFunction) => {
        const role = req.admin?.role || '';
        const allowed = actions.some((action) => canPerform(role, action));
        if (!allowed) {
            return next(new ForbiddenError('Forbidden: insufficient permissions for this operation'));
        }
        next();
    };
};

/**
 * Automatically validates action-level RBAC and mandatory reasons
 * based on declarative guard rules for admin mutations, and masks CNIC
 * by default in outgoing JSON responses.
 */
export const adminGuardMiddleware = (req: AdminAuthRequest, res: Response, next: NextFunction) => {
    // Automatically mask CNIC in all admin JSON responses except reveal endpoint
    if (!req.path.includes('/reveal-cnic')) {
        const originalJson = res.json.bind(res);
        res.json = (body: any) => {
            return originalJson(maskCnicDeep(body));
        };
    }

    const rule = findGuardRule(req.method, req.path);
    if (!rule) return next();

    const role = req.admin?.role || '';
    if (rule.action && !canPerform(role, rule.action)) {
        return next(new ForbiddenError(`Forbidden: '${rule.action}' permission required for this action`));
    }

    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const isRequired = rule.needsReason ? rule.needsReason(body) : true;
    const extracted = extractReason(body, req.query as Record<string, unknown>, rule.aliases);
    const check = checkReason(extracted, isRequired);

    if (!check.ok) {
        return next(new BadRequestError(check.message));
    }

    if (check.reason) {
        req.body = { ...body, reason: check.reason };
    }

    next();
};
