
const c = global.chalk;
const clone = global.clone;
const fetch = global.fetch;
const log = global.log;
const parseDOM = global.DOMParser;
const { sendMessage } = global.chat;
const { load, updateFile, getConst } = global.storage;


const goodsfilePath = 'data/configs/delivery.json';
const settings = global.settings;
let goods = await load(goodsfilePath);
let backupOrders = [];

import { refund } from "./account.js";
import { Order } from "./ru/cycle/Utils.js";

async function enableAutoIssue() {
    backupOrders = await getOrders();

    if(goods == undefined) {
        log(`Не удалось запустить автовыдачу, т.к. товары не были загружены.`, 'r');
        return false;
    }

    log(`Автовыдача запущена, загружено ${c.yellowBright(goods.length)} товара(ов).`, 'g');
}

async function checkForNewOrders() {
    try {
        let orders = [];

        log(`Проверяем на наличие новых заказов...`, 'c');
        orders = await getNewOrders(backupOrders);

        if(!orders || orders.newOrders.length == 0) {
            log(`Новых заказов нет.`, 'c');
            return;
        }

        for(let i = 0; i < orders.newOrders.length; i++) {
            const order = orders.newOrders[i];

            if(!order) {
                log('!order', 'c');
                return;
            }

            if(global.telegramBot && settings.newOrderNotification) {
                global.telegramBot.sendNewOrderNotification(order);
            }

            
            

            log(`Новый заказ ${c.yellowBright(order.id)} от покупателя ${c.yellowBright(order.buyerName)} на сумму ${c.yellowBright(order.price)} ₽.`);

            
            
            
            
            
            

            if (order.name.includes(global.settings.bot.orderName)) {
                if (!Order.isNull()) {
                    const queued = new Order(order.id, order.buyerName, order.buyerId, order.count, order.name);
                    const pos = Order.addWaiting(queued);
                    await sendMessage(order.buyerId, `Бот занят. Ваш заказ помещён в очередь. Ваша позиция #${pos}.`, true);
                    await Order.notifyQueue();
                } else {
                    const orderClazz = new Order(order.id, order.buyerName, order.buyerId, order.count, order.name);
                    Order.setCurrent(orderClazz);
                    log(`Успешно установил ${order.id} в нынешний заказ!`);
                    await sendMessage(order.buyerId, '👉 Ваша очередь подошла! Выполняю заказ.', true);
                    await issueGood(order.buyerId, order.buyerName, order.name, 'id', order.id);

                    orderClazz.timeoutId = setTimeout(async () => {
                        if (Order.isCurrent(orderClazz)) {
                            Order.clearTimeoutSafe(orderClazz);
                            clearTimeout(orderClazz.timeoutId);
                            orderClazz.timeoutId = null;
                            if (global.bot?.withdrawed) {                
global.bot.withdrawed = false;
                                global.bot.mustGive = 0;
                            }
                            await sendMessage(orderClazz.buyerId, '⌛ Вы не успели завершить покупку за 2 мин. Вас переместили в конец очереди.', true);
                            orderClazz.promptSent = false;
                            const pos = Order.addWaiting(orderClazz);
                            await sendMessage(orderClazz.buyerId, `Ваша новая позиция в очереди: ${pos}`, true);
                            Order.setCurrent(null);
                            await Order.notifyQueue();
                            if (global.processQueue) await global.processQueue();
                        }
                    }, 120000);
                }

                 continue;
            }

            for(let i = 0; i < order.count; i++) {
                await issueGood(order.buyerId, order.buyerName, order.name, 'id', order.id);
            }
        }
        
        backupOrders = clone(orders.backupOrders);
    } catch (err) {
        log(`Ошибка при автовыдаче: ${err}`, 'r');
    }
}
async function updateQueuePositions() {
    await Order.notifyQueue();
}
global.processQueue = async function () {
    if (!Order.isNull()) return;
    const next = Order.nextWaiting();
    if (!next) return;

    Order.setCurrent(next);
    await sendMessage(next.buyerId, '👉 Ваша очередь подошла! Выполняю заказ.', true);
    await issueGood(next.buyerId, next.username, next.goodName, 'id', next.id);

    await updateQueuePositions();

    next.timeoutId = setTimeout(async () => {
        if (Order.isCurrent(next)) {
            Order.clearTimeoutSafe(next);
            clearTimeout(next.timeoutId)
            next.timeoutId = null;
            if (global.bot?.withdrawed) {                
global.bot.withdrawed = false;
                global.bot.mustGive = 0;
            }
            await sendMessage(next.buyerId, '⌛ Вы не успели завершить покупку за 2 мин. Вас переместили в конец очереди.', true);
            next.promptSent = false;
            const pos = Order.addWaiting(next);
            await sendMessage(next.buyerId, `Ваша новая позиция в очереди: ${pos}`, true);
            Order.setCurrent(null);
            await Order.notifyQueue();
            await global.processQueue();
        }
    }, 120000);
    Order.getCurrent().timeoutId = next.timeoutId;
}
export async function markOrderDone(orderObj) {
    if (!orderObj) return;
    orderObj.done = true;
    Order.clearTimeoutSafe(orderObj);
}
async function issueGood(buyerIdOrNode, buyerName, goodName, type = 'id', orderId) {
    let result = false;

    try {
        goods = await load(goodsfilePath);
        let message = "";
        
        for(let i = 0; i < goods.length; i++) {
            if(goodName.includes(goods[i].name)) {
                if(goods[i].message != undefined) {
                    message = goods[i].message;
                    break;
                } 
                else
                if(goods[i].nodes != undefined) {
                    let notInStock = true;

                    for(let j = 0; j < goods[i].nodes.length; j++) {
                        const node = goods[i].nodes[j];
    
                        goods[i].nodes.shift();
                        await updateFile(goods, goodsfilePath);
                        message = node;
                        notInStock = false;
                        break;
                    }

                    if(notInStock) {
                        log(`Похоже, товар "${goodName}" закончился, выдавать нечего.`);
                        return 'notInStock';
                    }
                }
            }
        }

        if(message != "") {
            let node = buyerIdOrNode;
            let customNode = false;

            if(type == 'id') {
                customNode = true;
            }
            
            
            
            try {
                if (typeof Order !== 'undefined') {
                    const cur = (Order.getCurrent && Order.getCurrent()) || null;
                    if (type !== 'node' && cur && (cur.id == orderId) && cur.promptSent) {
                        log(`Пропускаю повторную отправку первичного сообщения для заказа #${orderId}.`, 'y');
                        return false;
                    }
                    if (cur && (cur.id == orderId) && !cur.promptSent) {
                        cur.promptSent = true;
                    }
                }
            } catch {}
            result = await sendMessage(node, message, customNode);
            
            if(result) {
                log(`Товар "${c.yellowBright(goodName)}" выдан покупателю ${c.yellowBright(buyerName)} с сообщением:`);
                log(message);

                if(global.telegramBot && settings.deliveryNotification) {
                    await global.telegramBot.sendDeliveryNotification(buyerName, goodName, message, orderId);
                }

            } else {
                log(`Не удалось отправить товар "${goodName}" покупателю ${buyerName}.`, 'r');
            }
        } else {
            log(`Товара "${c.yellowBright(goodName)}" нет в списке автовыдачи, пропускаю.`, 'y');
        }
    } catch (err) {
        log(`Ошибка при выдаче товара: ${err}`, 'r');
    }

    return result;
}

async function getGood(orderName) {
    let result = false;
    try {
        goods = await load(goodsfilePath);
    
        for(let i = 0; i < goods.length; i++) {
            if(orderName == goods[i].name) {
                result = goods[i];
                break;
            }
        }
    } catch (err) {
        log(`Ошибка при поиске заказов по нику: ${err}`, 'r');
    }

    return result;
}

async function addDeliveredName(orderName, name, orderId) {
    try {
        goods = await load(goodsfilePath);
        
        for(let i = 0; i < goods.length; i++) {
            if(orderName === goods[i].name) {
                if(goods[i].delivered == undefined) {
                    goods[i].delivered = [];
                }

                goods[i].delivered.push({
                    name: name, order: orderId
                });
                await updateFile(goods, goodsfilePath);
                break;
            }
        }
    } catch (err) {
        log(`Ошибка при записи новых ников к заказу: ${err}`, 'r');
    }
}

async function searchOrdersByUserName(userName) {
    let result = [];
    try {
        goods = await load(goodsfilePath);
    
        const orders = await getOrders();
    
        for(let i = 0; i < orders.length; i++) {
            if (orders[i].buyerName == userName) {
                result[result.length] = orders[i];
            }
        }
    } catch (err) {
        log(`Ошибка при поиске заказов по нику: ${err}`, 'r');
    }

    return result;
}

async function getNewOrders(lastOrders) {
    if(!lastOrders || !lastOrders[0]) {
        log(`Начальные данные по заказам не переданы`);
        return;
    }

    let result = [];
    let orders = [];

    try {
        orders = await getOrders();
        if(!orders || !orders[0]) {
            log(`Ошибка получения новых заказов: список заказов пуст.`, 'r');
            return;
        }

        for(let i = 0; i < orders.length; i++) {
            if(result.length >= 3) break;
            let contains = false;

            for(let j = 0; j < lastOrders.length; j++) {
                if(orders[i].id == lastOrders[j].id) {
                    contains = true;
                    break;
                }
            }

            if(contains == false) {
                result.push(Object.assign(orders[i]));
            }
        }
    } catch(err) {
        log(`Ошибка при получении новых заказов: ${err}`, 'r');
    }

    return {newOrders: result, backupOrders: orders};
}

async function getOrders() {
    let result = [];
    try {
        const url = `${getConst('api')}/orders/trade`;
        const headers = {
            "cookie": `golden_key=${settings.golden_key}`,
            "x-requested-with": "XMLHttpRequest"
        };

        const options = {
            method: 'POST',
            headers: headers
        }

        let resp = await fetch(url, options);
        
        const data = await resp.text();
        const doc = parseDOM(data);
        const ordersEl = doc.querySelectorAll(".tc-item");

        for(let i = 0; i < ordersEl.length; i++) {
            const order = ordersEl[i];
            const id = order.querySelector(".tc-order").innerHTML;
            const name = order.querySelector(".order-desc").querySelector('div').innerHTML;
            const buyerName = order.querySelector(".media-user-name > span").innerHTML;
            const buyerProfileLink = order.querySelector(".avatar-photo").getAttribute("data-href").split("/");
            const buyerId = buyerProfileLink[buyerProfileLink.length - 2];
            const status = order.querySelector(".tc-status").innerHTML;
            const price = Number(order.querySelector(".tc-price").firstChild.textContent);
            const unit = order.querySelector(".tc-price").querySelector("span").innerHTML;

            const sections = name.split(',');
            let count = 1;
            
            if(sections.length > 1) {
                const section = sections[sections.length - 1];
                if(section.includes('шт.')) {
                    count = Number(section.split('шт.')[0]);

                    if(!count || isNaN(count)) {
                        count = 1;
                    }
                }
            }

            result.push({
                id: id,
                name: name,
                buyerId: buyerId,
                buyerName: buyerName,
                status: status,
                price: price,
                unit: unit,
                count: count
            });
        }

        return result;
    } catch (err) {
        log(`Ошибка при получении списка продаж: ${err}`, 'r');
    }
    return result;
}

async function getLotNames() {
    let result = [];
    try {
        const url = `${getConst('api')}/users/${global.appData.id}/`;
        const headers = {
            "cookie": `golden_key=${settings.golden_key}`
        };

        const options = {
            method: 'GET',
            headers: headers
        };

        let resp = await fetch(url, options);
        const data = await resp.text();
        const doc = parseDOM(data);
        const lotNamesEl = doc.querySelectorAll(".tc-desc-text");

        for(let i = 0; i < lotNamesEl.length; i++) {
            result.push(lotNamesEl[i].innerHTML);
        }

        return result;
    } catch (err) {
        log(`Ошибка при получении списка лотов: ${err}`, 'r');
    }
}

export { getOrders, getNewOrders, issueGood, getLotNames, searchOrdersByUserName, checkForNewOrders, getGood, addDeliveredName, enableAutoIssue };
