## Web Test Recorder Extension + Backend

This project provides a Chrome Extension that behaves like a lightweight Selenium IDE: it records user interactions (clicks, text inputs) on web pages as **test cases** and sends them to a **Node.js + MySQL** backend for storage.

### 1. Chrome Extension

**Files (in `extension-src/`):**
- `manifest.json` – Chrome Manifest V3 configuration
- `background.js` – service worker managing recording state and collecting steps
- `content.js` – injected into pages to listen for clicks/inputs
- `popup.html`, `popup.js` – UI to start/stop recording and send data to backend

**How it works:**
- Open the popup and give your test case a name.
- Click **Start recording**.
- Interact with the current tab (click buttons/links, type into fields, etc.).
- Click **Stop recording**.
- The popup sends the recorded test case (with steps) to the backend at `http://localhost:4000/api/test-cases`.

Each recorded **step** includes:
- `action` – `click` or `input`
- `selector` – a CSS-like selector for the target element
- `tagName` – element tag (e.g. `BUTTON`, `INPUT`)
- `value` – for input actions, the text value
- `url` – page URL
- `timestamp` – capture time (ms since epoch)

#### Load the extension in Chrome
1. Build/prepare: the extension is already in plain JS, no build step needed.
2. In Chrome, go to `chrome://extensions/`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the `extension-src` folder.
5. Pin the extension icon if desired.

### 2. Backend (Node.js + Express + MySQL)

**Location:** `backend/`

**Key files:**
- `server.js` – Express app, MySQL pool, schema initialization and REST endpoints
- `package.json` – Node project with dependencies and `start` script

**Install dependencies:**

```bash
cd backend
npm install
```

(Dependencies are already listed in `package.json`.)

**Configure MySQL:**

Create a database (default name: `test_recorder`):

```sql
CREATE DATABASE test_recorder;
```

Optionally create a dedicated MySQL user and grant permissions.

Backend reads the following environment variables (with defaults):
- `DB_HOST` (default `localhost`)
- `DB_USER` (default `root`)
- `DB_PASSWORD` (default `password`)
- `DB_NAME` (default `test_recorder`)
- `PORT` (default `4000`)

You can export them before starting the server, e.g.:

```bash
export DB_HOST=localhost
export DB_USER=root
export DB_PASSWORD=your_password
export DB_NAME=test_recorder
export PORT=4000
```

**Run the backend:**

```bash
cd backend
npm start
```

On startup the server will:
- connect to MySQL
- create tables `test_cases` and `test_steps` if they do not exist
- start listening on `http://localhost:4000`

### 3. API Overview

**POST `/api/test-cases`** – store a test case and its steps

Request body example:

```json
{
  "name": "Login flow",
  "steps": [
    {
      "action": "click",
      "selector": "#login-button",
      "tagName": "BUTTON",
      "url": "https://example.com/login",
      "timestamp": 1737540000000
    },
    {
      "action": "input",
      "selector": "#email",
      "tagName": "INPUT",
      "value": "user@example.com",
      "url": "https://example.com/login",
      "timestamp": 1737540001000
    }
  ]
}
```

Response:

```json
{
  "id": 1,
  "name": "Login flow",
  "stepCount": 2
}
```

**GET `/api/test-cases`** – list all test cases

Returns an array of `test_cases` rows.

**GET `/api/test-cases/:id`** – get a single test case with steps

Returns:

```json
{
  "id": 1,
  "name": "Login flow",
  "created_at": "2026-01-22T12:00:00.000Z",
  "steps": [
    {
      "id": 1,
      "test_case_id": 1,
      "step_order": 1,
      "action": "click",
      "selector": "#login-button",
      "tag_name": "BUTTON",
      "value": null,
      "url": "https://example.com/login",
      "timestamp": 1737540000000
    }
  ]
}
```

### 4. End-to-end Flow

1. Start MySQL and create the `test_recorder` database.
2. Run the backend with `npm start` from the `backend` folder.
3. Load the Chrome extension from `extension-src` in `chrome://extensions`.
4. Navigate to any web page, open the extension popup.
5. Enter a test case name and click **Start recording**.
6. Interact with the page (clicks, text inputs are captured).
7. Click **Stop recording** in the popup.
8. The extension posts the test case to `http://localhost:4000/api/test-cases` and shows a status message (including stored id).
9. You can inspect data using MySQL or via the REST endpoints.

This gives you a basic Selenium IDE–like recorder that you can extend with more actions (navigation, assertions, waits, etc.) and richer UI as needed.
