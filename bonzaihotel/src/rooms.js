const { docClient } = require("../initializers/dynamo");
const {
  GetCommand,
  PutCommand,
  UpdateCommand,
  ScanCommand,
} = require("@aws-sdk/lib-dynamodb");
const serverless = require("serverless-http");
const { v4: uuid } = require("uuid");
const { initExpress } = require("../initializers/initExpress");
const ROOMS_TABLE = process.env.ROOMS_TABLE;
const app = initExpress();

app.post("/rooms", async (req, res) => {
  const { room, guests, price } = req.body;

  const params = {
    TableName: ROOMS_TABLE,
    Item: {
      id: uuid(),
      room: room,
      guests: guests,
      price: price,
      available: true,
    },
  };
  if (room == "" || guests == "" || price == "") {
    return res
      .status(404)
      .json({ msg: "The field room, guests, and price is required" });
  }

  try {
    const command = new PutCommand(params);
    await docClient.send(command);
    res.status(200).json({ result: params.Item });
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
});

app.get("/rooms", async (req, res) => {
  const params = {
    TableName: ROOMS_TABLE,
  };

  try {
    const command = new ScanCommand(params);
    const { Items } = await docClient.send(command);
    if (Items) {
      res.status(200).json(Items);
    }
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
});

exports.handler = serverless(app);
