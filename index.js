const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const mysql = require('mysql2/promise');

const app = express();
const PORT = process.env.PORT || 8084;

app.use(cors());
app.use(express.json());

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'admin',
    database: process.env.DB_NAME || 'patient_system',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// BLOB-tabell (Ingen file_path, istället image_data)
async function initDB() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS images (
                id VARCHAR(36) PRIMARY KEY,
                encounter_id BIGINT NOT NULL,
                patient_id BIGINT,
                image_data LONGBLOB,          -- HÄR SPARAS BILDEN
                mime_type VARCHAR(50),
                description TEXT,
                annotations LONGTEXT,
                texts LONGTEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_encounter (encounter_id),
                INDEX idx_patient (patient_id)
            )
        `);
        console.log("Databastabell 'images' (BLOB) kontrollerad/skapad.");
    } catch (err) {
        console.error("Kunde inte initiera databasen:", err);
    }
}

// MemoryStorage = Spara i RAM, inte på disk
const upload = multer({ storage: multer.memoryStorage() });

// 1. Ladda upp (Till Databasen)
app.post('/images/upload', upload.single('image'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Ingen bild' });

    const imageId = uuidv4();
    const { encounterId, description } = req.body;
    let { patientId } = req.body;

    try {
        if (!patientId && encounterId) {
            const [encounters] = await pool.query(
                'SELECT patient_id FROM encounters WHERE id = ?',
                [encounterId]
            );
            if (encounters.length > 0) patientId = encounters[0].patient_id;
        }

        await pool.query(
            `INSERT INTO images (id, encounter_id, patient_id, image_data, mime_type, description) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [imageId, encounterId, patientId, req.file.buffer, req.file.mimetype, description]
        );

        const publicUrl = process.env.PUBLIC_URL || `http://localhost:${PORT}`;

        res.json({
            success: true,
            id: imageId,
            url: `${publicUrl}/images/blob/${imageId}` // Länk till blob-endpointen
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Databasfel vid uppladdning' });
    }
});

// 2. Visa bild (Strömma från Databasen)
app.get('/images/blob/:id', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT image_data, mime_type FROM images WHERE id = ?', [req.params.id]);
        if (rows.length === 0) return res.status(404).send('Bild saknas');

        const img = rows[0];
        res.setHeader('Content-Type', img.mime_type || 'image/jpeg');
        res.send(img.image_data);
    } catch (err) {
        res.status(500).send('Kunde inte hämta bild');
    }
});

// 3. Hämta metadata
app.get('/images/:id', async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT id, encounter_id, annotations, texts, description FROM images WHERE id = ?',
            [req.params.id]
        );

        if (rows.length === 0) return res.status(404).json({ error: 'Bild hittades inte' });

        const img = rows[0];
        const publicUrl = process.env.PUBLIC_URL || `http://localhost:${PORT}`;

        res.json({
            id: img.id,
            encounterId: img.encounter_id,
            url: `${publicUrl}/images/blob/${img.id}`,

            // FIX: Skicka annotations som en sträng, inte objekt
            annotations: img.annotations || "",

            // Texts är en array, så den ska parsas
            texts: img.texts ? JSON.parse(img.texts) : [],
            description: img.description
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Kunde inte hämta bildinfo' });
    }
});


// 4. Spara annoteringar
app.put('/images/:id/annotate', async (req, res) => {
    const { annotations, texts } = req.body;
    try {
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

// 5. Lista bilder
app.get('/images/encounter/:encounterId', async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT id, encounter_id, description FROM images WHERE encounter_id = ? ORDER BY created_at DESC',
            [req.params.encounterId]
        );
        const publicUrl = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
        const images = rows.map(img => ({
            id: img.id,
            encounterId: img.encounter_id,
            description: img.description,
            url: `${publicUrl}/images/blob/${img.id}`
        }));
        res.json(images);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Databasfel' });
    }
});

initDB().then(() => {
    app.listen(PORT, () => {
        console.log(`Image Service (MySQL BLOB) körs på port ${PORT}`);
    });
});