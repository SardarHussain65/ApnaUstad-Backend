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
import app from './app';
import logger from './config/logger';

// Validate environment variables before starting
validateEnv();

const config = getConfig();

// Connect to database and start server
const startServer = async () => {
    try {
        // Connect to MongoDB
        await connectDB();

        // Start Express server
        const server = app.listen(config.port, () => {
            logger.info(`🚀 Server running on port ${config.port}`);
            logger.info(`📍 Environment: ${config.nodeEnv}`);
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