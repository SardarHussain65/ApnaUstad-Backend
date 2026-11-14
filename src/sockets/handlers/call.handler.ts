import { Server, Socket } from 'socket.io';
import Booking from '../../models/Booking';
import { sendNotificationToRecipient, sendSilentPushToRecipient } from '../../services/notificationHelper';
import { activeCallService } from '../../services/activeCallService';
import logger from '../../config/logger';

export const registerCallHandlers = (io: Server, socket: Socket) => {
  const user = (socket as any).user;
  if (!user) return;

  /**
   * Caller initiates ringing to the recipient
   */
  socket.on('call:ring', async (data: {
    bookingId: string;
    channelName: string;
    recipientId: string;
    recipientType: 'user' | 'worker';
    callerName: string;
    callerAvatar?: string;
  }) => {
    try {
      const { bookingId, channelName, recipientId, recipientType, callerName, callerAvatar } = data;
      const callerId = user.id;
      const callerType = user.type;

      if (!bookingId || !recipientId || !recipientType) {
        return socket.emit('call:error', { message: 'Missing call parameters' });
      }

      // Check if booking is still active
      const booking = await Booking.findById(bookingId).select('status customer worker').lean();
      if (!booking || !['accepted', 'ongoing'].includes(booking.status)) {
        return socket.emit('call:rejected', {
          bookingId,
          reason: 'Booking is no longer active',
        });
      }

      const targetRoom = `${recipientType}:${recipientId}`;
      const callerRoom = `${callerType}:${callerId}`;
      logger.info(`📞 Emitting call:incoming to room ${targetRoom} from ${callerName} (${callerId})`);

      // 1. Register in activeCallService with 45s ringing timeout
      activeCallService.startRinging(
        {
          bookingId,
          channelName,
          callerId,
          callerType,
          callerName: callerName || 'Apna Ustad User',
          callerAvatar: callerAvatar || '',
          recipientId,
          recipientType,
        },
        () => {
          // Timeout callback: auto-dismiss on both sides after 45s
          logger.info(`📞 Call timeout triggered for booking ${bookingId}`);
          io.to(targetRoom).emit('call:ended', {
            bookingId,
            channelName,
            reason: 'timeout',
          });
          io.to(callerRoom).emit('call:ended', {
            bookingId,
            channelName,
            reason: 'timeout',
          });
          sendSilentPushToRecipient(recipientId, recipientType, {
            type: 'call_cancelled',
            bookingId,
            channelName,
            reason: 'timeout',
          }).catch((err) => {
            logger.warn('Failed to send timeout cancellation push:', err?.message);
          });
        }
      );

      // 2. Emit live socket event to recipient room
      io.to(targetRoom).emit('call:incoming', {
        bookingId,
        channelName,
        callerId,
        callerType,
        callerName: callerName || 'Apna Ustad User',
        callerAvatar: callerAvatar || '',
      });

      // 3. Send high-priority push notification with lockscreen / heads-up support
      sendNotificationToRecipient(
        recipientId,
        recipientType,
        'Incoming Voice Call',
        `${callerName || 'Apna Ustad'} is calling you...`,
        {
          type: 'incoming_call',
          bookingId,
          channelName,
          callerId: String(callerId),
          callerType: String(callerType),
          callerName: callerName || 'Apna Ustad User',
          callerAvatar: callerAvatar || '',
        }
      ).catch((err) => {
        logger.warn('Failed to send incoming call push notification:', err?.message);
      });
    } catch (error: any) {
      logger.error('Error in call:ring handler:', error);
      socket.emit('call:error', { message: 'Failed to initiate call' });
    }
  });

  /**
   * Recipient accepts the call
   */
  socket.on('call:accept', (data: {
    bookingId: string;
    channelName: string;
    callerId: string;
    callerType: 'user' | 'worker';
  }) => {
    try {
      const { bookingId, channelName, callerId, callerType } = data;
      const targetRoom = `${callerType}:${callerId}`;
      logger.info(`📞 Call accepted by ${user.id}, notifying caller in room ${targetRoom}`);

      activeCallService.markConnected(bookingId);

      io.to(targetRoom).emit('call:accepted', {
        bookingId,
        channelName,
        recipientId: user.id,
        recipientType: user.type,
      });
    } catch (error) {
      logger.error('Error in call:accept handler:', error);
    }
  });

  /**
   * Recipient declines or is busy
   */
  socket.on('call:reject', (data: {
    bookingId: string;
    channelName: string;
    callerId: string;
    callerType: 'user' | 'worker';
    reason?: string;
  }) => {
    try {
      const { bookingId, channelName, callerId, callerType, reason } = data;
      const targetRoom = `${callerType}:${callerId}`;
      logger.info(`📞 Call rejected by ${user.id} (${reason || 'declined'}), notifying room ${targetRoom}`);

      activeCallService.endCall(bookingId);

      io.to(targetRoom).emit('call:rejected', {
        bookingId,
        channelName,
        reason: reason || 'Call declined',
      });

      // Also send silent push to recipient's other devices to cancel ringing notification
      sendSilentPushToRecipient(user.id, user.type, {
        type: 'call_cancelled',
        bookingId,
        channelName,
        reason: 'declined',
      }).catch((e) => {
        logger.warn('Failed to send decline cancellation push:', e?.message);
      });
    } catch (error) {
      logger.error('Error in call:reject handler:', error);
    }
  });

  /**
   * Either party ends or cancels the call
   */
  socket.on('call:end', (data: {
    bookingId: string;
    channelName: string;
    partnerId: string;
    partnerType: 'user' | 'worker';
  }) => {
    try {
      const { bookingId, channelName, partnerId, partnerType } = data;

      activeCallService.endCall(bookingId);

      if (partnerId && partnerType) {
        const targetRoom = `${partnerType}:${partnerId}`;
        logger.info(`📞 Call ended by ${user.id}, notifying room ${targetRoom}`);

        io.to(targetRoom).emit('call:ended', {
          bookingId,
          channelName,
          endedBy: user.id,
        });

        // CRITICAL: Send silent cancellation push to partner so their push notification is dismissed immediately!
        sendSilentPushToRecipient(partnerId, partnerType, {
          type: 'call_cancelled',
          bookingId,
          channelName,
          endedBy: user.id,
        }).catch((err) => {
          logger.warn('Failed to send silent cancellation push on call:end:', err?.message);
        });
      }
    } catch (error) {
      logger.error('Error in call:end handler:', error);
    }
  });

  /**
   * Check active call state (used on app resume / reconnect)
   */
  socket.on('call:check_active', () => {
    try {
      const activeCall = activeCallService.getActiveCallForUser(user.id, user.type);
      socket.emit('call:active_state', {
        hasActiveCall: !!activeCall,
        call: activeCall
          ? {
            bookingId: activeCall.bookingId,
            channelName: activeCall.channelName,
            callerId: activeCall.callerId,
            callerType: activeCall.callerType,
            callerName: activeCall.callerName,
            callerAvatar: activeCall.callerAvatar,
            recipientId: activeCall.recipientId,
            recipientType: activeCall.recipientType,
            status: activeCall.status,
            isCaller: activeCall.callerId === user.id,
            createdAt: activeCall.createdAt,
          }
          : null,
      });
    } catch (error) {
      logger.error('Error in call:check_active handler:', error);
    }
  });
};
