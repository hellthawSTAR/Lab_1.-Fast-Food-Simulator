"use strict";

const $ = (id) => document.getElementById(id);

const els = {
  arrival: $("arrivalInput"),
  cookTime: $("cookInput"),
  cashiers: $("cashierInput"),
  cooks: $("cookersInput"),
  servers: $("serversInput"),
  start: $("startBtn"),
  stop: $("stopBtn"),
  reset: $("resetBtn"),
  warning: $("warning"),
  state: $("simulationState"),
  stateDot: $("stateDot"),
  totalStaff: $("totalStaff"),
  lineCount: $("lineCount"),
  lineList: $("lineList"),
  orderAreaList: $("orderAreaList"),
  cookingList: $("cookingList"),
  kitchenQueueList: $("kitchenQueueList"),
  pickupList: $("pickupList"),
  servingList: $("servingList"),
  diningCount: $("diningCount"),
  diningList: $("diningList"),
  staffGrid: $("staffGrid"),
  ordersTable: $("ordersTable"),
  ordersTotal: $("ordersTotal"),
  eventLog: $("eventLog"),
  clearLog: $("clearLogBtn"),
  statArrived: $("statArrived"),
  statCompleted: $("statCompleted"),
  statLine: $("statLine"),
  statKitchen: $("statKitchen"),
  statPickup: $("statPickup"),
  statDining: $("statDining"),
  statTime: $("statTime")
};

const ROLE = {
  cashier: { label: "Кассир", icon: "🧾", description: "Приём заказа" },
  cook: { label: "Повар", icon: "👨‍🍳", description: "Приготовление" },
  server: { label: "Сотрудник выдачи", icon: "🥡", description: "Выдача заказа" }
};

const STATUS = {
  waitingOrder: "Ожидает кассира",
  taking: "Заказ оформляется",
  kitchen: "Ожидает приготовления",
  cooking: "Готовится",
  pickup: "Ожидает выдачи",
  serving: "Выдаётся клиенту",
  dining: "В зале",
  completed: "Завершён"
};

let running = false;
let arrivalTimer = null;
let uiTimer = null;
let startTimestamp = 0;
let elapsedBeforeStart = 0;
let customerId = 0;
let orderId = 0;
let staffId = 0;
let customers = [];
let orders = [];
let staff = [];
let customerLine = [];
let kitchenQueue = [];
let pickupQueue = [];
let diningCustomers = [];
let eventEntries = [];
let sessionToken = 0;
let config = null;

function readConfig() {
  return {
    arrivalMs: Number(els.arrival.value) * 1000,
    cookMs: Number(els.cookTime.value) * 1000,
    cashiers: Number(els.cashiers.value),
    cooks: Number(els.cooks.value),
    servers: Number(els.servers.value)
  };
}

function validateConfig() {
  const c = readConfig();
  const checks = [
    [Number.isFinite(c.arrivalMs) && c.arrivalMs >= 200 && c.arrivalMs <= 3600000, "Интервал прихода клиентов должен быть от 0,2 до 3600 секунд."],
    [Number.isFinite(c.cookMs) && c.cookMs >= 200 && c.cookMs <= 3600000, "Время приготовления должно быть от 0,2 до 3600 секунд."],
    [Number.isInteger(c.cashiers) && c.cashiers >= 1 && c.cashiers <= 10, "Количество кассиров должно быть целым числом от 1 до 10."],
    [Number.isInteger(c.cooks) && c.cooks >= 1 && c.cooks <= 10, "Количество поваров должно быть целым числом от 1 до 10."],
    [Number.isInteger(c.servers) && c.servers >= 1 && c.servers <= 10, "Количество сотрудников выдачи должно быть целым числом от 1 до 10."]
  ];
  for (const [ok, message] of checks) {
    if (!ok) {
      els.warning.textContent = message;
      return null;
    }
  }
  els.warning.textContent = "";
  return c;
}

function nowSeconds() {
  if (!startTimestamp) return elapsedBeforeStart / 1000;
  return (elapsedBeforeStart + (running ? Date.now() - startTimestamp : 0)) / 1000;
}

function formatDuration(seconds) {
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function timeLabel() {
  return formatDuration(nowSeconds());
}

function logEvent(message) {
  eventEntries.unshift({ time: timeLabel(), message });
  if (eventEntries.length > 150) eventEntries.length = 150;
  renderLog();
}

function renderLog() {
  if (!eventEntries.length) {
    els.eventLog.innerHTML = '<li class="log-empty">События появятся после запуска.</li>';
    return;
  }
  els.eventLog.innerHTML = eventEntries.map(entry =>
    `<li><span class="log-time">${entry.time}</span><span class="log-message">${escapeHtml(entry.message)}</span></li>`
  ).join("");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
}

function makeStaff(role, count) {
  const result = [];
  for (let i = 0; i < count; i++) {
    staffId++;
    result.push({
      id: staffId,
      name: `${ROLE[role].label} ${i + 1}`,
      role,
      busy: false,
      task: null,
      completedTasks: 0
    });
  }
  return result;
}

function buildStaff() {
  staffId = 0;
  staff = [
    ...makeStaff("cashier", config.cashiers),
    ...makeStaff("cook", config.cooks),
    ...makeStaff("server", config.servers)
  ];
}

function getFreeStaff(role) {
  return staff.find(person => person.role === role && !person.busy);
}

function getCustomer(id) {
  return customers.find(customer => customer.id === id);
}

function getOrder(id) {
  return orders.find(order => order.id === id);
}

function setCustomerStatus(customer, status) {
  customer.status = status;
}

function createCustomer() {
  customerId++;
  const customer = {
    id: customerId,
    name: `Клиент ${customerId}`,
    status: STATUS.waitingOrder,
    orderId: null,
    arrivedAt: nowSeconds()
  };
  customers.push(customer);
  customerLine.push(customer.id);
  logEvent(`${customer.name} пришёл и встал в очередь на заказ.`);
  render();
  dispatchCashier();
}

function createOrderFor(customer) {
  orderId++;
  const order = {
    id: orderId,
    customerId: customer.id,
    status: STATUS.taking,
    cashierId: null,
    cookId: null,
    serverId: null,
    createdAt: nowSeconds(),
    completedAt: null
  };
  orders.push(order);
  customer.orderId = order.id;
  customer.status = STATUS.taking;
  return order;
}

function dispatchCashier() {
  if (!running) return;
  // Назначаем задачи по FIFO: только свободному кассиру.
  while (customerLine.length > 0) {
    const cashier = getFreeStaff("cashier");
    if (!cashier) break;
    const customer = getCustomer(customerLine.shift());
    if (!customer || customer.status !== STATUS.waitingOrder) continue;
    const order = createOrderFor(customer);
    cashier.busy = true;
    cashier.task = { type: "taking", orderId: order.id };
    order.cashierId = cashier.id;
    logEvent(`${cashier.name} принимает заказ №${order.id} у ${customer.name}.`);
    render();
    completeAfter(900, () => {
      cashier.busy = false;
      cashier.task = null;
      cashier.completedTasks++;
      order.status = STATUS.kitchen;
      customer.status = STATUS.kitchen;
      kitchenQueue.push(order.id);
      logEvent(`${cashier.name} оформил заказ №${order.id}; заказ передан в очередь кухни.`);
      render();
      dispatchCashier();
      dispatchCooks();
    });
  }
}

function dispatchCooks() {
  if (!running) return;
  // Каждый повар берёт не более одного заказа. Другие заказы ждут в FIFO.
  while (kitchenQueue.length > 0) {
    const cook = getFreeStaff("cook");
    if (!cook) break;
    const order = getOrder(kitchenQueue.shift());
    if (!order || order.status !== STATUS.kitchen) continue;
    cook.busy = true;
    cook.task = { type: "cooking", orderId: order.id };
    cook.completedTasks = cook.completedTasks || 0;
    order.cookId = cook.id;
    order.status = STATUS.cooking;
    const customer = getCustomer(order.customerId);
    if (customer) customer.status = STATUS.cooking;
    logEvent(`${cook.name} начал готовить заказ №${order.id}.`);
    render();
    completeAfter(config.cookMs, () => {
      cook.busy = false;
      cook.task = null;
      cook.completedTasks++;
      order.status = STATUS.pickup;
      if (customer) customer.status = STATUS.pickup;
      pickupQueue.push(order.id);
      logEvent(`${cook.name} закончил заказ №${order.id}; заказ ожидает выдачи.`);
      render();
      dispatchCooks();
      dispatchServers();
    });
  }
}

function dispatchServers() {
  if (!running) return;
  while (pickupQueue.length > 0) {
    const server = getFreeStaff("server");
    if (!server) break;
    const order = getOrder(pickupQueue.shift());
    if (!order || order.status !== STATUS.pickup) continue;
    server.busy = true;
    server.task = { type: "serving", orderId: order.id };
    order.serverId = server.id;
    order.status = STATUS.serving;
    const customer = getCustomer(order.customerId);
    if (customer) customer.status = STATUS.serving;
    logEvent(`${server.name} выдаёт заказ №${order.id} клиенту ${customer ? customer.name : ""}.`);
    render();
    completeAfter(700, () => {
      server.busy = false;
      server.task = null;
      server.completedTasks++;
      order.status = STATUS.completed;
      order.completedAt = nowSeconds();
      if (customer) {
        customer.status = STATUS.dining;
        diningCustomers.push(customer.id);
      }
      logEvent(`${customer ? customer.name : "Клиент"} получил заказ №${order.id} и прошёл в зал.`);
      render();
      dispatchServers();
    });
  }
}

function completeAfter(ms, callback) {
  const token = sessionToken;
  window.setTimeout(() => {
    if (!running || token !== sessionToken) return;
    callback();
  }, ms);
}

function renderEntityList(element, entries, emptyText, renderer) {
  if (!entries.length) {
    element.classList.add("empty-state");
    element.innerHTML = escapeHtml(emptyText);
    return;
  }
  element.classList.remove("empty-state");
  element.innerHTML = entries.map(renderer).join("");
}

function statusClass(status) {
  if ([STATUS.completed, STATUS.dining].includes(status)) return "done";
  if ([STATUS.taking, STATUS.cooking, STATUS.serving].includes(status)) return "busy";
  if ([STATUS.waitingOrder, STATUS.kitchen, STATUS.pickup].includes(status)) return "waiting";
  return "neutral";
}

function entityCard(title, status, detail = "") {
  return `<div class="entity"><div class="entity-top"><span class="entity-title">${escapeHtml(title)}</span><span class="status ${statusClass(status)}">${escapeHtml(status)}</span></div>${detail ? `<div class="entity-detail">${escapeHtml(detail)}</div>` : ""}</div>`;
}

function renderCustomersAndZones() {
  const waitingCustomers = customerLine.map(getCustomer).filter(Boolean);
  els.lineCount.textContent = waitingCustomers.length;
  renderEntityList(els.lineList, waitingCustomers, "Очередь пуста", customer =>
    entityCard(customer.name, customer.status, `Пришёл в ${formatDuration(customer.arrivedAt)}`)
  );

  const takingOrders = orders.filter(order => order.status === STATUS.taking);
  renderEntityList(els.orderAreaList, takingOrders, "Нет активных заказов", order => {
    const customer = getCustomer(order.customerId);
    const cashier = staff.find(person => person.id === order.cashierId);
    return entityCard(`Заказ №${order.id}`, order.status, `${customer ? customer.name : "Клиент"} · ${cashier ? cashier.name : "кассир"}`);
  });

  const cookingOrders = orders.filter(order => order.status === STATUS.cooking);
  renderEntityList(els.cookingList, cookingOrders, "Никто не готовит", order => {
    const cook = staff.find(person => person.id === order.cookId);
    const customer = getCustomer(order.customerId);
    return entityCard(`Заказ №${order.id}`, order.status, `${cook ? cook.name : "Повар"} · ${customer ? customer.name : ""}`);
  });

  const waitingKitchen = kitchenQueue.map(getOrder).filter(Boolean);
  renderEntityList(els.kitchenQueueList, waitingKitchen, "Очередь пуста", order => {
    const customer = getCustomer(order.customerId);
    return entityCard(`Заказ №${order.id}`, order.status, customer ? customer.name : "");
  });

  const readyOrders = pickupQueue.map(getOrder).filter(Boolean);
  renderEntityList(els.pickupList, readyOrders, "Нет готовых заказов", order => {
    const customer = getCustomer(order.customerId);
    return entityCard(`Заказ №${order.id}`, order.status, customer ? customer.name : "");
  });

  const servingOrders = orders.filter(order => order.status === STATUS.serving);
  renderEntityList(els.servingList, servingOrders, "Нет активной выдачи", order => {
    const server = staff.find(person => person.id === order.serverId);
    const customer = getCustomer(order.customerId);
    return entityCard(`Заказ №${order.id}`, order.status, `${server ? server.name : "Сотрудник выдачи"} · ${customer ? customer.name : ""}`);
  });

  const dining = diningCustomers.map(getCustomer).filter(Boolean);
  els.diningCount.textContent = dining.length;
  renderEntityList(els.diningList, dining, "Пока никого нет", customer =>
    entityCard(customer.name, customer.status, customer.orderId ? `Заказ №${customer.orderId}` : "")
  );
}

function taskDescription(person) {
  if (!person.task) return "Нет активной задачи";
  const order = getOrder(person.task.orderId);
  if (!order) return "Нет активной задачи";
  if (person.task.type === "taking") return `Оформляет заказ №${order.id}`;
  if (person.task.type === "cooking") return `Готовит заказ №${order.id}`;
  if (person.task.type === "serving") return `Выдаёт заказ №${order.id}`;
  return "Нет активной задачи";
}

function renderStaff() {
  els.totalStaff.textContent = staff.length;
  els.staffGrid.innerHTML = staff.map(person => {
    const busy = person.busy;
    return `<article class="staff-card ${busy ? "is-busy" : "is-free"}">
      <div class="staff-top">
        <span class="staff-avatar">${ROLE[person.role].icon}</span>
        <div><div class="staff-name">${escapeHtml(person.name)}</div><div class="staff-role">${ROLE[person.role].description}</div></div>
      </div>
      <div class="staff-status"><span class="legend-dot ${busy ? "busy" : "free"}"></span>${busy ? "Занят" : "Свободен"}</div>
      <div class="staff-task">${escapeHtml(taskDescription(person))}</div>
      <div class="entity-detail" style="margin-top:8px">Выполнено задач: ${person.completedTasks}</div>
    </article>`;
  }).join("");
}

function renderOrdersTable() {
  const sorted = [...orders].sort((a, b) => b.id - a.id);
  els.ordersTotal.textContent = `${orders.length} ${pluralOrders(orders.length)}`;
  if (!sorted.length) {
    els.ordersTable.innerHTML = '<tr><td colspan="5" class="table-empty">Заказов пока нет</td></tr>';
    return;
  }
  els.ordersTable.innerHTML = sorted.map(order => {
    const customer = getCustomer(order.customerId);
    const staffIds = [order.cashierId, order.cookId, order.serverId].filter(Boolean);
    const names = staffIds.map(id => staff.find(person => person.id === id)?.name).filter(Boolean).join(" → ");
    return `<tr>
      <td><strong>№${order.id}</strong></td>
      <td>${escapeHtml(customer ? customer.name : "—")}</td>
      <td><span class="status ${statusClass(order.status)}">${escapeHtml(order.status)}</span></td>
      <td>${escapeHtml(names || "—")}</td>
      <td>${formatDuration(order.createdAt)}</td>
    </tr>`;
  }).join("");
}

function pluralOrders(count) {
  const n = count % 100;
  if (n >= 11 && n <= 14) return "заказов";
  switch (count % 10) {
    case 1: return "заказ";
    case 2: case 3: case 4: return "заказа";
    default: return "заказов";
  }
}

function renderStats() {
  els.statArrived.textContent = customers.length;
  els.statCompleted.textContent = orders.filter(order => order.status === STATUS.completed).length;
  els.statLine.textContent = customerLine.length;
  els.statKitchen.textContent = kitchenQueue.length;
  els.statPickup.textContent = pickupQueue.length;
  els.statDining.textContent = diningCustomers.length;
  els.statTime.textContent = timeLabel();
}

function render() {
  renderCustomersAndZones();
  renderStaff();
  renderOrdersTable();
  renderStats();
}

function setRunningState(value) {
  running = value;
  els.start.disabled = value;
  els.stop.disabled = !value;
  els.state.textContent = value ? "Работает" : "Остановлена";
  els.stateDot.classList.toggle("running", value);
  els.arrival.disabled = value;
  els.cookTime.disabled = value;
  els.cashiers.disabled = value;
  els.cooks.disabled = value;
  els.servers.disabled = value;
}

function startSimulation() {
  if (running) return;
  const validConfig = validateConfig();
  if (!validConfig) return;

  config = validConfig;
  sessionToken++;
  customers = [];
  orders = [];
  customerLine = [];
  kitchenQueue = [];
  pickupQueue = [];
  diningCustomers = [];
  eventEntries = [];
  customerId = 0;
  orderId = 0;
  elapsedBeforeStart = 0;
  startTimestamp = Date.now();
  buildStaff();
  setRunningState(true);
  logEvent(`Симуляция запущена. Персонал: ${config.cashiers} кассир(а), ${config.cooks} повар(а), ${config.servers} сотрудник(а) выдачи.`);
  logEvent(`Клиенты приходят каждые ${config.arrivalMs / 1000} сек.; приготовление занимает ${config.cookMs / 1000} сек.`);
  render();
  // Первый клиент появляется через заданный интервал.
  arrivalTimer = window.setInterval(createCustomer, config.arrivalMs);
  uiTimer = window.setInterval(renderStats, 250);
}

function stopSimulation() {
  if (!running) return;
  elapsedBeforeStart += Date.now() - startTimestamp;
  startTimestamp = 0;
  running = false;
  sessionToken++; // аннулирует все незавершённые операции текущего запуска
  window.clearInterval(arrivalTimer);
  window.clearInterval(uiTimer);
  arrivalTimer = null;
  uiTimer = null;
  setRunningState(false);
  logEvent("Симуляция остановлена. Незавершённые операции приостановлены и не завершатся в фоне.");
  render();
}

function resetSimulation() {
  stopSimulation();
  sessionToken++;
  customers = [];
  orders = [];
  staff = [];
  customerLine = [];
  kitchenQueue = [];
  pickupQueue = [];
  diningCustomers = [];
  eventEntries = [];
  customerId = 0;
  orderId = 0;
  staffId = 0;
  startTimestamp = 0;
  elapsedBeforeStart = 0;
  config = null;
  buildStaffFromInputs();
  els.warning.textContent = "";
  renderLog();
  render();
}

function buildStaffFromInputs() {
  const c = validateConfig();
  if (!c) {
    config = { cashiers: 1, cooks: 2, servers: 1 };
    buildStaff();
    els.totalStaff.textContent = staff.length;
    return;
  }
  config = c;
  buildStaff();
}

els.start.addEventListener("click", startSimulation);
els.stop.addEventListener("click", stopSimulation);
els.reset.addEventListener("click", resetSimulation);
els.clearLog.addEventListener("click", () => {
  eventEntries = [];
  renderLog();
});

[els.cashiers, els.cooks, els.servers].forEach(input => {
  input.addEventListener("input", () => {
    const values = [Number(els.cashiers.value), Number(els.cooks.value), Number(els.servers.value)];
    if (values.every(value => Number.isInteger(value) && value >= 1 && value <= 10)) {
      els.totalStaff.textContent = values.reduce((sum, value) => sum + value, 0);
    }
  });
});

buildStaffFromInputs();
render();
setRunningState(false);
