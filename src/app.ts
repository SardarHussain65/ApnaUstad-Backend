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


const app = express();
const config = getConfig();

// --- 🪵 Logging Middleware ---
app.use(morgan(config.nodeEnv === 'development' ? 'dev' : 'combined', { stream }));

// --- ⏱️ Request Timeout Middleware ---
app.use(requestTimeout(15000));

// --- 📦 Response Compression Middleware ---
app.use(compression());

// --- ⚙️ Core Middlewares ---
// Enable CORS
const allowedOrigins = config.clientUrl === '*' 
    ? '*' 
    : config.clientUrl.split(',').map((url: string) => url.trim());

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (like React Native mobile app, Postman, or curl)
        if (!origin) return callback(null, true);
        
        if (allowedOrigins === '*' || allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        
        return callback(new Error('Not allowed by CORS'));
    },
    credentials: true
}));

// 1. Set Security HTTP Headers
app.use(helmet());

// 2. Limit requests from the same API (Prevents Brute Force/DDoS)
const limiter = rateLimit({
    max: 500, // Limit each IP to 500 requests per windowMs
    windowMs: 15 * 60 * 1000, // 15 Minutes
    message: "Too many requests from this IP, please try again in 15 minutes!"
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


// --- ⚠️ Error Handling ---
// Global Error Middleware (Must be last)
app.use(errorHandler);


export default app;
