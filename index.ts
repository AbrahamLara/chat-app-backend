import express from "express";

const PORT = 5000;
const app = express();

app.get("/", (_, res) => {
  res.send("Hello, World!");
});

app.listen(PORT, () => console.log(`Listening on port ${PORT}`));
