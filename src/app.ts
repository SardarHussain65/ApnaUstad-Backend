import express from "express";
import cors from "cors";
import morgan from "morgan";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import mongoSanitize from "express-mongo-sanitize";

import { getConfig } from "./config/env";
import { errorHandler } from "./middlewares/error.middleware";
import logger, { stream } from "./config/logger";

import usersRoute from "./routes/usersRoute";
import workerRoute from "./routes/workerRoute";


const app = express();
const config = getConfig();

// --- 🪵 Logging Middleware ---
app.use(morgan(config.nodeEnv === 'development' ? 'dev' : 'combined', { stream }));

// --- ⚙️ Core Middlewares ---
// Enable CORS
app.use(cors({
    origin: config.clientUrl,
    credentials: true
}));

// 1. Set Security HTTP Headers
app.use(helmet());

// 2. Limit requests from the same API (Prevents Brute Force/DDoS)
const limiter = rateLimit({
    max: 100, // Limit each IP to 100 requests per windowMs
    windowMs: 15 * 60 * 1000, // 15 Minutes
    message: "Too many requests from this IP, please try again in an hour!"
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
app.use('/api/v1/users', usersRoute);
app.use('/api/v1/workers', workerRoute);



// --- ⚠️ Error Handling ---
// Global Error Middleware (Must be last)
app.use(errorHandler);


export default app;
