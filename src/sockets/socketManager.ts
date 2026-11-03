import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';
import * as jwt from 'jsonwebtoken';
import { getConfig } from '../config/env';
import logger from '../config/logger';

// Handlers
import { registerBookingHandlers } from './handlers/booking.handler';
import { registerNotificationHandlers } from './handlers/notification.handler';
import { registerLocationHandlers } from './handlers/location.handler';
import { registerPresenceHandlers } from './handlers/presence.handler';
import { registerChatHandlers } from './handlers/chat.handler';
import { getActionCounts, setAdminSocketEmitter } from '../services/adminAnalytics';

let io: SocketIOServer;

const config = getConfig();

export const initSocket = (httpServer: HttpServer) => {
    const envOrigins = config.clientUrl === '*' 
        ? ['*'] 
        : config.clientUrl.split(',').map((url: string) => url.trim());

    const isSocketOriginAllowed = (origin: string | undefined): boolean => {
        if (!origin) return true;
        if (envOrigins.includes('*') || envOrigins.includes(origin)) return true;
        try {
            const url = new URL(origin);
            if (url.hostname === 'apnaustad.app' || url.hostname.endsWith('.apnaustad.app') || url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
                return true;
            }
        } catch {
            return false;
        }
        return false;
    };

    io = new SocketIOServer(httpServer, {
        pingInterval: 15000, // Send ping every 15 seconds to check if client is alive
        pingTimeout: 10000,  // Consider connection dead and disconnect if no pong received within 10 seconds
        cors: {
            origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
                if (isSocketOriginAllowed(origin)) {
                    callback(null, true);
                } else {
                    callback(null, false);
                }
            },
            methods: ["GET", "POST"],
            credentials: true,
        },
    });

    setAdminSocketEmitter((event: string, data: any) => {
        io.to('admin').emit(event, data);
    });

    // Authentication Middleware
    io.use((socket, next) => {
        const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.split(' ')[1];

        if (!token) {
            return next(new Error('Authentication error: Token missing'));
        }

        try {
            const decoded = jwt.verify(token, config.jwtSecret) as any;
            // Attach user info to socket
            (socket as any).user = decoded;
            next();
        } catch (err) {
            return next(new Error('Authentication error: Invalid token'));
        }
    });

    io.on('connection', (socket: Socket) => {
        const user = (socket as any).user;
        logger.info(`🔌 Client connected: ${socket.id} (User: ${user.id}, Type: ${user.type})`);

        // Join specific room based on user type
        if (user.type === 'user') {
            const room = `user:${user.id}`;
            socket.join(room);
            logger.info(`✅ User ${user.id} joined room: ${room}`);
        } else if (user.type === 'worker') {
            const room = `worker:${user.id}`;
            socket.join(room);
            logger.info(`✅ Worker ${user.id} joined room: ${room}`);
            // If worker has a city in token payload, join city room (for Phase 3)
            if (user.city) {
                socket.join(`city:${user.city}`);
                logger.info(`Joined room: city:${user.city}`);
            }
            logger.info(`Joined room: worker:${user.id}`);
        } else if (user.type === 'admin' || user.role === 'admin' || user.role === 'superadmin') {
            socket.join(`admin`);
            logger.info(`Joined room: admin`);
            getActionCounts()
                .then((counts: any) => socket.emit('admin:counts', counts))
                .catch(() => {});
        }

        // Register handlers
        registerBookingHandlers(io, socket);
        registerNotificationHandlers(io, socket);
        registerLocationHandlers(io, socket);
        registerPresenceHandlers(io, socket);
        registerChatHandlers(io, socket);

        socket.on('disconnect', () => {
            logger.info(`🔌 Client disconnected: ${socket.id} (User: ${user.id})`);
        });
    });

    return io;
};

export const getIO = (): SocketIOServer => {
    if (!io) {
        throw new Error("Socket.io not initialized!");
    }
    return io;
};
