/**
 * server.js
 *
 * Solstice Events Co. — Conference Check-In Kiosk
 * POST-PIVOT VERSION: badge printing now uses an ASYNCHRONOUS queue-based model
 * with webhook callbacks. The check-in endpoint publishes a request to the
 * message queue and returns immediately with a PENDING_PRINT status. A separate
 * webhook endpoint receives the printer's completion callback and marks the
 * attendee CHECKED_IN.
 *
 * PRODUCTION ENHANCEMENTS:
 *   - Persistent queue storage (JSON file; scales to Redis/DB)
 *   - Webhook signature verification (HMAC-SHA256)
 *
 * This models real-world async vendor APIs where you can't block waiting for
 * a physical printer to finish.
 */

const express = require('express');
const path = require('path');
const { randomUUID } = require('crypto');
const attendees = require('./data/attendees');
const queueStorage = require('./lib/queue-storage');
const { verifyWebhookSignature, signPayload, WEBHOOK_SECRET } = require('./lib/webhook-verify');
const retryBackoff = require('./lib/retry-backoff');
const { startRetryWorker } = retryBackoff;

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================================
// MESSAGE QUEUE (NOW PERSISTENT)
// Jobs are now persisted to disk (JSON file) instead of in-memory.
// Survives server restarts. In production, would use Redis or a database.
// ============================================================================

function generateJobId() {
  // UUIDs stay unique across process restarts, unlike an in-memory counter.
  return `JOB-${randomUUID()}`;
}

function publishPrintJob(attendeeId, name) {
  const jobId = generateJobId();
  const job = {
    jobId,
    attendeeId,
    name,
    publishedAt: new Date().toISOString(),
    status: 'QUEUED' // QUEUED | PROCESSING | COMPLETED | FAILED
  };

  queueStorage.add(job);
  console.log(`📤 Print job published: ${jobId} for ${attendeeId}`);

  // Simulate an asynchronous printer worker picking up the job.
  // In real life, this would be a separate service polling the queue.
  processPrintJobAsync(job);

  return jobId;
}

async function processPrintJobAsync(job) {
  // Track attempt count for retry logic
  if (!job.attemptCount) {
    job.attemptCount = 1;
  }

  queueStorage.updateJob(job.jobId, {
    status: 'PROCESSING',
    attemptCount: job.attemptCount,
    nextRetryAt: null
  });

  // Simulate the printer taking time to process the job
  const processingDurationMs = 1600 + Math.floor(Math.random() * 900); // ~1.6s - 2.5s

  await new Promise((resolve) => setTimeout(resolve, processingDurationMs));

  // Simulate printer failure (15% chance)
  const FAILURE_RATE = 0.15;
  if (Math.random() < FAILURE_RATE) {
    console.log(`❌ Print job failed: ${job.jobId} - Printer jam detected (attempt ${job.attemptCount})`);

    // Check if we should retry using exponential backoff
    const { shouldRetry, reason } = retryBackoff.shouldRetry(job);

    if (shouldRetry) {
      // Schedule for retry with exponential backoff (1s, 2s, 4s, 8s...)
      retryBackoff.scheduleRetry(job);
      return;
    } else {
      // Max retries exceeded: move to dead-letter queue for manual intervention
      retryBackoff.addToDeadLetter(job, 'Printer jam - exceeded max retry attempts');
      queueStorage.updateStatus(job.jobId, 'DEAD_LETTER');
      return;
    }
  }

  // Success: generate badge ID and trigger webhook callback
  queueStorage.updateStatus(job.jobId, 'COMPLETED');
  const badgeId = `BADGE-${job.attendeeId}-${Date.now().toString().slice(-5)}`;

  console.log(`✅ Print job completed: ${job.jobId}, badge ${badgeId}`);

  // Simulate the printer sending a webhook callback to our server
  // (We'll call our own webhook endpoint after a small delay)
  setTimeout(() => {
    triggerWebhookCallback(job.jobId, job.attendeeId, badgeId);
  }, 100);
}

function triggerWebhookCallback(jobId, attendeeId, badgeId) {
  // Simulate an external service calling our webhook endpoint
  console.log(`🔔 Simulating webhook callback for job ${jobId}`);

  const payload = { jobId, attendeeId, badgeId };
  const payloadJson = JSON.stringify(payload);
  const signature = signPayload(payloadJson, WEBHOOK_SECRET);

  fetch(`http://localhost:${PORT}/api/webhook/print-complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Signature': signature
    },
    body: payloadJson
  }).catch((err) => console.error('Webhook callback error:', err));
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function findAttendee(id) {
  const normalized = String(id || '').trim().toUpperCase();
  return attendees.find((a) => a.id === normalized);
}

// ============================================================================
// API ENDPOINTS
// ============================================================================

/**
 * GET /api/attendees/:id
 * Searches for a single attendee by ID. This is what the kiosk calls
 * when staff scan a QR code or type an ID into the search field.
 */
app.get('/api/attendees/:id', (req, res) => {
  const attendee = findAttendee(req.params.id);

  if (!attendee) {
    return res.status(404).json({
      error: `No attendee found for ID "${req.params.id}". Check the ID and try again.`
    });
  }

  res.json({ attendee });
});

/**
 * POST /api/checkin/:id
 *
 * Initiates check-in for an attendee. POST-PIVOT ASYNC VERSION:
 *
 *   1. Find the attendee.
 *   2. Reject if they're ALREADY checked in or PENDING_PRINT (duplicate scan protection).
 *   3. Publish a print job to the message queue.
 *   4. Set attendee status to PENDING_PRINT and return immediately.
 *   5. The webhook endpoint will later confirm the check-in once printing completes.
 *
 * This models real-world badge-printer APIs where you publish a request
 * and receive a callback when done, rather than blocking on the print.
 */
app.post('/api/checkin/:id', async (req, res) => {
  const attendee = findAttendee(req.params.id);

  if (!attendee) {
    return res.status(404).json({
      error: `No attendee found for ID "${req.params.id}". Check the ID and try again.`
    });
  }

  // Duplicate-scan protection: reject if already checked in or pending
  if (attendee.status === 'CHECKED_IN') {
    return res.status(409).json({
      error: 'This attendee has already checked in. A second badge cannot be printed.',
      attendee
    });
  }

  if (attendee.status === 'PENDING_PRINT') {
    return res.status(409).json({
      error: 'A badge print is already in progress for this attendee. Please wait for it to complete.',
      attendee
    });
  }

  // Publish the print job to the queue and set status to PENDING_PRINT
  const jobId = publishPrintJob(attendee.id, attendee.name);

  attendee.status = 'PENDING_PRINT';
  attendee.printJobId = jobId;
  // Don't set badgeId yet - we'll get it from the webhook callback

  res.json({
    success: true,
    message: 'Print job queued. Awaiting completion callback...',
    attendee,
    jobId
  });
});

/**
 * POST /api/webhook/print-complete
 *
 * Webhook endpoint that receives print-completion callbacks from the
 * badge-printer vendor. This is where we confirm that a badge was
 * actually printed and mark the attendee CHECKED_IN.
 *
 * SECURITY:
 *   - Verifies HMAC-SHA256 signature in X-Webhook-Signature header
 *   - Prevents spoofed/forged callbacks from unauthorized sources
 *
 * IMPORTANT: Callbacks may arrive out of order if multiple print jobs
 * complete around the same time. We must still enforce that:
 *   - Only attendees in PENDING_PRINT status can be confirmed
 *   - The jobId and attendeeId must match
 *   - No duplicate confirmations
 */
app.post('/api/webhook/print-complete', (req, res) => {
  // ========================================================================
  // STEP 1: VERIFY WEBHOOK SIGNATURE
  // ========================================================================
  const signature = req.headers['x-webhook-signature'];

  if (!signature) {
    console.warn('❌ Webhook callback missing X-Webhook-Signature header');
    return res.status(401).json({
      error: 'Missing webhook signature. Request rejected.'
    });
  }

  const isValid = verifyWebhookSignature(req.body, signature, WEBHOOK_SECRET);

  if (!isValid) {
    console.warn('❌ Webhook callback signature verification failed. Possible spoofed request.');
    return res.status(401).json({
      error: 'Webhook signature verification failed. Request rejected.'
    });
  }

  console.log('✅ Webhook signature verified');

  // ========================================================================
  // STEP 2: VALIDATE PAYLOAD
  // ========================================================================
  const { jobId, attendeeId, badgeId } = req.body || {};

  if (!jobId || !attendeeId || !badgeId) {
    return res.status(400).json({
      error: 'Missing jobId, attendeeId, or badgeId in webhook callback.'
    });
  }

  const attendee = findAttendee(attendeeId);

  if (!attendee) {
    console.warn(`⚠️ Webhook callback for unknown attendee: ${attendeeId}`);
    return res.status(404).json({
      error: `Attendee not found: ${attendeeId}`
    });
  }

  // Idempotency: if this attendee is already checked in, ignore the callback
  // (e.g., if the webhook is retried after the attendee was already confirmed)
  if (attendee.status === 'CHECKED_IN') {
    console.warn(`⚠️ Webhook callback for already-checked-in attendee: ${attendeeId}`);
    return res.json({
      success: true,
      message: 'Attendee already checked in (idempotent callback)',
      attendee
    });
  }

  // Webhook arrived for an attendee not in PENDING_PRINT state
  if (attendee.status !== 'PENDING_PRINT') {
    console.warn(
      `⚠️ Webhook callback arrived for attendee in unexpected status: ${attendeeId} (${attendee.status})`
    );
    return res.status(409).json({
      error: `Cannot confirm check-in for attendee in status: ${attendee.status}`,
      attendee
    });
  }

  // Verify the jobId matches
  if (attendee.printJobId !== jobId) {
    console.warn(
      `⚠️ Webhook jobId mismatch for ${attendeeId}: expected ${attendee.printJobId}, got ${jobId}`
    );
    return res.status(409).json({
      error: `Print job ID mismatch for attendee ${attendeeId}`,
      attendee
    });
  }

  // ========================================================================
  // STEP 3: CONFIRM CHECK-IN
  // ========================================================================
  attendee.status = 'CHECKED_IN';
  attendee.badgeId = badgeId;
  attendee.checkedInAt = new Date().toISOString();

  console.log(`✔️ Attendee confirmed checked in: ${attendeeId} with badge ${badgeId}`);

  res.json({
    success: true,
    message: 'Attendee check-in confirmed via webhook callback.',
    attendee
  });
});

/**
 * GET /api/test/print-queue
 * [DEBUG ENDPOINT] - Returns the current state of the print queue.
 * Useful for testing and understanding the async flow.
 */
app.get('/api/test/print-queue', (req, res) => {
  const queue = queueStorage.getAll();
  res.json({
    queueLength: queue.length,
    queue: queue.map((job) => ({
      ...job,
      elapsed: Date.now() - new Date(job.publishedAt).getTime()
    }))
  });
});

/**
 * POST /api/test/trigger-webhook
 * [DEBUG ENDPOINT] - Manually trigger a webhook callback for testing.
 * In a real scenario, the printer vendor would do this automatically.
 * Includes proper HMAC signature verification.
 */
app.post('/api/test/trigger-webhook', (req, res) => {
  const { jobId } = req.body || {};

  if (!jobId) {
    return res.status(400).json({ error: 'Missing jobId' });
  }

  const job = queueStorage.findById(jobId);

  if (!job) {
    return res.status(404).json({ error: `Job not found: ${jobId}` });
  }

  const badgeId = `BADGE-${job.attendeeId}-${Date.now().toString().slice(-5)}`;
  const payload = { jobId, attendeeId: job.attendeeId, badgeId };
  const payloadJson = JSON.stringify(payload);
  const signature = signPayload(payloadJson, WEBHOOK_SECRET);

  // Simulate webhook callback with signature
  fetch(`http://localhost:${PORT}/api/webhook/print-complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Signature': signature
    },
    body: payloadJson
  }).catch((err) => console.error('Webhook test error:', err));

  res.json({ success: true, message: 'Webhook callback triggered with valid signature' });
});

// ============================================================================
// SERVER START
// ============================================================================

// Retry jobs need a processor as well as a scheduler. Without this worker,
// RETRY_SCHEDULED jobs would remain queued indefinitely.
startRetryWorker(processPrintJobAsync);

app.listen(PORT, () => {
  console.log(`\n✨ Solstice Events check-in kiosk running at http://localhost:${PORT}`);
  console.log(`📋 POST-PIVOT VERSION: Async queue + webhook model`);
  console.log(`� PRODUCTION FEATURES:`);
  console.log(`   ✓ Persistent queue (JSON file → scales to Redis/DB)`);
  console.log(`   ✓ Webhook signature verification (HMAC-SHA256)`);
  console.log(`�🔔 Debug endpoints available:`);
  console.log(`   - GET  http://localhost:${PORT}/api/test/print-queue`);
  console.log(`   - POST http://localhost:${PORT}/api/test/trigger-webhook\n`);
});
