const express = require('express');
const router = express.Router();

router.get('/', function (req, res, next) {
    if(!global.monitor) {
        res.json("monitoring not enabled.");
        return;
    }

    res.json(global.monitor.json());
});

module.exports = router;