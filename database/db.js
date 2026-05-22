# Crear archivo db.js
cat > db.js << 'EOF'
const { Pool } = require('pg');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

let db;

if (process.env.NODE_ENV === 'production') {
  // PostgreSQL para producción (Render)
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });
  
  db = pool;
  
  // Probar conexión
  pool.connect((err, client, release) => {
    if (err) {
      console.error('❌ Error conectando a PostgreSQL:', err.message);
    } else {
      console.log('✅ Conectado a PostgreSQL en Render');
      release();
    }
  });
} else {
  // SQLite para desarrollo local
  db = new sqlite3.Database(path.join(__dirname, 'tv_app.db'), (err) => {
    if (err) {
      console.error('❌ Error abriendo SQLite:', err.message);
    } else {
      console.log('✅ Usando SQLite local');
    }
  });
}

module.exports = db;
EOF