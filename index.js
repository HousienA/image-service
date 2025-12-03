const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');
const mysql = require('mysql2/promise'); // Vi använder promise-versionen

const app = express();
const PORT = 8084;

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Konfigurera Databas-pool
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost', // Eller 'journal-mysql' i Docker
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'admin',
    database: process.env.DB_NAME || 'patient_system',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

async function initDB() {
    try {
        // Skapa tabellen om den inte finns
        await pool.query(`
            CREATE TABLE IF NOT EXISTS images (
                id VARCHAR(36) PRIMARY KEY,
                encounter_id BIGINT NOT NULL,
                patient_id BIGINT,
                file_path VARCHAR(255) NOT NULL,
                description TEXT,
                annotations LONGTEXT,
                texts LONGTEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_encounter (encounter_id),
                INDEX idx_patient (patient_id)
            )
        `);
        console.log("Databastabell 'images' kontrollerad/skapad.");
    } catch (err) {
        console.error("Kunde inte initiera databasen:", err);
    }
}

// Multer setup (Sparar filen på disk)
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = 'uploads/';
        fs.ensureDirSync(dir);
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `${uuidv4()}${ext}`);
    }
});
const upload = multer({ storage });

// --- ENDPOINTS ---

// 1. Ladda upp bild och koppla till Encounter i DB
app.post('/images/upload', upload.single('image'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Ingen bild laddades upp' });

    const imageId = path.parse(req.file.filename).name;
    const { encounterId, description } = req.body;

    // Vi tar emot patientId från frontend om det finns, annars null
    let { patientId } = req.body;

    try {
        // FIX: Om patientId saknas, hämta det från encounters-tabellen!
        if (!patientId && encounterId) {
            const [encounters] = await pool.query(
                'SELECT patient_id FROM encounters WHERE id = ?',
                [encounterId]
            );

            if (encounters.length > 0) {
                patientId = encounters[0].patient_id;
            }
        }

        // SPARA I DATABASEN (Nu med korrekt patientId)
        const [result] = await pool.query(
            `INSERT INTO images (id, encounter_id, patient_id, file_path, description)
             VALUES (?, ?, ?, ?, ?)`,
            [imageId, encounterId, patientId, req.file.filename, description]
        );

        const publicUrl = process.env.PUBLIC_URL || `http://localhost:${PORT}`;

        res.json({
            success: true,
            id: imageId,
            url: `${publicUrl}/uploads/${req.file.filename}`
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Databasfel vid uppladdning' });
    }
});


// 2. Hämta bild-data + annoteringar från DB
app.get('/images/:id', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM images WHERE id = ?', [req.params.id]);

        if (rows.length === 0) return res.status(404).json({ error: 'Bild hittades inte' });

        const img = rows[0];
        const publicUrl = process.env.PUBLIC_URL || `http://localhost:${PORT}`;

        res.json({
            id: img.id,
            encounterId: img.encounter_id,
            url: `${publicUrl}/uploads/${img.file_path}`,
            annotations: img.annotations ? JSON.parse(img.annotations) : "",
            texts: img.texts ? JSON.parse(img.texts) : []
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Kunde inte hämta bild' });
    }
});

// 3. Spara ändringar (Ritningar) till DB
app.put('/images/:id/annotate', async (req, res) => {
    const { annotations, texts } = req.body;

    try {
        // Vi måste göra om objekten till strängar för att spara i TEXT-kolumnen
        const annotString = typeof annotations === 'string' ? annotations : JSON.stringify(annotations);
        const textString = JSON.stringify(texts);

        await pool.query(
            'UPDATE images SET annotations = ?, texts = ? WHERE id = ?',
            [annotString, textString, req.params.id]
        );

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Kunde inte spara annoteringar' });
    }
});

// 4. Hämta alla bilder kopplade till en specifik ENCOUNTER
app.get('/images/encounter/:encounterId', async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT * FROM images WHERE encounter_id = ? ORDER BY created_at DESC',
            [req.params.encounterId]
        );

        const publicUrl = process.env.PUBLIC_URL || `http://localhost:${PORT}`;

        const images = rows.map(img => ({
            id: img.id,
            encounterId: img.encounter_id,
            description: img.description,
            url: `${publicUrl}/uploads/${img.file_path}`,
            // Vi skickar inte med den tunga annoterings-datan i listan för prestanda
        }));

        res.json(images);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Databasfel' });
    }
});

// Starta servern (uppdaterad)
initDB().then(() => {
    app.listen(PORT, () => {
        fs.ensureDirSync('uploads');
        console.log(`Image Service (MySQL) körs på port ${PORT}`);
    });
});
