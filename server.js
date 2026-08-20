/**
 * server.js
 *
 * Solstice Events Co. — Conference Check-In Kiosk
 * ORIGINAL PRE-PIVOT VERSION: badge printing uses a plain, synchronous
 * REST call. The check-in endpoint calls the printer endpoint and
 * *waits* for its response before doing anything else. There are no
 * queues, webhooks, or async confirmations here on purpose.
 */

const express = require('express');
const path = require('path');
const attendees = require('./data/attendees');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helper: find an attendee by ID, case-insensitive.
function findAttendee(id) {
  const normalized = String(id || '').trim().toUpperCase();
  return attendees.find((a) => a.id === normalized);
}

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
 * POST /api/printer/print
 * Simulates a badge printer's REST API. A real printer service would
 * live on its own machine; here it's just another endpoint on the
 * same server so the whole flow can run without extra hardware.
 *
 * It always takes a couple of seconds (like a real printer would) and
 * fails a small percentage of the time, to demonstrate error handling.
 */
app.post('/api/printer/print', async (req, res) => {
  const { attendeeId, name } = req.body || {};

  if (!attendeeId || !name) {
    return res.status(400).json({ success: false, error: 'Missing attendeeId or name for print job.' });
  }

  // Simulate the time it takes a physical printer to produce a badge.
  const printDurationMs = 1600 + Math.floor(Math.random() * 900); // ~1.6s - 2.5s
  await new Promise((resolve) => setTimeout(resolve, printDurationMs));

  // Simulate an occasional printer failure (jam, out of card stock, etc.)
  const FAILURE_RATE = 0.15;
  if (Math.random() < FAILURE_RATE) {
    return res.status(502).json({
      success: false,
      error: 'Printer jam detected. Clear the tray and try again.'
    });
  }

  const badgeId = `BADGE-${attendeeId}-${Date.now().toString().slice(-5)}`;
  res.json({ success: true, badgeId });
});

/**
 * POST /api/checkin/:id
 * Checks an attendee in. This is the synchronous flow:
 *   1. Find the attendee.
 *   2. Reject if they're already checked in (duplicate scan protection).
 *   3. Call the printer REST API and WAIT for its response.
 *   4. Only mark the attendee CHECKED_IN if printing succeeded.
 */
app.post('/api/checkin/:id', async (req, res) => {
  const attendee = findAttendee(req.params.id);

  if (!attendee) {
    return res.status(404).json({
      error: `No attendee found for ID "${req.params.id}". Check the ID and try again.`
    });
  }

  if (attendee.status === 'CHECKED_IN') {
    return res.status(409).json({
      error: 'This attendee has already checked in. A second badge cannot be printed.',
      attendee
    });
  }

  try {
    // Call the printer's REST API directly and wait for the result -
    // this is the synchronous part: nothing else happens until the
    // printer responds.
    const printerResponse = await fetch(`http://localhost:${PORT}/api/printer/print`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attendeeId: attendee.id, name: attendee.name })
    });

    const printResult = await printerResponse.json();

    if (!printerResponse.ok || !printResult.success) {
      // Printing failed: do NOT check the attendee in.
      return res.status(502).json({
        error: printResult.error || 'Badge printing failed. Please try again.',
        attendee
      });
    }

    // Printing succeeded: now it's safe to mark them checked in.
    attendee.status = 'CHECKED_IN';
    attendee.badgeId = printResult.badgeId;
    attendee.checkedInAt = new Date().toISOString();

    res.json({ success: true, attendee });
  } catch (err) {
    res.status(500).json({
      error: 'Could not reach the badge printer service. Please try again.',
      attendee
    });
  }
});

app.listen(PORT, () => {
  console.log(`Solstice Events check-in kiosk running at http://localhost:${PORT}`);
});
