import { mkdir, writeFile } from "node:fs/promises";
const targets = await (
  await fetch("http://127.0.0.1:" + process.argv[2] + "/json/list")
).json();
const target = targets.find(
  (t) => t.type === "page" && t.url.includes("127.0.0.1:3200"),
);
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => socket.addEventListener("open", r, { once: true }));
let id = 0;
const pending = new Map();
const errors = [];
socket.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  if (msg.method === "Runtime.exceptionThrown")
    errors.push(msg.params.exceptionDetails.text);
  if (pending.has(msg.id)) {
    const [resolve, reject] = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(msg.error) : resolve(msg.result);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    pending.set(++id, [resolve, reject]);
    socket.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails)
    throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = async (expression, name) => {
  if (!(await evaluate(expression))) throw new Error(name);
  console.log("PASS " + name);
};
const ready = async () => {
  for (let i = 0; i < 100; i++) {
    if (await evaluate("!!document.querySelector('.help-trigger')")) return;
    await wait(100);
  }
  throw new Error("Page not ready");
};
const key = async (name, modifiers = 0) => {
  await send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: name,
    code: name,
    windowsVirtualKeyCode: name === "Tab" ? 9 : 27,
    modifiers,
  });
  await send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: name,
    code: name,
    windowsVirtualKeyCode: name === "Tab" ? 9 : 27,
    modifiers,
  });
};
const click = async (selector) => {
  const { x, y } = await evaluate(
    `(()=>{const r=document.querySelector('${selector}').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,
  );
  await send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button: "left",
    clickCount: 1,
  });
  await send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button: "left",
    clickCount: 1,
  });
  await wait(100);
};
const out = new URL("../visual-review/", import.meta.url);
await mkdir(out, { recursive: true });
const shot = async (name) => {
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(new URL(name + ".png", out), Buffer.from(data, "base64"));
};
await send("Runtime.enable");
try {
  await ready();
  for (const [width, height] of [
    [1440, 1000],
    [375, 667],
    [390, 844],
    [393, 852],
    [430, 932],
  ]) {
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 760,
    });
    await evaluate("localStorage.removeItem('tug.how-to-play.dismissed.v1')");
    await send("Page.reload");
    await wait(500);
    await ready();
    await wait(500);
    await assert(
      "document.querySelector('dialog').open",
      "first visit " + width,
    );
    await assert(
      "document.querySelector('.help-sequence').textContent.replace(/\\s+/g,' ').trim()==='Pick a grip→Survive the tug→Bank or climb again'",
      "concise visual sequence",
    );
    await assert(
      "document.querySelector('dialog .primary').textContent.trim()==='Start playing'",
      "primary onboarding action",
    );
    await assert(
      "document.activeElement.id==='how-to-play-title'",
      "initial title focus",
    );
    await assert(
      "(()=>{const r=document.querySelector('dialog').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight})()",
      "dialog fits",
    );
    await shot("onboarding-" + width);
    await evaluate("document.querySelector('.help-close').focus()");
    await key("Tab", 8);
    await assert(
      "document.activeElement.matches('dialog .primary')",
      "backward focus trap",
    );
    await key("Tab");
    await assert(
      "document.activeElement.matches('.help-close')",
      "forward focus trap",
    );
    await key("Escape");
    await assert(
      "!document.querySelector('dialog').open && localStorage.getItem('tug.how-to-play.dismissed.v1')==='1'",
      "Escape persists dismissal",
    );
    await assert(
      "document.activeElement.matches('.help-trigger')",
      "focus restored",
    );
    await click(".help-trigger");
    await assert("document.querySelector('dialog').open", "manual reopen");
    await click("dialog .primary");
    await assert("!document.querySelector('dialog').open", "Start playing dismisses");
    await click(".help-trigger");
    await click(".help-close");
    await assert("!document.querySelector('dialog').open", "Close dismisses");
    await send("Page.reload");
    await wait(500);
    await ready();
    await wait(500);
    await assert(
      "!document.querySelector('dialog').open",
      "dismissal survives reload",
    );
    await assert(
      "document.querySelector('.callout').textContent==='Set your wager.'",
      "pre-round prompt",
    );
    await assert("!document.querySelector('.coach')", "old paragraph removed");
    await assert(
      "(()=>{const e=document.querySelector(innerWidth<760?'.mobile-rtp':'.ladder-head span');return e.getBoundingClientRect().height>0&&e.textContent==='95% RTP'})()",
      "RTP visible",
    );
    await assert(
      "document.documentElement.scrollWidth<=innerWidth",
      "no horizontal overflow",
    );
    await shot("onboarding-dismissed-" + width);
    await click(".decision .primary");
    await wait(300);
    await assert(
      "document.querySelector('.callout').textContent==='Choose your grip'",
      "active-round prompt",
    );
    await assert(
      "!!document.querySelector('.intensity-ease')&&!document.querySelector('dialog').open&&document.querySelector('.help-trigger').disabled",
      "onboarding unavailable during active round",
    );
  }
  if (errors.length) throw new Error(errors.join("\n"));
  console.log("All onboarding checks passed; no runtime exceptions.");
} finally {
  socket.close();
}
