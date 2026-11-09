import { Request, Response, NextFunction } from 'express';
import { isAppError, formatErrorResponse } from '../utils/ApiError';
import logger from '../config/logger';

/**
 * Global Error Handling Middleware
 */
const errorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
    // Log error
    logger.error(`${err.message}`, {
        stack: err.stack,
        url: req.url,
        method: req.method
    });

    // Handle AppError (Custom operational errors)
    if (isAppError(err)) {
        return res.status(err.statusCode).json(formatErrorResponse(err));
    }

    // Handle Mongoose CastError (Invalid ObjectId)
    if (err.name === 'CastError') {
        const message = `Invalid ${err.path || 'ID'} format: "${err.value}"`;
        return res.status(400).json({
            success: false,
            status: 'fail',
            statusCode: 400,
            message,
            ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
        });
    }

    // Handle MongoDB Duplicate Key Error (Code 11000)
    if (err.code === 11000) {
        const field = Object.keys(err.keyValue || {})[0] || 'field';
        const val = err.keyValue ? err.keyValue[field] : '';
        const message = `A record with this ${field} already exists: "${val}"`;
        return res.status(409).json({
            success: false,
            status: 'fail',
            statusCode: 409,
            message,
            ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
        });
    }

    // Handle Mongoose ValidationError
    if (err.name === 'ValidationError') {
        const errors = Object.values(err.errors || {}).map((e: any) => e.message);
        return res.status(400).json({
            success: false,
            status: 'fail',
            statusCode: 400,
            message: 'Validation failed',
            errors,
            ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
        });
    }

    // Handle JWT Errors
    if (err.name === 'JsonWebTokenError') {
        return res.status(401).json({
            success: false,
            status: 'fail',
            statusCode: 401,
            message: 'Invalid authorization token'
        });
    }
    if (err.name === 'TokenExpiredError') {
        return res.status(401).json({
            success: false,
            status: 'fail',
            statusCode: 401,
            message: 'Authorization token has expired'
        });
    }

    // Default error response for unexpected (non-operational) errors
    const statusCode = err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    return res.status(statusCode).json({
        success: false,
        status: 'error',
        statusCode: statusCode,
        message: message,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
};

export { errorHandler };
