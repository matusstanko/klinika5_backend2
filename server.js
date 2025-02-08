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
app.use(cors({
  origin: "https://red-dune-0ace81103.4.azurestaticapps.net", // Your frontend URL
  methods: ["GET", "POST", "DELETE", "PUT", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, "public"))); // Serve static files

//SMS VONAGE
const { Vonage } = require('@vonage/server-sdk')

const vonage = new Vonage({
  apiKey: process.env.VONAGE_API_KEY,  // Use the environment variables
  apiSecret: process.env.VONAGE_API_SECRET
});


const sendSMS = async (phone, text) => {
    const from = "Vonage APIs";  // Sender name (it can be a string or a valid phone number)
    const to = phone;  // Recipient phone number
    const messageText = text;  // Message body

    try {
        await vonage.sms.send({ to, from, text: messageText });
        console.log('Message sent successfully');
    } catch (err) {
        console.log('There was an error sending the message.');
        console.error(err);
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

    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: toEmail,
        subject: "Potvrdenie rezervácie - Dentalná klinika",
        text: `Dobrý deň,

Vaša rezervácia na dentálnej klinike bola úspešne potvrdená.

📅 Dátum: ${reservationDetails.date}
⏰ Čas: ${reservationDetails.time}
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
        logError(error);
        console.error("❌ Error sending email:", error);
    }
}
async function sendCancelEmail(toEmail, phone, reservationDetails) {
    const createLink = `https://red-dune-0ace81103.4.azurestaticapps.net/objednat-sa.html`;
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: toEmail,
      subject: "Zrušenie rezervácie - Dentalná klinika",
      text: `Dobrý deň,
  
  Vaša rezervácia bola úspečne zrušená.
  
  📅 Dátum: ${reservationDetails.date}
  ⏰ Čas: ${reservationDetails.time}
  📞 Telefón: ${phone}
  📧 Váš e-mail: ${toEmail}
  
  Ak si želáte vytvoriť novú rezerváciu môžete použit tento odkaz ${createLink}
  
  Dentalná klinika`,
    };
  
    try {
      await transporter.sendMail(mailOptions);
      console.log(`✅ Email odoslaný na ${toEmail}`);
    } catch (error) {
      console.error("❌ Chyba pri odosielaní emailu:", error);
    }
  }



// Format time
function formatDateTime(dateString, timeString) {
    const date = new Date(dateString);
    const formattedDate = `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
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

        // Send confirmation email and SMS
        sendConfirmationEmail(email, phone, { date: checkResult.rows[0].date, time: checkResult.rows[0].time, cancellation_token: cancellationToken });
        sendSMS(phone, `✅ Vaša rezervácia bola úspešná. Termín: ${checkResult.rows[0].date} o ${checkResult.rows[0].time}.`);  // Send SMS here

        res.json({ message: "Rezervácia úspešná!" });

    } catch (err) {
        await client.query("ROLLBACK");
        logError(err);
        res.status(500).json({ error: "Chyba pri rezervácii." });
    } finally {
        client.release();
    }
});






// Vymazat
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

        // 6️⃣ Send cancellation SMS
        const newBookingLink = `https://red-dune-0ace81103.4.azurestaticapps.net/objednat-sa.html`;
        const cancellationMessage = `❌ Vasa rezervacia bola zrusená.\n📅 Datum: ${formattedDate}\n⏰ cas: ${formattedTime}\n🔄 Nova rezervacia: ${newBookingLink}`;
        sendSMS(phone, cancellationMessage);

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






