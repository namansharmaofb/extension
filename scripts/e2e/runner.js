const puppeteer = require("puppeteer");
const path = require("path");
const cleanupUser = require("./cleanup-user");
require("dotenv").config();

const EXTENSION_PATH = path.resolve(__dirname, "../../extension-src");
const TEST_EMAIL = process.env.E2E_TEST_EMAIL || "test@example.com";
const TARGET_URL = process.env.TARGET_URL || "http://localhost:3000";
const BACKEND_URL = "http://localhost:4000";

async function getWorker(browser) {
  const workerTarget = await browser.waitForTarget(
    (target) => target.type() === "service_worker",
  );
  return await workerTarget.worker();
}

async function executeTestCase(browser, page, testCaseId) {
  const startTime = Date.now();
  const res = await fetch(`${BACKEND_URL}/api/test-cases/${testCaseId}`);
  if (!res.ok)
    throw new Error(`Failed to fetch test case ${testCaseId} from backend`);
  const testCase = await res.json();

  console.log(
    `Starting execution for flow: ${testCase.name} (ID: ${testCaseId})`,
  );

  // Always re-find the worker to avoid "Execution context is not available" errors if it suspended
  const worker = await getWorker(browser);

  // Clear previous debug logs
  await worker.evaluate(async () => {
    await chrome.storage.local.set({ e2e_debug_logs: [] });
  });

  // Start execution
  await worker.evaluate(async (tc) => {
    const log = async (msg) => {
      const { e2e_debug_logs = [] } =
        await chrome.storage.local.get("e2e_debug_logs");
      e2e_debug_logs.push(`[${new Date().toISOString()}] ${msg}`);
      await chrome.storage.local.set({ e2e_debug_logs });
    };

    await log("Worker: START_EXECUTION triggered");
    const tabs = await chrome.tabs.query({});
    const targetTab = tabs.find(
      (t) =>
        t.url &&
        (t.url.includes("localhost:3007") || t.url.includes("localhost:3000")),
    );

    if (!targetTab) {
      await log("Worker: Target tab not found!");
      return { error: "Target tab not found" };
    }

    await log(`Worker: Target tab ID ${targetTab.id}, URL: ${targetTab.url}`);

    if (typeof executeCurrentStep === "function") {
      executionState = {
        isRunning: true,
        tabId: targetTab.id,
        testId: tc.id,
        steps: tc.steps || [],
        currentIndex: 0,
        executingIndex: -1,
        waitingForNavigation: false,
        detectedBugs: [],
        startTime: Date.now(),
      };
      await log(
        `Worker: Starting engine with ${executionState.steps.length} steps`,
      );
      executeCurrentStep();
      return { success: true };
    } else {
      await log("Worker: executeCurrentStep NOT FOUND");
      return { error: "executeCurrentStep not found" };
    }
  }, testCase);

  // Monitor for completion and poll logs
  let attempts = 0;
  const maxAttempts = 180; // 6 minutes
  let lastLogIndex = 0;

  while (attempts < maxAttempts) {
    // Re-check worker for polling too
    let workerForPolling;
    try {
      workerForPolling = await getWorker(browser);
    } catch (e) {
      console.warn("Retrying worker connection for logs...");
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }

    const logs = await workerForPolling
      .evaluate(async () => {
        const { e2e_debug_logs = [] } =
          await chrome.storage.local.get("e2e_debug_logs");
        return e2e_debug_logs;
      })
      .catch((err) => {
        // Context might have detached during evaluate
        return null;
      });

    if (logs && logs.length > lastLogIndex) {
      for (let i = lastLogIndex; i < logs.length; i++) {
        console.log(`WORKER DEBUG: ${logs[i]}`);
      }
      lastLogIndex = logs.length;
    }

    const execRes = await fetch(
      `${BACKEND_URL}/api/tests/${testCaseId}/executions`,
    );
    const executions = await execRes.json();
    const latest = executions[0];

    if (latest && new Date(latest.created_at).getTime() > startTime) {
      if (latest.status === "success") {
        console.log(`Execution of ${testCase.name} Successful!`);
        return true;
      } else if (latest.status === "failed") {
        throw new Error(
          `Execution of ${testCase.name} Failed. Duration: ${latest.duration}ms`,
        );
      }
    }

    await new Promise((r) => setTimeout(r, 2000));
    attempts++;
  }

  throw new Error(`Execution of ${testCase.name} Timed Out`);
}

async function runE2E() {
  console.log("Starting Daily E2E Run...");
  await cleanupUser(TEST_EMAIL);

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--start-maximized",
    ],
  });

  try {
    const pages = await browser.pages();
    const page = pages[0];

    console.log(`Navigating to ${TARGET_URL}...`);
    await page.goto(TARGET_URL, { waitUntil: "networkidle2" });

    // Initial worker check
    await getWorker(browser);
    console.log("Extension background worker found.");

    await new Promise((r) => setTimeout(r, 5000));

    const loginTestId = process.env.E2E_LOGIN_TEST_ID;
    if (loginTestId) {
      console.log(`Running Login Flow (ID: ${loginTestId})...`);
      await executeTestCase(browser, page, loginTestId);
      await new Promise((r) => setTimeout(r, 5000));
    }

    let mainTestId = process.env.E2E_MAIN_TEST_ID;
    if (!mainTestId) {
      const listRes = await fetch(`${BACKEND_URL}/api/test-cases`);
      const testCases = await listRes.json();
      const filteredCases = testCases.filter(
        (tc) => String(tc.id) !== String(loginTestId),
      );
      mainTestId = filteredCases[0].id;
    }

    console.log(`Running Main Test Flow (ID: ${mainTestId})...`);
    await executeTestCase(browser, page, mainTestId);

    console.log("Total E2E Run Successful!");
  } catch (err) {
    console.error("E2E ERROR:", err.message);
    process.exit(1);
  } finally {
    await new Promise((r) => setTimeout(r, 5000));
    await browser.close();
  }
}

runE2E();
