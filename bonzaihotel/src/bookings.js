const { docClient } = require('../initializers/dynamo');
const {
  GetCommand,
  PutCommand,
  UpdateCommand,
} = require('@aws-sdk/lib-dynamodb');
const serverless = require('serverless-http');
const { v4: uuid } = require('uuid');
const { initExpress } = require('../initializers/initExpress');

const app = initExpress();

exports.handler = serverless(app);
