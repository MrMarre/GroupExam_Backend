const { docClient } = require('../initializers/dynamo');

const serverless = require('serverless-http');
const { v4: uuid } = require('uuid');
const { initExpress } = require('../initializers/initExpress');
const { calculateDateDifference } = require('../functions/dateHelper');

const app = initExpress(app);

exports.handler = serverless(app);
