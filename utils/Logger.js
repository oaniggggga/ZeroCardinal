const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');
const util = require('util');

// Define log format
const logFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message }) => {
        return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    })
);

// Define console format with colors
const consoleFormat = winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp({ format: 'HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message }) => {
        return `[${timestamp}] ${level}: ${message}`;
    })
);

const logger = winston.createLogger({
    level: 'info',
    format: logFormat,
    transports: [
        // Daily rotation for error logs
        new DailyRotateFile({
            filename: path.join(__dirname, '..', 'logs', 'error-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            level: 'error',
            maxSize: '20m',
            maxFiles: '14d',
            zippedArchive: true
        }),
        // Daily rotation for combined logs
        new DailyRotateFile({
            filename: path.join(__dirname, '..', 'logs', 'combined-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            maxSize: '20m',
            maxFiles: '14d',
            zippedArchive: true
        }),
        // Console output
        new winston.transports.Console({
            format: consoleFormat
        })
    ]
});

const chatLogger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.printf(({ timestamp, message }) => {
            return `[${timestamp}] ${message}`;
        })
    ),
    transports: [
        new DailyRotateFile({
            filename: path.join(__dirname, '..', 'logs', 'chat-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            maxSize: '20m',
            maxFiles: '30d',
            zippedArchive: true
        })
    ]
});

// Wrapper class to maintain static method compatibility
class Logger {
    static setWebServer(ws) {
        Logger.webServer = ws;
    }

    static broadcast(level, message) {
        if (Logger.webServer) {
            // Strip ANSI codes if needed, or leave for frontend to handle (frontend handles raw text usually)
            // But winston colorize adds codes. 
            // Better to strip them for the web view.
            const cleanMsg = message.replace(/\u001b\[\d+m/g, '');
            Logger.webServer.broadcastLog(level, cleanMsg);
        }
    }

    static info(message, ...args) {
        const msg = util.format(message, ...args);
        logger.info(msg);
        Logger.broadcast('info', msg);
    }

    static warn(message, ...args) {
        const msg = util.format(message, ...args);
        logger.warn(msg);
        Logger.broadcast('warn', msg);
    }

    static error(message, ...args) {
        const msg = util.format(message, ...args);
        logger.error(msg);
        Logger.broadcast('error', msg);
    }

    static debug(message, ...args) {
        const msg = util.format(message, ...args);
        logger.debug(msg);
        Logger.broadcast('debug', msg);
    }

    static log(tag, message, ...args) {
        // Map 'log' generic calls to info, including the tag in the message
        const msg = `[${tag}] ${util.format(message, ...args)}`;
        logger.info(msg);
        Logger.broadcast('info', msg);
    }

    // Helper for WebServer to get recent logs (not implemented in Winston wrapper easily without transport)
    // We can rely on file reading or just start empty.
    static getRecentLogs() {
        return []; // Parsing files is complex, let's start fresh for now or implement memory cache if needed later
    }

    static chat(message) {
        chatLogger.info(message);
    }
}

module.exports = Logger;
