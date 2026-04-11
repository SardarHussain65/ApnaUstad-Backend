import { Server as SocketIOServer, Socket } from 'socket.io';
import logger from '../../config/logger';

export const registerPresenceHandlers = (io: SocketIOServer, socket: Socket) => {
    const user = (socket as any).user;

    socket.on('disconnect', () => {
         logger.info(`Presence: ${user.type} ${user.id} went offline`);
    });
};
