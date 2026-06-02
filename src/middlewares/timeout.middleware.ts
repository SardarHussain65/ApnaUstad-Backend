import { Request, Response, NextFunction } from 'express';

/**
 * Middleware to enforce request timeouts and prevent hanging connections
 * @param timeoutMs Timeout duration in milliseconds (default: 15000ms / 15s)
 */
export const requestTimeout = (timeoutMs = 15000) => {
    return (req: Request, res: Response, next: NextFunction) => {
        const timer = setTimeout(() => {
            if (!res.headersSent) {
                res.status(504).json({ 
                    success: false, 
                    message: "Request timed out. The server took too long to respond." 
                });
            }
        }, timeoutMs);

        // Clear timer on request completion or connection close
        res.on('finish', () => clearTimeout(timer));
        res.on('close', () => clearTimeout(timer));
        
        next();
    };
};
