import { RtcTokenBuilder, RtcRole } from 'agora-token';
import { getConfig } from '../config/env';
import logger from '../config/logger';

const config = getConfig();

export interface AgoraCallSession {
  channelName: string;
  appId: string;
  token: string;
  uid: number;
}

/**
 * Generates a secure RTC token for an in-app voice call session.
 * @param channelName Unique identifier for the call channel (e.g., call_booking_12345)
 * @param uid Numeric user identifier (0 lets Agora auto-assign a UID)
 * @param role Publisher (can speak) or Subscriber (listen only)
 * @param expireTimeInSeconds Expiration in seconds (default: 3600 = 1 hour)
 */
export const generateAgoraCallToken = (
  channelName: string,
  uid: number = 0,
  role: number = RtcRole.PUBLISHER,
  expireTimeInSeconds: number = 3600
): AgoraCallSession | null => {
  const currentConfig = getConfig();
  const appId = currentConfig.agoraAppId || process.env.AGORA_APP_ID || 'e537fd5b737642d79399d4c550d0887e';
  const appCertificate = currentConfig.agoraAppCertificate || process.env.AGORA_APP_CERTIFICATE || 'f67e98a1033f400db09f451a08bf5658';

  if (!appId || !appCertificate) {
    logger.error('Agora App ID or App Certificate is missing in environment variables.');
    return null;
  }

  try {
    const token = RtcTokenBuilder.buildTokenWithUid(
      appId,
      appCertificate,
      channelName,
      uid,
      role,
      expireTimeInSeconds,
      expireTimeInSeconds
    );

    if (!token) {
      logger.error('Failed to generate Agora token. Check if Agora App ID and Certificate are valid.');
      return null;
    }

    return {
      channelName,
      appId,
      token,
      uid,
    };
  } catch (error) {
    logger.error('Error generating Agora token:', error);
    return null;
  }
};

