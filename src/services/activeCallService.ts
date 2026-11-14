import logger from '../config/logger';

export interface ActiveCall {
  bookingId: string;
  channelName: string;
  callerId: string;
  callerType: 'user' | 'worker';
  callerName: string;
  callerAvatar?: string;
  recipientId: string;
  recipientType: 'user' | 'worker';
  status: 'ringing' | 'connected' | 'ended';
  createdAt: number;
  timeoutTimer?: NodeJS.Timeout | undefined;
}

class ActiveCallService {
  private activeCalls = new Map<string, ActiveCall>(); // key: bookingId

  /**
   * Start ringing for a call session
   */
  startRinging(
    callData: Omit<ActiveCall, 'status' | 'createdAt' | 'timeoutTimer'>,
    onTimeout: () => void
  ): ActiveCall {
    // Clear existing session for booking if any
    this.endCall(callData.bookingId);

    const CALL_TIMEOUT_MS = 45000; // 45 seconds ringing timeout
    const timeoutTimer = setTimeout(() => {
      logger.info(`⏰ Call timed out for booking ${callData.bookingId} after ${CALL_TIMEOUT_MS}ms`);
      this.endCall(callData.bookingId);
      onTimeout();
    }, CALL_TIMEOUT_MS);

    const call: ActiveCall = {
      ...callData,
      status: 'ringing',
      createdAt: Date.now(),
      timeoutTimer,
    };

    this.activeCalls.set(callData.bookingId, call);
    logger.info(`📞 Active call registered: booking=${callData.bookingId}, caller=${callData.callerId}, recipient=${callData.recipientId}`);
    return call;
  }

  /**
   * Recipient answered and connected
   */
  markConnected(bookingId: string): ActiveCall | null {
    const call = this.activeCalls.get(bookingId);
    if (!call) return null;

    if (call.timeoutTimer) {
      clearTimeout(call.timeoutTimer);
      call.timeoutTimer = undefined;
    }

    call.status = 'connected';
    logger.info(`📞 Call connected for booking ${bookingId}`);
    return call;
  }

  /**
   * End or cancel a call session
   */
  endCall(bookingId: string): ActiveCall | null {
    const call = this.activeCalls.get(bookingId);
    if (!call) return null;

    if (call.timeoutTimer) {
      clearTimeout(call.timeoutTimer);
      call.timeoutTimer = undefined;
    }

    call.status = 'ended';
    this.activeCalls.delete(bookingId);
    logger.info(`📞 Call ended and removed from activeCalls: booking=${bookingId}`);
    return call;
  }

  /**
   * Get active call session by bookingId
   */
  getActiveCallByBooking(bookingId: string): ActiveCall | null {
    const call = this.activeCalls.get(bookingId);
    if (!call || call.status === 'ended') return null;
    return call;
  }

  /**
   * Find if a user or worker has any active/ringing call
   */
  getActiveCallForUser(userId: string, userType: 'user' | 'worker'): ActiveCall | null {
    for (const call of this.activeCalls.values()) {
      if (call.status === 'ended') continue;

      const isCaller = call.callerId === userId && call.callerType === userType;
      const isRecipient = call.recipientId === userId && call.recipientType === userType;

      if (isCaller || isRecipient) {
        return call;
      }
    }
    return null;
  }
}

export const activeCallService = new ActiveCallService();
