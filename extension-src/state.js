// Global state and persistence for the background service worker

let isRecording = false;
let currentTestCase = { name: "Untitled Test", steps: [] };
let lastExecutionStatus = null;

// Execution state
let executionState = {
  isRunning: false,
  tabId: null,
  testId: null,
  steps: [],
  currentIndex: 0,
  executingIndex: -1,
  waitingForNavigation: false,
  activeStepAction: null,
  stepTimeout: null,
  detectedBugs: [], // [{stepIndex, type, message}]
  startTime: null,
};

/**
 * Persistence: Save state to storage to handle service worker suspension.
 */
async function saveState() {
  try {
    await chrome.storage.local.set({
      recorder_isRecording: isRecording,
      recorder_currentTestCase: currentTestCase,
      recorder_executionState: {
        ...executionState,
        stepTimeout: null, // Don't persist timeout handles
      },
      lastExecutionStatus: lastExecutionStatus,
    });
  } catch (e) {
    console.warn("Failed to save state:", e);
  }
}

/**
 * Persistence: Load state from storage on startup.
 */
async function loadState() {
  const data = await chrome.storage.local.get([
    "recorder_isRecording",
    "recorder_currentTestCase",
    "recorder_executionState",
    "lastExecutionStatus",
  ]);

  if (data.recorder_isRecording !== undefined)
    isRecording = data.recorder_isRecording;
  if (data.recorder_currentTestCase)
    currentTestCase = data.recorder_currentTestCase;
  if (data.lastExecutionStatus) lastExecutionStatus = data.lastExecutionStatus;

  if (data.recorder_executionState) {
    executionState = { ...executionState, ...data.recorder_executionState };

    // Auto-resume if we were running
    if (executionState.isRunning && typeof executeCurrentStep === "function") {
      console.log("Resuming execution after background restart...");
      // Wrap in a slight delay to ensure everything is initialized
      setTimeout(() => executeCurrentStep(), 1000);
    }
  }
}

// Initial load
loadState();
