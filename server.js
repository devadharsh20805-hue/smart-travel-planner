console.log("🚀 Running Smart Travel Planner server.js...");

const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const fetch = require("node-fetch");
const { GoogleGenerativeAI } = require("@google/generative-ai");

// ✅ Firebase imports
const { initializeApp } = require("firebase/app");
const {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  query,
  where,
} = require("firebase/firestore");

// ✅ Firebase configuration (ensure this matches your Firebase console)
const firebaseConfig = {
  apiKey: "AIzaSyAw-AhqKS1FemISwb7JdyldSb_ESp1FQhA",
  authDomain: "smart-travel-planner-bd849.firebaseapp.com",
  projectId: "smart-travel-planner-bd849",
  storageBucket: "smart-travel-planner-bd849.appspot.com",
  messagingSenderId: "1017075766889",
  appId: "1:1017075766889:web:6c7c7d3440c3aac45db4f8",
};

// ✅ Initialize Firebase + Firestore
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

const app = express();
const PORT = process.env.PORT || 5000;

// ✅ Middleware
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
  })
);
app.use(bodyParser.json({ limit: "2mb" }));
app.use(express.static(__dirname));

// ✅ Gemini Setup
const GEMINI_API_KEY = "AIzaSyB2nKhgkvMMq7zYIxCLIK7sgCbG-XkR6lI";
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const geminiModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

// ---------------------- AUTH ----------------------

// ✅ Signup Route
app.post(["/signup", "/auth/signup"], async (req, res) => {
  const { username, password, age, gender, nationality, preferences } = req.body;
  if (!username || !password)
    return res.status(400).json({ message: "Username & password required" });

  try {
    const usersRef = collection(db, "users");
    const q = query(usersRef, where("username", "==", username));
    const snapshot = await getDocs(q);

    if (!snapshot.empty)
      return res.status(400).json({ message: "User already exists" });

    await addDoc(usersRef, {
      username,
      password,
      age,
      gender,
      nationality,
      preferences,
    });
    console.log("✅ User added:", username);
    res.json({ message: "Signup successful" });
  } catch (err) {
    console.error("❌ Firestore error:", err);
    res.status(500).json({ message: "Signup failed" });
  }
});

// ✅ Login Route
app.post(["/login", "/auth/login"], async (req, res) => {
  const { username, password } = req.body;
  try {
    const usersRef = collection(db, "users");
    const q = query(
      usersRef,
      where("username", "==", username),
      where("password", "==", password)
    );
    const snapshot = await getDocs(q);

    if (snapshot.empty)
      return res.status(401).json({ message: "Invalid username or password" });

    let userData = null;
    snapshot.forEach((doc) => (userData = doc.data()));

    console.log("✅ User logged in:", username);
    res.json({ message: "Login successful", user: userData });
  } catch (err) {
    console.error("❌ Firestore login error:", err);
    res.status(500).json({ message: "Login failed" });
  }
});

// ✅ Profile Route
app.get(["/profile/:username", "/auth/profile/:username"], async (req, res) => {
  try {
    const usersRef = collection(db, "users");
    const q = query(usersRef, where("username", "==", req.params.username));
    const snapshot = await getDocs(q);

    if (snapshot.empty)
      return res.status(404).json({ message: "User not found" });

    let userData = null;
    snapshot.forEach((doc) => (userData = doc.data()));
    res.json(userData);
  } catch (err) {
    console.error("❌ Firestore profile error:", err);
    res.status(500).json({ message: "Failed to fetch profile" });
  }
});

// ---------------------- TRIP PLANNING ----------------------
app.post("/trip/plan", async (req, res) => {
  const { origin, destination, date, travelers, budget, days, destLat, destLon } =
    req.body;

  console.log(`🧭 Trip planning request: ${origin} ➡ ${destination}`);

  let geminiResult = {};
  let destinationImage = "";

  try {
    const prompt = `
      You are an expert travel planner. Create a structured trip plan.

      Trip details:
      - From: ${origin}
      - To: ${destination}
      - Date: ${date}
      - Duration: ${days} days
      - Travelers: ${travelers}
      - Budget: ₹${budget}

      Respond with ONLY valid JSON in this format:
      {
        "travelDuration": "8 hrs flight",
        "weather": "Pleasant and mild",
        "bestSeason": "October to February",
        "estimatedBudget": 25000,
        "budgetMatch": "Within budget",
        "itinerary": [
          {"day":1,"morning":"Arrival","afternoon":"City tour","evening":"Dinner at local restaurant"}
        ],
        "mappableLocations": ["Airport","City Center","Hotel"]
      }
    `;

    const result = await geminiModel.generateContent(prompt);
    let text = result.response.text().trim();

    text = text
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .replace(/^[^{]*({[\s\S]*})[^}]*$/, "$1")
      .replace(/[\u0000-\u001F]+/g, "")
      .trim();

    try {
      geminiResult = JSON.parse(text);
    } catch {
      console.warn("⚠️ Gemini JSON parse failed. Using fallback.");
      geminiResult = {
        travelDuration: "N/A",
        weather: "N/A",
        bestSeason: "N/A",
        estimatedBudget: budget,
        budgetMatch: "Could not compute",
        itinerary: [
          {
            day: 1,
            morning: "Trip info unavailable",
            afternoon: "Please try again",
            evening: "Server error",
          },
        ],
        mappableLocations: [],
      };
    }
  } catch (err) {
    console.error("Gemini API error:", err.message);
  }

  try {
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
      `;
    }

    const finalPrompt = `${contextText}\nUser: ${message}\nAssistant:`;

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
