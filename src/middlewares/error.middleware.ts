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
