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
 * Generates selectors in Chrome DevTools Recorder format.
 * @param {HTMLElement} element
 * @returns {Object} Selector object with arrays and metadata
 */
const SELECTOR_TEST_ATTRS = ["data-testid", "data-test", "data-cy"];
const ACTIONABLE_PARENT_SELECTOR =
  'button, a, [role="button"], input[type="submit"], input[type="button"]';
const MODAL_CONTAINER_SELECTOR =
  '.MuiDialog-root, .MuiDrawer-root, [role="dialog"]';

function generateSelectors(element) {
  element = normalizeSelectorTarget(element);
  if (!element || element.nodeType !== 1) return null;

  const selectors = [];
  const pushSelector = (selector) => {
    if (!selector || selectors.some((entry) => entry[0] === selector)) return;
    selectors.push([selector]);
  };

  const stableCandidates = collectStableSelectorCandidates(element);
  const primary = pickBestStableSelector(element, stableCandidates);
  const text = getVisibleText(element).replace(/\s+/g, " ").trim();

  pushSelector(primary);
  stableCandidates.forEach(({ value }) => pushSelector(value));

  if (element.hasAttribute("placeholder")) {
    const placeholder = element.getAttribute("placeholder");
    if (
      placeholder &&
      placeholder.trim().length >= 3 &&
      !/^\d+$/.test(placeholder.trim()) &&
      placeholder.trim().length < 100
    ) {
      pushSelector(`[placeholder="${escapeSelectorValue(placeholder)}"]`);
    }
  }

  const ariaSelector = buildAriaSelector(element);
  pushSelector(ariaSelector);

  const contextualButtonXPath = buildContextualButtonXPath(element);
  pushSelector(contextualButtonXPath);

  if (
    text &&
    text.length < 50 &&
    !text.includes("'") &&
    !isGenericIconText(text)
  ) {
    const tag = element.tagName.toLowerCase();
    pushSelector(`xpath///${tag}[normalize-space(.)='${text}']`);
    if (text.length > 3) {
      pushSelector(`xpath///${tag}[contains(normalize-space(.), '${text}')]`);
    }
  }

  if (element.hasAttribute("alt")) {
    const alt = element.getAttribute("alt");
    if (alt && alt.trim().length > 0 && alt.length < 80 && !isDynamic(alt)) {
      pushSelector(
        `${element.tagName.toLowerCase()}[alt="${escapeSelectorValue(alt)}"]`,
      );
    }
  }

  if (element.hasAttribute("title")) {
    const title = element.getAttribute("title");
    if (
      title &&
      title.trim().length > 0 &&
      title.length < 80 &&
      !isDynamic(title)
    ) {
      pushSelector(
        `${element.tagName.toLowerCase()}[title="${escapeSelectorValue(title)}"]`,
      );
    }
  }

  if (element.tagName === "A" && element.hasAttribute("href")) {
    const href = element.getAttribute("href");
    if (href && isStableUrl(href)) {
      pushSelector(`a[href="${escapeSelectorValue(href)}"]`);
    }
  }

  if (element.tagName === "IMG" && element.hasAttribute("src")) {
    const src = element.getAttribute("src");
    if (src && isStableUrl(src)) {
      pushSelector(`img[src="${escapeSelectorValue(src)}"]`);
    }
  }

  const css = buildSelector(element);
  const cssPath = buildCssPath(element);
  const xpath = getXPath(element);
  const primarySelector =
    primary || selectors[0]?.[0] || css || cssPath || (xpath ? `xpath//${xpath}` : "");

  pushSelector(css);
  pushSelector(cssPath);
  if (xpath) pushSelector(`xpath//${xpath}`);

  return {
    selectors,
    selector: primarySelector,
    selectorType: getSelectorType(primarySelector),
    css,
    xpath,
    id: element.id && !isDynamic(element.id) ? element.id : null,
    attributes: {
      "data-testid": element.getAttribute("data-testid"),
      "data-cy": element.getAttribute("data-cy"),
      "data-test": element.getAttribute("data-test"),
      "data-qa": element.getAttribute("data-qa"),
      "aria-label": element.getAttribute("aria-label"),
      alt: element.getAttribute("alt"),
      title: element.getAttribute("title"),
      name: element.getAttribute("name"),
      placeholder: element.getAttribute("placeholder"),
      role: element.getAttribute("role"),
      href: element.tagName === "A" ? element.getAttribute("href") : null,
      src: element.tagName === "IMG" ? element.getAttribute("src") : null,
    },
    innerText: text || "",
  };
}

function generateStableSelector(element) {
  element = normalizeSelectorTarget(element);
  if (!element || element.nodeType !== 1) return "";
  const candidates = collectStableSelectorCandidates(element);
  return pickBestStableSelector(element, candidates);
}

function normalizeSelectorTarget(element) {
  if (!element || element.nodeType !== 1) return null;
  const optionParent = element.closest?.(
    '[role="option"], .slds-listbox__option, li.slds-listbox__item, .MuiMenuItem-root, .MuiAutocomplete-option',
  );
  if (optionParent) return optionParent;
  const tag = (element.tagName || "").toLowerCase();
  const className =
    typeof element.className === "string"
      ? element.className
      : element.className?.baseVal || "";
  const isNestedTarget =
    ["svg", "path", "span", "p", "i", "use", "circle", "rect"].includes(tag) ||
    /\b(icon|svgicon)\b/i.test(className);
  return isNestedTarget
    ? element.closest(ACTIONABLE_PARENT_SELECTOR) || element
    : element;
}

function collectStableSelectorCandidates(element) {
  const scopeRoot = element.closest(MODAL_CONTAINER_SELECTOR);
  const scopePrefix = getModalScopeSelector(scopeRoot);
  const tag = element.tagName.toLowerCase();
  const candidates = [];
  const push = (priority, selector, scoped = true) => {
    if (!selector) return;
    const value =
      scoped && scopePrefix && !selector.startsWith("aria/")
        ? `${scopePrefix} ${selector}`
        : selector;
    candidates.push({ priority, value });
  };

  for (const [index, attr] of SELECTOR_TEST_ATTRS.entries()) {
    const value = element.getAttribute(attr);
    if (value && !isDynamic(value)) {
      push(index + 1, `[${attr}="${escapeSelectorValue(value)}"]`);
    }
  }

  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel && !isDynamic(ariaLabel)) {
    push(4, `[aria-label="${escapeSelectorValue(ariaLabel)}"]`);
  }

  if (element.id && !isDynamicId(element.id)) {
    push(5, `#${CSS.escape(element.id)}`);
  }

  const name = element.getAttribute("name");
  if (name && !isDynamic(name)) {
    push(6, `${tag}[name="${escapeSelectorValue(name)}"]`);
  }

  push(7, buildActionableTextSelector(element), false);

  const role = (element.getAttribute("role") || "").trim();
  if (role) {
    push(8, `[role="${escapeSelectorValue(role)}"]`);
    push(8, `${tag}[role="${escapeSelectorValue(role)}"]`);
  }

  const stableClass = getStableClasses(element)[0];
  if (stableClass) {
    push(9, `.${CSS.escape(stableClass)}`);
    push(9, `${tag}.${CSS.escape(stableClass)}`);
  }

  push(10, buildFallbackCssPath(element, scopeRoot), false);

  return candidates.filter(
    (candidate, index, list) =>
      candidate.value &&
      list.findIndex((entry) => entry.value === candidate.value) === index,
  );
}

function pickBestStableSelector(element, candidates) {
  const stableMatches = candidates.filter(
    ({ value, priority }) =>
      priority === 10 || isSelectorUnique(value, element),
  );
  stableMatches.sort(
    (left, right) =>
      left.priority - right.priority || left.value.length - right.value.length,
  );
  return stableMatches[0]?.value || buildFallbackCssPath(element);
}

function buildActionableTextSelector(element) {
  const role = getAriaRole(element);
  const isActionable =
    ["button", "link"].includes(role) ||
    element.matches?.(ACTIONABLE_PARENT_SELECTOR);
  const text = getVisibleText(element).replace(/\s+/g, " ").trim();

  if (
    !isActionable ||
    !text ||
    text.length > 80 ||
    isGenericIconText(text) ||
    /[[\]]/.test(text)
  ) {
    return "";
  }

  const base = role ? `aria/${role}[${text}]` : `aria/${text}`;
  const overlay = element.closest(MODAL_CONTAINER_SELECTOR);
  const overlayName = overlay ? getElementDescriptor(overlay) : "";
  const overlayRole = overlay ? getAriaRole(overlay) : "";

  if (overlay && overlay !== element && (!overlayName || !overlayRole)) {
    return "";
  }

  if (
    overlay &&
    overlay !== element &&
    overlayName &&
    overlayRole &&
    overlayName.length < 80 &&
    !/[[\]]/.test(overlayName)
  ) {
    return `aria/${overlayRole}[${overlayName.replace(/\s+/g, " ").trim()}] >> ${base}`;
  }

  return base;
}

function getModalScopeSelector(container) {
  if (!container) return "";
  for (const attr of SELECTOR_TEST_ATTRS) {
    const value = container.getAttribute(attr);
    if (value && !isDynamic(value)) {
      return `[${attr}="${escapeSelectorValue(value)}"]`;
    }
  }
  const ariaLabel = container.getAttribute("aria-label");
  if (ariaLabel && !isDynamic(ariaLabel)) {
    return `[aria-label="${escapeSelectorValue(ariaLabel)}"]`;
  }
  if (container.id && !isDynamicId(container.id)) {
    return `#${CSS.escape(container.id)}`;
  }
  if (container.matches(".MuiDialog-root")) return ".MuiDialog-root";
  if (container.matches(".MuiDrawer-root")) return ".MuiDrawer-root";
  return '[role="dialog"]';
}

function escapeSelectorValue(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function getStableClasses(element) {
  const className =
    typeof element.className === "string"
      ? element.className
      : element.className?.baseVal || "";
  return className
    .split(/\s+/)
    .filter(
      (cls) =>
        cls &&
        !isDynamicClass(cls) &&
        !/^(Mui-(checked|disabled|error|expanded|focusVisible|focused|selected)|is-|has-|active|open|closed|selected|disabled|focused)$/i.test(
          cls,
        ),
    )
    .sort((left, right) => left.length - right.length);
}

function buildCssSegment(element) {
  if (!element || element.nodeType !== 1) return "";
  for (const attr of [...SELECTOR_TEST_ATTRS, "name", "aria-label"]) {
    const value = element.getAttribute?.(attr);
    if (value && !isDynamic(value)) {
      return `${element.tagName.toLowerCase()}[${attr}="${escapeSelectorValue(value)}"]`;
    }
  }
  if (element.id && !isDynamicId(element.id)) {
    return `#${CSS.escape(element.id)}`;
  }
  const stableClass = getStableClasses(element)[0];
  if (stableClass) {
    return `${element.tagName.toLowerCase()}.${CSS.escape(stableClass)}`;
  }
  const role = (element.getAttribute("role") || "").trim();
  return role
    ? `${element.tagName.toLowerCase()}[role="${escapeSelectorValue(role)}"]`
    : element.tagName.toLowerCase();
}

function buildFallbackCssPath(element, scopeRoot = element.closest?.(MODAL_CONTAINER_SELECTOR)) {
  element = normalizeSelectorTarget(element);
  if (!element) return "";
  const scopePrefix = getModalScopeSelector(scopeRoot);
  const path = [];
  let current = element;

  while (
    current &&
    current.nodeType === 1 &&
    current !== document.body &&
    current !== scopeRoot
  ) {
    path.unshift(buildCssSegment(current));
    const candidate = scopePrefix
      ? `${scopePrefix} ${path.join(" > ")}`
      : path.join(" > ");
    if (isSelectorUnique(candidate, element)) return candidate;
    current = current.parentElement;
  }

  const fallback = path.join(" > ");
  if (!fallback) return scopePrefix;
  return scopePrefix ? `${scopePrefix} ${fallback}` : fallback;
}

function isSelectorUnique(selector, element) {
  if (!selector || !element) return false;
  try {
    if (selector.startsWith("aria/")) {
      const matches = queryAriaSelector(selector);
      return matches.length === 1 && matches[0] === element;
    }
    if (selector.startsWith("xpath/")) {
      const matches = getElementsByXPath(selector.slice(6));
      return matches.length === 1 && matches[0] === element;
    }
    const matches = Array.from(document.querySelectorAll(selector));
    return matches.length === 1 && matches[0] === element;
  } catch (err) {
    return false;
  }
}

function queryAriaSelector(selector) {
  if (!selector.startsWith("aria/")) return [];
  const parts = selector.split(" >> ");
  let contexts = [document];

  for (const rawPart of parts) {
    const part = rawPart.startsWith("aria/") ? rawPart.slice(5) : rawPart;
    const match = part.match(/^([a-z]+)\[(.+)\]$/i);
    const role = match ? match[1].toLowerCase() : null;
    const name = (match ? match[2] : part).replace(/\s+/g, " ").trim().toLowerCase();
    const next = [];

    for (const context of contexts) {
      for (const node of getAriaCandidatePool(context)) {
        const label = (node.getAttribute?.("aria-label") || "")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();
        const descriptor = getElementDescriptor(node)
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();
        const text = getVisibleText(node).replace(/\s+/g, " ").trim().toLowerCase();
        const matchedName =
          name && [label, descriptor, text].some((value) => value === name);
        if (!matchedName) continue;
        if (!role || getAriaRole(node) === role) next.push(node);
      }
    }

    contexts = next;
    if (!contexts.length) break;
  }

  return contexts;
}

function getAriaCandidatePool(context) {
  if (context === document) return Array.from(document.querySelectorAll("*"));
  if (!context || !context.querySelectorAll) return [];
  return [context, ...Array.from(context.querySelectorAll("*"))];
}

/**
 * Builds an ARIA selector — the "super-strategy" combining:
 *   - Role + accessible name (e.g. aria/button[Submit])
 *   - Label-based (label[for], wrapping label, aria-labelledby)
 *   - Visible text for interactive elements
 * Format: "aria/Submit" or "aria/button[Submit Order]"
 * @param {HTMLElement} element
 * @returns {string|null}
 */
function buildAriaSelector(element) {
  // 1. Get accessible name from getElementDescriptor (handles labels, aria-label, text, etc.)
  let accessibleName = getElementDescriptor(element);

  if (
    !accessibleName ||
    accessibleName.trim().length === 0 ||
    accessibleName.length >= 80
  ) {
    return null;
  }

  const finalName = accessibleName.replace(/\s+/g, " ").trim();
  // We no longer block generic icon text here because if it's the ONLY thing we found via getElementDescriptor,
  // it's better than an absolute XPath. The priority is handled by the caller.

  // 2. Try to determine the ARIA role for a richer selector
  const role = getAriaRole(element);

  // 3. Nested selector for MUI overlays
  const overlay = getNearestOverlay(element);
  if (overlay && overlay !== element) {
    const overlayName = getElementDescriptor(overlay);
    const overlayRole = getAriaRole(overlay);
    if (overlayName && overlayName.length < 50) {
      const overlaySelector = overlayRole
        ? `aria/${overlayRole}[${overlayName.replace(/\s+/g, " ").trim()}]`
        : `aria/${overlayName.replace(/\s+/g, " ").trim()}`;

      const elementSelector = role
        ? `aria/${role}[${finalName}]`
        : `aria/${finalName}`;

      return `${overlaySelector} >> ${elementSelector}`;
    }
  }

  // If we have a meaningful role, include it: aria/button[Submit]
  if (role) {
    return `aria/${role}[${finalName}]`;
  }

  // Otherwise just use the name: aria/Submit
  return `aria/${finalName}`;
}

function buildContextualButtonXPath(element) {
  if (!element || element.tagName !== "BUTTON") return null;
  const descriptor = (getElementDescriptor(element) || "").replace(/\s+/g, " ").trim();
  if (!["Edit", "Delete"].includes(descriptor)) return null;

  let current = element.parentElement;
  let contextText = "";
  let depth = 0;
  while (current && current !== document.body && depth < 6) {
    const text = getVisibleText(current).replace(/\s+/g, " ").trim();
    if (
      text &&
      text.length > descriptor.length + 4 &&
      text.length < 120 &&
      !text.toLowerCase().startsWith(descriptor.toLowerCase())
    ) {
      contextText = text.split(/\s{2,}|\n/)[0].trim();
      break;
    }
    current = current.parentElement;
    depth++;
  }

  if (!contextText || contextText.includes("'")) return null;

  const iconPredicate =
    descriptor === "Edit"
      ? ".//i[contains(normalize-space(.), 'edit')] or .//*[contains(@class, 'edit')]"
      : ".//i[contains(normalize-space(.), 'delete')] or .//*[contains(@class, 'delete')]";

  return `xpath///button[(${iconPredicate}) and ancestor::*[contains(normalize-space(.), '${contextText}')]]`;
}

/**
 * Finds the nearest MUI overlay (Modal, Dialog, Drawer, Popover).
 * @param {HTMLElement} el
 * @returns {HTMLElement|null}
 */
function getNearestOverlay(el) {
  let current = el ? el.parentElement : null;
  let depth = 0;
  while (current && current !== document.body && depth < 30) {
    const role = (current.getAttribute("role") || "").toLowerCase();
    if (["dialog", "alertdialog", "menu", "listbox"].includes(role))
      return current;
    if (current.tagName === "DIALOG") return current;

    const cls = current.className || "";
    if (
      typeof cls === "string" &&
      (/\b(modal|popover|dropdown-menu|drawer|popup|overlay)\b/i.test(cls) ||
        /\b(MuiModal|MuiPopover|MuiDrawer|MuiDialog|MuiMenu-paper|MuiAutocomplete-popper)\b/i.test(
          cls,
        ) ||
        /\b(ant-modal|ant-popover|ant-dropdown|ant-drawer|ant-select-dropdown)\b/i.test(
          cls,
        ) ||
        /\b(modal-dialog|modal-content)\b/i.test(cls) ||
        /\b(portal|react-select__menu|slds-modal|slds-dropdown|chakra-modal|chakra-popover)\b/i.test(
          cls,
        ))
    )
      return current;

    if (
      current.hasAttribute("data-popper-placement") ||
      current.hasAttribute("data-radix-popper-content-wrapper") ||
      current.hasAttribute("data-radix-dialog-content") ||
      current.hasAttribute("data-floating-ui-portal")
    )
      return current;

    current = current.parentElement;
    depth++;
  }
  return null;
}

/**
 * Determines the effective ARIA role for an element.
 * Returns the explicit role attribute or the implicit role from the tag.
 * @param {HTMLElement} element
 * @returns {string|null}
 */
function getAriaRole(element) {
  const className =
    typeof element.className === "string"
      ? element.className
      : element.className?.baseVal || "";

  // Explicit role attribute takes priority
  const explicitRole = element.getAttribute("role");
  if (explicitRole) return explicitRole;

  if (
    element.matches?.(
      '.slds-listbox__option, li.slds-listbox__item, .MuiMenuItem-root, .MuiAutocomplete-option',
    ) ||
    /\b(slds-listbox__option|MuiMenuItem-root|MuiAutocomplete-option)\b/.test(
      className,
    )
  ) {
    return "option";
  }

  // Implicit roles from HTML semantics
  const tag = element.tagName;
  const type = (element.getAttribute("type") || "").toLowerCase();

  const implicitRoles = {
    BUTTON: "button",
    A: "link",
    SELECT: "combobox",
    TEXTAREA: "textbox",
    NAV: "navigation",
    MAIN: "main",
    HEADER: "banner",
    FOOTER: "contentinfo",
    ASIDE: "complementary",
    FORM: "form",
    TABLE: "table",
    UL: "list",
    OL: "list",
    LI: "listitem",
    H1: "heading",
    H2: "heading",
    H3: "heading",
    H4: "heading",
    H5: "heading",
    H6: "heading",
    IMG: "img",
  };

  if (tag === "INPUT") {
    const inputRoles = {
      checkbox: "checkbox",
      radio: "radio",
      range: "slider",
      search: "searchbox",
      email: "textbox",
      tel: "textbox",
      url: "textbox",
      text: "textbox",
      password: "textbox",
      number: "spinbutton",
    };
    return inputRoles[type] || "textbox";
  }

  return implicitRoles[tag] || null;
}

/**
 * Checks if a URL is stable (not dynamic/session-specific).
 * @param {string} url
 * @returns {boolean}
 */
function isStableUrl(url) {
  if (!url || typeof url !== "string") return false;
  // Skip very long URLs, data URIs, blob URIs, and javascript: URIs
  if (url.length > 150) return false;
  if (url.startsWith("data:")) return false;
  if (url.startsWith("blob:")) return false;
  if (url.startsWith("javascript:")) return false;
  // Skip URLs with tokens, session IDs, or random hashes
  if (/[?&](token|session|sid|auth|nonce|_t)=/i.test(url)) return false;
  if (/[0-9a-f]{16,}/i.test(url)) return false;
  // Skip # anchors that look dynamic
  if (/#[0-9a-f]{8,}/i.test(url)) return false;
  return true;
}

/**
 * Builds a nth-of-type selector scoped to the parent element.
 * e.g. "div > button:nth-of-type(2)"
 * Only emitted when there are multiple siblings of the same tag.
 * @param {HTMLElement} element
 * @returns {string|null}
 */
function buildNthSelector(element) {
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
  if (selector.includes("[data-cy")) return "testId";
  if (selector.includes("[data-test")) return "testId";
  if (selector.includes("[data-qa")) return "testId";
  if (selector.includes("[name=")) return "name";
  if (selector.includes("[placeholder=")) return "placeholder";
  if (selector.includes("[alt=")) return "alt";
  if (selector.includes("[title=")) return "title";
  if (selector.includes("[href=")) return "href";
  if (selector.includes("[src=")) return "src";
  if (selector.includes(":nth-of-type")) return "nth";
  return "css";
}

/* ---------------- helpers ---------------- */

function isDynamic(value) {
  if (typeof value !== "string") return true;
  const normalized = value.trim();

  if (!normalized) return true;
  if (normalized.length > 120) return true;
  if (/^[0-9a-f]{8,}$/i.test(normalized)) return true;
  if (/^:(r[0-9a-z-]*):$/i.test(normalized)) return true;
  if (/^(mui-\d+|react-[\w-]+|headlessui-[\w-]+|radix-[\w-]+)/i.test(normalized))
    return true;
  if (/^(css|jsx|sc)-[a-z0-9]{5,}/i.test(normalized)) return true;
  if (/(^|[-_])(uuid|random|generated|temp|nonce|token)([-_]|$)/i.test(normalized))
    return true;
  if (/\d{5,}/.test(normalized)) return true;
  if (/[a-f0-9]{10,}/i.test(normalized) && /[-_]/.test(normalized)) return true;

  return false;
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
  return buildFallbackCssPath(el);
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
  element = normalizeSelectorTarget(element);
  if (!element) return "";
  const cssCandidate = collectStableSelectorCandidates(element).find(
    ({ value }) => value && !value.startsWith("aria/"),
  );
  return cssCandidate?.value || buildFallbackCssPath(element);
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
