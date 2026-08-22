/**
 * lib/queue-storage.js
 *
 * Persistent print queue storage using JSON file.
 * In production, this would use Redis or a database,
 * but for this sprint, a JSON file provides durability
 * without external dependencies.
 */

const fs = require('fs');
const path = require('path');

const QUEUE_FILE = path.join(__dirname, '..', 'data', 'print-queue.json');

// Ensure data directory exists
const dataDir = path.dirname(QUEUE_FILE);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

/**
 * Load queue from disk (or initialize empty)
 */
function loadQueue() {
  try {
    if (fs.existsSync(QUEUE_FILE)) {
      const data = fs.readFileSync(QUEUE_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.warn('⚠️ Failed to load queue from disk:', err.message);
  }
  return [];
}

/**
 * Save queue to disk
 */
function saveQueue(queue) {
  try {
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2), 'utf8');
  } catch (err) {
    console.error('❌ Failed to save queue to disk:', err.message);
  }
}

/**
 * Get all jobs in queue
 */
function getAll() {
  return loadQueue();
}

/**
 * Add a new job to the queue
 */
function add(job) {
  const queue = loadQueue();
  queue.push(job);
  saveQueue(queue);
  return job;
}

/**
 * Find a job by ID
 */
function findById(jobId) {
  const queue = loadQueue();
  return queue.slice().reverse().find((j) => j.jobId === jobId);
}

/**
 * Find a job by attendee ID
 */
function findByAttendeeId(attendeeId) {
  const queue = loadQueue();
  return queue.find((j) => j.attendeeId === attendeeId && j.status !== 'FAILED');
}

/**
 * Update job status
 */
function updateStatus(jobId, newStatus) {
  return updateJob(jobId, { status: newStatus });
}

/**
 * Update persisted fields on the most recently created matching job.
 */
function updateJob(jobId, updates) {
  const queue = loadQueue();
  const job = queue.slice().reverse().find((j) => j.jobId === jobId);
  if (job) {
    Object.assign(job, updates);
    saveQueue(queue);
  }
  return job;
}

/**
 * Clear queue (for testing)
 */
function clear() {
  saveQueue([]);
}

module.exports = {
  getAll,
  add,
  findById,
  findByAttendeeId,
  updateStatus,
  updateJob,
  clear,
  loadQueue,
  saveQueue
};
