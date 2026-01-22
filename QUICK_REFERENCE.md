# Quick Reference - Ports & Configuration

## 🔌 Port Configuration Locations

### Backend Server Port
**File:** `backend/server.js`  
**Line:** 6  
**Current Value:** `const PORT = process.env.PORT || 4000;`  
**How to Change:**
```bash
# Option 1: Set environment variable
export PORT=7080
npm start

# Option 2: Edit server.js directly
const PORT = 7080;
```

### Extension API URL
**File:** `extension-src/popup.js`  
**Line:** 3  
**Current Value:** `const API_BASE_URL = "http://localhost:4000";`  
**How to Change:**
```javascript
const API_BASE_URL = "http://localhost:7080"; // Change port here
```

### MySQL Database
**File:** `backend/server.js`  
**Lines:** 12-19  
**Configuration:**
```javascript
const dbConfig = {
  host: process.env.DB_HOST || "localhost",      // Default: localhost
  user: process.env.DB_USER || "root",            // Default: root
  password: process.env.DB_PASSWORD ?? "",        // Default: empty
  database: process.env.DB_NAME || "test_recorder" // Default: test_recorder
};
```

**How to Change:**
```bash
export DB_HOST=localhost
export DB_USER=your_user
export DB_PASSWORD=your_password
export DB_NAME=your_database
npm start
```

---

## 📍 Where Things Connect

```
┌─────────────────┐
│ Chrome Extension│
│  (popup.js)     │
│                 │
│ API_BASE_URL =  │───HTTP───┐
│ localhost:4000  │          │
└─────────────────┘          │
                              ▼
                        ┌─────────────┐
                        │ Node.js     │
                        │ Backend     │
                        │ Port: 4000  │
                        │ (server.js) │
                        └─────────────┘
                              │
                              │ MySQL Connection
                              │ (Port: 3306)
                              ▼
                        ┌─────────────┐
                        │ MySQL       │
                        │ Database    │
                        │ test_recorder│
                        └─────────────┘
```

---

## 🔄 Data Flow Summary

### Recording:
1. **User** → Clicks "Record" in extension popup
2. **Extension** → Records clicks/inputs on webpage
3. **Extension** → Sends to Backend API (`POST /api/test-cases`)
4. **Backend** → Saves to MySQL database
5. **Backend** → Returns test case ID

### Execution:
1. **User** → Selects flow from dropdown
2. **Extension** → Fetches from Backend API (`GET /api/test-cases/:id`)
3. **Backend** → Queries MySQL and returns steps
4. **Extension** → Executes steps on webpage
5. **Extension** → Shows completion status

---

## 🚀 Quick Start Commands

### Start Backend:
```bash
cd backend
npm start
# Server starts on http://localhost:4000
```

### Check if Backend is Running:
```bash
curl http://localhost:4000/api/test-cases
# Should return JSON array of test cases
```

### Check Database:
```bash
mysql -u root -e "USE test_recorder; SELECT * FROM test_cases;"
```

### Load Extension:
1. Open `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select `extension-src` folder

---

## ⚙️ Common Configuration Changes

### Change Backend Port to 7080:
1. **Backend:** `backend/server.js` line 6 → `const PORT = 7080;`
2. **Extension:** `extension-src/popup.js` line 3 → `const API_BASE_URL = "http://localhost:7080";`
3. Restart backend: `npm start`
4. Reload extension in Chrome

### Use Different MySQL Credentials:
```bash
cd backend
export DB_USER=myuser
export DB_PASSWORD=mypassword
export DB_NAME=mydatabase
npm start
```

---

## 📝 Important Notes

- **Backend and Extension ports must match** - If backend runs on 4000, extension must connect to 4000
- **MySQL must be running** - Backend will fail to start if MySQL is not accessible
- **Database is auto-created** - Tables are created automatically on first backend start
- **Extension needs reload** - After changing `popup.js`, reload extension in `chrome://extensions/`
