/**
 * script.js
 *
 * Handles the two things staff do at the kiosk:
 *   1. Search for an attendee by ID.
 *   2. Check that attendee in, which prints a badge via the synchronous
 *      printer REST API and only then updates their status.
 */

const searchForm = document.getElementById('search-form');
const idInput = document.getElementById('attendee-id');
const searchBtn = document.getElementById('search-btn');
const searchError = document.getElementById('search-error');
const quickIdButtons = document.querySelectorAll('.chip');

const emptyState = document.getElementById('empty-state');
const attendeeCard = document.getElementById('attendee-card');
const attendeeName = document.getElementById('attendee-name');
const attendeeIdDisplay = document.getElementById('attendee-id-display');
const attendeeEmail = document.getElementById('attendee-email');
const attendeeTicket = document.getElementById('attendee-ticket');
const badgeIdRow = document.getElementById('badge-id-row');
const attendeeBadgeId = document.getElementById('attendee-badge-id');
const statusBadge = document.getElementById('status-badge');
const printingIndicator = document.getElementById('printing-indicator');
const checkinNotice = document.getElementById('checkin-notice');
const checkinBtn = document.getElementById('checkin-btn');

const cameraToggleBtn = document.getElementById('camera-toggle-btn');
const cameraPanel = document.getElementById('camera-panel');
const cameraVideo = document.getElementById('camera-video');
const cameraCanvas = document.getElementById('camera-canvas');
const cameraStopBtn = document.getElementById('camera-stop-btn');
const showTestQrBtn = document.getElementById('show-test-qr-btn');
const qrModal = document.getElementById('qr-modal');
const qrModalClose = document.getElementById('qr-modal-close');

let currentAttendee = null;
let cameraStream = null;
let scanFrameId = null;

// ---------------------------------------------------------------------
// Camera QR scanning
// ---------------------------------------------------------------------

cameraToggleBtn.addEventListener('click', startCamera);
cameraStopBtn.addEventListener('click', stopCamera);

async function startCamera() {
  hideNotice(searchError);

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showNotice(searchError, 'This browser cannot access a camera. Enter the attendee ID manually below.');
    return;
  }

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' }
    });
    cameraVideo.srcObject = cameraStream;
    cameraPanel.classList.remove('hidden');
    cameraToggleBtn.disabled = true;
    scanFrameId = requestAnimationFrame(scanVideoFrame);
  } catch (err) {
    showNotice(
      searchError,
      'Could not access the camera. Check permissions, or enter the attendee ID manually below.'
    );
  }
}

function stopCamera() {
  if (scanFrameId) {
    cancelAnimationFrame(scanFrameId);
    scanFrameId = null;
  }
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
  }
  cameraVideo.srcObject = null;
  cameraPanel.classList.add('hidden');
  cameraToggleBtn.disabled = false;
}

// Reads frames from the live video feed and looks for a QR code in each
// one, using the jsQR library. This runs continuously (via
// requestAnimationFrame) while the camera panel is open.
function scanVideoFrame() {
  if (cameraVideo.readyState === cameraVideo.HAVE_ENOUGH_DATA && typeof jsQR === 'function') {
    cameraCanvas.width = cameraVideo.videoWidth;
    cameraCanvas.height = cameraVideo.videoHeight;
    const ctx = cameraCanvas.getContext('2d');
    ctx.drawImage(cameraVideo, 0, 0, cameraCanvas.width, cameraCanvas.height);

    const imageData = ctx.getImageData(0, 0, cameraCanvas.width, cameraCanvas.height);
    const code = jsQR(imageData.data, imageData.width, imageData.height);

    if (code && code.data) {
      const scannedId = code.data.trim();
      stopCamera();
      idInput.value = scannedId;
      searchForAttendee(scannedId);
      return;
    }
  }

  scanFrameId = requestAnimationFrame(scanVideoFrame);
}

// ---------------------------------------------------------------------
// Test QR code modal (lets staff test scanning without a printed badge)
// ---------------------------------------------------------------------

showTestQrBtn.addEventListener('click', () => {
  qrModal.classList.remove('hidden');

  if (typeof QRCode !== 'undefined') {
    ['ATT001', 'ATT002', 'ATT003'].forEach((id) => {
      const canvas = document.getElementById(`qr-${id}`);
      QRCode.toCanvas(canvas, id, {
        width: 130,
        margin: 1,
        color: { dark: '#0F1530', light: '#F4F1E8' }
      });
    });
  }
});

qrModalClose.addEventListener('click', () => qrModal.classList.add('hidden'));
qrModal.addEventListener('click', (e) => {
  if (e.target === qrModal) qrModal.classList.add('hidden');
});

// ---------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------

searchForm.addEventListener('submit', (e) => {
  e.preventDefault();
  searchForAttendee(idInput.value);
});

quickIdButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    idInput.value = btn.dataset.id;
    searchForAttendee(btn.dataset.id);
  });
});

async function searchForAttendee(rawId) {
  const id = rawId.trim();

  hideNotice(searchError);

  if (!id) {
    showNotice(searchError, 'Enter or scan an attendee ID first.');
    return;
  }

  searchBtn.disabled = true;
  searchBtn.textContent = 'Searching…';

  try {
    const response = await fetch(`/api/attendees/${encodeURIComponent(id)}`);
    const data = await response.json();

    if (!response.ok) {
      currentAttendee = null;
      renderEmptyState();
      showNotice(searchError, data.error || 'Attendee not found.');
      return;
    }

    currentAttendee = data.attendee;
    renderAttendee(currentAttendee);
  } catch (err) {
    showNotice(searchError, 'Could not reach the server. Please try again.');
  } finally {
    searchBtn.disabled = false;
    searchBtn.textContent = 'Search Attendee';
  }
}

// ---------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------

function renderEmptyState() {
  emptyState.classList.remove('hidden');
  attendeeCard.classList.add('hidden');
}

function renderAttendee(attendee) {
  emptyState.classList.add('hidden');
  attendeeCard.classList.remove('hidden');

  attendeeName.textContent = attendee.name;
  attendeeIdDisplay.textContent = attendee.id;
  attendeeEmail.textContent = attendee.email;
  attendeeTicket.textContent = attendee.ticketType;

  hideNotice(checkinNotice);
  printingIndicator.classList.add('hidden');

  if (attendee.status === 'CHECKED_IN') {
    // ✔️ Badge has been printed and confirmed
    setStatusBadge('status-checked-in', 'Checked In');
    badgeIdRow.hidden = false;
    attendeeBadgeId.textContent = attendee.badgeId || '—';
    checkinBtn.classList.add('hidden');
    showNotice(
      checkinNotice,
      '✓ Checked In Successfully',
      'notice-success'
    );
  } else if (attendee.status === 'PENDING_PRINT') {
    // ⏳ Print job has been queued, waiting for webhook callback
    setStatusBadge('status-pending-print', 'Pending Print');
    badgeIdRow.hidden = true;
    checkinBtn.classList.add('hidden');
    printingIndicator.classList.remove('hidden');
    showNotice(
      checkinNotice,
      'Badge is printing... Please wait for confirmation.',
      'notice-info'
    );
    // Start polling for completion
    pollForCheckInCompletion(attendee.id);
  } else {
    // 🟡 Not checked in yet
    setStatusBadge('status-pending', 'Not Checked In');
    badgeIdRow.hidden = true;
    checkinBtn.classList.remove('hidden');
    checkinBtn.disabled = false;
    checkinBtn.textContent = 'Check In & Print Badge';
  }
}

function setStatusBadge(className, label) {
  statusBadge.className = `status-badge ${className}`;
  statusBadge.textContent = label;
}

function showNotice(el, message, className) {
  el.textContent = message;
  el.classList.remove('hidden');
  el.classList.remove('notice-error', 'notice-success');
  if (className) {
    el.classList.add(className);
  } else {
    el.classList.add('notice-error');
  }
}

function hideNotice(el) {
  el.classList.add('hidden');
  el.textContent = '';
}

// ---------------------------------------------------------------------
// Check-in + print
// ---------------------------------------------------------------------

checkinBtn.addEventListener('click', async () => {
  if (!currentAttendee) return;

  hideNotice(checkinNotice);
  checkinBtn.disabled = true;
  setStatusBadge('status-pending-print', 'Pending Print');
  printingIndicator.classList.remove('hidden');

  try {
    const response = await fetch(`/api/checkin/${encodeURIComponent(currentAttendee.id)}`, {
      method: 'POST'
    });
    const data = await response.json();

    if (!response.ok || !data.success) {
      // Check-in failed (e.g., already checked in, already pending, or invalid attendee)
      printingIndicator.classList.add('hidden');
      currentAttendee = data.attendee || currentAttendee;

      setStatusBadge('status-error', 'Error');
      showNotice(checkinNotice, data.error || 'Could not queue print job. Please try again.', 'notice-error');
      checkinBtn.disabled = false;
      checkinBtn.textContent = 'Try Again';
      renderAttendee(currentAttendee);
      return;
    }

    // Success: Print job has been queued and is now PENDING_PRINT
    // The webhook will eventually confirm completion.
    currentAttendee = data.attendee;
    renderAttendee(currentAttendee);
    // renderAttendee will start polling via pollForCheckInCompletion
  } catch (err) {
    printingIndicator.classList.add('hidden');
    setStatusBadge('status-error', 'Error');
    showNotice(checkinNotice, 'Could not reach the server. Please try again.', 'notice-error');
    checkinBtn.disabled = false;
    checkinBtn.textContent = 'Try Again';
  }
});

// =====================================================================
// Polling for async print completion
// =====================================================================

let pollTimeoutId = null;

function pollForCheckInCompletion(attendeeId) {
  // Clear any existing timeout to avoid duplicate polls
  if (pollTimeoutId) {
    clearTimeout(pollTimeoutId);
    pollTimeoutId = null;
  }

  const poll = async () => {
    try {
      const response = await fetch(`/api/attendees/${encodeURIComponent(attendeeId)}`);
      const data = await response.json();

      if (!response.ok) {
        // Attendee not found - stop polling
        return;
      }

      const updatedAttendee = data.attendee;

      // Update the current attendee reference
      if (currentAttendee && currentAttendee.id === attendeeId) {
        currentAttendee = updatedAttendee;
      }

      if (updatedAttendee.status === 'CHECKED_IN') {
        // ✔️ Print job completed! Webhook callback has confirmed.
        printingIndicator.classList.add('hidden');
        renderAttendee(updatedAttendee);
      } else if (updatedAttendee.status === 'PENDING_PRINT') {
        // ⏳ Still waiting for webhook. Keep polling.
        pollTimeoutId = setTimeout(poll, 500); // Poll every 500ms
      } else {
        // Unexpected status - stop polling
        console.warn(`Unexpected status during poll: ${updatedAttendee.status}`);
      }
    } catch (err) {
      console.error('Polling error:', err);
      // Continue polling on network error
      pollTimeoutId = setTimeout(poll, 1000);
    }
  };

  // Start polling
  poll();
}
