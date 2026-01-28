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
      if (current.hasAttribute(attr)) {
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

    const target = event.target;
    // Enhanced error handling for descriptor generation
    let descriptor = "";
    try {
      descriptor = getElementDescriptor(target);
    } catch (e) {
      console.error("Error generating descriptor:", e);
    }

    const step = {
      action: "click",
      selector: buildSelector(target),
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

    // Enhanced error handling
    let descriptor = "";
    try {
      descriptor = getElementDescriptor(target);
    } catch (e) {
      console.error("Error generating descriptor:", e);
    }

    const step = {
      action: "input",
      selector: buildSelector(target),
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

if (!window.__recorder_listeners_added) {
  window.addEventListener("click", handleClick, true);
  window.addEventListener("change", handleInput, true);
  window.addEventListener("input", handleInput, true);
  window.__recorder_listeners_added = true;
}

function findElementBySelector(
  selector,
  description = "",
  tagName = "",
  retries = 3,
) {
  if (!selector) return null;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      // 1. Try direct querySelector first (most common case)
      const element = document.querySelector(selector);
      if (element && element.isConnected) return element;

      // 2. If description/text is available, try to find by text
      if (description) {
        // Tag hint helps narrow down search
        const candidates = tagName
          ? document.getElementsByTagName(tagName)
          : document.querySelectorAll("*");

        for (const candidate of candidates) {
          // Skip hidden elements if possible?
          if (
            candidate.innerText === description ||
            candidate.getAttribute("aria-label") === description ||
            candidate.getAttribute("placeholder") === description ||
            getVisibleText(candidate) === description
          ) {
            if (candidate.isConnected) return candidate;
          }
        }

        // Partial match fallback?
        for (const candidate of candidates) {
          if (getVisibleText(candidate).includes(description)) {
            if (candidate.isConnected) return candidate;
          }
        }
      }

      // 3. If selector has " > ", try splitting and navigating (heuristic)
      if (selector.includes(" > ")) {
        const parts = selector.split(" > ").map((p) => p.trim());
        let current = document;

        for (const part of parts) {
          if (!current) break;
          const found = current.querySelector
            ? current.querySelector(part)
            : null;
          if (found) {
            current = found;
          } else {
            current = null;
            break;
          }
        }

        if (current && current instanceof Element && current.isConnected) {
          return current;
        }
      }

      // Try with slight delay if not found (for dynamic content)
      if (attempt < retries - 1) {
        // Small delay before retry
        const start = Date.now();
        while (Date.now() - start < 50) {} // 50ms wait
      }
    } catch (err) {
      console.error(
        `Error finding element (attempt ${attempt + 1}):`,
        selector,
        err,
      );
      if (attempt < retries - 1) {
        const start = Date.now();
        while (Date.now() - start < 50) {} // 50ms wait
      }
    }
  }

  return null;
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
    // Find element with retries
    let element = findElementBySelector(
      step.selector,
      step.description,
      step.tagName,
      3,
    );

    if (!element) {
      throw new Error(
        `Element not found for selector: ${step.selector} (and text fallback failed)`,
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

      if (!element.isConnected) {
        element = findElementBySelector(
          step.selector,
          step.description,
          step.tagName,
          2,
        );
        if (!element) throw new Error("Element disconnected");
      }

      highlightElement(element);
      await new Promise((r) => setTimeout(r, 500)); // Wait for visual confirmation

      element.click();
      console.log(`Executed step ${index + 1}: Click`);

      // Send completion immediately. If page unloads, background handles it.
      chrome.runtime.sendMessage({ type: "STEP_COMPLETE", stepIndex: index });
    } else if (step.action === "input") {
      element.scrollIntoView({
        behavior: "auto",
        block: "center",
        inline: "center",
      });
      element.focus();
      highlightElement(element);
      await new Promise((r) => setTimeout(r, 500)); // Wait for visual confirmation

      element.value = step.value || "";
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));

      console.log(`Executed step ${index + 1}: Input "${step.value}"`);
      chrome.runtime.sendMessage({ type: "STEP_COMPLETE", stepIndex: index });
    }
  } catch (err) {
    // In a multi-frame environment, "Element not found" will happen in N-1 frames.
    // We should not fail the whole test immediately if one frame can't find it.
    // The background script will handle timeout if NO frame finds it.
    const isNotFoundError = err.message.includes("Element not found");

    if (isNotFoundError) {
      console.log(`Frame skipped step ${index + 1}: Element not found`);
      // Do NOT send STEP_ERROR for not found, wait for timeout or success from other frame
    } else {
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
