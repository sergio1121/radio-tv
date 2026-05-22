const { Pool } = require('pg');

const pool = new Pool({
    connectionString: 'postgresql://radio_user:rb2RZQNjYqxpUIevHRQCv47zE61TQ1c5@dpg-d83fjfjtqb8s73dmgf4g-a.oregon-postgres.render.com/radio_tv_db',
    ssl: { rejectUnauthorized: false }
});

async function testLogin() {
    try {
        const username = 'admin';
        const password = 'Ser1979b@';
        
        const result = await pool.query('SELECT * FROM users WHERE username = $1 AND password = $2', [username, password]);
        console.log('Resultado:', result.rows);
        
        if (result.rows.length > 0) {
            console.log('✅ Login exitoso!');
        } else {
            console.log('❌ Login fallido');
        }
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await pool.end();
    }
}

testLogin();