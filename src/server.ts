/**
 * 
 * 
 * 
 * 
 * Server Entry Point
 * Validates environment, connects to database, and starts the server
 */

import mongoose from "mongoose";


import { validateEnv, getConfig } from './config/env';
import { connectDB } from './config/db';
import { initializeFirebase } from './config/firebase';
import app from './app';
import logger from './config/logger';
import { cleanupOrphanedUploads } from "./scripts/cleanupUploads";
import http from 'http';
import { initSocket } from './sockets/socketManager';
import { startInstantBookingCleanup } from './scripts/instantBookingCleanup';
import { startInstantJobExpansion } from './scripts/instantJobExpansion';

// Validate environment variables before starting
validateEnv();

const config = getConfig();

// Connect to database and start server
const startServer = async () => {
    try {
        // Initialize Firebase Admin
        initializeFirebase();

        // Connect to MongoDB
        await connectDB();

        // Create HTTP server
        const httpServer = http.createServer(app);

        // Initialize Socket.IO
        initSocket(httpServer);

        // Start periodic cleanups
        startInstantBookingCleanup();
        startInstantJobExpansion();

        // Start HTTP server
        const server = httpServer.listen(config.port, () => {
            logger.info(`🚀 Server running on port ${config.port}`);
            logger.info(`📍 Environment: ${config.nodeEnv}`);

            // Start periodic cleanup task for orphaned uploads (every 24 hours)
            // We run it once shortly after boot (2 hours delay) then every 24h
            setTimeout(() => {
                cleanupOrphanedUploads().catch(err => logger.error("Scheduled cleanup failed", err));
            }, 1000 * 60 * 60 * 2);

            setInterval(() => {
                cleanupOrphanedUploads().catch(err => logger.error("Scheduled cleanup failed", err));
            }, 1000 * 60 * 60 * 24);
        });

        // Handle unhandled promise rejections
        process.on('unhandledRejection', (err: any) => {
            logger.error('UNHANDLED REJECTION! 💥 Shutting down...');
            logger.error(`${err.name}: ${err.message}`);
            server.close(async () => {
                await mongoose.connection.close(); // <--- Add this
                process.exit(1);
            });
        });

        // Handle SIGTERM signal
        process.on('SIGTERM', async () => {
            logger.info('👋 SIGTERM RECEIVED. Shutting down gracefully');
            server.close(async () => {
                await mongoose.connection.close(); // <--- Add this
                logger.info('💥 Process terminated!');
            });
        });


    } catch (error) {
        logger.error('Failed to start server:', error);
        process.exit(1);
    }
};

startServer();