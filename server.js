const express = require('express');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
require('dotenv').config();
const cors = require("cors");




const app = express();
app.use(cors({
  origin: ["https://bilshow-voting.vercel.app", "http://localhost:3000"],
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(bodyParser.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// 🎯 POST /vote – brukeren stemmer
app.post('/vote', async (req, res) => {
  const { carName, fingerprint, ipAddress } = req.body;

  try {
    // Har brukeren allerede stemt?
    const existingVote = await pool.query(
      'SELECT * FROM votes WHERE fingerprint = $1 OR ip_address = $2',
      [fingerprint, ipAddress]
    );

    if (existingVote.rows.length > 0) {
      return res.status(400).json({ error: 'Du har allerede stemt.' });
    }

    const cleanedName = carName.trim().toLowerCase();

    // Forsøk å finne bilen (case-insensitive)
    let result = await pool.query(
      'SELECT id FROM contestants WHERE name ILIKE $1',
      [cleanedName]
    );

    let contestantId;

    if (result.rows.length > 0) {
      contestantId = result.rows[0].id;
    } else {
      // ❗️Ingen bil funnet – legg den til
      const insert = await pool.query(
        'INSERT INTO contestants (name) VALUES ($1) RETURNING id',
        [cleanedName]
      );
      contestantId = insert.rows[0].id;
    }

    // Registrer stemmen
    await pool.query(
      'INSERT INTO votes (contestant_id, fingerprint, ip_address) VALUES ($1, $2, $3)',
      [contestantId, fingerprint, ipAddress]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Feil ved stemmegivning:', err);
    res.status(500).json({ error: 'Noe gikk galt på serveren.' });
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

// ✅ Versjonshåndtering
let currentVoteVersion = 1;

// 📡 GET /vote-version – lar frontend sjekke om versjon har endret seg
app.get("/vote-version", (req, res) => {
  res.json({ version: currentVoteVersion });
});

// 🔁 POST /reset-votes – sletter alle stemmer og oppdaterer versjon
app.post("/reset-votes", async (req, res) => {
  const authHeader = req.headers['authorization'];
  const expected = `Bearer ${process.env.ADMIN_SECRET}`;

  if (authHeader !== expected) {
    return res.status(401).json({ error: 'Ikke autorisert' });
  }

  try {
    await pool.query("DELETE FROM votes");
    currentVoteVersion++;
    res.json({ success: true, newVersion: currentVoteVersion });
  } catch (err) {
    console.error("Feil ved sletting av stemmer:", err);
    res.status(500).json({ error: "Kunne ikke slette stemmer." });
  }
});


const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ Backend kjører på port ${PORT}`);
});