import pkg from "qrcode-terminal";
import Whatsapp from "whatsapp-web.js";
import { initializeApp } from "firebase/app";
import { getDatabase, ref, get, set, child } from "firebase/database";
import express from "express";
import qr2 from "qrcode";
import { fileURLToPath } from "url";
import { dirname } from "path";
// import { env } from "process";
import { config } from "dotenv";
import fetch from "node-fetch";
config(); // Load environment variables from .env file

const { Client, LocalAuth } = Whatsapp;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const appEx = express();
appEx.use(express.urlencoded({ extended: true }));


const firebaseConfig = {
    apiKey: process.env.API_KEY,
    authDomain: process.env.AUTH_DOMAIN,
    databaseURL: process.env.DATABASE_URL,
    projectId: process.env.PROJECT_ID,
    storageBucket: process.env.STORAGE_BUCKET,
    messagingSenderId: process.env.MESSAGING_SENDER_ID,
    appId: process.env.APP_ID,

}
const app = initializeApp(firebaseConfig);
const database = getDatabase(app);
const dbRef = ref(database);


const userMessageCount = new Map(); // Store message timestamps for rate-limiting

appEx.get("/authenticate", (req, res) => {
    const phoneNumber = req.query.phoneNumber;
    const defaultPrompt = process.env.DEFAULT_PROMPT ;

let ownerOfBusinessPrompt = req.query.prompt ? `\n\n owner Of Business prompt:\n${req.query.prompt}` : "";
let fullPrompt = defaultPrompt + ownerOfBusinessPrompt;
console.log(req.query.prompt);

    let arr_chat = [{ role: "system", content: fullPrompt }];
    const sessionName = `session-${phoneNumber}`;

    const client = new Client({
        authStrategy: new LocalAuth({ clientId: sessionName }),
        webVersion: "2.2409.2",
        webVersionCache: { type: "none" },
    });

    console.log("Client is initializing...");

    let qrSent = false; // Flag to prevent multiple QR responses

    client.on("qr", (qrCode) => {
        if (qrSent) return; // If QR already sent, ignore further events
        qrSent = true; // Mark QR as sent to prevent duplicates
    
        console.log("QR Code Generated");
    
        qr2.toDataURL(qrCode, (err, src) => {
            if (err) return console.error("Error generating QR Code");
    
            res.send(` 
                <!DOCTYPE html>
                <html>
                <head>
                <title>WhatsGPT</title>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <link rel="stylesheet" href="https://www.w3schools.com/w3css/4/w3.css">
                <link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Raleway">
                <style>
                body,h1 {font-family: "Raleway", sans-serif}
                body, html {height: 100%}
                .bgimg {
                  background-image: url('https://w0.peakpx.com/wallpaper/818/148/HD-wallpaper-whatsapp-background-cool-dark-green-new-theme-whatsapp.jpg');
                  min-height: 100%;
                  background-position: center;
                  background-size: cover;
                }
                </style>
                </head>
                <body>
                <div class="bgimg w3-display-container w3-animate-opacity w3-text-white">
                  <div class="w3-display-topleft w3-padding-large w3-xlarge">WhatsGPT</div>
                  <div class="w3-display-middle">
                    <center>
                      <h2 class="w3-jumbo w3-animate-top">QRCode Generated</h2>
                      <hr class="w3-border-grey" style="margin:auto;width:40%">
                      <p class="w3-center"><div><img src='${src}'/></div></p>
                    </center>
                  </div>
                  <div class="w3-display-bottomleft w3-padding-large">
                    Powered by <a href="/" target="_blank">WhatsGPT</a>
                  </div>
                </div>
                </body>
                </html>
            `);
        });
    });
    

    client.on("ready", () => {
        console.log("Client is ready!");
    });

    client.initialize();

    client.on("message", async (message) => {
        const chat = await message.getChat();
        const userId = chat.id.user;
        const now = Date.now();

        // Rate Limiting (Max 5 messages per minute per user)
        if (!userMessageCount.has(userId)) userMessageCount.set(userId, []);
        const timestamps = userMessageCount.get(userId);
        timestamps.push(now);
        while (timestamps.length > 0 && timestamps[0] < now - 60000) timestamps.shift();
        if (timestamps.length > 5) return console.log(`Rate limit reached for user ${userId}`);

        // Retrieve chat history from Firebase
        get(child(dbRef, `/chats/chat_with/${userId}`)).then(async (snapshot) => {
            if (snapshot.exists()) {
                arr_chat = snapshot.val()?.messages ? snapshot.val().messages : arr_chat;
            }
            arr_chat.push({ role: "user", content: message.body });

            set(ref(database, `/chats/chat_with/${userId}`), { messages: arr_chat });

            chat.sendStateTyping();
            setTimeout(async () => {
               
                const botResponse = await getChatResponse(arr_chat);
                chat.clearState();
                message.reply(botResponse);
                arr_chat.push({ role: "system", content: botResponse });
                set(ref(database, `/chats/chat_with/${userId}`), { messages: arr_chat });

                // 
/*const isOrderConfirmed = await checkOrderConfirmation(arr_chat);
            if (isOrderConfirmed) {
                const orderDetails = `New Order from ${userId}:\n\n${message.body}`;

                // Send order details to business owner
                const ownerPhoneNumber = "201122795610"; // Ensure correct format
                await client.sendMessage(`${ownerPhoneNumber}@c.us`, orderDetails);
                console.log(`Order details sent to ${ownerPhoneNumber}`);
            }*/

                //
            }, Math.random() * 5000 + 2000);
        }).catch(console.error);
    });
});

async function getChatResponse(messages) {
    const models = [
        "deepseek/deepseek-chat:free",
        "deepseek/deepseek-r1-distill-llama-70b:free",
        "qwen/qwen-vl-plus:free",
        "google/gemini-2.0-flash-thinking-exp:free",
        "google/gemini-2.0-flash-lite-preview-02-05:free"
    ];
    for (let model of models) {
        try {
            const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: { "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
                body: JSON.stringify({ model, messages })
            });
            const data = await response.json();
            if (response.ok && data.choices?.[0]?.message?.content) return data.choices[0].message.content;
        } catch (error) { console.error(`Error with model ${model}:`, error); }
    }
    return await getGeminiResponse(messages);
}

async function getGeminiResponse(messages) {
    try {
        const formattedMessages = messages.map(msg => ({ role: msg.role === "system" ? "model" : msg.role, parts: [{ text: msg.content }] }));
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contents: formattedMessages })
        });
        const data = await response.json();
        if (response.ok && data.candidates?.[0]?.content?.parts?.[0]?.text) return data.candidates[0].content.parts[0].text;
        else return `Error: ${data.error?.message || "Unknown issue"}`;
    } catch (error) {
        console.error("Error fetching Gemini response:", error);
        return `Error: ${error.message}`;
    }
}
async function checkOrderConfirmation(messages) {
    try {
        // Send only the last 2-3 messages to the AI model
        const recentMessages = messages.slice(-3); 

        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: "google/gemini-2.0-flash-lite-preview-02-05:free",
                messages: [
                    { role: "system", content: "You are an AI assistant helping users confirm orders." },
                    ...recentMessages,
                    { role: "user", content: "Does the user want to confirm an order? Reply with ONLY 'yes' or 'no'." }
                ]
            }),
        });

        const data = await response.json();
        const aiReply = data.choices?.[0]?.message?.content?.trim().toLowerCase();

        return aiReply === "yes"; // Only confirm if AI explicitly says "yes"
    } catch (error) {
        console.error("Error in AI order confirmation:", error);
        return false; // Assume no confirmation in case of error
    }
}




appEx.post("/submit", (req, res) => {
    console.log(req.body);
    const message = req.body.message; // Ensure proper encoding
    const phoneNumber = req.body.phoneNumber

    res.redirect(`/authenticate?phoneNumber=${phoneNumber}&prompt=${message}`);
});


appEx.get("/", (req, res) => {
    res.sendFile(__dirname + "/index.html");
});
appEx.listen(process.env.PORT, function () {
    console.log("Example app listening on port " + process.env.PORT + "!");
});
