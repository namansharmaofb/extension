// Logic for capturing user interactions and reporting them to the background

/**
 * Finds the nearest interactive parent element.
 * @param {HTMLElement} element
 * @returns {HTMLElement}
 */
function getInteractiveParent(element) {
  let current = element;
  let depth = 0;
  const maxDepth = 5; // Go a bit deeper

  // If we are already on a semantic interactive element, return it
  if (
    ["BUTTON", "A", "SELECT", "INPUT"].includes(element.tagName) ||
    ["button", "link", "checkbox", "radio"].includes(
      element.getAttribute("role"),
    )
  ) {
    return element;
  }

  while (current && current !== document.body && depth < maxDepth) {
    // Prefer these semantic tags and roles
    if (
      ["BUTTON", "A", "SELECT", "INPUT"].includes(current.tagName) ||
      ["button", "link", "checkbox", "radio"].includes(
        current.getAttribute("role"),
      )
    ) {
      return current;
    }

    // Also check for common clickable classes if no semantic parent found yet
    if (
      current.hasAttribute("onclick") ||
      current.classList.contains("btn") ||
      current.classList.contains("button")
    ) {
      return current;
    }

    current = current.parentElement;
    depth++;
  }

  // Fallback: stay on original element if no clear parent,
  // but if it's a very small element with no ID, it's often better to go up one level
  if (
    ["SPAN", "I", "SMALL", "B", "STRONG"].includes(element.tagName) &&
    !element.id &&
    element.parentElement
  ) {
    return element.parentElement;
  }

  return element;
}

/**
 * Checks if an element is interactive.
 * @param {HTMLElement} element
 * @returns {boolean}
 */
function isInteractive(element) {
  if (!element) return false;

  const tag = element.tagName;
  if (tag === "BUTTON" || tag === "A" || tag === "SELECT") return true;

  const role = element.getAttribute("role");
  if (role === "button" || role === "link" || role === "menuitem") return true;

  if (element.hasAttribute("onclick")) return true;
  if (element.classList.contains("btn") || element.classList.contains("button"))
    return true;

  // Check if it's a clickable div/span
  const cursor = window.getComputedStyle(element).cursor;
  if (cursor === "pointer") return true;

  return false;
}

/**
 * Handles clicks and records them as steps.
 * @param {MouseEvent} event
 */
function handleClick(event) {
  try {
    if (!isRecording) return;
    if (event.target.hasAttribute("data-recorder-ui")) return;

    // Use composedPath to get the actual target inside Shadow DOM
    const composedPath = event.composedPath();
    let target = composedPath.length > 0 ? composedPath[0] : event.target;

    // Promote to interactive parent if clicking on child element
    target = getInteractiveParent(target);

    const selectors = generateSelectors(target);
    const descriptor = getElementDescriptor(target);
    const nuanceMetadata = getElementState(target);

    // Calculate click offset relative to element
    const rect = target.getBoundingClientRect();
    const offsetX = Math.round(event.clientX - rect.left);
    const offsetY = Math.round(event.clientY - rect.top);

    const step = {
      action: "click",
      selectors: selectors.selectors, // NEW: Array of selector arrays
      selector: selectors.selector,
      selectorType: selectors.selectorType,
      tagName: target.tagName,
      description: descriptor,
      url: window.location.href,
      nuanceMetadata: nuanceMetadata,
      offsetX: offsetX,
      offsetY: offsetY,
    };

    chrome.runtime.sendMessage({ type: "RECORD_STEP", step });
  } catch (err) {
    console.error("Error recording click:", err);
  }
}

// Debounce timers for input recording
const inputTimers = new Map();

/**
 * Handles input change/input events and records them as steps (debounced).
 * @param {Event} event
 */
function handleInput(event) {
  try {
    if (!isRecording) return;

    // Use composedPath to get the actual target inside Shadow DOM
    const composedPath = event.composedPath();
    const target = composedPath.length > 0 ? composedPath[0] : event.target;
    if (
      !(
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement
      )
    )
      return;

    // Clear existing timer for this element
    if (inputTimers.has(target)) {
      clearTimeout(inputTimers.get(target));
    }

    // Set new timer to record after 300ms of no typing
    const timer = setTimeout(() => {
      recordInputStep(target);
      inputTimers.delete(target);
    }, 300);

    inputTimers.set(target, timer);
  } catch (err) {
    console.error("Error recording input:", err);
  }
}

/**
 * Records an input step (called after debounce).
 * @param {HTMLInputElement|HTMLTextAreaElement} target
 */
function recordInputStep(target) {
  try {
    const selectors = generateSelectors(target);
    const descriptor = getElementDescriptor(target);
    const nuanceMetadata = getElementState(target);

    const step = {
      action: "input",
      selectors: selectors.selectors, // NEW: Array of selector arrays
      selector: selectors.selector,
      selectorType: selectors.selectorType,
      tagName: target.tagName,
      value: target.value,
      description: descriptor,
      url: window.location.href,
      nuanceMetadata: nuanceMetadata,
    };

    chrome.runtime.sendMessage({ type: "RECORD_STEP", step });
  } catch (err) {
    console.error("Error recording input step:", err);
  }
}

/**
 * Handles change events to record final input value.
 * @param {Event} event
 */
function handleChange(event) {
  try {
    if (!isRecording) return;

    const target = event.target;
    if (
      !(
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      )
    )
      return;

    // Clear any pending debounced input
    if (inputTimers.has(target)) {
      clearTimeout(inputTimers.get(target));
      inputTimers.delete(target);
    }

    // Record immediately on change
    recordInputStep(target);
  } catch (err) {
    console.error("Error recording change:", err);
  }
}

let scrollTimeout;
/**
 * Handles scroll events and records them as steps (debounced).
 * @param {Event} event
 */
function handleScroll(event) {
  try {
    if (!isRecording) return;

    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      const step = {
        action: "scroll",
        value: JSON.stringify({
          x: window.scrollX,
          y: window.scrollY,
        }),
        description: `Scroll to ${Math.round(window.scrollX)}, ${Math.round(window.scrollY)}`,
        url: window.location.href,
        timestamp: Date.now(),
      };

      chrome.runtime.sendMessage({ type: "RECORD_STEP", step });
    }, 1000);
  } catch (err) {
    console.error("Error recording scroll:", err);
  }
}

// Register event listeners
if (!window.__recorder_listeners_added) {
  window.addEventListener("click", handleClick, true);
  window.addEventListener("change", handleChange, true); // NEW: Capture final value
  window.addEventListener("input", handleInput, true);
  window.addEventListener("scroll", handleScroll, true);
  window.__recorder_listeners_added = true;
  console.log("Recorder event listeners registered");
}
