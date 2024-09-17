const { docClient } = require('../initializers/dynamo');
const {
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
} = require('@aws-sdk/lib-dynamodb');
const serverless = require('serverless-http');
const { v4: uuid } = require('uuid');
const { initExpress } = require('../initializers/initExpress');
const { calculateDateDifference } = require('../functions/dateHelper');

const BOOKINGS_TABLE = process.env.BOOKINGS_TABLE;
const ROOMS_TABLE = process.env.ROOMS_TABLE;

const app = initExpress();

app.post('/bookings/:roomId', async (req, res) => {
  const body = req.body;
  const { roomId } = req.params;
  const checkIn = new Date(body.checkIn);
  const checkOut = new Date(body.checkOut);
  const { clientName, guests } = req.body;

  const roomParams = {
    TableName: ROOMS_TABLE,
    Key: { id: roomId },
  };

  const roomCommand = new GetCommand(roomParams);
  const foundRoom = await docClient.send(roomCommand);

  if (!foundRoom.Item) {
    return res.status(404).json({ msg: 'No room found with that id' });
  }

  const days = calculateDateDifference(checkIn, checkOut);
  const sum = Number(foundRoom.Item.price) * days;
  try {
    const order = {
      orderId: uuid(),
      id: roomId,
      days: days,
      checkIn: checkIn.toISOString(),
      checkOut: checkOut.toISOString(),
      sum: sum,
      clientName: clientName,
      guests: guests,
    };

    const params = {
      TableName: BOOKINGS_TABLE,
      Item: order,
    };
    console.log('params', params);
    const command = new PutCommand(params);
    await docClient.send(command);
    res.status(200).json({ msg: 'Room booked successfully', result: order });
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
});

//DELETE BOOKING
app.delete('/bookings/:roomId', async (req, res) => {
  const { roomId } = req.params;

  try {
    const params = {
      TableName: BOOKINGS_TABLE,
      Key: { id: roomId },
    };

    const deleteCommand = new DeleteCommand(params);
    await docClient.send(deleteCommand);

    res
      .status(200)
      .json({ msg: `Booking ${roomId} deleted successfully` });
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
});

exports.handler = serverless(app);
