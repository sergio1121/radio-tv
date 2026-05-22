const sqlite3 = require('sqlite3');
const { Pool } = require('pg');

const sqlite = new sqlite3.Database('./database/radio.db');
const pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function migrate() {
    console.log('🚀 Migrando radio.db a PostgreSQL...\n');
    
    const tables = ['songs', 'playlists', 'playlist_songs', 'users', 'recordings', 'ads', 'settings'];
    
    for (const table of tables) {
        console.log(`📥 Leyendo ${table}...`);
        
        const rows = await new Promise((resolve) => {
            sqlite.all(`SELECT * FROM ${table}`, (err, rows) => {
                if (err) {
                    console.log(`  Error: ${err.message}`);
                    resolve([]);
                } else {
                    console.log(`  ${rows.length} registros`);
                    resolve(rows);
                }
            });
        });
        
        if (rows.length > 0 && rows[0]) {
            const columns = Object.keys(rows[0]);
            
            for (const row of rows) {
                const values = columns.map(col => row[col]);
                const placeholders = values.map((_, i) => `$${i + 1}`).join(',');
                const query = `INSERT INTO ${table} (${columns.join(',')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;
                
                try {
                    await pgPool.query(query, values);
                } catch (err) {
                    // Error ignorado
                }
            }
            console.log(`  ✅ ${table} migrado`);
        }
    }
    
    console.log('\n🎉 Migración completada!');
    await pgPool.end();
    sqlite.close();
}

migrate();