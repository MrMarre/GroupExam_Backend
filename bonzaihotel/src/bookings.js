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

app.post('/bookings', async (req, res) => {
  // orderId: uuid,
  // roomId: roomId,
  // days: number
  // checkIn: date
  // checkOut: date
  // sum: number (days + roomPrice)
  // clientName: string
});

exports.handler = serverless(app);
