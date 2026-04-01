/**
 * 
 * 
 * 
 * 
 * Server Entry Point
 * Validates environment, connects to database, and starts the server
 */

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
            server.close(() => {
                process.exit(1);
            });
        });

        // Handle SIGTERM signal (e.g., from Heroku)
        process.on('SIGTERM', () => {
            logger.info('👋 SIGTERM RECEIVED. Shutting down gracefully');
            server.close(() => {
                logger.info('💥 Process terminated!');
            });
        });

    } catch (error) {
        logger.error('Failed to start server:', error);
        process.exit(1);
    }
};

startServer();