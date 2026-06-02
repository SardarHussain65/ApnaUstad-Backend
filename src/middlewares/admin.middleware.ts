import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import Admin, { IAdmin } from '../models/Admin';
import { getConfig } from '../config/env';
import { UnauthorizedError, ForbiddenError } from '../utils/ApiError';

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
