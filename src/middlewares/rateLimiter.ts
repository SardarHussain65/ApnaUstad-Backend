import rateLimit from "express-rate-limit";

// Strict limiter for authentication endpoints (login, register)
export const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 Minutes
    max: 10, // Limit each IP to 10 attempts
    message: {
        success: false,
        message: "Too many login/registration attempts from this IP, please try again in 15 minutes!"
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// Extremely strict limiter for sending OTP codes
export const otpLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 Minutes
    max: 5, // Limit each IP to 5 OTP requests
    message: {
        success: false,
        message: "Too many OTP requests. Please wait 10 minutes before requesting a new code!"
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// Strict limiter for document identity verification requests
export const verificationLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 Minutes
    max: 5, // Limit each IP to 5 requests
    message: {
        success: false,
        message: "Too many identity verification attempts. Please wait 15 minutes before resubmitting!"
    },
    standardHeaders: true,
    legacyHeaders: false,
});
