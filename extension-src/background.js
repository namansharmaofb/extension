// Background/service worker for coordinating recording state and communication
importScripts("state.js", "execution-engine.js");

// Create context menus for assertions
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "assertText",
    title: "Verify Text",
    contexts: ["all"],
  });
  chrome.contextMenus.create({
    id: "assertExists",
    title: "Verify Element Exists",
    contexts: ["all"],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!isRecording) return;
  chrome.tabs.sendMessage(
    tab.id,
    { type: "GET_LAST_RIGHT_CLICKED" },
    (response) => {
      if (response && response.step) {
        const action =
          info.menuItemId === "assertText" ? "assertText" : "assertExists";
        const step = {
          ...response.step,
          action: action,
          description: `${action === "assertText" ? "Verify text" : "Verify existence of"} "${response.step.description || response.step.target}"`,
          timestamp: Date.now(),
        };
        currentTestCase.steps.push(step);
        saveState();
        chrome.runtime
          .sendMessage({ type: "STEP_RECORDED", step })
          .catch(() => {});
      }
    },
  );
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "START_RECORDING") {
    isRecording = true;
    currentTestCase = { name: message.name || "Untitled Test", steps: [] };
    saveState();

    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const activeTab = tabs[0];
      if (activeTab) {
        const startStep = {
          action: "navigate",
          target: `url=${activeTab.url}`,
          url: activeTab.url,
          description: `Start at ${activeTab.url}`,
          timestamp: Date.now(),
        };
        currentTestCase.steps.push(startStep);
        saveState();
        chrome.runtime
          .sendMessage({ type: "STEP_RECORDED", step: startStep })
          .catch(() => {});

        try {
          await chrome.scripting.executeScript({
            target: { tabId: activeTab.id, allFrames: true },
            files: [
              "utils.js",
              "locator-builders.js",
              "recorder.js",
              "playback.js",
              "content.js",
            ],
          });

          await chrome.scripting.executeScript({
            target: { tabId: activeTab.id, allFrames: true },
            func: (state) => {
              if (window.__recorder_toggle) window.__recorder_toggle(state);
            },
            args: [true],
          });
        } catch (err) {
          console.error("Failed to start recording:", err);
        }
      }
    });

    sendResponse({ success: true });
    return true;
  } else if (message.type === "STOP_RECORDING") {
    isRecording = false;
    saveState();

    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (tabs[0]) {
        await chrome.scripting
          .executeScript({
            target: { tabId: tabs[0].id, allFrames: true },
            func: (state) => {
              if (window.__recorder_toggle) window.__recorder_toggle(state);
            },
            args: [false],
          })
          .catch(() => {});
      }
    });
    sendResponse({ success: true, testCase: currentTestCase });
  } else if (message.type === "RECORD_STEP") {
    if (message.sync) {
      currentTestCase.steps = message.steps || [];
      saveState();
      sendResponse({ success: true });
      return true;
    }

    if (isRecording && message.step) {
      currentTestCase.steps.push({ ...message.step, timestamp: Date.now() });
      saveState();
      chrome.runtime
        .sendMessage({ type: "STEP_RECORDED", step: message.step })
        .catch(() => {});
    }
    sendResponse({ success: true });
  } else if (message.type === "GET_STATE") {
    sendResponse({
      isRecording,
      currentTestCase,
      lastExecutionStatus,
      isRunning: executionState.isRunning,
      currentIndex: executionState.currentIndex,
    });
  } else if (message.type === "START_EXECUTION") {
    executionState = {
      ...executionState,
      isRunning: true,
      tabId: message.tabId,
      testId: message.testCase.id,
      steps: message.testCase.steps || [],
      currentIndex: 0,
      executingIndex: -1,
      waitingForNavigation: false,
      detectedBugs: [],
      startTime: Date.now(),
    };
    executeCurrentStep();
    sendResponse({ success: true });
  } else if (message.type === "BUG_DETECTED") {
    if (executionState.isRunning && message.bug) {
      executionState.detectedBugs.push(message.bug);
      saveState();
    }
    sendResponse({ success: true });
  } else if (message.type === "STOP_EXECUTION") {
    finishExecution(false, "User stopped execution");
    sendResponse({ success: true });
  } else if (message.type === "STEP_COMPLETE") {
    if (
      executionState.isRunning &&
      message.stepIndex === executionState.currentIndex
    ) {
      if (executionState.stepTimeout) {
        clearTimeout(executionState.stepTimeout);
        executionState.stepTimeout = null;
      }
      executionState.currentIndex++;
      executionState.activeStepAction = null;
      saveState();
      setTimeout(() => executeCurrentStep(), 1000);
    }
    sendResponse({ success: true });
  } else if (message.type === "STEP_ERROR") {
    if (executionState.isRunning) {
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
