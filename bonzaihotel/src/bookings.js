const { docClient } = require('../initializers/dynamo');
const {
  GetCommand,
  PutCommand,
  UpdateCommand,
} = require('@aws-sdk/lib-dynamodb');
const serverless = require('serverless-http');
const { v4: uuid } = require('uuid');
const { initExpress } = require('../initializers/initExpress');
const { calculateDateDifference } = require('../functions/dateHelper');

const BOOKINGS_TABLE = process.env.BOOKINGS_TABLE;
const ROOMS_TABLE = process.env.ROOMS_TABLE;

const app = initExpress();

app.post('/bookings/:roomId', async (req, res) => {
  console.log('request Body:', req.body);
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

  console.log('Found room:', foundRoom);

  if (!foundRoom.Item) {
    return res.status(404).json({ msg: 'No room found with that id' });
  }

  const controlGuestAmount = (guests) => {
    let maxGuests;
    switch (foundRoom.Item.room) {
      case 'single':
        maxGuests = 1;
        break;
      case 'double':
        maxGuests = 2;
        break;
      case 'suite':
        maxGuests = 3;
        break;
      default:
        maxGuests = 1;
    }
    if (guests > maxGuests) {
      return res
        .status(400)
        .json({ msg: `Too many guests. Maximum allowed is ${maxGuests}` });
    }
  };

  const days = calculateDateDifference(checkIn, checkOut);
  const sum = Number(foundRoom.Item.price) * days;
  try {
    controlGuestAmount(guests);

    const order = {
      id: uuid(),
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
      // Här tror jag att vi skall uppdatera BOOL till false
    };
    console.log('params', params.Item);
    const command = new PutCommand(params);
    const result = await docClient.send(command);

    console.log('PutCommand Result:', result);

    res.status(200).json({
      msg: 'Room booked successfully',
      orderId: order.id,
      roomId: roomId,
    });
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
});

exports.handler = serverless(app);
