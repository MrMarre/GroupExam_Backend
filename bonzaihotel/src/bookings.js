const { docClient } = require("../initializers/dynamo");
const {
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
} = require("@aws-sdk/lib-dynamodb");
const serverless = require("serverless-http");
const { v4: uuid } = require("uuid");
const { initExpress } = require("../initializers/initExpress");
const { calculateDateDifference } = require("../functions/dateHelper");

const BOOKINGS_TABLE = process.env.BOOKINGS_TABLE;
const ROOMS_TABLE = process.env.ROOMS_TABLE;

const app = initExpress();

app.post("/bookings/:roomId", async (req, res) => {
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
    return res.status(404).json({ msg: "No room found with that id" });
  }

  const controlGuestAmount = (guests) => {
    let maxGuests;
    switch (foundRoom.Item.room) {
      case "single":
        maxGuests = 1;
        break;
      case "double":
        maxGuests = 2;
        break;
      case "suite":
        maxGuests = 3;
        break;
      default:
        maxGuests = 1;
    }
    if (guests > maxGuests) {
      throw new Error(`Too many guests. Maximum allowed is ${maxGuests}`);
    }
  };

  const days = calculateDateDifference(checkIn, checkOut);
  const sum = Number(foundRoom.Item.price) * days;
  try {
    controlGuestAmount(guests);

    const order = {
      id: uuid(),
      roomId: roomId,
      days: days,
      checkIn: checkIn.toISOString(),
      checkOut: checkOut.toISOString(),
      sum: sum,
      clientName: clientName,
      guests: guests,
    };

    const bookingParams = {
      TableName: BOOKINGS_TABLE,
      Item: order,
    };
    const bookingCommand = new PutCommand(bookingParams);
    await docClient.send(bookingCommand);

    // Update the room availability
    const updateRoomParams = {
      TableName: ROOMS_TABLE,
      Key: { id: roomId },
      UpdateExpression: "SET available = :available",
      ExpressionAttributeValues: {
        ":available": false,
      },
    };

    const updateRoomCommand = new UpdateCommand(updateRoomParams);
    await docClient.send(updateRoomCommand);

    res.status(200).json({
      msg: "Room booked successfully",
      orderId: order.id,
      roomId: roomId,
    });
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
});

// DELETE BOOKING
app.delete("/bookings/:orderId", async (req, res) => {
  const { orderId } = req.params;

  try {
    // Retrieve the booking details
    const getParams = {
      TableName: BOOKINGS_TABLE,
      Key: { id: orderId },
    };

    const getCommand = new GetCommand(getParams);
    const booking = await docClient.send(getCommand);

    if (!booking.Item) {
      return res
        .status(404)
        .json({ msg: "No booking found with that orderId", orderId });
    }

    const checkInDate = new Date(booking.Item.checkIn);
    const currentDate = new Date();
    const timeDifference = checkInDate.getTime() - currentDate.getTime();
    const daysDifference = timeDifference / (1000 * 3600 * 24);

    if (daysDifference <= 2) {
      return res.status(400).json({
        msg: "You cannot delete this booking. The check-in date is within 2 days.",
      });
    }
    const updateParams = booking.Item.roomId;

    // Delete booking
    const deleteParams = {
      TableName: BOOKINGS_TABLE,
      Key: { id: orderId },
    };
    const deleteCommand = new DeleteCommand(deleteParams);
    await docClient.send(deleteCommand);

    // Update room availability to true
    const updateRoomParams = {
      TableName: ROOMS_TABLE,
      Key: { id: updateParams },
      UpdateExpression: "SET available = :available",
      ExpressionAttributeValues: {
        ":available": true,
      },
    };

    const updateRoomCommand = new UpdateCommand(updateRoomParams);
    await docClient.send(updateRoomCommand);

    res
      .status(200)
      .json({ msg: `Booking ${updateParams} deleted successfully` });
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
});

app.get("/bookings/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const params = {
      TableName: BOOKINGS_TABLE,
      Key: { id },
    };

    const command = new GetCommand(params);
    const { Item: bookingInfo } = await docClient.send(command);
    if (bookingInfo) {
      res.status(200).json({ bookingid: id, bookingInfo });
    } else {
      res.status(404).json({ msg: "Booking not found" });
    }
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
});

exports.handler = serverless(app);
