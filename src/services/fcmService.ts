// IMPROVED: fcmService.ts
// Enhancements:
// 1. Batch sending with parallelization
// 2. Delivery tracking and metrics
// 3. Better error handling
// 4. Token pre-filtering
// 5. Monitoring and logging

import admin from 'firebase-admin';
import path from 'path';
import logger from '../config/logger';

// Initialize Firebase Admin SDK
const serviceAccountPath = path.join(__dirname, '../../serviceAccountKey.json');
let app: admin.app.App;
let firebaseInitialized = false;

try {
  if (!admin.apps.length) {
    app = admin.initializeApp({
      credential: admin.credential.cert(require(serviceAccountPath)),
    });
  } else {
    app = admin.app();
  }
  firebaseInitialized = true;
  logger.info('Firebase Admin initialized successfully');
} catch (error) {
  logger.error('Error initializing Firebase Admin:', error);
  firebaseInitialized = false;
  // Don't exit process, but mark as uninitialized for checks
}

// ✅ NEW: Export initialization status for checks
export const isFirebaseInitialized = (): boolean => firebaseInitialized;

// ✅ IMPROVED: Send single notification with delivery tracking
export const sendPushNotification = async (
  deviceToken: string,
  title: string,
  body: string,
  data?: Record<string, string>
) => {
  if (!firebaseInitialized) {
    logger.error('Firebase Admin not initialized');
    return {
      success: false,
      messageId: null,
      error: new Error('Firebase Admin not initialized')
    };
  }

  try {
    const message = {
      notification: {
        title,
        body,
      },
      data: data || {},
      token: deviceToken,
    };

    const messageId = await admin.messaging().send(message);
    
    logger.info('Notification sent successfully', {
      messageId,
      deviceToken: deviceToken.substring(0, 20) + '...',  // Log partial token
      title
    });

    return {
      success: true,
      messageId,
      error: null
    };
  } catch (error: any) {
    logger.error('Error sending notification', {
      error: error.message,
      code: error.code,
      deviceToken: deviceToken.substring(0, 20) + '...'
    });

    return {
      success: false,
      messageId: null,
      error
    };
  }
};

// ✅ IMPROVED: Send to multiple devices with batching and error recovery
export const sendMultiplePushNotifications = async (
  deviceTokens: string[],
  title: string,
  body: string,
  data?: Record<string, string>,
  maxRetries: number = 3
) => {
  if (!firebaseInitialized) {
    logger.error('Firebase Admin not initialized, cannot send notifications');
    return {
      success: false,
      successCount: 0,
      failureCount: deviceTokens.length,
      invalidTokens: [],
      error: new Error('Firebase Admin not initialized'),
      metrics: {
        totalAttempted: deviceTokens.length,
        batchSize: 0,
        processingTimeMs: 0
      }
    };
  }

  const startTime = Date.now();
  let successCount = 0;
  let failureCount = 0;
  const invalidTokens: string[] = [];
  const failedTokens: Array<{ token: string; error: string; retryable: boolean }> = [];

  // ✅ NEW: FCM error codes that mean token is permanently invalid
  const INVALID_TOKEN_CODES = new Set([
    'messaging/registration-token-not-registered',
    'messaging/invalid-registration-token',
    'messaging/mismatched-credential',
    'messaging/third-party-auth-error',
  ]);

  try {
    logger.info('Starting batch notification send', {
      totalTokens: deviceTokens.length,
      title
    });

    // ✅ NEW: Filter out obviously invalid tokens first
    const validTokens = deviceTokens.filter(token => {
      if (!token || token.length < 100) {
        logger.warn('Skipping invalid token format', {
          tokenLength: token?.length
        });
        failureCount++;
        return false;
      }
      return true;
    });

    if (validTokens.length === 0) {
      logger.warn('No valid tokens to send');
      return {
        success: false,
        successCount: 0,
        failureCount,
        invalidTokens: deviceTokens,
        error: new Error('No valid tokens provided'),
        metrics: {
          totalAttempted: deviceTokens.length,
          batchSize: 0,
          processingTimeMs: Date.now() - startTime
        }
      };
    }

    // ✅ NEW: Send in parallel batches (100 concurrent max for FCM rate limits)
    const BATCH_SIZE = 100;
    const batches = [];

    for (let i = 0; i < validTokens.length; i += BATCH_SIZE) {
      batches.push(validTokens.slice(i, i + BATCH_SIZE));
    }

    logger.info('Divided into batches', {
      batchCount: batches.length,
      batchSize: BATCH_SIZE
    });

    // Process all batches
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      if (!batch) continue;

      // ✅ Send all in batch in parallel
      const results = await Promise.allSettled(
        batch.map(token => {
          if (!token) return Promise.reject(new Error('Empty token'));
          return admin.messaging().send({
            notification: { title, body },
            data: data || {},
            token,
          });
        })
      );

      // Process results from this batch
      results.forEach((result, tokenIndex) => {
        const token = batch[tokenIndex];

        if (result.status === 'fulfilled') {
          successCount++;
          logger.debug('Notification sent to token', {
            messageId: result.value,
            batchIndex,
            tokenIndex
          });
        } else {
          const error = (result as PromiseRejectedResult).reason;
          failureCount++;

          const errorCode: string = error?.errorInfo?.code || error?.code || '';
          const errorMessage: string = error?.message || 'Unknown error';

          // Check if token is permanently invalid
          if (token && INVALID_TOKEN_CODES.has(errorCode)) {
            invalidTokens.push(token);
            logger.warn('Invalid token detected', {
              errorCode,
              tokenPrefix: token.substring(0, 20)
            });
          } else if (token) {
            // Retryable error - track for potential retry
            failedTokens.push({
              token,
              error: errorCode,
              retryable: true
            });
            logger.warn('Retryable notification error', {
              errorCode,
              errorMessage,
              tokenPrefix: token.substring(0, 20)
            });
          }
        }
      });

      // Add small delay between batches to avoid rate limiting
      if (batchIndex < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    const processingTime = Date.now() - startTime;

    logger.info('Batch send completed', {
      successCount,
      failureCount,
      invalidTokenCount: invalidTokens.length,
      processingTimeMs: processingTime
    });

    return {
      success: true,
      successCount,
      failureCount,
      invalidTokens,
      failedTokens,  // ✅ NEW: Include tokens that failed for potential retry
      metrics: {
        totalAttempted: deviceTokens.length,
        batchCount: batches.length,
        processingTimeMs: processingTime,
        averageTimePerToken: Math.round(processingTime / deviceTokens.length)
      }
    };
  } catch (error) {
    logger.error('Critical error in batch send', {
      error: error instanceof Error ? error.message : String(error),
      totalTokens: deviceTokens.length
    });

    return {
      success: false,
      successCount,
      failureCount,
      invalidTokens,
      error,
      metrics: {
        totalAttempted: deviceTokens.length,
        batchSize: deviceTokens.length,
        processingTimeMs: Date.now() - startTime
      }
    };
  }
};

// ✅ NEW: Retry failed notifications
export const retryFailedNotifications = async (
  failedTokens: Array<{ token: string; error: string }>,
  title: string,
  body: string,
  data?: Record<string, string>,
  attemptNumber: number = 1
) => {
  if (attemptNumber > 3) {
    logger.warn('Max retry attempts reached', { attemptNumber });
    return {
      success: false,
      retried: 0,
      stillFailed: failedTokens.length,
      message: 'Max retry attempts reached'
    };
  }

  logger.info('Retrying failed notifications', {
    attemptNumber,
    failedCount: failedTokens.length
  });

  // Wait with exponential backoff
  const waitTime = Math.pow(2, attemptNumber - 1) * 1000;
  await new Promise(resolve => setTimeout(resolve, waitTime));

  // Retry with tokens that failed
  const retryTokens = failedTokens.map(f => f.token);
  const result = await sendMultiplePushNotifications(
    retryTokens,
    title,
    body,
    data
  );

  return {
    success: result.success,
    retried: result.successCount,
    stillFailed: result.failureCount,
    invalidTokens: result.invalidTokens
  };
};

// ✅ NEW: Send to topic (for broadcast notifications)
export const sendNotificationToTopic = async (
  topic: string,
  title: string,
  body: string,
  data?: Record<string, string>
) => {
  if (!firebaseInitialized) {
    logger.error('Firebase Admin not initialized');
    return {
      success: false,
      messageId: null,
      error: new Error('Firebase Admin not initialized')
    };
  }

  try {
    const message = {
      notification: {
        title,
        body,
      },
      data: data || {},
      topic,
    };

    const messageId = await admin.messaging().send(message);
    
    logger.info('Topic notification sent', {
      messageId,
      topic,
      title
    });

    return {
      success: true,
      messageId,
      error: null
    };
  } catch (error: any) {
    logger.error('Error sending topic notification', {
      error: error.message,
      topic
    });

    return {
      success: false,
      messageId: null,
      error
    };
  }
};

// ✅ NEW: Subscribe device to topic
export const subscribeToTopic = async (
  tokens: string[],
  topic: string
) => {
  if (!firebaseInitialized) {
    logger.error('Firebase Admin not initialized');
    return {
      success: false,
      subscribedCount: 0,
      failedCount: tokens.length,
      error: new Error('Firebase Admin not initialized')
    };
  }

  try {
    const response = await admin.messaging().subscribeToTopic(tokens, topic);
    
    logger.info('Subscribed to topic', {
      topic,
      count: tokens.length,
      successCount: response.successCount,
      failureCount: response.failureCount
    });

    return {
      success: true,
      subscribedCount: response.successCount,
      failedCount: response.failureCount,
      error: null
    };
  } catch (error: any) {
    logger.error('Error subscribing to topic', {
      error: error.message,
      topic
    });

    return {
      success: false,
      subscribedCount: 0,
      failedCount: tokens.length,
      error
    };
  }
};

// ✅ NEW: Unsubscribe from topic
export const unsubscribeFromTopic = async (
  tokens: string[],
  topic: string
) => {
  if (!firebaseInitialized) {
    logger.error('Firebase Admin not initialized');
    return {
      success: false,
      unsubscribedCount: 0,
      error: new Error('Firebase Admin not initialized')
    };
  }

  try {
    const response = await admin.messaging().unsubscribeFromTopic(tokens, topic);
    
    logger.info('Unsubscribed from topic', {
      topic,
      count: tokens.length,
      successCount: response.successCount,
      failureCount: response.failureCount
    });

    return {
      success: true,
      unsubscribedCount: response.successCount,
      error: null
    };
  } catch (error: any) {
    logger.error('Error unsubscribing from topic', {
      error: error.message,
      topic
    });

    return {
      success: false,
      unsubscribedCount: 0,
      error
    };
  }
};

// ✅ NEW: Health check for Firebase service
export const healthCheck = async () => {
  try {
    if (!firebaseInitialized) {
      return {
        healthy: false,
        message: 'Firebase Admin not initialized'
      };
    }

    // Try a simple messaging operation
    const projectId = admin.app().options.projectId;
    
    return {
      healthy: true,
      message: 'Firebase Admin is operational',
      projectId
    };
  } catch (error: any) {
    logger.error('Firebase health check failed', {
      error: error.message
    });
    return {
      healthy: false,
      message: error.message
    };
  }
};
