import express from "express";
import cors from "cors";
import morgan from "morgan";
import { getConfig } from "./config/env";
import { errorHandler } from "./middlewares/error.middleware";
import logger, { stream } from "./config/logger";

import usersRoute from "./routes/usersRoute";


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

// Body parsers
app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: true, limit: "16kb" }));

// --- 📍 Route Handlers ---
app.use('/api/v1/users', usersRoute);

// --- ⚠️ Error Handling ---
// Global Error Middleware (Must be last)
app.use(errorHandler);


export default app;
