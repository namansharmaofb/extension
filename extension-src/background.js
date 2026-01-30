// Background/service worker for coordinating recording state and communication

let isRecording = false;
let currentTestCase = { name: "Untitled Test", steps: [] };
let lastExecutionStatus = null;

// Execution state
let executionState = {
  isRunning: false,
  tabId: null,
  steps: [],
  currentIndex: 0,
  waitingForNavigation: false,
};

async function executeCurrentStep() {
  if (!executionState.isRunning) return;

  if (executionState.currentIndex >= executionState.steps.length) {
    // Done
    finishExecution(true);
    return;
  }

  const step = executionState.steps[executionState.currentIndex];

  console.log(
    `Executing step ${executionState.currentIndex + 1}/${executionState.steps.length}: ${step.action} on ${step.description || step.selector}`,
  );

  try {
    // Clear any previous timeout
    if (executionState.stepTimeout) {
      clearTimeout(executionState.stepTimeout);
    }

    // Set a timeout for this step (30 seconds for reliability with slow pages)
    // If no frame responds with STEP_COMPLETE, we fail.
    executionState.stepTimeout = setTimeout(() => {
      console.error(
        `Timeout waiting for step ${executionState.currentIndex + 1}/${executionState.steps.length}`,
      );
      finishExecution(
        false,
        `Timeout waiting for step ${executionState.currentIndex + 1}`,
      );
    }, 30000);

    const tab = await chrome.tabs.get(executionState.tabId);

    // Check if we need to navigate
    // SKIP strict check for archive.org to avoid breaking out of iframes/rewrites,
    // or if the URL is roughly the same.
    const currentUrl = normalizeUrl(tab.url);
    const stepUrl = normalizeUrl(step.url);

    const isArchiveOrg = currentUrl.includes("web.archive.org");

    if (step.url && currentUrl !== stepUrl && !isArchiveOrg) {
      console.log(`Step requires navigation to ${step.url}`);
      executionState.waitingForNavigation = true;
      await chrome.tabs.update(executionState.tabId, { url: step.url });
      return; // Wait for onUpdated
    }

    // Attempt to inject content script to ensure it's there
    try {
      await chrome.scripting.executeScript({
        target: { tabId: executionState.tabId},
        files: ["content.js"],
      });
    } catch (e) {
      // Ignore if already injected or other non-critical error
      console.log("Injection check:", e.message);
    }

    // Send command to content script
    // Note: We don't specify frameId, so it goes to ALL frames.
    // We rely on the fact that only the frame with the element will succeed.
    chrome.tabs.sendMessage(
      executionState.tabId,
      {
        type: "EXECUTE_SINGLE_STEP",
        step: step,
        stepIndex: executionState.currentIndex,
      },
      (response) => {
        // Handle connection error (e.g., if script didn't load yet?)
        if (chrome.runtime.lastError) {
          console.error("Msg Error:", chrome.runtime.lastError.message);
          // If content script is missing, maybe we should retry or fail?
          // The timeout will catch it eventually.
        }
      },
    );
  } catch (err) {
    if (executionState.stepTimeout) clearTimeout(executionState.stepTimeout);
    finishExecution(false, err.message);
  }
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    // Remove trailing slash for comparison
    return u.href.replace(/\/$/, "");
  } catch (e) {
    return url;
  }
}

function finishExecution(success, error = null) {
  executionState.isRunning = false;
  executionState.waitingForNavigation = false;

  const status = {
    success,
    error,
    stepCount: executionState.currentIndex + (success ? 0 : 1), // roughly
  };

  chrome.runtime
    .sendMessage({
      type: "EXECUTION_STATUS_UPDATE",
      ...status,
    })
    .catch(() => {});

  lastExecutionStatus = status;
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // 1. Maintain recording state across reloads/navigation
  if (isRecording && changeInfo.status === "complete" && tab.active) {
    chrome.tabs
      .sendMessage(tabId, {
        type: "SET_RECORDING",
        isRecording: true,
      })
      .catch(() => {
        // Ignore errors if content script isn't ready yet or strictly not injectable
      });
  }

  if (
    executionState.isRunning &&
    tabId === executionState.tabId &&
    changeInfo.status === "complete"
  ) {
    // If we were explicitly waiting for navigation, OR if a navigation happened naturally
    // (like a click causing page load), we should check if we can proceed.

    // If we were waiting for navigation, resume now.
    if (executionState.waitingForNavigation) {
      executionState.waitingForNavigation = false;
      // Give page a moment to settle?
      setTimeout(() => executeCurrentStep(), 500);
    } else {
      // If we weren't explicitly waiting, but a load happened,
      // it might be due to the previous step (Click).
      // So we should re-inject logic if needed or just let the step completion handler fire?

      // PROBLEM: If the page reloads, the content script that was processing the click is dead.
      // It never sent "STEP_COMPLETE".
      // So if we see a load complete, and we are stuck on a step that was a 'click',
      // we should assume it succeeded and move to next?

      // Let's implement that heuristic.
      const currentStep = executionState.steps[executionState.currentIndex];
      if (currentStep && currentStep.action === "click") {
        console.log(
          "Detected page load during click step. Assuming success and moving next.",
        );
        // CRITICAL: Clear the timeout before advancing to prevent race condition
        if (executionState.stepTimeout) {
          clearTimeout(executionState.stepTimeout);
          executionState.stepTimeout = null;
        }
        executionState.currentIndex++;
        setTimeout(() => executeCurrentStep(), 1000);
      }
    }
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "START_RECORDING") {
    isRecording = true;
    currentTestCase = { name: message.name || "Untitled Test", steps: [] };
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const activeTab = tabs[0];
      if (activeTab) {
        try {
          // 1. Ensure scripts are injected in all frames
          await chrome.scripting
            .executeScript({
              target: { tabId: activeTab.id, allFrames: true },
              files: ["content.js"],
            })
            .catch((e) => console.log("Injection skipped/failed:", e.message));

          // 2. toggle state in ALL frames directly
          await chrome.scripting.executeScript({
            target: { tabId: activeTab.id, allFrames: true },
            func: (state) => {
              if (window.__recorder_toggle) {
                window.__recorder_toggle(state);
              }
            },
            args: [true], // isRecording = true
          });

          // Legacy/Backup: Send message to top frame (popup might rely on this return?)
          // Actually, we just need to send response to the popup
        } catch (err) {
          console.error("Failed to start recording:", err);
        }
      }
    });
    sendResponse({ success: true });
  } else if (message.type === "STOP_RECORDING") {
    isRecording = false;
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (tabs[0]) {
        // Toggle state in ALL frames
        await chrome.scripting
          .executeScript({
            target: { tabId: tabs[0].id, allFrames: true },
            func: (state) => {
              if (window.__recorder_toggle) {
                window.__recorder_toggle(state);
              }
            },
            args: [false],
          })
          .catch(() => {});
      }
    });
    sendResponse({ success: true, testCase: currentTestCase });
  } else if (message.type === "RECORD_STEP") {
    if (isRecording && message.step) {
      currentTestCase.steps.push({
        ...message.step,
        timestamp: Date.now(),
      });
    }
    sendResponse({ success: true });
  } else if (message.type === "GET_STATE") {
    sendResponse({ isRecording, currentTestCase, lastExecutionStatus });
  }

  // EXECUTION HANDLING
  else if (message.type === "START_EXECUTION") {
    executionState = {
      isRunning: true,
      tabId: message.tabId,
      steps: message.testCase.steps || [],
      currentIndex: 0,
      waitingForNavigation: false,
    };

    executeCurrentStep();
    sendResponse({ success: true });
  } else if (message.type === "STEP_COMPLETE") {
    if (executionState.isRunning) {
      // Clear the timeout to prevent false timeout errors
      if (executionState.stepTimeout) {
        clearTimeout(executionState.stepTimeout);
        executionState.stepTimeout = null;
      }
      executionState.currentIndex++;
      executeCurrentStep();
    }
    sendResponse({ success: true });
  } else if (message.type === "STEP_ERROR") {
    if (executionState.isRunning) {
      // Clear the timeout before finishing execution
      if (executionState.stepTimeout) {
        clearTimeout(executionState.stepTimeout);
        executionState.stepTimeout = null;
      }
      finishExecution(false, message.error);
    }
    sendResponse({ success: true });
  }

  return true;
});
