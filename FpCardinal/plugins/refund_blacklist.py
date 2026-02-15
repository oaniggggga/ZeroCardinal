"""
Плагин для автоматического возврата средств и добавления в черный список.
При команде /возврат - возвращает средства и добавляет пользователя в ЧС.
При повторной покупке - автоматически возвращает средства.
"""

NAME = "Refund & Blacklist"
VERSION = "1.0.0"
DESCRIPTION = "Автоматический возврат средств и ЧС при команде /возврат"
CREDITS = "@MullaXul"
UUID = "6cbed939-8507-4a53-b5fb-ff9c678a77a4"
SETTINGS_PAGE = False

import json
import os
import time
from cardinal import Cardinal
from FunPayAPI.updater.events import NewMessageEvent, NewOrderEvent
from FunPayAPI.types import MessageTypes

REFUND_BLACKLIST_FILE = "storage/refund_blacklist.json"
PENDING_REFUNDS_FILE = "storage/pending_refunds.json"


def load_pending_refunds():
    """Загружает список ожидающих подтверждения возвратов"""
    if not os.path.exists(PENDING_REFUNDS_FILE):
        return {}
    try:
        with open(PENDING_REFUNDS_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except:
        return {}


def save_pending_refunds(pending):
    """Сохраняет список ожидающих подтверждения"""
    os.makedirs(os.path.dirname(PENDING_REFUNDS_FILE), exist_ok=True)
    with open(PENDING_REFUNDS_FILE, 'w', encoding='utf-8') as f:
        json.dump(pending, f, ensure_ascii=False, indent=2)


def load_refund_blacklist():
    """Загружает список пользователей, запросивших возврат"""
    if not os.path.exists(REFUND_BLACKLIST_FILE):
        return {}
    try:
        with open(REFUND_BLACKLIST_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except:
        return {}


def save_refund_blacklist(blacklist):
    """Сохраняет список пользователей"""
    os.makedirs(os.path.dirname(REFUND_BLACKLIST_FILE), exist_ok=True)
    with open(REFUND_BLACKLIST_FILE, 'w', encoding='utf-8') as f:
        json.dump(blacklist, f, ensure_ascii=False, indent=2)


def add_to_cardinal_blacklist(cardinal: Cardinal, username: str):
    """Добавляет пользователя в основной черный список Cardinal"""
    if username not in cardinal.blacklist:
        cardinal.blacklist.append(username)
        # Сохраняем черный список
        from Utils import cardinal_tools
        cardinal_tools.cache_blacklist(cardinal.blacklist)
        cardinal.logger.info(f"[Refund & Blacklist] Пользователь {username} добавлен в основной ЧС")


def process_refund(cardinal: Cardinal, username: str, chat_id: int, order_id: str = None):
    """Обрабатывает возврат средств после подтверждения"""
    refund_bl = load_refund_blacklist()
    
    # Добавляем в ЧС возвратов
    refund_bl[username] = {
        'first_refund': int(time.time()),
        'last_attempt': int(time.time()),
        'refund_count': 1,
        'order_id': order_id
    }
    save_refund_blacklist(refund_bl)
    
    # Добавляем в основной ЧС Cardinal
    add_to_cardinal_blacklist(cardinal, username)
    
    # Отправляем сообщение о возврате
    message = """✅ Ваш запрос на возврат средств принят.

💰 Средства будут возвращены в течение 24 часов.
⚠️ Вы добавлены в черный список.
🚫 Повторные покупки будут автоматически возвращены.

Спасибо за понимание."""
    
    cardinal.send_message(chat_id, message, username)
    cardinal.logger.info(f"[Refund & Blacklist] Возврат обработан для {username}, заказ #{order_id}")
    
    # Уведомление в Telegram (если бот настроен)
    if cardinal.telegram:
        from tg_bot import utils, keyboards
        tg_message = f"""🔴 <b>ВОЗВРАТ СРЕДСТВ</b>

👤 Пользователь: <code>{username}</code>
📦 Заказ: <code>#{order_id or 'N/A'}</code>
⏰ Время: <code>{time.strftime('%d.%m.%Y %H:%M')}</code>

⚠️ Пользователь добавлен в ЧС."""
        
        kb = keyboards.reply(chat_id, username, extend=True)
        cardinal.telegram.send_notification(tg_message, kb, utils.NotificationTypes.other)
    
    return True


def on_new_message(cardinal: Cardinal, event: NewMessageEvent):
    """Обработчик новых сообщений - проверяет команду /возврат и подтверждения"""
    message = event.message
    
    # Игнорируем системные сообщения и свои сообщения
    if message.type != MessageTypes.NON_SYSTEM or message.author_id == cardinal.account.id:
        return
    
    message_text = str(message).strip().lower()
    username = message.author
    chat_id = message.chat_id
    
    # Загружаем ожидающие подтверждения
    pending = load_pending_refunds()
    
    # Проверяем, ожидается ли подтверждение от этого пользователя
    if username in pending:
        # Проверяем таймаут (5 минут)
        if int(time.time()) - pending[username]['timestamp'] > 300:
            # Таймаут истек
            del pending[username]
            save_pending_refunds(pending)
            timeout_message = """⏰ Время ожидания подтверждения истекло.

Если вы все еще хотите вернуть средства, напишите команду /возврат снова."""
            cardinal.send_message(chat_id, timeout_message, username)
            cardinal.logger.info(f"[Refund & Blacklist] Таймаут подтверждения для {username}")
            return
        
        # Проверяем ответ
        if message_text in ['да', 'yes', 'д', 'y', 'ага', 'угу', '+']:
            # Подтверждение получено
            order_id = pending[username].get('order_id')
            del pending[username]
            save_pending_refunds(pending)
            
            cardinal.logger.info(f"[Refund & Blacklist] Подтверждение получено от {username}")
            process_refund(cardinal, username, chat_id, order_id)
            return
            
        elif message_text in ['нет', 'no', 'н', 'n', 'отмена', 'cancel', '-']:
            # Отмена возврата
            del pending[username]
            save_pending_refunds(pending)
            
            cancel_message = """❌ Возврат средств отменен.

Если передумаете, напишите команду /возврат снова.
Рады, что остаетесь с нами! 😊"""
            cardinal.send_message(chat_id, cancel_message, username)
            cardinal.logger.info(f"[Refund & Blacklist] Возврат отменен пользователем {username}")
            return
        else:
            # Неправильный ответ
            reminder_message = """⚠️ Пожалуйста, ответьте "да" или "нет".

Вы уверены, что хотите вернуть средства и быть добавлены в черный список?

Напишите:
• "да" - подтвердить возврат
• "нет" - отменить возврат"""
            cardinal.send_message(chat_id, reminder_message, username)
            return
    
    # Проверяем команду /возврат
    if message_text in ['/возврат', 'возврат', '/refund', 'refund']:
        cardinal.logger.info(f"[Refund & Blacklist] Получена команда возврата от {username}")
        
        # Проверяем, не в ЧС ли уже
        refund_bl = load_refund_blacklist()
        if username in refund_bl:
            refund_count = refund_bl[username].get('refund_count', 1)
            already_blocked_message = f"""❌ Вы уже находитесь в черном списке за возврат средств.

📊 Количество попыток возврата: {refund_count}
⏰ Первый возврат: {time.strftime('%d.%m.%Y %H:%M', time.localtime(refund_bl[username]['first_refund']))}

⚠️ Повторные покупки будут автоматически возвращены."""
            
            cardinal.send_message(chat_id, already_blocked_message, username)
            cardinal.logger.warning(f"[Refund & Blacklist] {username} уже в ЧС, попытка #{refund_count + 1}")
            
            # Увеличиваем счетчик попыток
            refund_bl[username]['refund_count'] = refund_count + 1
            refund_bl[username]['last_attempt'] = int(time.time())
            save_refund_blacklist(refund_bl)
            return
        
        # Пытаемся найти последний заказ пользователя
        order_id = None
        try:
            from FunPayAPI import utils as fp_utils
            order_ids = fp_utils.RegularExpressions().ORDER_ID.findall(str(message))
            if order_ids:
                order_id = order_ids[0][1:]
        except:
            pass
        
        # Добавляем в ожидающие подтверждения
        pending[username] = {
            'timestamp': int(time.time()),
            'chat_id': chat_id,
            'order_id': order_id
        }
        save_pending_refunds(pending)
        
        # Отправляем запрос подтверждения
        confirmation_message = """⚠️ ВНИМАНИЕ! Вы уверены?

Если вы подтвердите возврат средств:
🚫 Вы будете занесены в черный список бота
💰 Средства будут возвращены в течение 24 часов
❌ Повторные покупки будут автоматически отклонены

Вы действительно хотите продолжить?

Напишите:
• "да" - подтвердить возврат и добавление в ЧС
• "нет" - отменить возврат

⏰ У вас есть 5 минут для ответа."""
        
        cardinal.send_message(chat_id, confirmation_message, username)
        cardinal.logger.info(f"[Refund & Blacklist] Запрос подтверждения отправлен {username}")


def on_new_order(cardinal: Cardinal, event: NewOrderEvent):
    """Обработчик новых заказов - автоматически возвращает средства пользователям из ЧС"""
    order = event.order
    username = order.buyer_username
    
    refund_bl = load_refund_blacklist()
    
    # Проверяем, есть ли пользователь в ЧС возвратов
    if username in refund_bl:
        cardinal.logger.warning(f"[Refund & Blacklist] Заказ #{order.id} от {username} (в ЧС возвратов)")
        
        # Отправляем сообщение о блокировке
        message = f"""🚫 ЗАКАЗ ОТКЛОНЕН

Вы находитесь в черном списке за возврат средств.

📊 Информация:
• Первый возврат: {time.strftime('%d.%m.%Y %H:%M', time.localtime(refund_bl[username]['first_refund']))}
• Попыток возврата: {refund_bl[username].get('refund_count', 1)}

💰 Средства будут автоматически возвращены в течение 24 часов.

⚠️ Повторные покупки невозможны."""
        
        chat = cardinal.account.get_chat_by_name(username)
        chat_id = chat.id if chat else order.chat_id
        
        cardinal.send_message(chat_id, message, username)
        
        # Обновляем счетчик попыток
        refund_bl[username]['refund_count'] = refund_bl[username].get('refund_count', 1) + 1
        refund_bl[username]['last_attempt'] = int(time.time())
        refund_bl[username]['blocked_orders'] = refund_bl[username].get('blocked_orders', [])
        refund_bl[username]['blocked_orders'].append({
            'order_id': order.id,
            'timestamp': int(time.time()),
            'amount': f"{order.price} {order.currency}"
        })
        save_refund_blacklist(refund_bl)
        
        # Уведомление в Telegram
        if cardinal.telegram:
            from tg_bot import utils, keyboards
            tg_message = f"""🚫 <b>ЗАКАЗ ЗАБЛОКИРОВАН</b>

👤 Пользователь: <code>{username}</code> (в ЧС возвратов)
📦 Заказ: <code>#{order.id}</code>
💰 Сумма: <code>{order.price} {order.currency}</code>
⏰ Время: <code>{time.strftime('%d.%m.%Y %H:%M')}</code>

📊 Попыток возврата: {refund_bl[username].get('refund_count', 1)}
🔴 Средства будут возвращены автоматически."""
            
            kb = keyboards.new_order(order.id, username, chat_id)
            cardinal.telegram.send_notification(tg_message, kb, utils.NotificationTypes.other)


def on_plugin_delete(cardinal: Cardinal):
    """Вызывается при удалении плагина"""
    cardinal.logger.info(f"[{NAME}] Плагин удален")


def init(cardinal: Cardinal):
    """Инициализация плагина"""
    # Создаем папку для хранения данных
    os.makedirs("storage", exist_ok=True)
    
    # Загружаем ЧС и синхронизируем с основным ЧС Cardinal
    refund_bl = load_refund_blacklist()
    for username in refund_bl.keys():
        add_to_cardinal_blacklist(cardinal, username)
    
    cardinal.logger.info(f"[{NAME}] Плагин загружен. ЧС возвратов: {len(refund_bl)} пользователей")


BIND_TO_NEW_MESSAGE = [on_new_message]
BIND_TO_NEW_ORDER = [on_new_order]
BIND_TO_DELETE = on_plugin_delete
