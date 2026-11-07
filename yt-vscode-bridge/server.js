const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 9999 });

wss.on('connection', (ws) => {
  console.log('>>> ¡CLIENTE CONECTADO! Total conectados:', wss.clients.size);

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      console.log('>>> Tráfico pasando:', data.type);
    } catch(e) {}

    wss.clients.forEach((client) => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(message.toString());
      }
    });
  });

  ws.on('close', () => {
    console.log('>>> Cliente desconectado. Quedan:', wss.clients.size);
  });
});

console.log('Puente activo en ws://localhost:9999');