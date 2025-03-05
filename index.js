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



appEx.get("/authenticate", (req, res) => {
    const phoneNumber = req.query.phoneNumber;
    let promt = req.query.promt;

    var arr_chat = [
        {
            role: "system",
            content: promt,
        },
    ];

    const sessionName = `session-${phoneNumber}`;
    const client = new Client({
        authStrategy: new LocalAuth({ clientId: sessionName }),
        webVersion: '2.2409.2', // Use a known working version
        webVersionCache: { type: 'none' }, // Disable caching to avoid corrupted versions
    });
    

    console.log("Client is not ready to use!");
   // console.log(client);
    client.on("qr", (qrCode) => {
        console.log("inside qr");
        
        pkg.generate(qrCode, { small: true });
        qr2.toDataURL(qrCode, (err, src) => {
            console.log(src);
            if (err) res.send("Error occured");
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
  <div class="w3-display-topleft w3-padding-large w3-xlarge">
  WhatsGPT
  </div>
  <div class="w3-display-middle">
 <center>
    <h2  class="w3-jumbo w3-animate-top">QRCode Generated</h2>
    
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
        console.log("Received message:", message.body);
        const chat = await message.getChat();
        console.log(chat.id.user);
        var userId = chat.id.user + "";
        console.log(userId);
        console.log(arr_chat);
        set(ref(database, "links/test/" + chat.id.user), {
            messages: arr_chat,
        });
        // const starCountRef = ref(database, 'links/jo/'+chat.id.user);
        get(child(dbRef, "/links/test/" + chat.id.user))
            .then(async (snapshot) => {
                if (snapshot.exists()) {
                    console.log(snapshot.val());
                    const data = await snapshot.val();
                    console.log(data.messages);
                    arr_chat = data.messages;
                    arr_chat.push({
                        role: "user",
                        content: message.body,
                    });
                    console.log(arr_chat);
                    set(ref(database, "links/test/" + chat.id.user), {
                        messages: arr_chat,
                    });
                    async function getChatResponse(messages) {
                        const models = [
                            "google/gemini-2.0-flash-thinking-exp:free",
                            "google/gemini-2.0-flash-lite-preview-02-05:free",
                            "qwen/qwen-vl-plus:free",
                            "deepseek/deepseek-chat:free",
                            "deepseek/deepseek-r1-distill-llama-70b:free"
                        ];
                        
                        for (let model of models) {
                            try {
                                const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                                    method: "POST",
                                    headers: {
                                        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
                                        "Content-Type": "application/json",
                                    },
                                    body: JSON.stringify({
                                        "model": model,
                                        "messages": messages,
                                    }),
                                });
                                
                                const data = await response.json();
                                if (response.ok && data.choices?.[0]?.message?.content) {
                                    return data.choices[0].message.content;
                                }
                            } catch (error) {
                                console.error(`Error with model ${model}:`, error);
                            }
                        }
                        
                        // If all OpenRouter models fail, fallback to Gemini API
                        return await getGeminiResponse(messages);
                    }
                    
                    async function getGeminiResponse(messages) {
                        try {
                            const formattedMessages = messages.map(msg => ({
                                role: msg.role === "system" ? "model" : msg.role, // Convert "system" to "model"
                                parts: [{ text: msg.content }]
                            }));
                    
                            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=AIzaSyCKlWfNCo5XchWZGnWd2dpB4jusdzIefW0`, {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ contents: formattedMessages })
                            });
                    
                            const data = await response.json();
                            console.log("Gemini API Response:", data); // Debugging output
                    
                            if (response.ok && data.candidates?.[0]?.content?.parts?.[0]?.text) {
                                return data.candidates[0].content.parts[0].text;
                            } else {
                                console.error("Error fetching Gemini response:", data);
                                return `I'm currently unable to respond. Error: ${data.error?.message || "Unknown issue"}`;
                            }
                        } catch (error) {
                            console.error("Error fetching Gemini response:", error);
                            return `I'm currently unable to respond. Please try again later. Error: ${error.message}`;
                        }
                    }
                    
                    
                    const botResponse = await getChatResponse(arr_chat);
              
                    message.reply(botResponse);
                    arr_chat.push({
                        role: "system",
                        content: botResponse,
                    });
                    //console.log(arr_chat);
                    set(ref(database, "/links/test/" + chat.id.user), {
                        messages: arr_chat,
                    });
                } else {
                    console.log("No data available");
                }
            })
            .catch((error) => {
                console.error(error);
            });
    });
});
appEx.post("/submit", (req, res) => {
    console.log(req.body);
    const message = req.body.message; // Ensure proper encoding
    const phoneNumber = req.body.phoneNumber

    res.redirect(`/authenticate?phoneNumber=${phoneNumber}&promt=${message}`);
});


appEx.get("/", (req, res) => {
    res.sendFile(__dirname + "/index.html");
});
appEx.listen(process.env.PORT, function () {
    console.log("Example app listening on port "+process.env.PORT+"!");
});
