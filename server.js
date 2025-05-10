const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// 🎯 POST /vote – brukeren stemmer
app.post('/vote', async (req, res) => {
  const { contestantId, fingerprint, ipAddress } = req.body;

  try {
    const existing = await pool.query(
      'SELECT * FROM votes WHERE fingerprint = $1 OR ip_address = $2',
      [fingerprint, ipAddress]
    );

    if (existing.rows.length > 0) {
      return res.status(403).json({ error: 'Du har allerede stemt!' });
    }

    await pool.query(
      'INSERT INTO votes (contestant_id, fingerprint, ip_address) VALUES ($1, $2, $3)',
      [contestantId, fingerprint, ipAddress]
    );

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Noe gikk galt med stemmegivning.' });
  }
});

// GET /contestants – henter deltakerne fra Supabase og sender til frontend
app.get('/results', async (req, res) => {
  const authHeader = req.headers['authorization'];
  const expected = `Bearer ${process.env.ADMIN_SECRET}`;

  if (authHeader !== expected) {
    return res.status(401).json({ error: 'Ikke autorisert' });
  }

  try {
    const result = await pool.query(`
      SELECT c.name, COUNT(v.id) as votes
      FROM contestants c
      LEFT JOIN votes v ON v.contestant_id = c.id
      GROUP BY c.id
      ORDER BY votes DESC;
    `);

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Feil ved henting av resultater.' });
  }
});


app.listen(3001, () => {
  console.log('✅ Backend kjører på http://localhost:3001');
});