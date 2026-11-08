import express from "express";
import cors from "cors";
import morgan from "morgan";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import mongoSanitize from "express-mongo-sanitize";
import compression from "compression";

import { getConfig } from "./config/env";
import { errorHandler } from "./middlewares/error.middleware";
import logger, { stream } from "./config/logger";
import { requestTimeout } from "./middlewares/timeout.middleware";

import healthRoute from "./routes/healthRoute";
import usersRoute from "./routes/usersRoute";
import workerRoute from "./routes/workerRoute";
import adminRoute from "./routes/adminRoute";
import bookingRoute from "./routes/bookingRoute";
import reviewRoute from "./routes/reviewRoute";
import otpRoute from "./routes/otpRoute";
import jobRoute from "./routes/jobRoute";
import messageRoute from "./routes/messageRoute";
import notificationRoutes from './routes/notificationRoutes';
import paymentRoute from './routes/paymentRoute';
import preferencesRoute from './routes/preferencesRoute';
import supportRoute from './routes/supportRoute';
import walletRoute from './routes/walletRoute';
import disputeRoute from './routes/disputeRoute';
import promoRoute from './routes/promoRoute';
import userWalletRoute from './routes/userWalletRoute';
import callRoute from './routes/callRoute';


const app = express();
const config = getConfig();

// Trust reverse proxy (Nginx / Azure VM / Cloudflare) to ensure accurate client IP detection for rate-limiting
app.set('trust proxy', 1);

// --- 🪵 Logging Middleware ---
app.use(morgan(config.nodeEnv === 'development' ? 'dev' : 'combined', { stream }));

// --- ⏱️ Request Timeout Middleware ---
app.use(requestTimeout(30000));

// --- 📦 Response Compression Middleware ---
app.use(compression());

// --- ⚙️ Core Middlewares ---
// Enable CORS
const envOrigins = config.clientUrl === '*'
    ? ['*']
    : config.clientUrl.split(',').map((url: string) => url.trim());

const isAllowedOrigin = (origin: string): boolean => {
    if (envOrigins.includes('*') || envOrigins.includes(origin)) return true;

    try {
        const url = new URL(origin);
        // Automatically allow official production domain and subdomains (apnaustad.app, www.apnaustad.app)
        if (url.hostname === 'apnaustad.app' || url.hostname.endsWith('.apnaustad.app')) {
            return true;
        }
        // Allow local development
        if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
            return true;
        }
        // Allow Cloudflare Workers & Pages previews
        if (url.hostname.endsWith('.pages.dev') || url.hostname.endsWith('.workers.dev')) {
            return true;
        }
    } catch {
        return false;
    }
    return false;
};

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (like React Native mobile app, Postman, or curl)
        if (!origin) return callback(null, true);

        if (isAllowedOrigin(origin)) {
            return callback(null, true);
        }

        return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin']
}));

// 1. Set Security HTTP Headers
app.use(helmet());

// 2. Limit requests from the same API (Prevents Brute Force/DDoS)
const limiter = rateLimit({
    max: 3500, // Limit each client IP to 3500 requests per 15 minutes window
    windowMs: 15 * 60 * 1000, // 15 Minutes
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.method === 'OPTIONS', // Never count CORS preflights towards rate limit
    message: {
        success: false,
        message: "Too many requests from this device, please try again shortly."
    }
});
app.use('/api', limiter);

// Body parsers
app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: true, limit: "16kb" }));

// 3. Data sanitization against NoSQL query injection
app.use((req, res, next) => {
    if (req.body) mongoSanitize.sanitize(req.body);
    if (req.params) mongoSanitize.sanitize(req.params);
    if (req.query) mongoSanitize.sanitize(req.query);
    if (req.headers) mongoSanitize.sanitize(req.headers);
    next();
});

// --- 📍 Route Handlers ---
app.use('/health', healthRoute);

app.use('/api/v1/users', usersRoute);
app.use('/api/v1/workers', workerRoute);
app.use('/api/v1/admin', adminRoute);
app.use('/api/v1/bookings', bookingRoute);
app.use('/api/v1/jobs', jobRoute);
app.use('/api/v1/reviews', reviewRoute);
app.use('/api/v1/otp', otpRoute);
app.use('/api/v1/messages', messageRoute);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/payments', paymentRoute);
app.use('/api/v1/preferences', preferencesRoute);
app.use('/api/v1/support', supportRoute);
app.use('/api/v1/wallet', walletRoute);
app.use('/api/v1/user-wallet', userWalletRoute);
app.use('/api/v1/disputes', disputeRoute);
app.use('/api/v1/promos', promoRoute);
app.use('/api/v1/calls', callRoute);


// --- ⚠️ Error Handling ---
// Global Error Middleware (Must be last)
app.use(errorHandler);


export default app;
