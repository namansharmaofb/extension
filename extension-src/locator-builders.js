// Locator building logic for generating robust Selenium-compatible selectors

/**
 * Generates an XPath for an element.
 * @param {HTMLElement} element
 */
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
      return "";

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
    return "";
  }
  return "";
}

/**
 * Generates an absolute full XPath from root, ignoring IDs.
 * This is the "Nuclear Option" for targeting.
 */
function getFullXPath(element) {
  if (!element) return "";
  if (element.tagName.toLowerCase() === "html") return "/html";
  if (element === document.body) return "/html/body";

  let ix = 0;
  if (!element.parentNode) return "";

  const siblings = element.parentNode.childNodes;
  for (let i = 0; i < siblings.length; i++) {
    const sibling = siblings[i];
    if (sibling === element) {
      return `${getFullXPath(element.parentNode)}/${element.tagName.toLowerCase()}[${ix + 1}]`;
    }
    if (sibling.nodeType === 1 && sibling.tagName === element.tagName) {
      ix++;
    }
  }
  return "";
}

/**
 * Generates a full target object with multiple selector strategies.
 * @param {HTMLElement} element
 */
// function generateSelectors(element) {
//   if (!element) return null;

//   try {
//     const targets = [];

//     // 1. Playwright Test ID (Highest Priority)
//     const testIdAttrs = ["data-testid", "data-cy", "data-test-id", "data-qa"];
//     for (const attr of testIdAttrs) {
//       if (element.hasAttribute(attr)) {
//         targets.push({ type: "testId", value: element.getAttribute(attr) });
//       }
//     }

//     // 2. Playwright Placeholder
//     if (element.hasAttribute("placeholder")) {
//       targets.push({
//         type: "placeholder",
//         value: element.getAttribute("placeholder"),
//       });
//     }

//     // 3. Playwright Role (Semantic)
//     const role = element.getAttribute("role") || element.tagName.toLowerCase();
//     const validRoles = [
//       "button",
//       "link",
//       "checkbox",
//       "radio",
//       "heading",
//       "textbox",
//       "img",
//     ];
//     const accessibleName =
//       element.getAttribute("aria-label") ||
//       element.innerText ||
//       element.getAttribute("alt") ||
//       "";

//     // Normalize role for standard tags
//     let semanticRole = role;
//     if (element.tagName === "A") semanticRole = "link";
//     if (element.tagName === "BUTTON") semanticRole = "button";
//     if (element.tagName === "INPUT") semanticRole = "textbox"; // simplified

//     if (
//       validRoles.includes(semanticRole) &&
//       accessibleName.trim().length > 0 &&
//       accessibleName.length < 50
//     ) {
//       const safeName = accessibleName.trim().replace(/'/g, "\\'");
//       targets.push({
//         type: "role",
//         value: `${semanticRole}[name='${safeName}']`,
//       });
//     }

//     // 4. ID (Legacy High Priority)
//     if (element.id && !isDynamicId(element.id)) {
//       targets.push({ type: "id", value: element.id });
//     }

//     // 5. CSS Finder
//     const css = buildSelector(element);
//     if (css) {
//       targets.push({ type: "css", value: css });
//     }

//     // 6. XPath:innerText (Robust Text Match)
//     const visibleText = getVisibleText(element);
//     if (visibleText && visibleText.length < 50 && !visibleText.includes("'")) {
//       // Simple text only
//       targets.push({
//         type: "xpath:innerText",
//         value: `//${element.tagName.toLowerCase()}[text()='${visibleText}']`,
//       });
//       targets.push({
//         type: "xpath:containsText",
//         value: `//${element.tagName.toLowerCase()}[contains(text(), '${visibleText}')]`,
//       });
//     }

//     // 7. Full Absolute XPath (The "Nuclear Option")
//     const fullXpath = getFullXPath(element);
//     if (fullXpath) {
//       targets.push({ type: "xpath:absolute", value: fullXpath });
//     }

//     // 8. XPath Attributes (Legacy)

//     const attrMap = {};
//     for (const attr of ["placeholder", "aria-label", "type", "href"]) {
//       if (element.hasAttribute(attr)) {
//         const val = element.getAttribute(attr);
//         if (val && !isDynamicId(val)) {
//           attrMap[attr] = val;
//         }
//       }
//     }

//     const xpath = getXPath(element);
//     const result = {
//       selector: targets.length > 0 ? targets[0].value : css,
//       selectorType: targets.length > 0 ? targets[0].type : "css",
//       targets: targets,
//       css: css,
//       xpath: xpath,
//       id: element.id && !isDynamicId(element.id) ? element.id : null,
//       attributes: attrMap,
//     };

//     const text = getVisibleText(element);
//     if (text && text.length < 30) {
//       result.innerText = text;
//       if (element.tagName === "A") {
//         targets.push({ type: "linkText", value: text });
//       }
//     }

//     return result;
//   } catch (err) {
//     console.error("Error generating selectors:", err);
//     const css = buildSelector(element);
//     return {
//       selector: css,
//       selectorType: "css",
//       targets: [{ type: "css", value: css }],
//       css: css,
//       xpath: null,
//       id: null,
//       attributes: {},
//     };
//   }
// }
/**
 * Generates selectors in Chrome DevTools Recorder format.
 * Returns an array of selector arrays, each containing fallback strategies.
 * @param {HTMLElement} element
 * @returns {Object} Selector object with arrays and metadata
 */
function generateSelectors(element) {
  if (!element || element.nodeType !== 1) return null;

  const selectors = []; // Array of [selector] arrays

  // 1. ARIA selector (highest priority for accessibility)
  const ariaSelector = buildAriaSelector(element);
  if (ariaSelector) {
    selectors.push([ariaSelector]);
  }

  // 2. data-testid / data-cy / data-test
  const testAttrs = ["data-testid", "data-cy", "data-test"];
  for (const attr of testAttrs) {
    if (element.hasAttribute(attr)) {
      const value = element.getAttribute(attr);
      if (value && !isDynamic(value)) {
        selectors.push([`[${attr}="${value.replace(/"/g, '\\"')}"]`]);
      }
    }
  }

  // 3. Name attribute (critical for forms)
  if (element.hasAttribute("name")) {
    const name = element.getAttribute("name");
    if (name && !isDynamic(name)) {
      const tag = element.tagName.toLowerCase();
      selectors.push([`${tag}[name="${name.replace(/"/g, '\\"')}"]`]);
    }
  }

  // 4. Placeholder (for inputs)
  if (element.hasAttribute("placeholder")) {
    const placeholder = element.getAttribute("placeholder");
    if (placeholder) {
      selectors.push([`[placeholder="${placeholder.replace(/"/g, '\\"')}"]`]);
    }
  }

  // 5. Stable ID
  if (element.id && !isDynamic(element.id)) {
    selectors.push([`#${CSS.escape(element.id)}`]);
  }

  // 6. CSS selector (stable attrs + limited classes)
  const css = buildSelector(element);
  if (css) {
    selectors.push([css]);
  }

  // 7. XPath with text (for links and buttons with visible text)
  const text = getVisibleText(element).replace(/\s+/g, " ").trim();
  if (
    text &&
    text.length > 0 &&
    text.length < 50 &&
    !text.includes("'") &&
    !isGenericIconText(text)
  ) {
    const tag = element.tagName.toLowerCase();
    // Use normalize-space(.) to handle non-breaking spaces and erratic whitespace in text matches
    selectors.push([`xpath///${tag}[normalize-space(.)='${text}']`]);
    // Contains text (more flexible)
    if (text.length > 3) {
      selectors.push([
        `xpath///${tag}[contains(normalize-space(.), '${text}')]`,
      ]);
    }
  }

  // 8. Full CSS path fallback
  const cssPath = buildCssPath(element);
  if (cssPath && cssPath !== css) {
    selectors.push([cssPath]);
  }

  // 9. XPath fallback (last resort)
  const xpath = getXPath(element);
  if (xpath) {
    selectors.push([`xpath//${xpath}`]);
  }

  // REORDER: Prefer stable attribute selectors first, then aria, then css, then xpath
  const orderedSelectors = [];
  const used = new Set();

  const addGroup = (predicate) => {
    selectors.forEach((s, idx) => {
      if (used.has(idx)) return;
      if (predicate(s[0])) {
        orderedSelectors.push(s);
        used.add(idx);
      }
    });
  };

  const hasDataAttr = (sel) =>
    sel.includes("[data-testid") ||
    sel.includes("[data-cy") ||
    sel.includes("[data-test") ||
    sel.includes("[data-qa");
  const hasName = (sel) => sel.includes("[name=");
  const hasPlaceholder = (sel) => sel.includes("[placeholder=");
  const isId = (sel) => sel.startsWith("#");
  const isAria = (sel) => sel.startsWith("aria/");
  const isXpath = (sel) => sel.startsWith("xpath/");

  addGroup(hasDataAttr);
  addGroup(hasName);
  addGroup(hasPlaceholder);
  addGroup(isId);
  addGroup(isAria);
  addGroup((sel) => !isXpath(sel) && !isAria(sel)); // CSS and other non-xpath selectors
  addGroup(isXpath);
  addGroup(() => true); // any leftover

  // REORDER: Push any selectors containing :nth- (fragile) to the end of the list
  const robustSelectors = orderedSelectors.filter((s) => !s[0].includes(":nth-"));
  const fragileSelectors = orderedSelectors.filter((s) => s[0].includes(":nth-"));
  const reorderedSelectors = [...robustSelectors, ...fragileSelectors];

  // Build the result object
  const primary =
    reorderedSelectors.length > 0 ? reorderedSelectors[0][0] : css || xpath;

  return {
    selectors: reorderedSelectors, // NEW: Reordered to favor robust strategies
    selector: primary, // Legacy: primary selector string
    selectorType: getSelectorType(primary), // Legacy: type of primary selector
    css: css,
    xpath: xpath,
    id: element.id && !isDynamic(element.id) ? element.id : null,
    attributes: {
      "data-testid": element.getAttribute("data-testid"),
      "data-cy": element.getAttribute("data-cy"),
      "data-test": element.getAttribute("data-test"),
      "aria-label": element.getAttribute("aria-label"),
      name: element.getAttribute("name"),
      placeholder: element.getAttribute("placeholder"),
      role: element.getAttribute("role"),
    },
    innerText: text || "",
  };
}

/**
 * Builds an ARIA selector (Puppeteer format) for the element.
 * Format: "aria/Button Text" or "aria/Input Label"
 * @param {HTMLElement} element
 * @returns {string|null}
 */
function buildAriaSelector(element) {
  // Use getElementDescriptor logic for consistent accessible name
  let accessibleName = getElementDescriptor(element);

  if (
    accessibleName &&
    accessibleName.trim().length > 0 &&
    accessibleName.length < 80
  ) {
    // Normalize whitespace for the final selector string
    const finalName = accessibleName.replace(/\s+/g, " ").trim();
    if (isGenericIconText(finalName)) return null;
    // Format: aria/accessible name
    return `aria/${finalName}`;
  }

  return null;
}

/**
 * Gets the selector type from a selector string.
 * @param {string} selector
 * @returns {string}
 */
function getSelectorType(selector) {
  if (!selector) return "css";
  if (selector.startsWith("aria/")) return "aria";
  if (selector.startsWith("xpath/")) return "xpath";
  if (selector.startsWith("#")) return "id";
  if (selector.includes("[data-testid")) return "testId";
  if (selector.includes("[name")) return "name";
  return "css";
}

/* ---------------- helpers ---------------- */

function isDynamic(value) {
  if (typeof value !== "string") return true;
  // Ignore purely numeric long strings or hex-like strings
  if (/^[0-9a-f]{16,}$/.test(value)) return true;
  // Allow common stable prefixes
  if (/^(mui|btn|nav|list|item|cell)-/i.test(value)) return false;
  return /\d{5,}|uuid|random|test-?id|tfid-/i.test(value);
}

function isGenericIconText(text) {
  if (!text || typeof text !== "string") return false;
  const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();
  const iconWords = new Set([
    "chevron_right",
    "chevron_left",
    "expand_more",
    "expand_less",
    "file_download",
    "file_upload",
    "west",
    "east",
    "north",
    "south",
    "menu",
    "more_vert",
    "more_horiz",
    "close",
    "add",
    "remove",
    "search",
    "filter_list",
    "edit",
    "delete",
    "download",
    "upload",
    "refresh",
  ]);

  // Single icon word
  if (iconWords.has(normalized)) return true;

  // If text is made only of icon words, treat as generic
  const parts = normalized.split(" ").filter(Boolean);
  if (parts.length > 0 && parts.every((p) => iconWords.has(p))) return true;

  return false;
}

function isDynamicId(id) {
  return isDynamic(id);
}

function isDynamicClass(cls) {
  return isDynamic(cls);
}

function buildCssPath(el) {
  const path = [];

  while (el && el.nodeType === 1 && el !== document.body) {
    let selector = el.tagName.toLowerCase();

    if (el.className) {
      const cls = el.className.split(" ").filter(Boolean).slice(0, 2).join(".");
      if (cls) selector += "." + cls;
    }

    const siblings = Array.from(el.parentNode.children).filter(
      (e) => e.tagName === el.tagName,
    );

    if (siblings.length > 1) {
      selector += `:nth-child(${Array.from(el.parentNode.children).indexOf(el) + 1})`;
    }

    path.unshift(selector);
    el = el.parentNode;
  }

  return path.join(" > ");
}

function buildXPath(el) {
  let path = "";

  while (el && el.nodeType === 1) {
    let index = 1;
    let sib = el.previousSibling;

    while (sib) {
      if (sib.nodeType === 1 && sib.tagName === el.tagName) index++;
      sib = sib.previousSibling;
    }

    path = `/${el.tagName.toLowerCase()}[${index}]` + path;
    el = el.parentNode;
  }

  return path;
}

/**
 * Builds a CSS selector for an element.
 * @param {HTMLElement} element
 */
function buildSelector(element) {
  if (!element) return "";

  if (element.id && !isDynamicId(element.id)) {
    return `#${CSS.escape(element.id)}`;
  }

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

  let path = [];
  let current = element;
  while (current && current.nodeType === Node.ELEMENT_NODE && path.length < 5) {
    let selector = current.nodeName.toLowerCase();

    if (current.className && typeof current.className === "string") {
      const classes = current.className.trim().split(/\s+/);
      const stableClasses = classes.filter(
        (cls) => cls && !isDynamicClass(cls),
      );
      if (stableClasses.length > 0) {
        selector += `.${stableClasses
          .slice(0, 2)
          .map((cls) => CSS.escape(cls))
          .join(".")}`;
      }
    }

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

    if (current && current.id && !isDynamicId(current.id)) {
      path.unshift(`#${CSS.escape(current.id)}`);
      break;
    }

    let foundStableAttr = false;
    for (const attr of stableAttrs) {
      if (current && current.hasAttribute(attr)) {
        const val = current.getAttribute(attr);
        if (val && !isDynamicId(val)) {
          path.unshift(`${current.tagName.toLowerCase()}[${attr}="${val}"]`);
          foundStableAttr = true;
          break;
        }
      }
    }
    if (foundStableAttr) break;
  }

  return path.join(" > ");
}

/**
 * Finds all elements matching an XPath.
 * @param {string} xpath
 */
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
  } catch (err) {}
  return result;
}
