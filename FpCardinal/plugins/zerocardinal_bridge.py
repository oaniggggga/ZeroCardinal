"""
Plugin for ZeroCardinal integration.
Handles new orders, incoming messages, and outgoing requests via SQLite.
"""

NAME = "ZeroCardinal Bridge"
VERSION = "2.0.0"
DESCRIPTION = "Unified bridge for ZeroCardinal (SQLite)"
CREDITS = "ZeroCardinal"
UUID = "f7e8d9c0-b1a2-43d4-b5c6-d7e8f9a0b1c2"
SETTINGS_PAGE = False

import json
import os
import time
import logging
import sqlite3
from threading import Thread
from cardinal import Cardinal
from FunPayAPI.updater.events import NewOrderEvent, NewMessageEvent

# Configure logger
logger = logging.getLogger("FPC")

# Path to database (relative to FpCardinal root)
DB_PATH = "shared/data.db"
CHECK_INTERVAL = 1

def get_db_connection():
    try:
        conn = sqlite3.connect(DB_PATH, timeout=10)
        conn.row_factory = sqlite3.Row
        return conn
    except Exception as e:
        logger.error(f"[{NAME}] Connection error: {e}")
        return None

def on_new_order(cardinal: Cardinal, event: NewOrderEvent):
    order = event.order
    conn = get_db_connection()
    if not conn:
        return

    try:
        cursor = conn.cursor()
        # Check if exists
        cursor.execute("SELECT 1 FROM orders WHERE id = ?", (order.id,))
        if cursor.fetchone():
            return # Already exists

        cursor.execute("""
            INSERT INTO orders (id, username, amount, description, status, created_at, updated_at, is_manual)
            VALUES (?, ?, ?, ?, ?, ?, ?, 0)
        """, (
            order.id,
            order.buyer_username,
            order.amount if order.amount else 1,
            order.description,
            "pending",
            int(time.time() * 1000),
            int(time.time() * 1000)
        ))
        conn.commit()
        logger.info(f"[{NAME}] Order #{order.id} from {order.buyer_username} added to DB")
    except Exception as e:
        logger.error(f"[{NAME}] Error adding order: {e}")
    finally:
        conn.close()

def on_new_message(cardinal: Cardinal, event: NewMessageEvent):
    msg = event.message
    # Ignore self messages unless they are commands (if we want to process our own !commands)
    # But usually bot commands are from other users.
    is_command = msg.text and msg.text.strip().startswith('!')
    
    if msg.author_id == cardinal.account.id and not is_command:
        return
        
    username = msg.author if msg.author else "System"
    text = msg.text if msg.text else "[Image/Other]"
    
    conn = get_db_connection()
    if not conn:
        return

    try:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO messages (username, message, is_incoming, processed, created_at)
            VALUES (?, ?, 1, 0, ?)
        """, (username, text, int(time.time() * 1000)))
        conn.commit()
        logger.info(f"[{NAME}] Message from {username} logged to DB")
    except Exception as e:
        logger.error(f"[{NAME}] Error logging message: {e}")
    finally:
        conn.close()

def find_chat(cardinal: Cardinal, username: str):
    chat = cardinal.account.get_chat_by_name(username)
    if chat:
        return chat
        
    try:
        chats = cardinal.account.get_chats()
        for chat_id in chats:
            chat_obj = chats[chat_id]
            if chat_obj.name.lower() == username.lower():
                return chat_obj
    except:
        pass
    return None

# --- Socket Client ---

import socket
import threading

SOCKET_HOST = "127.0.0.1"
SOCKET_PORT = 19132

class SocketClient:
    def __init__(self, cardinal):
        self.cardinal = cardinal
        self.sock = None
        self.connected = False
        self.lock = threading.Lock()
        
    def connect(self):
        try:
            self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.sock.connect((SOCKET_HOST, SOCKET_PORT))
            self.connected = True
            logger.info(f"[{NAME}] Connected to Node.js socket")
            
            # Start listener thread
            t = threading.Thread(target=self.listen, daemon=True)
            t.start()
        except:
            self.connected = False
            
    def send(self, data):
        if not self.connected:
            return
        try:
            with self.lock:
                self.sock.sendall((json.dumps(data) + "\n").encode('utf-8'))
        except:
            self.connected = False
            self.sock.close()

    def listen(self):
        buffer = ""
        while True:
            try:
                data = self.sock.recv(4096).decode('utf-8')
                if not data:
                    break
                buffer += data
                while "\n" in buffer:
                    line, buffer = buffer.split("\n", 1)
                    if line.strip():
                        try:
                            msg = json.loads(line)
                            self.handle_message(msg)
                        except Exception as e:
                            logger.error(f"[{NAME}] Socket msg error: {e}")
            except:
                break
        
        self.connected = False
        logger.warning(f"[{NAME}] Socket disconnected")

    def handle_message(self, msg):
        msg_type = msg.get('type')
        if msg_type == 'message':
            username = msg.get('username')
            text = msg.get('message')
            chat = find_chat(self.cardinal, username)
            if chat:
                final_msg = f"{text}\n\n🐦 ZeroCardinal"
                try:
                    self.cardinal.send_message(chat.id, final_msg, chat_name=username, watermark=False)
                    # Mark as processed in DB if it was also in DB (optional, but good practice)
                except Exception as e:
                    logger.error(f"[{NAME}] Send error: {e}")
        elif msg_type == 'alert':
            text = msg.get('message')
            if self.cardinal.telegram:
                from tg_bot import utils
                self.cardinal.telegram.send_notification(f"🔔 <b>BOT ALERT</b>\n\n{text}", notification_type=utils.NotificationTypes.other)

# Global client
socket_client = None

def requests_worker(cardinal: Cardinal):
    # This worker now mainly handles DB polling as fallback OR socket connection maintenance
    global socket_client
    socket_client = SocketClient(cardinal)
    
    while True:
        if not socket_client.connected:
            socket_client.connect()
        
        # We can still poll DB as backup for outgoing requests if socket fails
        # But for now, let's rely on socket for OUTGOING (Node -> Python) messages mostly.
        # Although, OrderManager writes to DB first, then sends signal.
        # But verify logic: OrderManager sends message via socket DIRECTLY now in my updated code.
        
        time.sleep(5)

def on_new_order(cardinal: Cardinal, event: NewOrderEvent):
    order = event.order
    conn = get_db_connection()
    if not conn: return
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT 1 FROM orders WHERE id = ?", (order.id,))
        if cursor.fetchone(): return

        cursor.execute("""
            INSERT INTO orders (id, username, amount, description, status, created_at, updated_at, is_manual)
            VALUES (?, ?, ?, ?, ?, ?, ?, 0)
        """, (order.id, order.buyer_username, order.amount if order.amount else 1, order.description, "pending", int(time.time() * 1000), int(time.time() * 1000)))
        conn.commit()
        logger.info(f"[{NAME}] Order #{order.id} added")
        
        # Signal Node.js
        if socket_client:
            socket_client.send({"type": "signal", "event": "order"})
            
    except Exception as e:
        logger.error(f"[{NAME}] DB Error: {e}")
    finally:
        conn.close()

def on_new_message(cardinal: Cardinal, event: NewMessageEvent):
    msg = event.message
    is_command = msg.text and msg.text.strip().startswith('!')
    if msg.author_id == cardinal.account.id and not is_command: return
    
    username = msg.author if msg.author else "System"
    text = msg.text if msg.text else "[Image]"
    
    conn = get_db_connection()
    if not conn: return
    try:
        cursor = conn.cursor()
        cursor.execute("INSERT INTO messages (username, message, is_incoming, processed, created_at) VALUES (?, ?, 1, 0, ?)", (username, text, int(time.time() * 1000)))
        conn.commit()
        
        # Signal Node.js
        if socket_client:
            socket_client.send({"type": "signal", "event": "message"})
            
    except Exception as e:
        logger.error(f"[{NAME}] DB Error: {e}")
    finally:
        conn.close()

def on_post_start(cardinal: Cardinal):
    os.makedirs("shared", exist_ok=True)
    t = Thread(target=requests_worker, args=(cardinal,), daemon=True)
    t.start()
    logger.info(f"[{NAME}] Plugin started (v{VERSION}) with Socket")

def on_plugin_delete(cardinal: Cardinal):
    logger.info(f"[{NAME}] Plugin deleted")

BIND_TO_POST_START = [on_post_start]
BIND_TO_NEW_ORDER = [on_new_order]
BIND_TO_NEW_MESSAGE = [on_new_message]
BIND_TO_DELETE = on_plugin_delete
