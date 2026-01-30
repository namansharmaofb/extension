// Popup logic: panel-style UI, start/stop recording and send test case to backend

const API_BASE_URL = "http://localhost:4000"; // adjust if needed

const recordBtn = document.getElementById("recordBtn");
const statusText = document.getElementById("statusText");
const agentStatus = document.getElementById("agentStatus");
const testNameInput = document.getElementById("testName");
const flowSelect = document.getElementById("flowSelect");
const newFlowBtn = document.getElementById("newFlowBtn");
const saveFlowBtn = document.getElementById("saveFlowBtn");
const deleteFlowBtn = document.getElementById("deleteFlowBtn");
const runFlowBtn = document.getElementById("runFlowBtn");
const logsEl = document.getElementById("logs");
const stepsBody = document.getElementById("stepsBody");

function logLine(text) {
  const ts = new Date().toLocaleTimeString();
  logsEl.textContent += `${ts} | ${text}\n`;
  logsEl.scrollTop = logsEl.scrollHeight;
}

function renderSteps(steps = []) {
  stepsBody.innerHTML = "";
  if (!steps.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 4;
    cell.className = "steps-empty";
    cell.textContent = "No steps recorded yet.";
    row.appendChild(cell);
    stepsBody.appendChild(row);
    return;
  }

  steps.forEach((step, index) => {
    const row = document.createElement("tr");

    const idx = document.createElement("td");
    idx.textContent = String(index + 1);

    const cmd = document.createElement("td");
    cmd.textContent = step.action || "";

    const target = document.createElement("td");
    target.textContent = step.description || step.selector || "";
    if (step.description && step.selector) {
      target.title = step.selector;
    }

    const value = document.createElement("td");
    value.textContent = step.value || "";

    row.appendChild(idx);
    row.appendChild(cmd);
    row.appendChild(target);
    row.appendChild(value);
    stepsBody.appendChild(row);
  });
}

function setUI(isRecording) {
  if (isRecording) {
    recordBtn.textContent = "■ Stop";
    recordBtn.classList.add("recording");
    statusText.textContent = "Recording... perform actions in the tab";
    agentStatus.textContent = "Recording";
  } else {
    recordBtn.textContent = "● Record";
    recordBtn.classList.remove("recording");
    statusText.textContent = "Idle";
    agentStatus.textContent = "Ready";
  }
}

async function loadFlowsFromBackend() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/test-cases`);
    if (!res.ok) throw new Error(`Backend responded with status ${res.status}`);
    const flows = await res.json();

    // Clear existing options except the first "Select Flow"
    if (flowSelect) {
      flowSelect.innerHTML = '<option value="">Select Flow</option>';

      flows.forEach((flow) => {
        const opt = document.createElement("option");
        opt.value = flow.id.toString();
        opt.textContent = flow.name;
        opt.dataset.flowId = flow.id.toString();
        flowSelect.appendChild(opt);
      });
    }

    // Store in Chrome storage for persistence
    await chrome.storage.local.set({ savedFlows: flows });

    logLine(`Loaded ${flows.length} flow(s) from backend`);
  } catch (err) {
    console.error("Error loading flows", err);
    logLine("Error loading flows: " + err.message);

    // Try to load from Chrome storage as fallback
    chrome.storage.local.get(["savedFlows"], (result) => {
      if (result.savedFlows && flowSelect) {
        flowSelect.innerHTML = '<option value="">Select Flow</option>';
        result.savedFlows.forEach((flow) => {
          const opt = document.createElement("option");
          opt.value = flow.id.toString();
          opt.textContent = flow.name;
          opt.dataset.flowId = flow.id.toString();
          flowSelect.appendChild(opt);
        });
        logLine(
          `Loaded ${result.savedFlows.length} flow(s) from local storage`,
        );
      }
    });
  }
}

function init() {
  // Load flows from backend first
  loadFlowsFromBackend();

  chrome.runtime.sendMessage({ type: "GET_STATE" }, (response) => {
    if (chrome.runtime.lastError) {
      console.error(chrome.runtime.lastError);
      logLine(`Error fetching state: ${chrome.runtime.lastError.message}`);
      return;
    }
    const { isRecording, currentTestCase } = response || {};
    if (currentTestCase && currentTestCase.name) {
      testNameInput.value = currentTestCase.name;
      renderSteps(currentTestCase.steps || []);
    }
    setUI(!!isRecording);
  });
}

async function sendToBackend(testCase) {
  try {
    logLine("Sending test case to backend...");
    const res = await fetch(`${API_BASE_URL}/api/test-cases`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(testCase),
    });

    if (!res.ok) {
      throw new Error(`Backend responded with status ${res.status}`);
    }

    const data = await res.json();
    statusText.textContent = "Saved to backend (id: " + data.id + ")";
    logLine(
      `Saved test case '${testCase.name}' with id=${data.id} (${data.stepCount} steps) to database`,
    );

    // Store full test case in Chrome storage for offline access
    await chrome.storage.local.set({ [`flow_${data.id}`]: testCase });

    // Reload flows dropdown after saving
    await loadFlowsFromBackend();
  } catch (err) {
    console.error("Error sending to backend", err);
    statusText.textContent = "Error sending to backend: " + err.message;
    logLine("Error sending to backend: " + err.message);
  }
}

function onRecordClick() {
  chrome.runtime.sendMessage({ type: "GET_STATE" }, (state) => {
    if (!state) return;
    const currentlyRecording = state.isRecording;

    if (!currentlyRecording) {
      const nameFromInput = testNameInput.value.trim();
      let selectedFlowName = nameFromInput;

      if (!selectedFlowName && flowSelect && flowSelect.value) {
        // If user selected a flow from dropdown, reuse that name (overwrite)
        selectedFlowName = flowSelect.options[flowSelect.selectedIndex].text;
      }

      if (!selectedFlowName) {
        // Auto-generate unique name
        const now = new Date();
        // Format: Flow HH:MM:SS
        const timeString = now.toLocaleTimeString([], { hour12: false });
        selectedFlowName = `Flow ${timeString}`;
      }

      testNameInput.value = selectedFlowName;

      chrome.runtime.sendMessage(
        { type: "START_RECORDING", name: selectedFlowName },
        (res) => {
          if (res && res.success) {
            setUI(true);
            renderSteps([]);
            logLine(`Started recording flow '${selectedFlowName}'`);
          }
        },
      );
    } else {
      chrome.runtime.sendMessage({ type: "STOP_RECORDING" }, async (res) => {
        if (res && res.success) {
          setUI(false);
          const testCase = res.testCase || {};
          if (!testCase.name) {
            const now = new Date();
            const timeString = now.toLocaleTimeString([], { hour12: false });
            testCase.name =
              testNameInput.value.trim() ||
              (flowSelect && flowSelect.value
                ? flowSelect.options[flowSelect.selectedIndex].text
                : "") ||
              `Flow ${timeString}`;
          }
          renderSteps(testCase.steps || []);
          logLine(
            `Stopped recording. Captured ${testCase.steps?.length || 0} steps.`,
          );
          await sendToBackend(testCase);
        }
      });
    }
  });
}

function onNewFlow() {
  testNameInput.value = "";
  if (flowSelect) {
    flowSelect.value = "";
  }
  renderSteps([]);
  logLine("New flow started. Give it a name and click Save Flow if desired.");
}

function onSaveFlow() {
  const name = testNameInput.value.trim();
  if (!name) {
    alert("Please enter a flow name");
    return;
  }

  chrome.runtime.sendMessage({ type: "GET_STATE" }, async (state) => {
    if (!state || !state.currentTestCase) {
      logLine("No steps to save");
      return;
    }

    const testCase = {
      ...state.currentTestCase,
      name: name,
    };

    await sendToBackend(testCase);
  });
}

async function onDeleteFlow() {
  const selectedId = flowSelect?.value;
  if (!selectedId || selectedId === "") {
    logLine("Please select a flow to delete");
    return;
  }

  // Get flow name for confirmation
  const flowName =
    flowSelect.options[flowSelect.selectedIndex]?.textContent || "this flow";

  // Confirm deletion
  if (
    !confirm(
      `Are you sure you want to delete "${flowName}"?\n\nThis action cannot be undone.`,
    )
  ) {
    return;
  }

  try {
    logLine(`Deleting flow ID ${selectedId}...`);
    const res = await fetch(`${API_BASE_URL}/api/test-cases/${selectedId}`, {
      method: "DELETE",
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(
        errorData.error || `Backend responded with status ${res.status}`,
      );
    }

    const data = await res.json();
    logLine(data.message || `Flow '${flowName}' deleted successfully`);

    // Clear current selection
    testNameInput.value = "";
    renderSteps([]);
    flowSelect.value = "";

    // Remove from Chrome storage
    await chrome.storage.local.remove([`flow_${selectedId}`]);

    // Reload flows from backend
    await loadFlowsFromBackend();

    logLine("Flow list refreshed");
  } catch (err) {
    console.error("Error deleting flow", err);
    logLine("Error deleting flow: " + err.message);
    statusText.textContent = "Error: " + err.message;
  }
}

async function onFlowSelect() {
  const selectedId = flowSelect?.value;
  if (!selectedId || selectedId === "") {
    renderSteps([]);
    testNameInput.value = "";
    return;
  }

  try {
    logLine(`Loading flow ID ${selectedId} from database...`);
    const res = await fetch(`${API_BASE_URL}/api/test-cases/${selectedId}`);
    if (!res.ok) {
      throw new Error(
        `Backend responded with status ${res.status}. Make sure backend is running on ${API_BASE_URL}`,
      );
    }

    const testCase = await res.json();

    if (!testCase || !testCase.steps) {
      throw new Error(
        "Flow loaded but has no steps. Data may not be saved in database.",
      );
    }

    testNameInput.value = testCase.name;
    renderSteps(testCase.steps || []);
    logLine(
      `Loaded flow '${testCase.name}' with ${testCase.steps?.length || 0} steps from database`,
    );

    // Store full test case in Chrome storage for offline access
    await chrome.storage.local.set({ [`flow_${selectedId}`]: testCase });

    // Don't auto-run - user must click "Run Flow" button
  } catch (err) {
    console.error("Error loading flow", err);
    logLine("Error loading flow: " + err.message);
    statusText.textContent = "Error: " + err.message;

    // Try to load from Chrome storage as fallback
    try {
      const result = await chrome.storage.local.get([`flow_${selectedId}`]);
      if (result[`flow_${selectedId}`]) {
        const cachedFlow = result[`flow_${selectedId}`];
        testNameInput.value = cachedFlow.name;
        renderSteps(cachedFlow.steps || []);
        logLine(
          `Loaded flow '${cachedFlow.name}' from local cache (${cachedFlow.steps?.length || 0} steps)`,
        );
        // Don't auto-run - user must click "Run Flow" button
      } else {
        logLine(
          "Flow not found in local cache. Please ensure backend is running and try again.",
        );
      }
    } catch (cacheErr) {
      logLine("Failed to load from cache: " + cacheErr.message);
    }
  }
}

async function runFlow(testCase) {
  if (!testCase.steps || testCase.steps.length === 0) {
    logLine("No steps to execute");
    return;
  }

  logLine(
    `Starting execution of flow '${testCase.name}' (${testCase.steps.length} steps)...`,
  );
  agentStatus.textContent = "Running";
  agentStatus.style.color = "#fbbf24";

  try {
    // Get the active tab
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab) {
      throw new Error("No active tab found");
    }

    // Check if tab URL is injectable
    if (
      tab.url &&
      (tab.url.startsWith("chrome://") ||
        tab.url.startsWith("chrome-extension://") ||
        tab.url.startsWith("edge://"))
    ) {
      throw new Error(
        "Cannot execute on this page. Please navigate to a regular webpage (http:// or https://).",
      );
    }

    // Send START_EXECUTION to background
    const response = await chrome.runtime.sendMessage({
      type: "START_EXECUTION",
      testCase: testCase,
      tabId: tab.id,
    });

    if (response && response.success) {
      logLine("Flow execution started in background...");
    } else {
      throw new Error(response?.error || "Failed to start execution");
    }

    // Status updates will come via EXECUTION_STATUS_UPDATE message
    const statusListener = (message) => {
      if (message.type === "EXECUTION_STATUS_UPDATE") {
        if (message.success) {
          logLine(
            `Flow execution completed successfully (${message.stepCount} steps)`,
          );
          agentStatus.textContent = "Ready";
          agentStatus.style.color = "#4ade80";
          chrome.runtime.onMessage.removeListener(statusListener);
        } else if (message.error) {
          logLine(`Flow execution failed: ${message.error}`);
          agentStatus.textContent = "Error";
          agentStatus.style.color = "#ef4444";
          chrome.runtime.onMessage.removeListener(statusListener);
        } else if (message.status === "progress") {
          // Optional: log progress
        }
      }
    };
    chrome.runtime.onMessage.addListener(statusListener);
  } catch (err) {
    console.error("Error starting flow", err);
    logLine("Error starting flow: " + err.message);
    agentStatus.textContent = "Error";
    agentStatus.style.color = "#ef4444";
  }
}

async function onRunFlow() {
  const selectedId = flowSelect?.value;
  if (!selectedId || selectedId === "") {
    logLine("Please select a flow first");
    return;
  }

  // Get the test case (either from current display or load from backend)
  let testCase = null;

  // Check if we have it in Chrome storage first
  const result = await chrome.storage.local.get([`flow_${selectedId}`]);
  if (result[`flow_${selectedId}`]) {
    testCase = result[`flow_${selectedId}`];
    logLine(`Using cached flow '${testCase.name}'`);
  } else {
    // Load from backend
    try {
      logLine(`Loading flow ID ${selectedId} from database...`);
      const res = await fetch(`${API_BASE_URL}/api/test-cases/${selectedId}`);
      if (!res.ok)
        throw new Error(`Backend responded with status ${res.status}`);
      testCase = await res.json();
    } catch (err) {
      logLine("Error loading flow: " + err.message);
      return;
    }
  }

  if (!testCase || !testCase.steps || testCase.steps.length === 0) {
    logLine("Flow has no steps to execute");
    return;
  }

  // Run the flow
  await runFlow(testCase);
}

if (recordBtn) {
  recordBtn.addEventListener("click", onRecordClick);
}
if (newFlowBtn) {
  newFlowBtn.addEventListener("click", onNewFlow);
}
if (saveFlowBtn) {
  saveFlowBtn.addEventListener("click", onSaveFlow);
}
if (deleteFlowBtn) {
  deleteFlowBtn.addEventListener("click", onDeleteFlow);
}
if (runFlowBtn) {
  runFlowBtn.addEventListener("click", onRunFlow);
}
if (flowSelect) {
  flowSelect.addEventListener("change", onFlowSelect);
}

init();
