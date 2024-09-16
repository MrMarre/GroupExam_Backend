const express = require('express');

const initExpress = () => {
  const app = express();
  app.use(express.json());

  return app;
};

module.exports = {
  initExpress,
};
