import { Response } from 'express';
import { AuthRequest } from '../middlewares/jwt.middleware';
import Booking from '../models/Booking';
import User from '../models/User';
import Worker from '../models/Workers';
import { generateAgoraCallToken } from '../services/callService';
import { activeCallService } from '../services/activeCallService';
import { sendSilentPushToRecipient } from '../services/notificationHelper';
import logger from '../config/logger';

/**
 * Initiates an in-app voice call session for an active booking.
 * Generates an Agora RTC token for the caller and validates booking authorization.
 */
export const initiateCall = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const callerId = req.tokenPayload?.id;
    const callerType = req.tokenPayload?.type; // 'user' or 'worker'
    const { bookingId } = req.body;

    logger.info(`📞 [API] initiateCall request received: caller=${callerId} (${callerType}), bookingId=${bookingId}`);

    if (!callerId || !callerType) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    if (!bookingId) {
      res.status(400).json({ success: false, message: 'bookingId is required' });
      return;
    }

    const booking = await Booking.findById(bookingId);
    if (!booking) {
      res.status(404).json({ success: false, message: 'Booking not found' });
      return;
    }

    // Only allow calling if booking is accepted or ongoing
    const allowedStatuses = ['accepted', 'ongoing'];
    if (!allowedStatuses.includes(booking.status)) {
      res.status(403).json({
        success: false,
        message: `Calls are only allowed for active bookings. Current status is ${booking.status}.`,
      });
      return;
    }

    const customerId = booking.customer.toString();
    const workerId = booking.worker.toString();

    // Verify caller belongs to this booking
    let recipientId = '';
    let recipientType: 'user' | 'worker' = 'user';

    if (callerType === 'user') {
      if (customerId !== callerId) {
        res.status(403).json({ success: false, message: 'Unauthorized for this booking' });
        return;
      }
      recipientId = workerId;
      recipientType = 'worker';
    } else if (callerType === 'worker') {
      if (workerId !== callerId) {
        res.status(403).json({ success: false, message: 'Unauthorized for this booking' });
        return;
      }
      recipientId = customerId;
      recipientType = 'user';
    } else {
      res.status(403).json({ success: false, message: 'Admins cannot initiate calls' });
      return;
    }

    // Fetch caller and recipient details (WITHOUT exposing phone numbers)
    let callerName = 'User';
    let callerAvatar = '';
    let recipientName = 'Partner';
    let recipientAvatar = '';

    if (callerType === 'user') {
      const u = await User.findById(callerId).select('fullName profileImage').lean();
      if (u) {
        callerName = u.fullName || 'Client';
        callerAvatar = u.profileImage || '';
      }
      const w = await Worker.findById(recipientId).select('fullName profileImage category').lean();
      if (w) {
        recipientName = w.fullName || 'Worker';
        recipientAvatar = w.profileImage || '';
      }
    } else {
      const w = await Worker.findById(callerId).select('fullName profileImage category').lean();
      if (w) {
        callerName = w.fullName || 'Worker';
        callerAvatar = w.profileImage || '';
      }
      const u = await User.findById(recipientId).select('fullName profileImage').lean();
      if (u) {
        recipientName = u.fullName || 'Client';
        recipientAvatar = u.profileImage || '';
      }
    }

    const channelName = `call_booking_${bookingId}`;
    const callerUid = 1;
    const callSession = generateAgoraCallToken(channelName, callerUid);

    if (!callSession) {
      res.status(500).json({
        success: false,
        message: 'Could not generate voice calling token. Please verify Agora configuration.',
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: {
        channelName: callSession.channelName,
        token: callSession.token,
        appId: callSession.appId,
        uid: callSession.uid,
        bookingId,
        caller: {
          id: callerId,
          type: callerType,
          name: callerName,
          avatar: callerAvatar,
        },
        recipient: {
          id: recipientId,
          type: recipientType,
          name: recipientName,
          avatar: recipientAvatar,
        },
      },
    });
  } catch (error: any) {
    logger.error('Error in initiateCall:', error);
    res.status(500).json({ success: false, message: error.message || 'Internal server error' });
  }
};

/**
 * Allows the recipient to fetch an Agora token to join an incoming call channel.
 */
export const getCallToken = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.tokenPayload?.id;
    const userType = req.tokenPayload?.type;
    const { bookingId } = req.params;

    if (!userId || !userType) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const booking = await Booking.findById(bookingId);
    if (!booking) {
      res.status(404).json({ success: false, message: 'Booking not found' });
      return;
    }

    const customerId = booking.customer.toString();
    const workerId = booking.worker.toString();

    if (userId !== customerId && userId !== workerId) {
      res.status(403).json({ success: false, message: 'Unauthorized for this booking call' });
      return;
    }

    const channelName = `call_booking_${bookingId}`;
    const recipientUid = 2;
    const callSession = generateAgoraCallToken(channelName, recipientUid);

    if (!callSession) {
      res.status(500).json({
        success: false,
        message: 'Failed to generate voice call token',
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: {
        channelName: callSession.channelName,
        token: callSession.token,
        appId: callSession.appId,
        uid: callSession.uid,
      },
    });
  } catch (error: any) {
    logger.error('Error in getCallToken:', error);
    res.status(500).json({ success: false, message: error.message || 'Internal server error' });
  }
};

/**
 * Checks if the authenticated user has an active ongoing or ringing call session.
 * Used for cold boot, unlocking device, and app resume state synchronization.
 */
export const getActiveCallSession = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.tokenPayload?.id;
    const userType = req.tokenPayload?.type as 'user' | 'worker';

    if (!userId || !userType) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const activeCall = activeCallService.getActiveCallForUser(userId, userType);
    if (activeCall && activeCall.status !== 'ended') {
      res.status(200).json({
        success: true,
        hasActiveCall: true,
        call: {
          bookingId: activeCall.bookingId,
          channelName: activeCall.channelName,
          callerId: activeCall.callerId,
          callerType: activeCall.callerType,
          callerName: activeCall.callerName,
          callerAvatar: activeCall.callerAvatar,
          recipientId: activeCall.recipientId,
          recipientType: activeCall.recipientType,
          status: activeCall.status,
          isCaller: activeCall.callerId === userId,
          createdAt: activeCall.createdAt,
        },
      });
      return;
    }

    res.status(200).json({
      success: true,
      hasActiveCall: false,
    });
  } catch (error: any) {
    logger.error('Error in getActiveCallSession:', error);
    res.status(500).json({ success: false, message: error.message || 'Internal server error' });
  }
};

/**
 * End or cancel an active call session via REST API fallback.
 */
export const endCallSession = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.tokenPayload?.id;
    const userType = req.tokenPayload?.type as 'user' | 'worker';
    const { bookingId } = req.body;

    if (!userId || !bookingId) {
      res.status(400).json({ success: false, message: 'bookingId is required' });
      return;
    }

    const call = activeCallService.getActiveCallByBooking(bookingId);
    if (call) {
      activeCallService.endCall(bookingId);

      // Identify partner to send silent push notification to dismiss ringing
      const partnerId = call.callerId === userId ? call.recipientId : call.callerId;
      const partnerType = call.callerId === userId ? call.recipientType : call.callerType;

      sendSilentPushToRecipient(partnerId, partnerType, {
        type: 'call_cancelled',
        bookingId,
        channelName: call.channelName,
        reason: 'ended_via_api',
      }).catch((e) => {
        logger.warn('Failed to send silent cancellation push:', e?.message);
      });
    }

    res.status(200).json({ success: true, message: 'Call ended successfully' });
  } catch (error: any) {
    logger.error('Error in endCallSession:', error);
    res.status(500).json({ success: false, message: error.message || 'Internal server error' });
  }
};


