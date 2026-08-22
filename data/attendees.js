/**
 * data/attendees.js
 *
 * In-memory attendee "database" for the check-in kiosk.
 * In a real system this would live in a proper database - for this
 * prototype a plain array is enough, and it resets each time the
 * server restarts.
 *
 * STATUS values:
 *   NOT_CHECKED_IN - Not yet attempted check-in
 *   PENDING_PRINT  - Print job has been published to the queue, awaiting webhook callback
 *   CHECKED_IN     - Print job completed successfully via webhook callback
 */

const attendees = [
  {
    id: 'ATT001',
    name: 'Alice Johnson',
    email: 'alice.johnson@example.com',
    ticketType: 'All-Access Pass',
    status: 'NOT_CHECKED_IN', // NOT_CHECKED_IN | PENDING_PRINT | CHECKED_IN
    badgeId: null,
    checkedInAt: null,
    printJobId: null // Track the async print job
  },
  {
    id: 'ATT002',
    name: 'Brian Otieno',
    email: 'brian.otieno@example.com',
    ticketType: 'Developer Pass',
    status: 'NOT_CHECKED_IN',
    badgeId: null,
    checkedInAt: null,
    printJobId: null
  },
  {
    id: 'ATT003',
    name: 'Mary Wanjiku',
    email: 'mary.wanjiku@example.com',
    ticketType: 'Speaker Pass',
    status: 'NOT_CHECKED_IN',
    badgeId: null,
    checkedInAt: null,
    printJobId: null
  }
];

module.exports = attendees;
