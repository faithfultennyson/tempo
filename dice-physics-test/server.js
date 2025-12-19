const express = require('express');
const path = require('path');

const app = express();
const PORT = 3300;

// Serve static files from current directory
app.use(express.static(__dirname));

// Serve assets folder
app.use('/assets', express.static(path.join(__dirname, 'assets')));

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════╗
║  Dice Physics Test Server Running     ║
║  Open: http://localhost:${PORT}        ║
╚════════════════════════════════════════╝
  `);
});
