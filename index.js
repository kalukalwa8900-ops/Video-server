const express = require("express");
const app = express();

// Simple test route
app.get("/", (req, res) => {
  res.send("Server is running 🚀");
});

// REQUIRED for Railway
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});