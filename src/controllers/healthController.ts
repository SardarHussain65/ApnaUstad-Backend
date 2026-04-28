import { Request, Response } from "express";
import mongoose from "mongoose";
import logger from "../config/logger";

/**
 * @description Get application health status
 * @route GET /health
 * @access Public
 */
export const getHealth = async (req: Request, res: Response) => {
    try {
        const dbConnected = mongoose.connection.readyState === 1;
        const timestamp = new Date().toISOString();
        const uptime = process.uptime();

        const healthStatus = {
            status: "ok",
            timestamp,
            uptime: `${Math.floor(uptime / 60)} minutes`,
            database: {
                connected: dbConnected,
                readyState: mongoose.connection.readyState,
            },
            environment: process.env.NODE_ENV || "development",
        };

        if (!dbConnected) {
            logger.warn("Health check: Database connection is down");
            return res.status(503).json({
                ...healthStatus,
                status: "degraded",
            });
        }

        return res.status(200).json(healthStatus);
    } catch (error) {
        logger.error("Health check failed:", error);
        return res.status(503).json({
            status: "error",
            timestamp: new Date().toISOString(),
            message: "Health check failed",
        });
    }
};
