import { Response } from 'express';

/**
 * Standardized response helpers for API consistency
 */

/**
 * Success response
 * @param {Response} res - Express response object
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Success message
 * @param {any} data - Response data
 */
export const successResponse = (res: Response, statusCode: number = 200, message: string = 'Success', data: any = null) => {
    const response: any = {
        success: true,
        message
    };
    if (data !== null) {
        response.data = data;
    }
    return res.status(statusCode).json(response);
};

/**
 * Error response
 * @param {Response} res - Express response object
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 * @param {any} errors - Detailed errors (optional)
 */
export const errorResponse = (res: Response, statusCode: number = 500, message: string = 'Internal Server Error', errors: any = null) => {
    const response: any = {
        success: false,
        message
    };
    if (errors !== null) {
        response.errors = errors;
    }
    return res.status(statusCode).json(response);
};

/**
 * Paginated response
 * @param {Response} res - Express response object
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Success message
 * @param {any[]} data - Array of items
 * @param {number} page - Current page
 * @param {number} limit - Items per page
 * @param {number} total - Total items count
 */
export const paginatedResponse = (res: Response, statusCode: number = 200, message: string = 'Success', data: any[] = [], page: number = 1, limit: number = 10, total: number = 0) => {
    return res.status(statusCode).json({
        success: true,
        message,
        data,
        pagination: {
            currentPage: page,
            totalPages: Math.ceil(total / limit),
            totalItems: total,
            itemsPerPage: limit
        }
    });
};


