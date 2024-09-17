const { docClient } = require("../initializers/dynamo");
const {
  GetCommand,
  PutCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");
const serverless = require("serverless-http");
const { v4: uuid } = require("uuid");
const { initExpress } = require("../initializers/initExpress");

const BOOKINGS_TABLE = process.env.BOOKINGS_TABLE;
const ROOMS_TABLE = process.env.ROOMS_TABLE;

const app = initExpress();

app.post("/bookings/:roomId", async (req, res) => {
  // orderId: uuid,
  // roomId: roomId,
  // days: number
  // checkIn: date
  // checkOut: date
  // sum: number (days + roomPrice)
  // clientName: string

  const { roomId } = req.params;
  const { days, clientName } = req.body;

  const roomParams = {
    TableName: ROOMS_TABLE,
    Key: { id: roomId },
  };

  const roomCommand = new GetCommand(roomParams);
  const foundRoom = await docClient.send(roomCommand);

  if (!foundRoom.Item) {
    return res.status(404).json({ msg: "No room found with that id" });
  }

  try {
    const order = {
      orderId: uuid(),
      id: roomId,
      days: days,
      checkIn: Date(),
      checkOut: Date(),
      sum: 500,
      clientName: clientName,
    };
    const params = {
      TableName: BOOKINGS_TABLE,
      Item: order,
    };
    console.log("params", params);
    const command = new PutCommand(params);
    await docClient.send(command);
    res.status(200).json({ msg: "Room booked successfully", result: order });
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
});

exports.handler = serverless(app);
