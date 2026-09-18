const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Memory cache for active meal images (base64 or file paths)
let activeMeals = {
    date: getTodayString(),
    breakfast: null,
    lunch: null,
    snacks: null,
    dinner: null
};

function getTodayString() {
    return new Date().toISOString().split('T')[0];
}

function checkAndResetAtMidnight() {
    const today = getTodayString();
    if (activeMeals.date !== today) {
        console.log(`[Midnight Reset] Date changed from ${activeMeals.date} to ${today}. Resetting active meal slots.`);
        activeMeals = {
            date: today,
            breakfast: null,
            lunch: null,
            snacks: null,
            dinner: null
        };
        broadcastState();
    }
}

// Check for date rollover every 10 seconds
setInterval(checkAndResetAtMidnight, 10000);

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Serve current state via REST endpoint as fallback
app.get('/api/meals', (req, res) => {
    checkAndResetAtMidnight();
    res.json(activeMeals);
});

// Upload endpoint
app.post('/api/upload', (req, res) => {
    checkAndResetAtMidnight();
    const { meal, imageData } = req.body;

    if (!['breakfast', 'lunch', 'snacks', 'dinner'].includes(meal)) {
        return res.status(400).json({ error: 'Invalid meal slot' });
    }

    activeMeals[meal] = imageData; // stores base64 image or null
    broadcastState();
    res.json({ success: true, meal, date: activeMeals.date });
});

function broadcastState() {
    const payload = JSON.stringify({ type: 'SYNC_MEALS', data: activeMeals });
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    });
}

wss.on('connection', (ws) => {
    console.log('[WebSocket] Client connected.');
    // Send current meal images immediately upon connecting
    ws.send(JSON.stringify({ type: 'SYNC_MEALS', data: activeMeals }));

    ws.on('message', (message) => {
        try {
            const parsed = JSON.parse(message);
            if (parsed.type === 'UPDATE_MEAL') {
                const { meal, imageData } = parsed;
                if (['breakfast', 'lunch', 'snacks', 'dinner'].includes(meal)) {
                    activeMeals[meal] = imageData;
                    broadcastState();
                }
            } else if (parsed.type === 'CLEAR_ALL') {
                activeMeals.breakfast = null;
                activeMeals.lunch = null;
                activeMeals.snacks = null;
                activeMeals.dinner = null;
                broadcastState();
            }
        } catch (e) {
            console.error('WebSocket Error:', e);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`\n🚀 Daily Meal Tracker running on http://localhost:${PORT}`);
    console.log(`📱 Access on other devices using your computer's local IP address (e.g. http://192.168.1.X:${PORT})\n`);
});