// ============================================
// DEPENDENCIAS
// ============================================
const NodeMediaServer = require('node-media-server');
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { spawn } = require('child_process');
const session = require('express-session');

// ============================================
// CONFIGURACIÓN DE BASE DE DATOS
// ============================================
const app = express();
const WEB_PORT = process.env.PORT || 3000;
const RTMP_PORT = 1935;
const HTTP_PORT = 8000;

// Variables globales
let db;
let isStreaming = false;
let isRecording = false;
let currentRecordingProcess = null;
let currentRecordingFilename = null;
let chatMessages = [];
const MAX_CHAT = 100;

// ============================================
// INICIALIZAR BASE DE DATOS SEGÚN ENTORNO
// ============================================
async function initDatabase() {
    if (process.env.NODE_ENV === 'production') {
        // PRODUCCIÓN: PostgreSQL
        const { Pool } = require('pg');
        const pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: { rejectUnauthorized: false }
        });
        
        // Crear tablas
        await pool.query(`
            CREATE TABLE IF NOT EXISTS songs (
                id SERIAL PRIMARY KEY,
                title TEXT,
                artist TEXT,
                filename TEXT,
                added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            
            CREATE TABLE IF NOT EXISTS playlists (
                id SERIAL PRIMARY KEY,
                name TEXT,
                description TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            
            CREATE TABLE IF NOT EXISTS playlist_songs (
                playlist_id INTEGER,
                song_id INTEGER,
                position INTEGER
            );
            
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username TEXT UNIQUE,
                password TEXT
            );
            
            CREATE TABLE IF NOT EXISTS recordings (
                id SERIAL PRIMARY KEY,
                filename TEXT,
                size INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            
            CREATE TABLE IF NOT EXISTS ads (
                id SERIAL PRIMARY KEY,
                image TEXT,
                link TEXT,
                title TEXT,
                active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT
            );
        `);
        
        // Usuario admin
        const userCheck = await pool.query("SELECT * FROM users WHERE username = 'admin'");
        if (userCheck.rows.length === 0) {
            await pool.query("INSERT INTO users (username, password) VALUES ($1, $2)", ['admin', 'admin123']);
            console.log('✅ Usuario admin creado: admin / admin123');
        }
        
        // Logo por defecto
        const logoCheck = await pool.query("SELECT * FROM settings WHERE key = 'logo'");
        if (logoCheck.rows.length === 0) {
            await pool.query("INSERT INTO settings (key, value) VALUES ($1, $2)", ['logo', '']);
        }
        
        console.log('✅ Conectado a PostgreSQL en Render');
        
        // Retornar objeto con métodos para la API
        return {
            query: (text, params) => pool.query(text, params),
            get: (text, params) => pool.query(text, params).then(res => res.rows[0]),
            all: (text, params) => pool.query(text, params).then(res => res.rows),
            run: (text, params) => pool.query(text, params)
        };
        
    } else {
        // DESARROLLO: SQLite
        const sqlite3 = require('sqlite3').verbose();
        const sqliteDb = new sqlite3.Database('./database/radio.db');
        
        sqliteDb.serialize(() => {
            sqliteDb.run(`CREATE TABLE IF NOT EXISTS songs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                artist TEXT,
                filename TEXT NOT NULL,
                added_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);
            
            sqliteDb.run(`CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL
            )`);
            
            sqliteDb.run(`CREATE TABLE IF NOT EXISTS ads (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                image TEXT NOT NULL,
                link TEXT,
                title TEXT,
                active INTEGER DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);
            
            sqliteDb.run(`CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT
            )`);
            
            sqliteDb.run(`CREATE TABLE IF NOT EXISTS recordings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filename TEXT NOT NULL,
                size INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);
            
            // Usuario admin
            sqliteDb.get("SELECT * FROM users WHERE username = 'admin'", (err, row) => {
                if (!row) {
                    sqliteDb.run("INSERT INTO users (username, password) VALUES (?, ?)", ['admin', 'admin123']);
                }
            });
            
            // Logo por defecto
            sqliteDb.get("SELECT * FROM settings WHERE key = 'logo'", (err, row) => {
                if (!row) {
                    sqliteDb.run("INSERT INTO settings (key, value) VALUES (?, ?)", ['logo', '']);
                }
            });
        });
        
        console.log('✅ Usando SQLite local');
        
        // Retornar objeto con métodos compatibles (callback style para SQLite)
        return {
            get: (sql, params, callback) => sqliteDb.get(sql, params, callback),
            all: (sql, params, callback) => sqliteDb.all(sql, params, callback),
            run: (sql, params, callback) => sqliteDb.run(sql, params, callback)
        };
    }
}

// ============================================
// MIDDLEWARES
// ============================================
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('public/assets/uploads'));
app.use('/logos', express.static('public/assets/logos'));
app.use('/ads', express.static('public/assets/ads'));
app.use('/recordings', express.static(path.join(__dirname, 'recordings')));

app.use(session({
    secret: process.env.SESSION_SECRET || 'nexuslive_secret_2024',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// Crear carpetas
const dirs = ['./database', './public/assets/uploads', './public/assets/logos', './public/assets/ads', './recordings'];
dirs.forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ============================================
// AUTENTICACIÓN
// ============================================
function isAuthenticated(req, res, next) {
    if (req.session && req.session.isAdmin) return next();
    res.redirect('/login');
}

// ============================================
// RUTAS
// ============================================

// Login
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = await db.get("SELECT * FROM users WHERE username = ? AND password = ?", [username, password]);
        if (user) {
            req.session.isAdmin = true;
            req.session.username = username;
            res.json({ success: true });
        } else {
            res.status(401).json({ success: false, error: 'Credenciales incorrectas' });
        }
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ success: false, error: 'Error del servidor' });
    }
});

app.get('/api/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// Chat
app.get('/api/chat/messages', (req, res) => {
    res.json(chatMessages.slice(-50));
});

app.post('/api/chat/send', (req, res) => {
    const { username, message } = req.body;
    if (!username || !message || message.trim() === '') {
        return res.status(400).json({ error: 'Mensaje inválido' });
    }
    const newMessage = {
        id: Date.now(),
        username: username.substring(0, 20),
        message: message.substring(0, 200),
        timestamp: new Date().toISOString()
    };
    chatMessages.push(newMessage);
    if (chatMessages.length > MAX_CHAT) chatMessages.shift();
    res.json({ success: true });
});

// Subida de archivos
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (file.fieldname === 'logo') cb(null, './public/assets/logos/');
        else if (file.fieldname === 'ad_image') cb(null, './public/assets/ads/');
        else cb(null, './public/assets/uploads/');
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024, files: 100 } });

// Canciones
app.post('/api/songs/multiple', upload.array('files', 100), (req, res) => {
    const files = req.files;
    if (!files || files.length === 0) {
        return res.status(400).json({ error: 'No se subió ningún archivo' });
    }
    let completed = 0;
    files.forEach(file => {
        let title = file.originalname.replace('.mp3', '').replace(/[_-]/g, ' ');
        title = title.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
        db.run('INSERT INTO songs (title, artist, filename) VALUES (?, ?, ?)', [title, 'NEXUS', file.filename], () => {
            completed++;
            if (completed === files.length) res.json({ success: true, uploaded: files.length });
        });
    });
});

app.get('/api/songs', (req, res) => {
    db.all('SELECT * FROM songs ORDER BY added_at DESC', [], (err, rows) => {
        if (err) {
            console.error('Error en songs:', err);
            return res.status(500).json({ error: err.message });
        }
        res.json(rows || []);
    });
});

app.delete('/api/songs/:id', (req, res) => {
    const { id } = req.params;
    db.get('SELECT filename FROM songs WHERE id = ?', [id], (err, row) => {
        if (err || !row) return res.status(500).json({ error: 'Canción no encontrada' });
        const filePath = path.join(__dirname, 'public/assets/uploads', row.filename);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        db.run('DELETE FROM songs WHERE id = ?', [id], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        });
    });
});

// Logo
app.post('/api/upload-logo', upload.single('logo'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No se subió ningún archivo' });
    const logoPath = `/logos/${req.file.filename}`;
    db.run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", ['logo', logoPath], () => {
        res.json({ success: true, logo: logoPath });
    });
});

app.get('/api/settings', (req, res) => {
    db.all('SELECT key, value FROM settings', [], (err, rows) => {
        if (err) return res.json({});
        const settings = {};
        rows.forEach(row => settings[row.key] = row.value);
        res.json(settings);
    });
});

// Publicidad
app.post('/api/ads/upload', upload.single('ad_image'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No se subió ningún archivo' });
    const { link, title } = req.body;
    const imagePath = `/ads/${req.file.filename}`;
    db.run("INSERT INTO ads (image, link, title) VALUES (?, ?, ?)", [imagePath, link || '#', title || 'Publicidad'], () => {
        res.json({ success: true });
    });
});

app.get('/api/ads', (req, res) => {
    db.all("SELECT * FROM ads WHERE active = 1 ORDER BY created_at DESC", [], (err, rows) => {
        if (err) return res.json([]);
        res.json(rows);
    });
});

app.delete('/api/ads/:id', (req, res) => {
    const { id } = req.params;
    db.get("SELECT image FROM ads WHERE id = ?", [id], (err, row) => {
        if (row && row.image) {
            const filePath = path.join(__dirname, 'public', row.image);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }
        db.run("DELETE FROM ads WHERE id = ?", [id], () => {
            res.json({ success: true });
        });
    });
});

// Grabaciones
app.post('/api/recordings/start', (req, res) => {
    if (isRecording) return res.json({ success: false, message: 'Ya hay una grabación en curso' });
    if (!isStreaming) return res.json({ success: false, message: 'No hay transmisión activa' });
    
    const timestamp = Date.now();
    currentRecordingFilename = `recording_${timestamp}.mp4`;
    const outputPath = path.join(__dirname, 'recordings', currentRecordingFilename);
    const rtmpUrl = `rtmp://localhost:${RTMP_PORT}/live/mitv`;
    currentRecordingProcess = spawn('ffmpeg', ['-i', rtmpUrl, '-c', 'copy', '-y', outputPath]);
    currentRecordingProcess.on('error', () => isRecording = false);
    currentRecordingProcess.on('close', () => { isRecording = false; currentRecordingProcess = null; });
    isRecording = true;
    res.json({ success: true, message: 'Grabación iniciada' });
});

app.post('/api/recordings/stop', (req, res) => {
    if (!isRecording || !currentRecordingProcess) return res.json({ success: false, message: 'No hay grabación en curso' });
    currentRecordingProcess.kill('SIGINT');
    res.json({ success: true, message: 'Grabación detenida' });
});

app.get('/api/recordings/status', (req, res) => {
    res.json({ isRecording, filename: currentRecordingFilename });
});

app.get('/api/recordings', (req, res) => {
    db.all('SELECT * FROM recordings ORDER BY created_at DESC', [], (err, rows) => {
        if (err || !rows || rows.length === 0) {
            const recordingsDir = path.join(__dirname, 'recordings');
            if (!fs.existsSync(recordingsDir)) return res.json([]);
            fs.readdir(recordingsDir, (err, files) => {
                if (err) return res.json([]);
                const recordings = files.filter(f => f.endsWith('.mp4')).map(filename => {
                    const filePath = path.join(recordingsDir, filename);
                    try {
                        const stats = fs.statSync(filePath);
                        return { id: filename, filename, title: filename.replace('.mp4', ''), size: stats.size, created_at: stats.birthtime || stats.ctime };
                    } catch(e) { return null; }
                }).filter(r => r).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
                res.json(recordings);
            });
        } else {
            res.json(rows);
        }
    });
});

app.delete('/api/recordings/:filename', (req, res) => {
    const filePath = path.join(__dirname, 'recordings', req.params.filename);
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        db.run('DELETE FROM recordings WHERE filename = ?', [req.params.filename]);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Archivo no encontrado' });
    }
});

app.get('/recordings/download/:filename', (req, res) => {
    const filePath = path.join(__dirname, 'recordings', req.params.filename);
    if (!fs.existsSync(filePath)) return res.status(404).send('Archivo no encontrado');
    res.download(filePath, req.params.filename);
});

// Estado del stream
app.get('/api/stream/status', (req, res) => {
    res.json({ isLive: isStreaming });
});

// Servidor RTMP
const nms = new NodeMediaServer({
    rtmp: { port: RTMP_PORT, chunk_size: 60000, gop_cache: true, ping: 60, ping_timeout: 30 },
    http: { port: HTTP_PORT, allow_origin: '*' }
});
nms.run();
nms.on('prePublish', () => { console.log('🔴 Stream EN VIVO'); isStreaming = true; });
nms.on('donePublish', () => { console.log('⚫ Stream detenido'); isStreaming = false; if (isRecording && currentRecordingProcess) { currentRecordingProcess.kill('SIGINT'); isRecording = false; } });

// Frontend
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });
app.get('/admin', isAuthenticated, (req, res) => { res.sendFile(path.join(__dirname, 'public', 'admin.html')); });

// ============================================
// INICIAR SERVIDOR
// ============================================
initDatabase().then(database => {
    db = database;
    app.listen(WEB_PORT, () => {
        console.log(`
═══════════════════════════════════════════════════
🎥 NEXUS LIVE - SERVIDOR COMPLETO
═══════════════════════════════════════════════════
🌐 Web:      http://localhost:${WEB_PORT}
🔐 Login:    http://localhost:${WEB_PORT}/login
🔧 Admin:    http://localhost:${WEB_PORT}/admin
📡 OBS:      rtmp://localhost:${RTMP_PORT}/live
🔑 Stream key: mitv
👤 Usuario: admin | Contraseña: admin123
📦 Base de datos: ${process.env.NODE_ENV === 'production' ? 'PostgreSQL' : 'SQLite'}
═══════════════════════════════════════════════════
        `);
    });
}).catch(err => {
    console.error('❌ Error inicializando base de datos:', err);
    process.exit(1);
});