const net = require('net');
const EventEmitter = require('events');
const Logger = require('../utils/Logger');
const config = require('../config/default.json');

class SocketService extends EventEmitter {
    constructor() {
        super();
        this.server = null;
        this.sockets = new Set();
        this.messageBuffer = []; // Buffer for messages sent while bridge is offline
        this.port = config.bot.socketPort || 19132;
    }

    start() {
        this.server = net.createServer((socket) => {
            if (this.sockets.size > 0) {
                Logger.warn('Python Bridge connection rejected (only one bridge allowed)');
                socket.end('One bridge already connected\n');
                return;
            }
            Logger.info('Python Bridge connected via Socket');
            this.sockets.add(socket);

            // Send buffered messages
            if (this.messageBuffer.length > 0) {
                Logger.info(`Sending ${this.messageBuffer.length} buffered messages to bridge`);
                while (this.messageBuffer.length > 0) {
                    const payload = this.messageBuffer.shift();
                    socket.write(payload);
                }
            }

            socket.on('data', (data) => {
                const chunks = data.toString().split('\n');
                for (const chunk of chunks) {
                    if (!chunk.trim()) continue;
                    try {
                        const message = JSON.parse(chunk);
                        this.handleMessage(message);
                    } catch (e) {
                        Logger.error(`Socket parse error: ${e.message} in "${chunk}"`);
                    }
                }
            });

            socket.on('end', () => {
                Logger.warn('Python Bridge disconnected');
                this.sockets.delete(socket);
            });

            socket.on('error', (err) => {
                Logger.error(`Socket error: ${err.message}`);
                this.sockets.delete(socket);
            });
        });

        this.server.listen(this.port, () => {
            Logger.info(`Socket Server listening on port ${this.port}`);
        });

        this.server.on('error', (err) => {
            Logger.error(`Socket Server error: ${err.message}`);
            if (err.code === 'EADDRINUSE') {
                Logger.error(`Port ${this.port} is already in use. Another instance of the bot might be running.`);
                process.exit(1);
            }
        });
    }

    handleMessage(message) {
        if (message.type === 'signal') {
            if (message.event === 'order') {
                Logger.info('Python Bridge signal: New Order');
                this.emit('order');
            } else if (message.event === 'message') {
                Logger.info('Python Bridge signal: New Message');
                this.emit('message');
            }
        }
    }

    send(data) {
        const payload = JSON.stringify(data) + '\n';
        if (this.sockets.size === 0) {
            this.messageBuffer.push(payload);
            // Optional: Limit buffer size to avoid memory issues
            if (this.messageBuffer.length > 50) this.messageBuffer.shift();
            return;
        }
        for (const socket of this.sockets) {
            socket.write(payload);
        }
    }

    // Helper to send FunPay message directly via socket
    sendFunPayMessage(username, message, orderId = null, nodeId = null) {
        this.send({
            type: 'message',
            username: username,
            message: message,
            order_id: orderId,
            node_id: nodeId
        });
    }
}

module.exports = new SocketService();
