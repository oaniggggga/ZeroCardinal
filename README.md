# ZeroCardinal

**ZeroCardinal** is a Minecraft bot automation system for delivering in-game currency orders from FunPay. It uses **Mineflayer** for Minecraft interaction and **SQLite** for robust data storage.

## 🚀 Features

- **Auto-Delivery**: Automatically delivers currency to players on "HolyWorld" (Anarchy 401).
- **FunPay Integration**: Parses chat/orders from FunPay (via Python bridge).
- **SQLite Database**: Secure, local storage for orders and history.
- **Queue System**: Handles multiple orders sequentially with queue notifications.
- **Robust Logging**: Daily rotating logs in `logs/` directory.
- **Process Management**: PM2 support for 24/7 operation.

## 📂 Project Structure

- `index.js`: Entry point.
- `managers/`: Business logic.
    - `OrderManager.js`: Handles orders, queue, and FunPay messages.
    - `DatabaseManager.js`: SQLite wrapper.
- `services/`: External interactions.
    - `MinecraftService.js`: Mineflayer bot logic.
- `utils/`: Helpers (Logger, Validator).
- `config/`: Configuration files.
- `FpCardinal/`: Python plugin for FunPayCardinal.
- `scripts/`: Utility scripts (migration, testing).

## 🛠 Installation

1.  **Install Node.js dependencies**:
    ```bash
    npm install
    ```
2.  **Configure**:
    - Edit `config/default.json` for messages, timeouts, and settings.
    - Ensure `config.json` (root) contains bot credentials (`host`, `username`, `password`).

## ▶️ usage

### Development
```bash
npm run dev
```
Runs with `nodemon` for auto-restart on changes.

### Production
```bash
npm start
```
Or with PM2 (recommended):
```bash
npm run pm2:start
```
Monitor logs:
```bash
npm run pm2:logs
```

## 🔄 Migration

If migrating from the old JSON version:
```bash
npm run migrate
```
This imports `orders.json` into the SQLite database.
