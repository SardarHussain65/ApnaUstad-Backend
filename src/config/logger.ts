/**
 * Winston Logger Configuration
 * Provides structured logging for the application
 */

import winston from "winston";
import { getConfig } from "./env";

const config = getConfig();

// Define log format
const logFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
);

// Define console format for development
const consoleFormat = winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(
        (info) => `${info.timestamp} ${info.level}: ${info.message}`
    )
);

// Create logger instance
const logger = winston.createLogger({
    level: config.nodeEnv === 'development' ? 'debug' : 'info',
    format: logFormat,
    defaultMeta: { service: 'apna-ustad-api' },
    transports: [
        // Write all logs to console
        new winston.transports.Console({
            format: config.nodeEnv === 'development' ? consoleFormat : logFormat
        })
    ]
});

// Add file transports in production
if (config.nodeEnv === 'production') {
    logger.add(new winston.transports.File({ filename: 'logs/error.log', level: 'error' }));
    logger.add(new winston.transports.File({ filename: 'logs/combined.log' }));
}

// Stream for Morgan HTTP logging
export const stream = {
    write: (message: string) => {
        logger.info(message.trim());
    }
};

export default logger;
