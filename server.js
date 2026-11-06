const express = require('express');
const app = express();

app.get('/', (req, res) => {
    res.send('MyCompta');
});

app.listen(3001, () => {
    console.log('MyCompta démarré');
});