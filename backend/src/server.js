require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const session = require('express-session');

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

app.use(session({
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        maxAge: 8 * 60 * 60 * 1000, // 8 hours
        secure: process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE === 'true',
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
app.listen(PORT, () => {
    console.log(`Invigilation system running on http://localhost:${PORT}`);
});
