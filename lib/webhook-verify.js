/**
 * lib/webhook-verify.js
 *
 * Webhook signature verification using HMAC-SHA256.
 * Prevents spoofed/forged webhook callbacks from unauthorized sources.
 *
 * Usage:
 *   const verified = verifyWebhookSignature(
 *     requestBody,
 *     signatureFromHeader,
 *     vendorSecret
 *   );
 */

const crypto = require('crypto');

/**
 * Webhook signing secret.
 * In production, this would be retrieved from environment variables
 * or a secrets management system (e.g., AWS Secrets Manager, HashiCorp Vault).
 *
 * For development/testing, this is a fixed test secret.
 * The vendor would provide this during API setup.
 */
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'test-vendor-secret-key';

/**
 * Sign a webhook payload using HMAC-SHA256.
 * The vendor calls this internally to sign their callback.
 *
 * @param {string} payload - JSON stringified request body
 * @param {string} secret - Shared webhook secret
 * @returns {string} - Hex-encoded HMAC signature
 */
function signPayload(payload, secret) {
  return crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
}

/**
 * Verify a webhook signature using constant-time comparison.
 * Prevents timing attacks.
 *
 * @param {object} requestBody - Parsed request body (will be JSON stringified)
 * @param {string} signature - Signature from webhook header (e.g., X-Webhook-Signature)
 * @param {string} secret - Shared webhook secret
 * @returns {boolean} - True if signature is valid
 */
function verifyWebhookSignature(requestBody, signature, secret) {
  if (!signature || !secret) {
    console.warn('⚠️ Missing signature or secret for webhook verification');
    return false;
  }

  // Reconstruct the payload as it was when vendor signed it
  const payload = JSON.stringify(requestBody);

  // Compute the expected signature
  const expectedSignature = signPayload(payload, secret);

  // Use timingSafeEqual to prevent timing-based attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
  } catch (err) {
    // Buffers are different lengths or signatures are malformed
    console.warn('⚠️ Webhook signature verification failed:', err.message);
    return false;
  }
}

module.exports = {
  WEBHOOK_SECRET,
  signPayload,
  verifyWebhookSignature
};
