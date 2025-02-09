require("dotenv").config();
const express = require("express");
const path = require("path");
const { Pool } = require("pg");
const fs = require("fs");
//
const app = express();
const PORT = process.env.PORT || 3000; // Azure sets PORT automatically

// PostgreSQL Connection (Azure)
const pool = new Pool({
    host: process.env.PGHOST,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE,
    port: Number(process.env.PGPORT),
    // Depending on your AZURE_POSTGRESQL_SSL value, you can conditionally set ssl options:
    ssl: process.env.AZURE_POSTGRESQL_SSL === 'true' 
           ? { rejectUnauthorized: false } 
           : false,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    keepAlive: true
  });

// Handle unexpected PostgreSQL errors
pool.on("error", (err) => {
    console.error("⚠️ PostgreSQL error:", err);
    logError(err);
    reconnectDatabase();
});

async function reconnectDatabase() {
    console.log("🔄 Reconnecting to PostgreSQL...");
    try {
        await pool.query("SELECT 1");
        console.log("🟢 Reconnected!");
    } catch (err) {
        console.error("🔴 Reconnect failed, retrying...", err);
        logError(err);
        setTimeout(reconnectDatabase, 5000);
    }
}

// Log errors to a file
function logError(error) {
    const logMessage = `[${new Date().toISOString()}] ${error}\n`;
    fs.appendFileSync("server_errors.log", logMessage);
}

// API Health Check
app.get("/api/health", async (req, res) => {
    try {
        await pool.query("SELECT 1");
        res.json({ status: "🟢 Database Connected" });
    } catch (err) {
        logError(err);
        res.status(500).json({ status: "🔴 Database Disconnected", error: err.message });
    }
});

// CORS Config for Azure Deployment
const cors = require("cors");
const allowedOrigins = [
    "https://matustest.eu",
    "http://localhost:8080", // Povolenie pre lokálny frontend
    "https://red-dune-0ace81103.4.azurestaticapps.net" // Povolenie pre Azure frontend
  ];

  app.use(cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST", "DELETE", "PUT", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true
  }));


/*
app.use(cors({
  //origin: "https://red-dune-0ace81103.4.azurestaticapps.net", // Your frontend URL
  origin: "localhost:8080",
  methods: ["GET", "POST", "DELETE", "PUT", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true
}));
*/

app.use(express.json());
app.use(express.static(path.join(__dirname, "public"))); // Serve static files

//SMS TWILIO

const twilio = require('twilio');

// Initialize Twilio with credentials from .env
const twilioClient = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
);

// Send Confirmation SMS
const sendConfirmationSMS = async (phone, reservationDetails) => {
    const BASE_URL = process.env.BASE_URL || "https://matustest.eu";
    const cancelLink = `${BASE_URL}/zrusit.html?token=${reservationDetails.cancellation_token}`;

    const smsMessage = `Vaša rezervácia bola úspešná! 📅 Dátum: ${reservationDetails.date}, ⏰ Čas: ${reservationDetails.time}. Zrušenie: ${cancelLink}`;

    try {
        await twilioClient.messages.create({
            body: smsMessage,
            from: process.env.TWILIO_PHONE_NUMBER,  // Twilio phone number
            to: phone
        });
        console.log(`✅ Confirmation SMS sent to ${phone}`);
    } catch (err) {
        console.error("❌ Error sending confirmation SMS:", err);
    }
};

// Send Cancellation SMS
const sendCancelSMS = async (phone) => {
    const createLink = "https://matustest.eu/objednat-sa.html";

    const smsMessage = `Vaša rezervácia bola zrušená. 🔄 Nová rezervácia: ${createLink}`;

    try {
        await twilioClient.messages.create({
            body: smsMessage,
            from: process.env.TWILIO_PHONE_NUMBER,
            to: phone
        });
        console.log(`✅ Cancellation SMS sent to ${phone}`);
    } catch (err) {
        console.error("❌ Error sending cancellation SMS:", err);
    }
};











// EMAIL - Nodemailer
const nodemailer = require("nodemailer");
const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

async function sendConfirmationEmail(toEmail, phone, reservationDetails) {
    const BASE_URL = process.env.BASE_URL || "https://red-dune-0ace81103.4.azurestaticapps.net";
    const cancelLink = `${BASE_URL}/zrusit.html?token=${reservationDetails.cancellation_token}`;

    console.log("📩 Sending email with details:", reservationDetails); // Debugging log

    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: toEmail,
        subject: "Potvrdenie rezervácie - Dentalná klinika",
        text: `Dobrý deň,

Vaša rezervácia na dentálnej klinike bola úspešne potvrdená.

📅 Dátum: ${reservationDetails.date ? reservationDetails.date : "Neznámy dátum"}
⏰ Čas: ${reservationDetails.time ? reservationDetails.time : "Neznámy čas"}
📞 Telefón: ${phone}
📧 Váš e-mail: ${toEmail}

Ak si želáte zrušiť alebo zmeniť termín, použite tento odkaz:
❌ Zrušiť termín: ${cancelLink}

Tešíme sa na Vašu návštevu!
Dentalná klinika`,
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`✅ Email sent to ${toEmail}`);
    } catch (error) {
        console.error("❌ Error sending email:", error);
    }
}
async function sendCancelEmail(toEmail, phone, reservationDetails) {
    const createLink = "https://red-dune-0ace81103.4.azurestaticapps.net/objednat-sa.html";

    console.log("📩 Sending cancellation email with details:", reservationDetails); // Debugging log

    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: toEmail,
        subject: "Zrušenie rezervácie - Dentalná klinika",
        text: `Dobrý deň,

Vaša rezervácia bola úspešne zrušená.

Ak si želáte vytvoriť novú rezerváciu, môžete použiť tento odkaz:
🔄 Nová rezervácia: ${createLink}

Dentalná klinika`,
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`✅ Cancellation email sent to ${toEmail}`);
    } catch (error) {
        console.error("❌ Error sending cancellation email:", error);
    }
}



// Format time
function formatDateTime(dateString, timeString) {
    // Vytvorenie objektu Date v UTC
    const date = new Date(dateString);

    // Extrahovanie UTC dňa, mesiaca a roka (bez posunu časového pásma)
    const den = String(date.getUTCDate()).padStart(2, '0');
    const mesiac = String(date.getUTCMonth() + 1).padStart(2, '0'); // Mesiace sú indexované od 0
    const rok = date.getUTCFullYear();

    // Formátovanie dátumu na DD/MM/YYYY (v UTC)
    const formattedDate = `${den}/${mesiac}/${rok}`;

    // Extrahovanie len HH:MM z reťazca času (napr. "12:30:00" → "12:30")
    const formattedTime = timeString.slice(0, 5);

    return { formattedDate, formattedTime };
}

// API ROUTES

// GET: All time slots
app.get("/api/get_all_timeslots", async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM time_slots ORDER BY time ASC");
        res.json(result.rows);
    } catch (err) {
        logError(err);
        res.status(500).json({ error: "Chyba pri načítaní termínov" });
    }
});

// DELETE: Delete time slot
app.delete("/api/delete_timeslot/:id", async (req, res) => {
    const { id } = req.params;
    console.log("ROUTE delete_timeslot/:id=",id)
    try {
        // Skontrolujeme, či je termín obsadený
        const checkResult = await pool.query("SELECT is_taken FROM time_slots WHERE id = $1", [id]);

        if (checkResult.rows.length === 0) {
            console.log("Termin neexistuje");
            return res.status(404).json({ error: "Termín neexistuje" });
            
        }

        if (checkResult.rows[0].is_taken) {
            console.log("Nemozem vymazat obsadeny termin");
            return res.status(400).json({ error: "Obsadený termín nemožno vymazať! Musíš najprv zrušiť rezerváciu" });
        }

        // Ak termín nie je obsadený, môžeme ho vymazať
        await pool.query("DELETE FROM time_slots WHERE id = $1", [id]);
        console.log("Uspesne vymazane")
        res.json({ message: "Termín úspešne vymazaný" });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Chyba pri mazaní termínu" });
    }
});

// POST: Create Reservation
const crypto = require("crypto");

app.post("/api/create_reservation", async (req, res) => {
    const { phone, email, timeslot_id } = req.body;
    if (!phone || !email || !timeslot_id) return res.status(400).json({ error: "Chýbajú údaje!" });

    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const checkResult = await client.query("SELECT id, is_taken, date, time FROM time_slots WHERE id = $1", [timeslot_id]);

        if (checkResult.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "Termín neexistuje." });
        }
        if (checkResult.rows[0].is_taken) {
            await client.query("ROLLBACK");
            return res.status(400).json({ error: "Termín je už obsadený." });
        }

        const cancellationToken = crypto.randomBytes(16).toString("hex");
        await client.query("INSERT INTO reservations (phone, email, time_slot_id, cancellation_token, created_at) VALUES ($1, $2, $3, $4, NOW())", [phone, email, timeslot_id, cancellationToken]);
        await client.query("UPDATE time_slots SET is_taken = true WHERE id = $1", [timeslot_id]);
        await client.query("COMMIT");

        // 🔹 Použitie funkcie na správny formát dátumu a času
        const { formattedDate, formattedTime } = formatDateTime(checkResult.rows[0].date, checkResult.rows[0].time);

        const reservationDetails = {
            date: formattedDate,  // Už preformátovaný dátum
            time: formattedTime,  // Už preformátovaný čas
            cancellation_token: cancellationToken
        };

        console.log("📝 Odosielam rezerváciu s údajmi:", reservationDetails); // Debug log

        // ✅ Send confirmation email
        sendConfirmationEmail(email, phone, reservationDetails);

        // ✅ Send confirmation SMS using Vonage
        sendConfirmationSMS(phone, reservationDetails);

        res.json({ message: "Rezervácia úspešná!" });

    } catch (err) {
        await client.query("ROLLBACK");
        logError(err);
        res.status(500).json({ error: "Chyba pri rezervácii." });
    } finally {
        client.release();
    }
});





// Vymazat reszervaciu
app.post("/api/cancel_reservation", async (req, res) => {
    const { cancellation_token } = req.body;

    if (!cancellation_token) {
        return res.status(400).json({ error: "Chýba storno token!" });
    }

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        // 1️⃣ Find the reservation by `cancellation_token`
        const reservationResult = await client.query(
            "SELECT id, time_slot_id, email, phone FROM reservations WHERE cancellation_token = $1",
            [cancellation_token]
        );

        if (reservationResult.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "Rezervácia neexistuje alebo už bola zrušená." });
        }

        const { id, time_slot_id, email, phone } = reservationResult.rows[0];

        // 2️⃣ Get reservation date and time
        const timeSlotResult = await client.query(
            "SELECT date, time FROM time_slots WHERE id = $1",
            [time_slot_id]
        );

        if (timeSlotResult.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(500).json({ error: "Chyba pri získavaní informácií o termíne." });
        }

        // ✅ Fix: Ensure correct handling of date and time
        const rawDate = new Date(timeSlotResult.rows[0].date); // Ensure it's a Date object
        const rawTime = String(timeSlotResult.rows[0].time); // Ensure it's a string

        const { formattedDate, formattedTime } = formatDateTime(rawDate, rawTime);

        // 3️⃣ Delete the reservation
        await client.query("DELETE FROM reservations WHERE id = $1", [id]);

        // 4️⃣ Free up the time slot (`is_taken = false`)
        await client.query("UPDATE time_slots SET is_taken = false WHERE id = $1", [time_slot_id]);

        await client.query("COMMIT");

        console.log(`✅ Rezervácia ID ${id} bola úspešne zrušená.`);

        // 5️⃣ Send cancellation email
        sendCancelEmail(email, phone, { formattedDate, formattedTime });

        // 6️⃣ Send cancellation SMS using Vonage
        sendCancelSMS(phone, { date: formattedDate, time: formattedTime });

        res.json({ message: "Rezervácia bola úspešne zrušená a termín je opäť dostupný." });

    } catch (err) {
        await client.query("ROLLBACK");
        console.error("❌ Chyba pri rušení rezervácie:", err);
        res.status(500).json({ error: "Chyba pri rušení rezervácie." });
    } finally {
        client.release();
    }
});



// Start server
app.listen(PORT, () => console.log(`🟢 Server beží na port ${PORT}`));






