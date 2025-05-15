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
    // const existingVote = await pool.query(
    //   'SELECT * FROM votes WHERE fingerprint = $1 OR ip_address = $2',
    //   [fingerprint, ipAddress]
    // );

    // if (existingVote.rows.length > 0) {
    //   return res.status(400).json({ error: 'Du har allerede stemt.' });
    // }

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
    await pool.query("DELETE FROM contestants");
    currentVoteVersion++;
    res.json({ success: true, newVersion: currentVoteVersion });
  } catch (err) {
    console.error("Feil ved nullstilling:", err);
    res.status(500).json({ error: "Kunne ikke nullstille databasen." });
  }
});

// 🧹 POST /merge-contestants – slår sammen like navn
app.post("/merge-contestants", async (req, res) => {
  const authHeader = req.headers['authorization'];
  const expected = `Bearer ${process.env.ADMIN_SECRET}`;
  if (authHeader !== expected) {
    return res.status(401).json({ error: 'Ikke autorisert' });
  }

  try {
    // Hent alle deltagere
    const contestants = await pool.query("SELECT * FROM contestants");

    // Normaliser navn
    const normalize = (name) =>
      name
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '')
        .replace(/[^a-z0-9]/g, '');

    const grouped = {};

    for (let contestant of contestants.rows) {
      const key = normalize(contestant.name);
      if (!grouped[key]) {
        grouped[key] = [];
      }
      grouped[key].push(contestant);
    }

    // Gå gjennom grupper med flere duplikater
    for (let key in grouped) {
      const group = grouped[key];
      if (group.length <= 1) continue;

      // Behold første, slett resten
      const keeper = group[0];
      const duplicates = group.slice(1);

      for (let dup of duplicates) {
        // Flytt stemmer til "keeper"
        await pool.query(`
          UPDATE votes
          SET contestant_id = $1
          WHERE contestant_id = $2
        `, [keeper.id, dup.id]);

        // Slett duplikaten
        await pool.query("DELETE FROM contestants WHERE id = $1", [dup.id]);
      }

      // Valgfritt: oppdater navn til "ren" versjon
      const prettyName = group.map(g => g.name).sort((a,b) => a.length - b.length)[0];
      await pool.query("UPDATE contestants SET name = $1 WHERE id = $2", [prettyName, keeper.id]);
    }

    res.json({ success: true, message: "Duplikater slått sammen" });
  } catch (err) {
    console.error("❌ Feil under sammenslåing:", err);
    res.status(500).json({ error: "Noe gikk galt under sammenslåing" });
  }
});


const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ Backend kjører på port ${PORT}`);
});