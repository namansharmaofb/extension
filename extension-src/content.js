// Prevent duplicate listeners if injected multiple times
if (window.__recorder_initialized) {
  // If already initialized, just update state if we can access the variable?
  // We can't easily access the closed-over 'isRecording' from outside unless we expose it.
  console.log("Content script already initialized");
} else {
  window.__recorder_initialized = true;
}

let isRecording = false;

// Expose internal state changer for background script to call directly
window.__recorder_toggle = function (state) {
  isRecording = state;
  updateVisualIndicator(state);
  console.log(
    "Recorder state updated to:",
    state,
    "in frame",
    window.location.href,
  );
};

// Initialize state from background
chrome.runtime.sendMessage({ type: "GET_STATE" }, (response) => {
  if (response) {
    // If background says we are recording, sync local state
    window.__recorder_toggle(response.isRecording);
  }
});

function updateVisualIndicator(active) {
  if (active) {
    document.body.style.border = "4px solid red";
    document.body.style.boxSizing = "border-box";
    // Ensure it's visible on top of everything?
    // Changing body border is usually safe-ish but z-index overlays are better.
    // Let's stick to border but maybe add a data attribute for debugging
    document.body.setAttribute("data-recorder-active", "true");
  } else {
    document.body.style.border = "";
    document.body.style.boxSizing = "";
    document.body.removeAttribute("data-recorder-active");
  }
}

function getXPath(element) {
  try {
    if (!element) return "";
    if (element.id && !isDynamicId(element.id))
      return `//*[@id="${element.id}"]`;
    if (element === document.body) return "/html/body";
    if (
      !element.parentNode ||
      element.parentNode.nodeType !== Node.ELEMENT_NODE
    )
      return ""; // Safety break

    let ix = 0;
    const siblings = element.parentNode.childNodes;
    for (let i = 0; i < siblings.length; i++) {
      const sibling = siblings[i];
      if (sibling === element) {
        const parentPath = getXPath(element.parentNode);
        return parentPath
          ? `${parentPath}/${element.tagName.toLowerCase()}[${ix + 1}]`
          : "";
      }
      if (sibling.nodeType === 1 && sibling.tagName === element.tagName) {
        ix++;
      }
    }
  } catch (e) {
    return ""; // Fail gracefully
  }
  return "";
}

function generateSelectors(element) {
  if (!element) return null;

  try {
    const css = buildSelector(element);
    const selectors = {
      css: css,
      xpath: getXPath(element),
      id: element.id && !isDynamicId(element.id) ? element.id : null,
      attributes: {},
    };

    // Capture stable attributes
    const stableAttrs = [
      "data-testid",
      "data-cy",
      "data-test-id",
      "data-qa",
      "name",
      "role",
      "placeholder",
      "aria-label",
      "type",
      "href",
    ];

    for (const attr of stableAttrs) {
      if (element.hasAttribute(attr)) {
        const val = element.getAttribute(attr);
        if (val && !isDynamicId(val)) {
          selectors.attributes[attr] = val;
        }
      }
    }

    // Capture inner text if short and clean
    const text = getVisibleText(element);
    if (text && text.length < 30) {
      selectors.innerText = text;
    }

    return selectors;
  } catch (err) {
    console.error(
      "Error generating advanced selectors, falling back to CSS:",
      err,
    );
    // FALLBACK: Return just the CSS selector to ensure we record SOMETHING
    return {
      css: buildSelector(element),
      xpath: null,
      id: null,
      attributes: {},
    };
  }
}

function buildSelector(element) {
  if (!element) return "";

  // 1. Try ID if it look stable (not auto-generated)
  if (element.id && !isDynamicId(element.id)) {
    return `#${element.id}`;
  }

  // 2. Try stable attributes (data-testid, etc.)
  const stableAttrs = [
    "data-testid",
    "data-cy",
    "data-test-id",
    "data-qa",
    "name",
    "role",
    "placeholder",
    "aria-label",
  ];
  for (const attr of stableAttrs) {
    if (element.hasAttribute(attr)) {
      const val = element.getAttribute(attr);
      if (val && !isDynamicId(val)) {
        return `${element.tagName.toLowerCase()}[${attr}="${val}"]`;
      }
    }
  }

  // 3. Fallback: Generate path
  let path = [];
  let current = element;
  while (current && current.nodeType === Node.ELEMENT_NODE && path.length < 5) {
    let selector = current.nodeName.toLowerCase();

    // Add stable classes only
    if (current.className) {
      const classes = current.className.toString().trim().split(/\s+/);
      const stableClasses = classes.filter((cls) => !isDynamicClass(cls));
      if (stableClasses.length > 0) {
        selector += `.${stableClasses.slice(0, 2).join(".")}`;
      }
    }

    // Add nth-of-type if needed for uniqueness among siblings
    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        (child) => child.nodeName === current.nodeName,
      );
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        selector += `:nth-of-type(${index})`;
      }
    }

    path.unshift(selector);
    current = current.parentElement;

    // Check if current ancestor has a stable attribute (ID or other)
    // 1. Check ID
    if (current && current.id && !isDynamicId(current.id)) {
      path.unshift(`#${current.id}`);
      break; // Stop climbing if we hit a stable ID
    }

    // 2. Check other stable attributes on ancestors
    let foundStableAttr = false;
    for (const attr of stableAttrs) {
      if (current && current.hasAttribute(attr)) {
        const val = current.getAttribute(attr);
        if (val && !isDynamicId(val)) {
          // We found a stable root!
          // e.g. div[placeholder="Search"]
          path.unshift(`${current.tagName.toLowerCase()}[${attr}="${val}"]`);
          foundStableAttr = true;
          break;
        }
      }
    }
    if (foundStableAttr) break; // Stop climbing
  }

  return path.join(" > ");
}

// Helper to detect if an ID/Class looks auto-generated (e.g. "lAIJgo", "input-12345")
function isDynamicId(str) {
  if (!str) return false;
  // Common patterns for dynamic strings:
  // - Contains long numbers (3+ digits) e.g. "ember123"
  // - Short random alphanumeric e.g. "abc1z"
  // - Starts with a number

  if (/^\d/.test(str)) return true; // Starts with digit
  if (/\d{4,}/.test(str)) return true; // Has 4+ consecutive digits

  // Random hash-like (4-8 chars, mixed case numbers) - crude heuristic
  // e.g. "lAIJgo"
  if (/^[a-zA-Z0-9]{5,8}$/.test(str) && /[0-9]/.test(str) === false) {
    // This is risky, "header" is 6 chars.
    // User's example "lAIJgo" is 6 chars mixed case.
    // Let's look for mixed case + no obvious meaning?
    // Better: assume if capital letters are present inside?
    if (/[a-z]/.test(str) && /[A-Z]/.test(str)) return true;
  }

  return false;
}

function isDynamicClass(cls) {
  return isDynamicId(cls);
}

function getVisibleText(element) {
  if (!element) return "";
  // 1. Check for direct text content
  const text = element.innerText || element.textContent;
  if (text) {
    const trimmed = text.trim();
    if (trimmed.length > 0 && trimmed.length < 50) return trimmed;
  }
  // 2. Check for image alt
  if (element.tagName === "IMG" && element.alt) return element.alt;
  // 3. Check for specific input types
  if (element.tagName === "INPUT" && element.type === "submit" && element.value)
    return element.value;
  return "";
}

function getElementDescriptor(element) {
  if (!element) return "";

  // Priority 1: Aria label or labelledby
  if (element.getAttribute("aria-label"))
    return element.getAttribute("aria-label");

  // Priority 2: Visible text
  const text = getVisibleText(element);
  if (text) return text;

  // Priority 3: Placeholder
  if (element.getAttribute("placeholder"))
    return element.getAttribute("placeholder");

  // Priority 4: Title
  if (element.getAttribute("title")) return element.getAttribute("title");

  // Priority 5: ID (if stable)
  if (element.id && !isDynamicId(element.id)) return `#${element.id}`;

  // Priority 6: Name
  if (element.getAttribute("name")) return element.getAttribute("name");

  return "";
}

function handleClick(event) {
  try {
    if (!isRecording) return;
    // Don't record clicks on the recorder UI itself if we had one injected
    if (event.target.hasAttribute("data-recorder-ui")) return;

    const target = event.target;
    const selectors = generateSelectors(target);
    const descriptor = getElementDescriptor(target);

    const step = {
      action: "click",
      selectors: selectors,
      selector: selectors.css, // Backward compat
      tagName: target.tagName,
      description: descriptor,
      url: window.location.href,
    };

    chrome.runtime.sendMessage({ type: "RECORD_STEP", step });
  } catch (err) {
    console.error("Error recording click:", err);
  }
}

function handleInput(event) {
  try {
    if (!isRecording) return;

    const target = event.target;
    if (
      !(
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement
      )
    )
      return;

    const selectors = generateSelectors(target);
    const descriptor = getElementDescriptor(target);

    const step = {
      action: "input",
      selectors: selectors,
      selector: selectors.css, // Backward compat
      tagName: target.tagName,
      value: target.value,
      description: descriptor,
      url: window.location.href,
    };

    chrome.runtime.sendMessage({ type: "RECORD_STEP", step });
  } catch (err) {
    console.error("Error recording input:", err);
  }
}

// Register event listeners (CRITICAL - without this, nothing gets recorded!)
if (!window.__recorder_listeners_added) {
  window.addEventListener("click", handleClick, true);
  window.addEventListener("change", handleInput, true);
  window.addEventListener("input", handleInput, true);
  window.__recorder_listeners_added = true;
  console.log("Recorder event listeners registered");
}

function getElementsByXPath(xpath) {
  const result = [];
  try {
    const nodes = document.evaluate(
      xpath,
      document,
      null,
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      null,
    );
    for (let i = 0; i < nodes.snapshotLength; i++) {
      result.push(nodes.snapshotItem(i));
    }
  } catch (err) {
    // XPath match failed
  }
  return result;
}

function locateElement(step) {
  const { selectors, selector, tagName, description, attributes } = step;

  // Strategy 1: Smart Selectors (CSS)
  if (selectors && selectors.css) {
    const el = document.querySelector(selectors.css);
    if (el && el.isConnected) return el;
  }
  // Fallback to legacy field
  if (selector) {
    const el = document.querySelector(selector);
    if (el && el.isConnected) return el;
  }

  // Strategy 2: ID
  if (selectors && selectors.id) {
    const el = document.getElementById(selectors.id);
    if (el && el.isConnected) return el;
  }

  // Strategy 3: Attributes
  if (selectors && selectors.attributes) {
    for (const [attr, val] of Object.entries(selectors.attributes)) {
      try {
        const el = document.querySelector(`[${attr}="${val}"]`);
        if (el && el.isConnected) return el;
      } catch (e) {
        // Ignore invalid selectors
      }
    }
  }
  // Backward compat for attributes from step root
  if (attributes) {
    for (const [attr, val] of Object.entries(attributes)) {
      try {
        const el = document.querySelector(`[${attr}="${val}"]`);
        if (el && el.isConnected) return el;
      } catch (e) {}
    }
  }

  // Strategy 4: XPath
  if (selectors && selectors.xpath) {
    const els = getElementsByXPath(selectors.xpath);
    if (els.length > 0 && els[0].isConnected) return els[0];
  }

  // Strategy 5: Text/Description Fallback
  if (description || (selectors && selectors.innerText)) {
    const textToMatch = selectors?.innerText || description;
    const candidates = tagName
      ? document.getElementsByTagName(tagName)
      : document.querySelectorAll("*");

    for (const candidate of candidates) {
      const visText = getVisibleText(candidate);
      if (visText === textToMatch) return candidate;
      // Partial match for lengthy text
      if (textToMatch.length > 5 && visText.includes(textToMatch))
        return candidate;
    }
  }

  return null;
}

function isElementVisible(element) {
  if (!element) return false;
  if (!element.isConnected) return false;

  // Check if element or any parent is hidden
  const style = window.getComputedStyle(element);
  if (
    style.display === "none" ||
    style.visibility === "hidden" ||
    style.opacity === "0"
  ) {
    return false;
  }

  // Check if element has dimensions
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    return false;
  }

  return true;
}

function highlightElement(element) {
  if (!element) return;
  const originalOutline = element.style.outline;
  const originalTransition = element.style.transition;

  element.style.outline = "2px solid #ef4444";
  element.style.transition = "outline 0.2s ease-in-out";

  setTimeout(() => {
    element.style.outline = originalOutline;
    element.style.transition = originalTransition;
  }, 1000);
}

// Single step execution for robust background-driven flow
async function executeSingleStep(step, index) {
  try {
    // Enhanced Retry Loop with visibility check
    // For dynamic elements (tooltips, dropdowns), we need to wait longer
    let element = null;
    const maxAttempts = 20; // 20 attempts
    const waitTime = 250; // 250ms between attempts = 5 seconds total

    for (let i = 0; i < maxAttempts; i++) {
      element = locateElement(step);

      // Check if element is not only found but also visible
      if (element && isElementVisible(element)) {
        break;
      }

      // Log progress for debugging
      if (i === 0) {
        console.log(`Step ${index + 1}: Waiting for element to appear...`);
      }

      element = null; // Reset if not visible
      await new Promise((r) => setTimeout(r, waitTime));
    }

    if (!element) {
      throw new Error(
        `Element not found or not visible for step:${index + 1} (${step.action})`,
      );
    }

    if (step.action === "click") {
      // Scroll if needed
      element.scrollIntoView({
        behavior: "auto",
        block: "center",
        inline: "center",
      });
      await new Promise((r) => setTimeout(r, 50));

      highlightElement(element);
      await new Promise((r) => setTimeout(r, 100)); // Quick visual confirmation

      element.click();
      console.log(
        `Executed step ${index + 1}: Click in frame ${window.location.href}`,
      );

      chrome.runtime.sendMessage({ type: "STEP_COMPLETE", stepIndex: index });
    } else if (step.action === "input") {
      element.scrollIntoView({
        behavior: "auto",
        block: "center",
        inline: "center",
      });
      element.focus();
      highlightElement(element);
      await new Promise((r) => setTimeout(r, 300)); // Visual confirmation

      // Try to maintain existing value if appending? No, replace for now.
      element.value = step.value || "";
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));

      console.log(
        `Executed step ${index + 1}: Input "${step.value}" in frame ${window.location.href}`,
      );
      chrome.runtime.sendMessage({ type: "STEP_COMPLETE", stepIndex: index });
    }
  } catch (err) {
    // In a multi-frame environment, "Element not found" will happen in N-1 frames.
    const isNotFoundError = err.message.includes("Element not found");

    if (isNotFoundError) {
      // Element not in this frame - this is expected in multi-frame scenarios
      console.log(
        `Step ${index + 1}: Element not found in this frame (${window.location.href})`,
      );
      // Don't send error - let other frames try
    } else {
      // Actual error (not just "not found")
      console.error(`Error executing step ${index + 1}:`, err);
      chrome.runtime.sendMessage({
        type: "STEP_ERROR",
        error: err.message,
        stepIndex: index,
      });
    }
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "SET_RECORDING") {
    isRecording = message.isRecording;
    updateVisualIndicator(isRecording);
    sendResponse({ success: true, isRecording });
  } else if (message.type === "EXECUTE_SINGLE_STEP") {
    // Execute single step
    executeSingleStep(message.step, message.stepIndex);
    sendResponse({ success: true, message: "Step execution started" });
  } else if (message.type === "EXECUTE_STEPS") {
    // Legacy support or fallback?
    // We are deprecating this in favor of background-driven, but keeping it for safety
    // if old code is still calling it (though we updated popup.js).
    // Let's just log a warning.
    console.warn("Received deprecated EXECUTE_STEPS message");
    sendResponse({ success: false, error: "Deprecated method" });
  }

  return true;
});
