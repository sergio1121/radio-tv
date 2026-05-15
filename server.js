const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { Pool } = require('pg');
const NodeMediaServer = require('node-media-server');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;
const RTMP_PORT = 1935;
const HTTP_PORT = 8000;

// ============================================
// CONFIGURACIÓN DE BASE DE DATOS
// ============================================
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// ============================================
// MIDDLEWARES
// ============================================
app.use(express.json());
app.use(express.static('public'));
app.use(session({
    secret: 'nexuslive_secret_2024',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// Crear carpetas necesarias
['./database', './public/assets/uploads', './public/assets/logos', './public/assets/ads', './recordings'].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ============================================
// FUNCIONES DE BASE DE DATOS
// ============================================
async function query(text, params) {
    try {
        const result = await pool.query(text, params);
        return result;
    } catch (err) {
        console.error('Error en query:', err);
        throw err;
    }
}

// ============================================
// MIDDLEWARE DE AUTENTICACIÓN
// ============================================
function isAuthenticated(req, res, next) {
    if (req.session && req.session.isAdmin) return next();
    res.redirect('/login');
}

// ============================================
// RUTAS DE AUTENTICACIÓN
// ============================================
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await query('SELECT * FROM users WHERE username = $1 AND password = $2', [username, password]);
        if (result.rows.length > 0) {
            req.session.isAdmin = true;
            req.session.username = username;
            res.json({ success: true });
        } else {
            res.status(401).json({ success: false, error: 'Credenciales incorrectas' });
        }
    } catch (err) {
        console.error('Error en login:', err);
        res.status(500).json({ success: false, error: 'Error del servidor' });
    }
});

app.get('/api/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// ============================================
// CHAT
// ============================================
let chatMessages = [];
const MAX_CHAT = 100;

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

// ============================================
// CONFIGURACIÓN DE MULTER
// ============================================
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

// ============================================
// CANCIONES
// ============================================
app.post('/api/songs/multiple', upload.array('files', 100), async (req, res) => {
    const files = req.files;
    if (!files || files.length === 0) {
        return res.status(400).json({ error: 'No se subió ningún archivo' });
    }
    try {
        for (const file of files) {
            let title = file.originalname.replace('.mp3', '').replace(/[_-]/g, ' ');
            title = title.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
            await query('INSERT INTO songs (title, artist, filename) VALUES ($1, $2, $3)', [title, 'NEXUS', file.filename]);
        }
        res.json({ success: true, uploaded: files.length });
    } catch (err) {
        console.error('Error al subir canciones:', err);
        res.status(500).json({ error: 'Error al subir archivos' });
    }
});

app.get('/api/songs', async (req, res) => {
    try {
        const result = await query('SELECT * FROM songs ORDER BY added_at DESC');
        res.json(result.rows || []);
    } catch (err) {
        console.error('Error al obtener canciones:', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/songs/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const song = await query('SELECT filename FROM songs WHERE id = $1', [id]);
        if (song.rows[0]) {
            const filePath = path.join(__dirname, 'public/assets/uploads', song.rows[0].filename);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }
        await query('DELETE FROM songs WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (err) {
        console.error('Error al eliminar canción:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// LOGO
// ============================================
app.post('/api/upload-logo', upload.single('logo'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No se subió ningún archivo' });
    }
    const logoPath = `/logos/${req.file.filename}`;
    await query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2', ['logo', logoPath]);
    res.json({ success: true, logo: logoPath });
});

app.get('/api/settings', async (req, res) => {
    try {
        const result = await query('SELECT key, value FROM settings');
        const settings = {};
        result.rows.forEach(row => settings[row.key] = row.value);
        res.json(settings);
    } catch (err) {
        res.json({});
    }
});

// ============================================
// PUBLICIDAD
// ============================================
app.post('/api/ads/upload', upload.single('ad_image'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No se subió ningún archivo' });
    }
    const { link, title } = req.body;
    const imagePath = `/ads/${req.file.filename}`;
    await query('INSERT INTO ads (image, link, title) VALUES ($1, $2, $3)', [imagePath, link || '#', title || 'Publicidad']);
    res.json({ success: true });
});

app.get('/api/ads', async (req, res) => {
    try {
        const result = await query('SELECT * FROM ads WHERE active = 1 ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) {
        res.json([]);
    }
});

app.delete('/api/ads/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const ad = await query('SELECT image FROM ads WHERE id = $1', [id]);
        if (ad.rows[0] && ad.rows[0].image) {
            const filePath = path.join(__dirname, 'public', ad.rows[0].image);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }
        await query('DELETE FROM ads WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (err) {
        res.json({ success: true });
    }
});

// ============================================
// GRABACIONES Y STREAM
// ============================================
let isRecording = false;
let currentRecordingProcess = null;
let currentRecordingFilename = null;
let isStreaming = false;

app.post('/api/recordings/start', (req, res) => {
    if (isRecording) return res.json({ success: false, message: 'Ya hay una grabación en curso' });
    if (!isStreaming) return res.json({ success: false, message: 'No hay transmisión activa' });
    
    const timestamp = Date.now();
    currentRecordingFilename = `recording_${timestamp}.mp4`;
    const outputPath = path.join(__dirname, 'recordings', currentRecordingFilename);
    const rtmpUrl = `rtmp://localhost:${RTMP_PORT}/live/mitv`;
    currentRecordingProcess = spawn('ffmpeg', ['-i', rtmpUrl, '-c', 'copy', '-y', outputPath]);
    currentRecordingProcess.on('error', () => { isRecording = false; });
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

app.get('/api/recordings', async (req, res) => {
    try {
        const result = await query('SELECT * FROM recordings ORDER BY created_at DESC');
        if (result.rows.length > 0) {
            res.json(result.rows);
            return;
        }
    } catch (err) {}
    
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
});

app.delete('/api/recordings/:filename', (req, res) => {
    const filePath = path.join(__dirname, 'recordings', req.params.filename);
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        query('DELETE FROM recordings WHERE filename = $1', [req.params.filename]).catch(() => {});
    }
    res.json({ success: true });
});

app.get('/recordings/download/:filename', (req, res) => {
    const filePath = path.join(__dirname, 'recordings', req.params.filename);
    if (!fs.existsSync(filePath)) return res.status(404).send('Archivo no encontrado');
    res.download(filePath, req.params.filename);
});

app.get('/api/stream/status', (req, res) => {
    res.json({ isLive: isStreaming });
});

// ============================================
// SERVIDOR RTMP
// ============================================
const nms = new NodeMediaServer({
    rtmp: { port: RTMP_PORT, chunk_size: 60000, gop_cache: true, ping: 60, ping_timeout: 30 },
    http: { port: HTTP_PORT, allow_origin: '*' }
});
nms.run();
nms.on('prePublish', () => { console.log('🔴 Stream EN VIVO'); isStreaming = true; });
nms.on('donePublish', () => { console.log('⚫ Stream detenido'); isStreaming = false; if (isRecording && currentRecordingProcess) { currentRecordingProcess.kill('SIGINT'); isRecording = false; } });

// ============================================
// RUTAS FRONTEND
// ============================================
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });
app.get('/admin', isAuthenticated, (req, res) => { res.sendFile(path.join(__dirname, 'public', 'admin.html')); });

// ============================================
// INICIO DEL SERVIDOR
// ============================================
app.listen(PORT, () => {
    console.log(`
═══════════════════════════════════════════════════
🎥 NEXUS LIVE - SERVIDOR COMPLETO
═══════════════════════════════════════════════════
🌐 Web:      http://localhost:${PORT}
🔐 Login:    http://localhost:${PORT}/login
🔧 Admin:    http://localhost:${PORT}/admin
📡 OBS:      rtmp://localhost:${RTMP_PORT}/live
🔑 Stream key: mitv
👤 Usuario: admin | Contraseña: Ser1979b@
📦 Base de datos: PostgreSQL
═══════════════════════════════════════════════════
    `);
});