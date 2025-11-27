const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 8084; // Ny port för denna tjänst

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Konfigurera lagring (Multer)
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = 'uploads/';
        fs.ensureDirSync(dir); // Skapar mappen om den inte finns
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        // Spara som: image-id.jpg
        const ext = path.extname(file.originalname);
        cb(null, `${uuidv4()}${ext}`);
    }
});

const upload = multer({ storage });

// --- ENDPOINTS ---

// 1. Ladda upp en ny bild (Kopplad till Patient/Encounter)
app.post('/images/upload', upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Ingen bild laddades upp' });
    }

    // Metadata om bilden (t.ex. vilken patient den tillhör)
    const imageId = req.file.filename;
    const { patientId, encounterId, description } = req.body;

    // Vi sparar metadata i en enkel JSON-fil för enkelhetens skull.
    // I ett riktigt system hade detta varit en MongoDB eller PostgreSQL-tabell.
    const metadata = {
        id: imageId,
        originalName: req.file.originalname,
        patientId,
        encounterId,
        description,
        uploadedAt: new Date(),
        annotations: [] // Här sparas ritningar/text senare
    };

    fs.writeJsonSync(`metadata/${imageId}.json`, metadata);

    res.json({
        success: true,
        imageId: imageId,
        url: `http://localhost:${PORT}/uploads/${imageId}`
    });
});

// 2. Hämta bilddata + annoteringar
app.get('/images/:id', (req, res) => {
    const { id } = req.params;
    const metaPath = `metadata/${id}.json`;

    if (!fs.existsSync(metaPath)) {
        return res.status(404).json({ error: 'Bild hittades inte' });
    }

    const metadata = fs.readJsonSync(metaPath);

    res.json({
        ...metadata,
        url: `http://localhost:${PORT}/uploads/${id}`
    });
});

// 3. Spara ändringar (Ritningar + Text)
app.put('/images/:id/annotate', (req, res) => {
    const { id } = req.params;
    const { annotations, texts } = req.body; // Hämta BÅDE annotations och texts
    const metaPath = `metadata/${id}.json`;

    if (!fs.existsSync(metaPath)) {
        return res.status(404).json({ error: 'Bild hittades inte' });
    }

    const metadata = fs.readJsonSync(metaPath);
    metadata.annotations = annotations; // Spara ritningar
    if (texts) metadata.texts = texts;   // Spara textrutor (om de finns)
    metadata.lastEditedAt = new Date();

    fs.writeJsonSync(metaPath, metadata);

    res.json({ success: true, message: 'Ändringar sparade', annotations, texts });
});


// 4. Hämta alla bilder för en patient
app.get('/images/patient/:patientId', (req, res) => {
    const { patientId } = req.params;
    const dir = 'metadata/';

    if (!fs.existsSync(dir)) fs.ensureDirSync(dir);

    const files = fs.readdirSync(dir);
    const images = files
        .map(file => fs.readJsonSync(path.join(dir, file)))
        .filter(img => img.patientId == patientId);

    res.json(images.map(img => ({
        ...img,
        url: `http://localhost:${PORT}/uploads/${img.id}`
    })));
});

app.listen(PORT, () => {
    // Se till att mappar finns
    fs.ensureDirSync('uploads');
    fs.ensureDirSync('metadata');
    console.log(`Image Service körs på http://localhost:${PORT}`);
});

// 5. Hämta alla bilder för ett vårdmöte (Encounter)
app.get('/images/encounter/:encounterId', (req, res) => {
    const { encounterId } = req.params;
    const dir = 'metadata/';

    if (!fs.existsSync(dir)) fs.ensureDirSync(dir);

    const files = fs.readdirSync(dir);
    const images = files
        .map(file => fs.readJsonSync(path.join(dir, file)))
        // Jämför som strängar för säkerhets skull
        .filter(img => String(img.encounterId) === String(encounterId));

    res.json(images.map(img => ({
        ...img,
        url: `http://localhost:${PORT}/uploads/${img.id}`
    })));
});



