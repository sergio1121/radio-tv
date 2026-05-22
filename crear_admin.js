const { Pool } = require('pg');

const pool = new Pool({
    connectionString: 'postgresql://radio_user:rb2RZQNjYqxpUIevHRQCv47zE61TQ1c5@dpg-d83fjfjtqb8s73dmgf4g-a.oregon-postgres.render.com/radio_tv_db',
    ssl: { rejectUnauthorized: false }
});

async function crearAdmin() {
    try {
        // Ver si existe la tabla users
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username TEXT UNIQUE,
                password TEXT,
                role TEXT
            );
        `);
        
        // Eliminar admin si existe
        await pool.query("DELETE FROM users WHERE username = 'admin'");
        
        // Crear nuevo admin
        await pool.query(
            "INSERT INTO users (username, password, role) VALUES ($1, $2, $3)",
            ['admin', 'Ser1979b@', 'admin']
        );
        
        console.log('✅ Usuario admin creado exitosamente');
        console.log('   Usuario: admin');
        console.log('   Contraseña: Ser1979b@');
        
        // Verificar
        const result = await pool.query("SELECT id, username, role FROM users WHERE username = 'admin'");
        console.log('   Resultado:', result.rows[0]);
        
    } catch (err) {
        console.error('❌ Error:', err.message);
    } finally {
        await pool.end();
    }
}

crearAdmin();