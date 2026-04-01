/**
 * Base custom error class for the application.
 * Extends the native Error class with additional properties for HTTP handling.
 * 
 * Includes a fix for the TypeScript `instanceof` issue.
 */
class AppError extends Error {
    public readonly statusCode: number;
    public readonly status: string;
    public readonly isOperational: boolean;
    public readonly errors?: any[];

    constructor(
        statusCode: number,
        message: string = "Something went wrong",
        errors: any[] = [],
        isOperational: boolean = true,
        stack: string = ""
    ) {
        super(message);
        this.statusCode = statusCode;
        this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
        this.isOperational = isOperational;
        this.errors = errors;

        // Fixing the prototype chain for custom errors in TypeScript
        Object.setPrototypeOf(this, new.target.prototype);

        if (stack) {
            this.stack = stack;
        } else if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
    }
}

/**
 * Common HTTP Error Classes
 */

class BadRequestError extends AppError {
    constructor(message: string = 'Bad Request', errors: any[] = []) {
        super(400, message, errors);
    }
}

class UnauthorizedError extends AppError {
    constructor(message: string = 'Unauthorized') {
        super(401, message);
    }
}

class ForbiddenError extends AppError {
    constructor(message: string = 'Forbidden') {
        super(403, message);
    }
}

class NotFoundError extends AppError {
    constructor(message: string = 'Resource not found') {
        super(404, message);
    }
}

class ConflictError extends AppError {
    constructor(message: string = 'Conflict occurred') {
        super(409, message);
    }
}

class ValidationError extends AppError {
    constructor(message: string = 'Validation failed', errors: any[] = []) {
        super(400, message, errors);
    }
}

class InternalServerError extends AppError {
    constructor(message: string = 'Internal server error') {
        super(500, message, [], false);
    }
}

/**
 * Type guard to check if an error is an AppError
 */
const isAppError = (error: any): error is AppError => {
    return error instanceof AppError;
};

/**
 * Helper to format error response consistently
 */
const formatErrorResponse = (error: AppError) => {
    return {
        success: false,
        status: error.status,
        statusCode: error.statusCode,
        message: error.message,
        ...(error.errors && error.errors.length > 0 && { errors: error.errors }),
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
    };
};

// Also export ApiError as an alias for AppError to maintain backward compatibility during transition
const ApiError = AppError;

export {
    AppError,
    ApiError,
    BadRequestError,
    UnauthorizedError,
    ForbiddenError,
    NotFoundError,
    ConflictError,
    ValidationError,
    InternalServerError,
    isAppError,
    formatErrorResponse
};