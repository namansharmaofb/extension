const puppeteer = require("puppeteer");
const path = require("path");
const mysql = require("mysql2/promise");
const cleanupUser = require("./cleanup-user");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });

const EXTENSION_PATH = path.resolve(__dirname, "../../extension-src");
const TEST_EMAIL = process.env.E2E_TEST_EMAIL || "test@example.com";
const TARGET_URL = process.env.TARGET_URL || "http://localhost:3000";
const BACKEND_URL = "http://localhost:4000";

async function fetchTestIdByName(namePattern) {
  let connection;
  try {
    connection = await mysql.createConnection({
      socketPath: "/var/run/mysqld/mysqld.sock",
      user: process.env.DB_USER || "root",
      password: process.env.DB_PASSWORD || "",
      database: process.env.DB_NAME || "test_recorder",
    });
    const [rows] = await connection.execute(
      "SELECT id FROM tests WHERE name LIKE ? LIMIT 1",
      [`%${namePattern}%`],
    );
    if (rows.length > 0) {
      console.log(
        `[DB Lookup] Found Test ID ${rows[0].id} for pattern "${namePattern}"`,
      );
      return rows[0].id;
    }
  } catch (err) {
    console.warn(
      `[DB Lookup] Failed to find test for "${namePattern}": ${err.message}`,
    );
  } finally {
    if (connection) await connection.end();
  }
  return null;
}

async function getWorker(browser) {
  // Always wait a tiny bit to let any reloads settle
  await new Promise((r) => setTimeout(r, 1000));

  const targets = browser
    .targets()
    .filter((t) => t.type() === "service_worker");
  if (targets.length > 0) {
    // Use the last target (most recently created service worker)
    const worker = await targets[targets.length - 1].worker();
    if (worker) return worker;
  }

  const workerTarget = await browser.waitForTarget(
    (target) => target.type() === "service_worker",
    { timeout: 5000 },
  );
  return await workerTarget.worker();
}

// Helper Functions for Onboarding & Feature Phases
async function get_last_ai_message(page) {
  try {
    // Selector for the AI's latest message bubble
    const selector =
      ".ai-message:last-child, [data-testid='ai-response']:last-of-type";
    await page.waitForSelector(selector, { timeout: 5000 });
    const text = await page.$eval(selector, (el) => el.innerText);
    return text.trim();
  } catch (e) {
    console.warn("get_last_ai_message failed:", e.message);
    return "";
  }
}

function get_answer_for_question(question) {
  const q = question.toLowerCase();
  if (q.includes("name")) return "Test User";
  if (q.includes("goal")) return "Automated Testing";
  if (q.includes("company")) return "Acme Corp";

  console.warn(`No pattern match for "${question}". Defaulting to "yes".`);
  return "yes";
}

const fs = require("fs");

async function file_bug(testName, errorMsg, screenshotPath) {
  console.log(`[Bug Tracker] Filing bug for "${testName}"...`);

  const bugReport = {
    id: `BUG-${Date.now()}`,
    title: `Failure in ${testName}`,
    description: errorMsg,
    screenshot: screenshotPath,
    timestamp: new Date().toISOString(),
  };

  const reportFile = path.resolve(__dirname, "bug_reports.json");

  try {
    let reports = [];
    if (fs.existsSync(reportFile)) {
      const data = fs.readFileSync(reportFile, "utf8");
      try {
        reports = JSON.parse(data);
      } catch (e) {
        // file might be corrupt or empty, start fresh
      }
    }

    reports.push(bugReport);
    fs.writeFileSync(reportFile, JSON.stringify(reports, null, 2));

    console.log(`[Bug Tracker] Bug saved to ${reportFile}`);
    console.log(`[Bug Tracker] Screenshot saved to ${screenshotPath}`);
  } catch (err) {
    console.error(`[Bug Tracker] Failed to save bug report: ${err.message}`);
  }
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

    // ONBOARDING: Interactive Phase Logic (Simulated)
    // If we are in the "onboarding" phase, we might need to answer questions.
    // This logic runs in parallel to the flow execution monitoring.
    if (testCase.name.toLowerCase().includes("onboarding")) {
      const aiMsg = await get_last_ai_message(page);
      if (aiMsg && aiMsg.includes("?")) {
        const answer = get_answer_for_question(aiMsg);
        console.log(
          `[Onboarding] AI asked: "${aiMsg}" -> Answering: "${answer}"`,
        );
        // Here we would inject the answer into the input field and click send
        // await page.type('textarea', answer);
        // await page.click('button[type="submit"]');
      }
    }

    if (latest && new Date(latest.created_at).getTime() > startTime) {
      if (latest.status === "success") {
        console.log(`Execution of ${testCase.name} Successful!`);
        return true;
      } else if (latest.status === "failed") {
        const errorMsg = latest.error_message || "Unknown error";
        const screenshotPath = `screenshots/error_${testCaseId}_${Date.now()}.png`;
        try {
          const dir = path.dirname(screenshotPath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          await page.screenshot({ path: screenshotPath });
          await file_bug(testCase.name, errorMsg, screenshotPath);
        } catch (screenshotErr) {
          console.error("Failed to take screenshot:", screenshotErr.message);
          await file_bug(testCase.name, errorMsg, "Screenshot failed");
        }

        throw new Error(
          `Execution of ${testCase.name} Failed. Error: ${errorMsg}. Duration: ${latest.duration}ms`,
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

  // Use existing Chrome profile to preserve login session
  // Set USE_CHROME_PROFILE=0 to use a fresh browser
  const useExistingProfile = process.env.USE_CHROME_PROFILE !== "0";

  let launchArgs = [
    `--disable-extensions-except=${EXTENSION_PATH}`,
    `--load-extension=${EXTENSION_PATH}`,
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--start-maximized",
  ];

  if (useExistingProfile) {
    // Use a separate test profile directory to avoid Chrome lock conflicts
    const testProfileDir = path.join(__dirname, ".chrome-test-profile");
    const sourceProfile = path.join(
      process.env.HOME,
      ".config/google-chrome/Default",
    );

    // Copy cookies and login data from main Chrome profile
    if (!fs.existsSync(testProfileDir)) {
      fs.mkdirSync(testProfileDir, { recursive: true });
    }

    // Copy essential files for login persistence
    const filesToCopy = [
      "Cookies",
      "Login Data",
      "Web Data",
      "Preferences",
      "Local Storage",
      "Extension State",
      "Service Worker",
      "Network Persistent State",
      "Extension Cookies",
    ];
    for (const file of filesToCopy) {
      const src = path.join(sourceProfile, file);
      const dest = path.join(testProfileDir, file);
      if (fs.existsSync(src)) {
        try {
          const stats = fs.statSync(src);
          if (stats.isDirectory()) {
            fs.cpSync(src, dest, { recursive: true });
          } else {
            fs.copyFileSync(src, dest);

            // Also copy companion files for SQLite
            for (const suffix of ["-journal", "-wal"]) {
              const journalSrc = src + suffix;
              const journalDest = dest + suffix;
              if (fs.existsSync(journalSrc)) {
                fs.copyFileSync(journalSrc, journalDest);
              }
            }
          }
          console.log(`Copied ${file} (and journals) to test profile`);
        } catch (e) {
          console.warn(`Could not copy ${file}: ${e.message}`);
        }
      }
    }

    console.log(`Using copied Chrome profile from: ${sourceProfile}`);
    launchArgs.push(`--user-data-dir=${testProfileDir}`);
  } else {
    console.log(
      "Using fresh browser (no profile). Set USE_CHROME_PROFILE=1 to use saved login.",
    );
  }

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: launchArgs,
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

    // Dynamic Lookup removed to prevent running old tests by accident
    // We strictly use the .env IDs now.
    const loginTestId = process.env.E2E_LOGIN_TEST_ID;
    if (loginTestId) {
      console.log(`Running Direct Login Flow (ID: ${loginTestId})...`);
      await executeTestCase(browser, page, loginTestId);
      await new Promise((r) => setTimeout(r, 5000));
    }

    const onboardingTestId = process.env.E2E_ONBOARDING_TEST_ID;
    if (onboardingTestId) {
      console.log(`Running Onboarding Flow (ID: ${onboardingTestId})...`);
      await executeTestCase(browser, page, onboardingTestId);
      await new Promise((r) => setTimeout(r, 5000));
    }

    let testIds = [];
    const suiteId = process.env.E2E_SUITE_ID;
    const mainTestId = process.env.E2E_MAIN_TEST_ID;

    if (suiteId) {
      console.log(`Fetching tests for Suite ID: ${suiteId}...`);
      const res = await fetch(`${BACKEND_URL}/api/suites/${suiteId}/tests`);
      if (!res.ok) throw new Error(`Failed to fetch suite ${suiteId}`);
      const tests = await res.json();
      testIds = tests.map((t) => t.id);
    } else if (mainTestId) {
      testIds = mainTestId.split(",").map((id) => id.trim());
    }

    if (testIds.length === 0) {
      const listRes = await fetch(`${BACKEND_URL}/api/test-cases`);
      const testCases = await listRes.json();
      const filteredCases = testCases.filter(
        (tc) => String(tc.id) !== String(loginTestId),
      );
      if (filteredCases.length > 0) {
        testIds = [filteredCases[0].id];
      }
    }

    console.log(`Planned execution: ${testIds.length} flows.`);
    const results = [];

    for (const id of testIds) {
      console.log(`\n=== Starting Flow ID: ${id} ===`);
      try {
        await executeTestCase(browser, page, id);
        results.push({ id, status: "SUCCESS" });
      } catch (err) {
        console.error(`ERROR in Flow ${id}: ${err.message}`);
        results.push({ id, status: "FAILED", error: err.message });
        // If it's a login flow failure, we should probably stop the whole thing
        if (String(id) === String(loginTestId)) {
          console.error("Login failed. Skipping remaining tests.");
          break;
        }
      }
    }

    console.log("\n" + "=".repeat(30));
    console.log("E2E RUN SUMMARY");
    console.log("=".repeat(30));
    results.forEach((r) => {
      console.log(`Flow ${r.id}: ${r.status}${r.error ? ` (${r.error})` : ""}`);
    });
    console.log("=".repeat(30));

    if (results.some((r) => r.status === "FAILED")) {
      process.exit(1);
    }
  } catch (err) {
    console.error("CRITICAL E2E ERROR:", err.message);
    process.exit(1);
  } finally {
    await new Promise((r) => setTimeout(r, 5000));
    await browser.close();
  }
}

runE2E();
