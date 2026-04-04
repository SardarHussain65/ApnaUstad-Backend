import rateLimit from "express-rate-limit";

/**
 * Specialized rate limiter for file uploads to prevent storage abuse.
 * Limits each IP to 5 upload requests per 15-minute window.
 */
export const uploadRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // Limit each IP to 5 upload requests per window
    message: {
        status: 429,
        success: false,
        message: "Too many upload attempts from this IP. Please try again after 15 minutes.",
    },
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});
