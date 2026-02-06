// Engine for finding elements and executing commands during flow playback

/**
 * Verifies that an element exists or contains specific text.
 * @param {Object} step
 */
async function verifyAssertion(step) {
  const element = locateElement(step);

  if (step.action === "assertExists") {
    if (!element || !isElementVisible(element)) {
      throw new Error(
        `Assertion Failed: Element not found or not visible for: ${step.description}`,
      );
    }
    highlightElement(element);
    return true;
  }

  if (step.action === "assertText") {
    if (!element) {
      throw new Error(
        `Assertion Failed: Element not found for: ${step.description}`,
      );
    }
    const actualText = getVisibleText(element);
    const expectedText = step.selectors?.innerText || step.description;

    if (!actualText.includes(expectedText)) {
      throw new Error(
        `Assertion Failed: Expected text "${expectedText}" but found "${actualText}"`,
      );
    }
    highlightElement(element);
    return true;
  }
  return false;
}

/**
 * Safely executes querySelectorAll and returns an array of elements.
 * Prevents crashes on invalid selectors (e.g. Playwright prefixes).
 */
function safeQuerySelectorAll(selector, root = document) {
  if (!selector || typeof selector !== "string") return [];

  // Quick prevent for common invalid playwright-style selectors
  if (
    selector.startsWith("aria/") ||
    selector.startsWith("xpath/") ||
    selector.startsWith("//")
  ) {
    return [];
  }

  try {
    return Array.from(root.querySelectorAll(selector));
  } catch (e) {
    return [];
  }
}

function locateElement(step) {
  let element = null;
  // 1. Try new selector array format
  if (
    step.selectors &&
    Array.isArray(step.selectors) &&
    step.selectors.length > 0
  ) {
    element = locateElementWithSelectorArray(step);
  }

  // 2. Try legacy single selector if array fails or is missing
  if (!element) {
    element = locateElementLegacy(step);
  }

  // 3. Try fuzzy search as last resort before giving up
  if (!element) {
    element = fuzzyFallbackSearch(step);
  }

  // 4. Try deep shadow DOM search for the main selector
  if (!element && step.target) {
    const target = step.target;
    // Don't pass prefixed ones to querySelector
    if (
      !target.startsWith("aria/") &&
      !target.startsWith("xpath/") &&
      !target.startsWith("//")
    ) {
      element = deepQuerySelector(target);
    }
  }

  return element;
}

/**
 * Locates element using new selector array format with Shadow DOM support.
 * @param {Object} step
 * @returns {HTMLElement|null}
 */
function locateElementWithSelectorArray(step) {
  const { selectors } = step;

  for (const selectorGroup of selectors) {
    const selector = Array.isArray(selectorGroup)
      ? selectorGroup[0]
      : selectorGroup;

    if (!selector || typeof selector !== "string") continue;

    try {
      let el = null;

      // ARIA Selector (Puppeteer format: "aria/Button Text")
      if (selector.startsWith("aria/")) {
        const ariaText = selector.slice(5);
        el = findByAriaLabel(ariaText);
        if (el && isElementVisible(el)) {
          logSelectorSuccess(selector, el);
          return el;
        } else if (el) {
          logExecution(
            `Strategy ${selector} found element but it was not visible`,
            "warning",
          );
        } else {
          logExecution(
            `Strategy ${selector} found NO matching elements`,
            "info",
          );
        }
      }
      // XPath selector
      else if (selector.startsWith("xpath/")) {
        const xpath = selector.slice(6);
        const els = getElementsByXPath(xpath);
        el = els.find(isElementVisible) || els[0];
        if (el) {
          logSelectorSuccess(selector, el);
          return el;
        } else if (els.length > 0) {
          logExecution(
            `Strategy ${selector} found ${els.length} elements but none were visible`,
            "warning",
          );
        } else {
          logExecution(
            `Strategy ${selector} found NO matching elements`,
            "info",
          );
        }
      }
      // CSS selector (default)
      else {
        // Try normal first
        const elements = safeQuerySelectorAll(selector);
        el = elements.find(isElementVisible) || elements[0];

        // Try deep shadow if not found
        if (!el) el = deepQuerySelector(selector);

        if (el) {
          logSelectorSuccess(selector, el);
          return el;
        } else if (elements.length > 0) {
          logExecution(
            `Strategy ${selector} found ${elements.length} elements but none were visible`,
            "warning",
          );
        } else {
          logExecution(
            `Strategy ${selector} found NO matching elements`,
            "info",
          );
        }
      }
    } catch (e) {
      logExecution(
        `Selector strategy failed: ${selector} - ${e.message}`,
        "error",
      );
    }
  }
  return null;
}

/**
 * Finds element by ARIA label (accessible name).
 * @param {string} ariaText
 * @returns {HTMLElement|null}
 */
function findByAriaLabel(ariaText) {
  const normalizedSearch = ariaText.trim().toLowerCase();

  // Try exact match first
  const allElements = document.querySelectorAll("*");
  for (const el of allElements) {
    // Check aria-label
    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel && ariaLabel.trim().toLowerCase() === normalizedSearch) {
      return el;
    }

    // Check aria-labelledby
    const ariaLabelledBy = el.getAttribute("aria-labelledby");
    if (ariaLabelledBy) {
      const labelEl = document.getElementById(ariaLabelledBy);
      if (labelEl) {
        const labelText = getVisibleText(labelEl).trim().toLowerCase();
        if (labelText === normalizedSearch) {
          return el;
        }
      }
    }

    // Check connected label (for inputs)
    if (el.id) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label) {
        const labelText = getVisibleText(label).trim().toLowerCase();
        if (labelText === normalizedSearch) {
          return el;
        }
      }
    }

    // Check button/link text content
    if (el.tagName === "BUTTON" || el.tagName === "A") {
      const text = getVisibleText(el).trim().toLowerCase();
      if (text === normalizedSearch) {
        return el;
      }
    }

    // Check placeholder
    if (el.hasAttribute("placeholder")) {
      const placeholder = el.getAttribute("placeholder").trim().toLowerCase();
      if (placeholder === normalizedSearch) {
        return el;
      }
    }
  }

  // Try partial match
  for (const el of allElements) {
    const ariaLabel = el.getAttribute("aria-label");
    if (
      ariaLabel &&
      ariaLabel.trim().toLowerCase().includes(normalizedSearch)
    ) {
      return el;
    }

    if (el.tagName === "BUTTON" || el.tagName === "A") {
      const text = getVisibleText(el).trim().toLowerCase();
      if (text.includes(normalizedSearch)) {
        return el;
      }
    }
  }

  return null;
}

/**
 * Legacy locator for backward compatibility.
 * @param {Object} step
 * @returns {HTMLElement|null}
 */
function locateElementLegacy(step) {
  const { targets, target, selectors, selector, selectorType } = step;

  const activeTargets = [];

  // 1. Build a list of candidate locators (Normalizing new and old formats)
  if (targets && Array.isArray(targets)) {
    targets.forEach((t) => {
      if (typeof t === "object" && t.type && t.value) {
        // New structure: {type, value}
        activeTargets.push({ type: t.type, value: t.value });
      } else if (Array.isArray(t) && t.length >= 1) {
        // Transition structure: ["prefix=value", "type"]
        const parts = t[0].split("=");
        if (parts.length >= 2) {
          activeTargets.push({
            type: parts[0],
            value: t[0].slice(parts[0].length + 1),
          });
        }
      }
    });
  }

  // Handle high-level target/selector fields
  if (selector && selectorType) {
    activeTargets.unshift({ type: selectorType, value: selector });
  } else if (target && typeof target === "string") {
    if (target.includes("=")) {
      // Old Selenium style string: "type=value"
      const parts = target.split("=");
      activeTargets.unshift({
        type: parts[0],
        value: target.slice(parts[0].length + 1),
      });
    } else {
      // Raw string: check for Playwright-style prefixes
      if (target.startsWith("aria/")) {
        activeTargets.unshift({ type: "aria", value: target.slice(5) });
      } else if (target.startsWith("xpath/")) {
        activeTargets.unshift({ type: "xpath", value: target.slice(6) });
      } else if (target.startsWith("//")) {
        activeTargets.unshift({ type: "xpath", value: target });
      } else {
        // Raw string: assume CSS
        activeTargets.unshift({ type: "css", value: target });
      }
    }
  }

  // 2. Try each locator strategy
  for (const locator of activeTargets) {
    try {
      let el = null;
      const { type, value } = locator;

      if (type === "id") {
        const elements = document.querySelectorAll(
          `[id="${CSS.escape(value)}"]`,
        );
        for (const candidate of elements) {
          if (isElementVisible(candidate)) {
            el = candidate;
            break;
          }
        }
      } else if (type === "css" || type === "css:finder") {
        const elements = safeQuerySelectorAll(value);
        for (const candidate of elements) {
          if (isElementVisible(candidate)) {
            el = candidate;
            break;
          }
        }
      } else if (type === "aria") {
        el = findByAriaLabel(value);
      } else if (type === "xpath" || type.startsWith("xpath:")) {
        const els = getElementsByXPath(value);
        if (els.length > 0) el = els[0];
      } else if (type === "linkText") {
        const links = document.getElementsByTagName("a");
        for (const link of links) {
          if (getVisibleText(link) === value) {
            el = link;
            break;
          }
        }
      } else if (type === "name") {
        el = document.querySelector(`[name="${CSS.escape(value)}"]`);
      } else if (type === "testId") {
        el = document.querySelector(
          `[data-testid="${CSS.escape(value)}"], [data-cy="${CSS.escape(value)}"], [data-test-id="${CSS.escape(value)}"], [data-qa="${CSS.escape(value)}"]`,
        );
      } else if (type === "placeholder") {
        el = document.querySelector(`[placeholder="${CSS.escape(value)}"]`);
      } else if (type === "role") {
        // Parse role: button[name='Save']
        const match = value.match(/([a-z]+)\[name='(.+?)'\]/);
        if (match) {
          const role = match[1];
          const name = match[2];
          const candidates = document.querySelectorAll(
            role === "textbox" ? "input, textarea" : role,
          );
          for (const candidate of candidates) {
            const cName =
              candidate.getAttribute("aria-label") ||
              candidate.innerText ||
              candidate.getAttribute("alt") ||
              "";
            if (cName.trim() === name || cName.includes(name)) {
              el = candidate;
              break;
            }
          }
        }
      }

      if (el) {
        const isVisible = isElementVisible(el);
        const logMsg = `Playback: Strategy ${type}=${value} found ${el.tagName} (ID: ${el.id}, Visible: ${isVisible})`;
        chrome.storage.local
          .get("e2e_debug_logs")
          .then(({ e2e_debug_logs = [] }) => {
            e2e_debug_logs.push(`[${new Date().toISOString()}] ${logMsg}`);
            chrome.storage.local.set({ e2e_debug_logs });
          });

        if (isVisible && el.isConnected) return el;
      }
    } catch (e) {
      console.warn("Strategy failed:", locator, e.message);
    }
  }

  // Legacy Fallback
  if (selectors && selectors.css) {
    const el = safeQuerySelectorAll(selectors.css)[0];
    if (el && el.isConnected) return el;
  }

  if (selector) {
    const el = safeQuerySelectorAll(selector)[0];
    if (el && el.isConnected) return el;
  }

  if (selectors && selectors.id) {
    const el = document.getElementById(selectors.id);
    if (el && el.isConnected) return el;
  }

  return fuzzyFallbackSearch(step);
}

/**
 * Fuzzy fallback search for elements.
 * @param {Object} step
 * @returns {HTMLElement|null}
 */
function fuzzyFallbackSearch(step) {
  // --- AGGRESSIVE FUZZY FALLBACK (Manager Demo Mode) ---
  // If all specific locators fail, search for any clickable element with matching text
  const searchText = step.description || step.value || "";
  if (searchText && searchText.length > 2 && searchText.length < 50) {
    const allElements = document.querySelectorAll(
      "button, a, div[role='button'], input[type='submit'], span",
    );
    for (const el of allElements) {
      const elText = getVisibleText(el).toLowerCase();
      const searchLower = searchText.toLowerCase();
      if (
        (elText === searchLower || elText.includes(searchLower)) &&
        isElementVisible(el)
      ) {
        console.log(`Fuzzy match found: '${elText}' matches '${searchLower}'`);
        return el;
      }
    }
  }

  // --- DEEP SHADOW DOM SEARCH ---
  // If we still haven't found it, try recursively searching all shadow roots
  const selectors =
    step.selectors || (step.selector ? { css: step.selector } : null);
  if (selectors && selectors.css) {
    console.log(`Deep searching Shadows for: ${selectors.css}`);
    const shadowEl = deepQuerySelector(selectors.css);
    if (shadowEl && isElementVisible(shadowEl)) return shadowEl;
  }

  console.log(
    `Locate failed for step. Selectors:`,
    step.selectors || step.selector,
  );
  return null;
}

/**
 * Logs successful selector match.
 * @param {string} selector
 * @param {HTMLElement} element
 */
function logSelectorSuccess(selector, element) {
  const logMsg = `Playback: Selector "${selector}" found ${element.tagName} (ID: ${element.id}, Visible: true)`;
  chrome.storage.local.get("e2e_debug_logs").then(({ e2e_debug_logs = [] }) => {
    e2e_debug_logs.push(`[${new Date().toISOString()}] ${logMsg}`);
    chrome.storage.local.set({ e2e_debug_logs });
  });
}

/**
 * Recursively searches for an element matching the selector in all open Shadow DOMs.
 * @param {string} selector
 * @param {Node} root
 * @returns {HTMLElement|null}
 */
function deepQuerySelector(selector, root = document) {
  // Check current scope
  let el = null;
  try {
    el = root.querySelector(selector);
  } catch (e) {}

  if (el) return el;

  // Find all elements with shadow roots in this scope
  // Note: This is expensive, but necessary for "Demo Mode" resilience
  const elements = root.querySelectorAll("*");
  for (const element of elements) {
    if (element.shadowRoot) {
      const found = deepQuerySelector(selector, element.shadowRoot);
      if (found) return found;
    }
  }

  return null;
}

/**
 * Sends a log message to the background (which forwards it to popup).
 * @param {string} text
 * @param {string} level
 */
function logExecution(text, level = "info") {
  chrome.runtime
    .sendMessage({ type: "LOG_MESSAGE", text, level })
    .catch(() => {});

  // Also log to e2e_debug_logs for runner visibility
  chrome.storage.local.get("e2e_debug_logs").then(({ e2e_debug_logs = [] }) => {
    e2e_debug_logs.push(`[${new Date().toISOString()}] Playback: ${text}`);
    chrome.storage.local.set({ e2e_debug_logs });
  });
}

let currentlyExecutingIndex = -1;

/**
 * Detects and logs nuances (differences in element state) between recording and playback.
 * @param {HTMLElement} element
 * @param {Object} step
 */
function detectNuances(element, step) {
  if (!step.nuanceMetadata) return;

  const currentState = getElementState(element);
  const nuances = compareStates(step.nuanceMetadata, currentState);

  if (nuances.length > 0) {
    const message = nuances.join(", ");
    logExecution(`Nuances Detected: ${message}`, "warning");
    chrome.runtime
      .sendMessage({
        type: "BUG_DETECTED",
        bug: {
          stepIndex: currentlyExecutingIndex,
          type: "nuance",
          message: message,
        },
      })
      .catch(() => {});
    console.log(
      `[Nuance Detection] Step ${currentlyExecutingIndex + 1}:`,
      nuances,
    );
  }
}

/**
 * Executes a single command on the page.
 * @param {Object} step
 * @param {number} index
 */
async function executeSingleStep(step, index) {
  if (currentlyExecutingIndex === index) return;
  currentlyExecutingIndex = index;

  logExecution(`Step ${index + 1} starting: ${JSON.stringify(step)}`, "info");

  try {
    let element = null;
    const maxAttempts = 40; // Increased to 10 seconds total (40 * 250ms)
    const waitTime = 250;

    if (step.action !== "scroll") {
      for (let i = 0; i < maxAttempts; i++) {
        element = locateElement(step);
        if (element && isElementVisible(element)) break;
        element = null;
        await new Promise((r) => setTimeout(r, waitTime));
      }

      if (!element) {
        throw new Error(
          `Element not found or not visible for step:${index + 1} (${step.action})`,
        );
      }
      logExecution(
        `Step ${index + 1}: Element found, executing ${step.action}`,
        "success",
      );

      // Perform nuance detection
      detectNuances(element, step);
    }

    if (step.action === "click") {
      element.scrollIntoView({
        behavior: "auto",
        block: "center",
        inline: "center",
      });
      await new Promise((r) => setTimeout(r, 100));
      highlightElement(element);

      const { offsetX, offsetY } = step;
      const rect = element.getBoundingClientRect();
      const clientX = rect.left + (offsetX || rect.width / 2);
      const clientY = rect.top + (offsetY || rect.height / 2);

      const eventOptions = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX,
        clientY,
      };

      // Dispatch full sequence immediately
      element.dispatchEvent(new MouseEvent("mousedown", eventOptions));
      element.dispatchEvent(new MouseEvent("mouseup", eventOptions));
      element.click();
      element.dispatchEvent(new MouseEvent("click", eventOptions));

      console.log(
        `Executed step ${index + 1}: Click at (${clientX}, ${clientY})`,
      );

      // Some frameworks need a bit more time to process the click and update state
      setTimeout(() => {
        chrome.runtime.sendMessage({ type: "STEP_COMPLETE", stepIndex: index });
      }, 800);
    } else if (step.action === "input") {
      element.scrollIntoView({
        behavior: "auto",
        block: "center",
        inline: "center",
      });
      element.focus();
      highlightElement(element);
      await new Promise((r) => setTimeout(r, 100));

      try {
        if (
          element.tagName === "INPUT" &&
          (element.type === "radio" || element.type === "checkbox")
        ) {
          element.checked = true;
          element.dispatchEvent(new Event("click", { bubbles: true }));
          element.dispatchEvent(new Event("input", { bubbles: true }));
          element.dispatchEvent(new Event("change", { bubbles: true }));
        } else {
          // React/Angular Support: Directly set value property to bypass tracking wrapper
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype,
            "value",
          ).set;
          nativeInputValueSetter.call(element, step.value || "");

          // Dispatch full event sequence for frameworks
          element.dispatchEvent(new Event("input", { bubbles: true }));
          element.dispatchEvent(new Event("change", { bubbles: true }));
        }

        const { e2e_debug_logs = [] } =
          await chrome.storage.local.get("e2e_debug_logs");
        e2e_debug_logs.push(
          `[${new Date().toISOString()}] Playback: Input "${step.value}" into ${element.tagName} (ID: ${element.id}) successful`,
        );
        await chrome.storage.local.set({ e2e_debug_logs });
      } catch (e) {
        const { e2e_debug_logs = [] } =
          await chrome.storage.local.get("e2e_debug_logs");
        e2e_debug_logs.push(
          `[${new Date().toISOString()}] Playback: Input error on ${element.tagName}: ${e.message}`,
        );
        await chrome.storage.local.set({ e2e_debug_logs });
        throw e;
      }

      // Simulate key events (some frameworks listen for these)
      element.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }));
      element.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
      element.blur();

      console.log(`Executed step ${index + 1}: Input "${step.value}"`);
      chrome.runtime.sendMessage({ type: "STEP_COMPLETE", stepIndex: index });
    } else if (step.action === "scroll") {
      try {
        const pos = JSON.parse(step.value || '{"x":0,"y":0}');
        window.scrollTo({ left: pos.x, top: pos.y, behavior: "smooth" });
        console.log(`Executed step ${index + 1}: Scroll`);
        setTimeout(() => {
          chrome.runtime.sendMessage({
            type: "STEP_COMPLETE",
            stepIndex: index,
          });
        }, 800);
      } catch (e) {
        chrome.runtime.sendMessage({ type: "STEP_COMPLETE", stepIndex: index });
      }
    }
  } catch (err) {
    if (err.message.includes("Element not found")) {
      console.log(
        `Step ${index + 1}: Element not found in this frame (${window.location.href})`,
      );
    } else {
      console.error(`Error executing step ${index + 1}:`, err);
      chrome.runtime
        .sendMessage({
          type: "BUG_DETECTED",
          bug: {
            stepIndex: index,
            type: "error",
            message: err.message,
          },
        })
        .catch(() => {});
      chrome.runtime.sendMessage({
        type: "STEP_ERROR",
        error: err.message,
        stepIndex: index,
      });
    }
  }
}
