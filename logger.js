'use strict';

require(ROOT + '/lib/decimal');
const winston = require('winston');
const moment = require('moment');
const config = require(ROOT + '/config');

const tsFormat = function () {
    return moment().format('YYYY-MM-DD HH:mm:ss');
}

//////////////////////////////////////////////////////////////////////////////////////////
const myFormat = winston.format.printf(info => {
    return tsFormat() + ' ' + info.message;
});

// Normal Logger: Winston
let logger = winston.createLogger({
    level: config.system.logLevel || 'info',
    format: winston.format.combine(
        myFormat
    ),
    transports: [
        new(winston.transports.Console)({
            colorize: true,
            handleExceptions: true,
        })
    ]
});

//Promise unhandled rejection logger.
//process.off('unhandledRejection', () => {});
process.on('unhandledRejection', (reason, p) => {
    console.error('Unhandled rejection Promise: ', p, ' reason: ', reason)
});

module.exports = logger;
