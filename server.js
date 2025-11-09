console.log("🚀 Running Smart Travel Planner server.js...");

const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const fetch = require("node-fetch");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const PORT = process.env.PORT || 5000; // ✅ Changed line for Render

//  Middleware
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
  })
);
app.use(bodyParser.json({ limit: "2mb" }));
app.use(express.static(__dirname));

//  Gemini Init
const GEMINI_API_KEY = "AIzaSyB2nKhgkvMMq7zYIxCLIK7sgCbG-XkR6lI";
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const geminiModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

//  Users store
let users = [];

// ---------------------- AUTH ----------------------
app.post(["/signup", "/auth/signup"], (req, res) => {
  const { username, password, age, gender, nationality, preferences } = req.body;
  if (!username || !password)
    return res.status(400).json({ message: "Username & password required" });

  const existing = users.find((u) => u.username === username);
  if (existing) return res.status(400).json({ message: "User already exists" });

  users.push({ username, password, age, gender, nationality, preferences });
  console.log("✅ New user signed up:", username);
  res.json({ message: "Signup successful" });
});

app.post(["/login", "/auth/login"], (req, res) => {
  const { username, password } = req.body;
  const user = users.find(
    (u) => u.username === username && u.password === password
  );

  if (!user)
    return res.status(401).json({ message: "Invalid username or password" });

  console.log("✅ User logged in:", username);
  res.json({ message: "Login successful", user });
});

app.get(["/profile/:username", "/auth/profile/:username"], (req, res) => {
  const user = users.find((u) => u.username === req.params.username);
  if (!user) return res.status(404).json({ message: "User not found" });
  res.json(user);
});

// ---------------------- TRIP PLANNING ----------------------

app.post("/trip/plan", async (req, res) => {
  const {
    origin,
    destination,
    date,
    travelers,
    budget,
    days,
    destLat,
    destLon,
  } = req.body;

  console.log(`🧭 Trip planning request: ${origin} ➡ ${destination}`);

  let geminiResult = {};
  let destinationImage = "";

  try {
    const prompt = `
      You are an expert travel planner. A user is planning a trip.

      Trip details:
      - From: ${origin}
      - To: ${destination}
      - Date: ${date}
      - Duration: ${days} days
      - Travelers: ${travelers}
      - Budget: ₹${budget}

      Generate a valid JSON (no markdown, no comments, no extra text):
      {
        "travelDuration": "Approx. 8 hrs flight",
        "weather": "Pleasant and mild during the season",
        "bestSeason": "October to February",
        "estimatedBudget": 12345,
        "budgetMatch": "Within user's budget",
        "itinerary": [
          {"day":1,"morning":"Arrival and check-in","afternoon":"Local sightseeing","evening":"Dinner by the beach"}
        ],
        "mappableLocations": ["Beach","City Center","Museum"]
      }
    `;

    const result = await geminiModel.generateContent(prompt);
    let response = result.response.text().trim();

    //  Clean unwanted text
    response = response
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .replace(/^[^{]*({[\s\S]*})[^}]*$/, "$1")
      .replace(/[\u0000-\u001F]+/g, "")
      .trim();

    try {
      geminiResult = JSON.parse(response);
    } catch (err) {
      console.warn("⚠️ Gemini JSON parse failed, using fallback data.");
      geminiResult = {
        travelDuration: "N/A",
        weather: "N/A",
        bestSeason: "N/A",
        estimatedBudget: budget,
        budgetMatch: "Could not compute",
        itinerary: [
          {
            day: 1,
            morning: "Trip details unavailable.",
            afternoon: "Try again later.",
            evening: "Server error encountered.",
          },
        ],
        mappableLocations: [],
      };
    }
  } catch (err) {
    console.error("Gemini API failed:", err.message);
  }

  try {
    //  Unsplash image fetch
    const unsplashKey = "tKk4AhD7RzddKqepqs3r0jI8z92wl7rGmHlyy2C-2zE";
    const imgRes = await fetch(
      `https://api.unsplash.com/search/photos?query=${encodeURIComponent(
        destination
      )}&per_page=1&orientation=landscape&client_id=${unsplashKey}`
    );

    const imgData = await imgRes.json();
    destinationImage =
      imgData?.results?.[0]?.urls?.regular ||
      "https://via.placeholder.com/1200x600?text=Destination+Image+Unavailable";
  } catch (err) {
    console.error("Image fetch failed:", err.message);
    destinationImage =
      "https://via.placeholder.com/1200x600?text=Image+Unavailable";
  }

  // Always send valid JSON
  res.json({
    origin,
    destination,
    date,
    travelers,
    budget,
    days,
    lat: destLat || null,
    lon: destLon || null,
    destinationImage,
    ...geminiResult,
  });
});

// ---------------------- CHATBOT ----------------------

app.post(["/chat", "/api/chat"], async (req, res) => {
  try {
    const { message, context } = req.body;

    if (!message?.trim())
      return res.status(400).json({ reply: "Please enter a message." });

    let contextText = "";
    if (context && Object.keys(context).length > 0) {
      contextText = `
        The user has planned a trip:
        - From: ${context.origin}
        - To: ${context.destination}
        - Duration: ${context.days} days
        - Travelers: ${context.travelers}
        - Budget: ₹${context.budget}
        - Weather: ${context.weather}
        - Itinerary: ${JSON.stringify(context.itinerary || [], null, 2)}
      `;
    }

    const finalPrompt = `
      ${contextText}S
      User: ${message}
      Assistant:
    `;

    const result = await geminiModel.generateContent(finalPrompt);
    const reply = result.response.text().trim();

    res.json({ reply });
  } catch (err) {
    console.error("Chatbot Error:", err.message);
    res.status(500).json({ reply: "AI Assistant encountered an issue." });
  }
});

// ---------------------- START SERVER ----------------------
app.listen(PORT, () => {
  console.log(`✅ Server running at: http://localhost:${PORT}`);
});
