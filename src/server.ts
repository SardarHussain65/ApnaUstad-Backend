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
import { startNotificationScheduler } from './scripts/notificationScheduler';

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
        startNotificationScheduler();

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

        const gracefulShutdown = async (signal: string) => {
            logger.info(`👋 ${signal} RECEIVED. Initiating graceful shutdown...`);

            // Set a failsafe timeout of 10s to force process exit if teardown hangs
            const forceExitTimeout = setTimeout(() => {
                logger.error('💥 Teardown hung! Forcefully terminating process.');
                process.exit(1);
            }, 10000);

            try {
                // 1. Close Express HTTP server (stops accepting new connections)
                server.close(() => {
                    logger.info('📦 HTTP Server closed.');
                });

                // 2. Disconnect Mongoose pool cleanly
                if (mongoose.connection.readyState !== 0) {
                    await mongoose.connection.close();
                    logger.info('📴 MongoDB connection safely terminated.');
                }

                clearTimeout(forceExitTimeout);
                logger.info('💥 Teardown completed successfully. Goodbye!');
                process.exit(0);
            } catch (err: any) {
                logger.error('❌ Error during graceful shutdown:', err);
                process.exit(1);
            }
        };

        // Handle unhandled promise rejections
        process.on('unhandledRejection', (err: any) => {
            logger.error('UNHANDLED REJECTION! 💥 Shutting down...');
            logger.error(`${err?.name || 'Error'}: ${err?.message || err}`);
            gracefulShutdown('UNHANDLED_REJECTION');
        });

        // Handle SIGTERM (sent by PM2, Kubernetes, or Docker)
        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

        // Handle SIGINT (Ctrl+C or PM2 reloads)
        process.on('SIGINT', () => gracefulShutdown('SIGINT'));


    } catch (error) {
        logger.error('Failed to start server:', error);
        process.exit(1);
    }
};

startServer();