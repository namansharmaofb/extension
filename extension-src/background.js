// Background/service worker for coordinating recording state and communication

let isRecording = false;
let currentTestCase = { name: "Untitled Test", steps: [] };
let lastExecutionStatus = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "START_RECORDING") {
    isRecording = true;
    currentTestCase = { name: message.name || "Untitled Test", steps: [] };
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: "SET_RECORDING", isRecording: true });
      }
    });
    sendResponse({ success: true });
  } else if (message.type === "STOP_RECORDING") {
    isRecording = false;
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: "SET_RECORDING", isRecording: false });
      }
    });
    sendResponse({ success: true, testCase: currentTestCase });
  } else if (message.type === "RECORD_STEP") {
    if (isRecording && message.step) {
      currentTestCase.steps.push({
        ...message.step,
        timestamp: Date.now()
      });
    }
    sendResponse({ success: true });
  } else if (message.type === "GET_STATE") {
    sendResponse({ isRecording, currentTestCase, lastExecutionStatus });
  } else if (message.type === "FLOW_EXECUTION_COMPLETE") {
    // Store execution status for popup to check
    lastExecutionStatus = {
      success: message.success,
      error: message.error,
      stepCount: message.stepCount,
      timestamp: Date.now()
    };
    // Try to notify popup if it's open (but don't fail if it's closed)
    chrome.runtime.sendMessage({
      type: "EXECUTION_STATUS_UPDATE",
      ...lastExecutionStatus
    }).catch(() => {
      // Popup is closed, that's fine
    });
    sendResponse({ success: true });
  }

  // Indicate async response possibility
  return true;
});
