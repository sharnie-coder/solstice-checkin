/**
 * lib/retry-backoff.js
 *
 * Retry logic with exponential backoff for failed print jobs.
 * Adapted from retry-backoff-prototype by Sharnice.
 *
 * Implements:
 *   - Exponential backoff (1s, 2s, 4s, 8s, 16s, 32s, 60s capped)
 *   - Max retry attempts (5 retries + 1 initial = 6 total)
 *   - Dead-letter queue for jobs exceeding max retries
 *
 * Strategy:
 *   Attempt 1: Fail → wait 1s → Attempt 2
 *   Attempt 2: Fail → wait 2s → Attempt 3
 *   Attempt 3: Fail → wait 4s → Attempt 4
 *   Attempt 4: Fail → wait 8s → Attempt 5
 *   Attempt 5: Fail → wait 16s → Attempt 6
 *   Attempt 6: Fail → DEAD-LETTER (max retries exceeded)
 */

const queueStorage = require('./queue-storage');

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  BASE_DELAY_MS: 1000,    // 1 second base delay
  MAX_RETRIES: 5,         // 5 retries + 1 initial = 6 total attempts
  MAX_DELAY_MS: 60000     // Cap backoff at 60 seconds
};

// ============================================================================
// DEAD-LETTER QUEUE (DLQ)
// Jobs that exceed MAX_RETRIES go here for manual intervention
// ============================================================================

const deadLetterQueue = [];

function addToDeadLetter(job, reason) {
  const dlq_entry = {
    jobId: job.jobId,
    attendeeId: job.attendeeId,
    name: job.name,
    failureReason: reason,
    lastAttemptAt: new Date().toISOString(),
    attemptCount: job.attemptCount || 1,
    movedToDeadLetterAt: new Date().toISOString()
  };

  deadLetterQueue.push(dlq_entry);
  console.log(`☠️ Job moved to dead-letter queue: ${job.jobId} (${reason})`);
  return dlq_entry;
}

function getDeadLetterQueue() {
  return deadLetterQueue;
}

// ============================================================================
// EXPONENTIAL BACKOFF CALCULATION
// Copied from your retryService.js
// ============================================================================

/**
 * Calculate delay before NEXT retry using exponential backoff.
 *
 * Formula (from your prototype):
 *   delay = baseDelay × 2^(attempt - 1)
 *   capped at maxDelay
 *
 * Example with baseDelay = 1000ms:
 *   attempt 1 failed → wait 1000 × 2^0 = 1000ms
 *   attempt 2 failed → wait 1000 × 2^1 = 2000ms
 *   attempt 3 failed → wait 1000 × 2^2 = 4000ms
 *   attempt 4 failed → wait 1000 × 2^3 = 8000ms
 *
 * @param {number} attempt - the attempt number that just failed (1-based)
 * @param {number} baseDelay - starting delay in ms
 * @param {number} maxDelay - the largest delay we are allowed to wait
 * @returns {number} delay in milliseconds, capped at maxDelay
 */
function calculateBackoffDelay(attempt, baseDelay, maxDelay) {
  const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);
  return Math.min(exponentialDelay, maxDelay);
}

/**
 * Check if a job should be retried.
 *
 * @param {object} job - The failed print job
 * @returns {object} - { shouldRetry: boolean, nextRetryAt: string?, reason: string? }
 */
function shouldRetry(job) {
  const attemptCount = job.attemptCount || 1;

  if (attemptCount >= CONFIG.MAX_RETRIES + 1) {
    // Exceeded max attempts (initial + retries)
    return {
      shouldRetry: false,
      reason: `Exceeded maximum attempts (${CONFIG.MAX_RETRIES + 1})`
    };
  }

  const delay = calculateBackoffDelay(attemptCount, CONFIG.BASE_DELAY_MS, CONFIG.MAX_DELAY_MS);
  const nextRetryAt = new Date(Date.now() + delay).toISOString();

  return {
    shouldRetry: true,
    delay,
    nextRetryAt
  };
}

/**
 * Schedule a failed job for retry.
 * Updates job status and sets retry timestamp.
 *
 * @param {object} job - The failed job
 * @returns {object} - Updated job with attemptCount and nextRetryAt
 */
function scheduleRetry(job) {
  const attemptCount = (job.attemptCount || 1) + 1;
  const delay = calculateBackoffDelay(attemptCount - 1, CONFIG.BASE_DELAY_MS, CONFIG.MAX_DELAY_MS);
  const nextRetryAt = new Date(Date.now() + delay).toISOString();

  // Update job with retry information
  job.status = 'RETRY_SCHEDULED';
  job.attemptCount = attemptCount;
  job.nextRetryAt = nextRetryAt;
  job.lastFailedAt = new Date().toISOString();

  // Persist all retry metadata so retries survive a server restart.
  queueStorage.updateJob(job.jobId, {
    status: job.status,
    attemptCount: job.attemptCount,
    nextRetryAt: job.nextRetryAt,
    lastFailedAt: job.lastFailedAt
  });

  const delaySec = (delay / 1000).toFixed(1);
  console.log(
    `🔄 Job scheduled for retry: ${job.jobId} (attempt ${attemptCount}/${CONFIG.MAX_RETRIES + 1}), ` +
      `retry in ${delaySec}s`
  );

  return job;
}

/**
 * Check if a RETRY_SCHEDULED job is now due for retry.
 * Returns true if job.nextRetryAt <= now, false otherwise.
 *
 * @param {object} job - The job to check
 * @returns {boolean} - True if job should be retried now
 */
function isRetryDue(job) {
  // Older persisted jobs may predate nextRetryAt being saved. Treat those as
  // immediately due so they cannot remain stuck forever after an upgrade.
  if (!job.nextRetryAt) return true;
  const now = Date.now();
  const nextRetryAt = new Date(job.nextRetryAt).getTime();
  return now >= nextRetryAt;
}

/**
 * Requeue a job that is due for retry back to QUEUED status.
 *
 * @param {object} job - The job to requeue
 * @returns {boolean} - True if job was requeued
 */
function requeueForRetry(job) {
  if (!isRetryDue(job)) {
    return false;
  }

  // Time to retry: requeue the job
  job.status = 'QUEUED';
  console.log(
    `♻️ Job requeued for retry: ${job.jobId} (attempt ${job.attemptCount || 1}/${CONFIG.MAX_RETRIES + 1})`
  );

  return true;
}

// ============================================================================
// RETRY WORKER
// Periodically checks for jobs due for retry and requeues them
// ============================================================================

let retryWorkerInterval = null;

function startRetryWorker(processJob, intervalMs = 5000) {
  if (typeof processJob !== 'function') {
    throw new TypeError('startRetryWorker requires a print-job processor function');
  }

  if (retryWorkerInterval) {
    console.log('⚠️ Retry worker already running');
    return;
  }

  console.log(`🔧 Starting retry worker (checks every ${intervalMs}ms)`);

  retryWorkerInterval = setInterval(() => {
    const queue = queueStorage.getAll();
    let requeuedCount = 0;

    queue.forEach((job) => {
      if (job.status === 'RETRY_SCHEDULED') {
        if (isRetryDue(job)) {
          if (requeueForRetry(job)) {
            queueStorage.updateJob(job.jobId, {
              status: 'QUEUED',
              nextRetryAt: null
            });
            requeuedCount++;

            // Pick the job up immediately after requeueing it.
            Promise.resolve(processJob(job)).catch((err) => {
              console.error(`Failed to process retried job ${job.jobId}:`, err);
            });
          }
        }
      }
    });

    if (requeuedCount > 0) {
      console.log(`📤 Requeued ${requeuedCount} job(s) from retry queue`);
    }
  }, intervalMs);
}

function stopRetryWorker() {
  if (retryWorkerInterval) {
    clearInterval(retryWorkerInterval);
    retryWorkerInterval = null;
    console.log('🛑 Retry worker stopped');
  }
}

// ============================================================================
// METRICS
// ============================================================================

function getRetryStats() {
  const queue = queueStorage.getAll();

  const stats = {
    totalJobs: queue.length,
    retryScheduled: queue.filter((j) => j.status === 'RETRY_SCHEDULED').length,
    deadLetterCount: deadLetterQueue.length,
    deadLetterQueue: deadLetterQueue.slice(-20) // Last 20 for summary
  };

  return stats;
}

module.exports = {
  CONFIG,
  calculateBackoffDelay,
  shouldRetry,
  scheduleRetry,
  isRetryDue,
  requeueForRetry,
  addToDeadLetter,
  getDeadLetterQueue,
  startRetryWorker,
  stopRetryWorker,
  getRetryStats
};
