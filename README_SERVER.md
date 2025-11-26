# Running the Web App

## Problem: CORS Error

If you see errors like:
- "Access to script blocked by CORS policy"
- "app is not defined"
- "Failed to load resource"

This happens because you're opening the HTML file directly (`file://`). The app uses ES6 modules which require an HTTP server.

## Solution: Use a Local Server

### Option 1: Python (Easiest)

**Windows:**
```bash
cd web
python -m http.server 8000
```

**Mac/Linux:**
```bash
cd web
python3 -m http.server 8000
```

Then open: http://localhost:8000/index.html

### Option 2: Using the Provided Script

**Windows:**
Double-click `server.bat` in the `web` folder

**Python script:**
```bash
cd web
python server.py
```

### Option 3: Node.js (if you have it)

```bash
cd web
npx http-server -p 8000
```

### Option 4: VS Code Live Server

1. Install "Live Server" extension in VS Code
2. Right-click on `index.html`
3. Select "Open with Live Server"

### Option 5: PHP (if you have it)

```bash
cd web
php -S localhost:8000
```

## Quick Start

1. Open terminal/command prompt
2. Navigate to the `web` folder:
   ```bash
   cd web
   ```
3. Start a server (choose one):
   - Python: `python -m http.server 8000`
   - Node: `npx http-server -p 8000`
4. Open browser and go to: `http://localhost:8000/index.html`

## Note

The server must be running while you use the app. Keep the terminal window open.

