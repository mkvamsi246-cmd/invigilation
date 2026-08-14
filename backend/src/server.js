require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const fs = require('fs');
const db = require('./db');

const authRoutes = require('./routes/auth');
const facultyRoutes = require('./routes/faculty');
const classroomRoutes = require('./routes/classrooms');
const examRoutes = require('./routes/exams');
const allocationRoutes = require('./routes/allocation');
const uploadRoutes = require('./routes/upload');
const templateRoutes = require('./routes/templates');

const app = express();

app.use(cors({
    origin: process.env.FRONTEND_ORIGIN || true,
    credentials: true,
}));
app.use(express.json());

const isProd = process.env.NODE_ENV === 'production';
if (isProd) {
    app.set('trust proxy', 1); // Trust first proxy (Render uses reverse proxies)
}

app.use(session({
    store: new pgSession({
        pool: db.pool, // Connection pool
        tableName: 'session' // DB table name
    }),
    secret: process.env.SESSION_SECRET || 'dev-secret-change-key-2026',
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        maxAge: 8 * 60 * 60 * 1000, // 8 hours
        secure: isProd,
        sameSite: isProd ? 'none' : 'lax',
    },
}));

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/faculty', facultyRoutes);
app.use('/api/classrooms', classroomRoutes);
app.use('/api/exams', examRoutes);
app.use('/api/allocation', allocationRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/templates', templateRoutes);

// Serve the frontend (single static folder, deployed alongside backend)
const frontendPath = path.join(__dirname, '..', '..', 'frontend');
// Disable caching for JS/CSS so browsers always fetch the latest code
app.use(express.static(frontendPath, {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        }
    }
}));
app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(frontendPath, 'index.html'));
});

// Error handler
app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 4000;

// Run database migrations on startup, then start the server
async function startServer() {
    try {
        const schemaPath = path.join(__dirname, 'schema.sql');
        const sql = fs.readFileSync(schemaPath, 'utf8');
        await db.query(sql);
        console.log('✔ Database schema verified/applied successfully.');

        app.listen(PORT, () => {
            console.log(`Invigilation system running on http://localhost:${PORT}`);
        });
    } catch (err) {
        console.error('✘ Failed to apply database schema on startup:', err);
        process.exit(1);
    }
}

startServer();
