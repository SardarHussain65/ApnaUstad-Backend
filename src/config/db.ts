import mongoose from "mongoose";
import { getConfig } from "./env";
import logger from "./logger";


const config = getConfig();
/**
 * Connect to MongoDB database
 * @returns {Promise} Mongoose connection
 */
const connectDB = async () => {
    try {
        const conn = await mongoose.connect(config.mongodbUrl, {
            maxPoolSize: 50,
            minPoolSize: 10,
            socketTimeoutMS: 45000,
            serverSelectionTimeoutMS: 5000,
            heartbeatFrequencyMS: 10000,
        });
        logger.info(`✅ MongoDB Connected: ${conn.connection.host}`);
        return conn;
    } catch (error: any) {
        logger.error('❌ Database connection error:', error.message);
        logger.error('Possible causes: IP not whitelisted in MongoDB Atlas, incorrect password, or network issues.');
        process.exit(1);
    }
};

/**
 * Disconnect from MongoDB database
 * Used for testing and graceful shutdown
 */
const disconnectDB = async () => {
    try {
        await mongoose.disconnect();
        logger.info('📴 MongoDB Disconnected');
    } catch (error: any) {
        logger.error('Error disconnecting from MongoDB:', error.message);
        process.exit(1);
    }
};

// Handle connection events
mongoose.connection.on('error', (err) => {
    logger.error('MongoDB connection error:', err);
});

mongoose.connection.on('disconnected', () => {
    logger.info('MongoDB disconnected');
});

export { connectDB, disconnectDB };
