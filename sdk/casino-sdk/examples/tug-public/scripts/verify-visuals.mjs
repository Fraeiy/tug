// Presentation-only browser checks against a local demo. No application hooks.
// Usage: node scripts/verify-visuals.mjs <Chrome CDP port>
import { mkdir, writeFile } from "node:fs/promises";
const port = process.argv[2];
const targets = await (
  await fetch("http://127.0.0.1:" + port + "/json/list")
).json();
const target = targets.find(
  (t) => t.type === "page" && t.url.includes("127.0.0.1:3200"),
);
if (!target)
  throw new Error("Open local Tug in the verification browser first.");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve) =>
  socket.addEventListener("open", resolve, { once: true }),
);
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
    msg.error
      ? reject(new Error(JSON.stringify(msg.error)))
      : resolve(msg.result);
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
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const tap = async (selector) => {
  const rect = await evaluate(
    `(()=>{const e=document.querySelector('${selector}');if(!e)throw new Error('Missing ${selector}');e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,
  );
  await send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [rect],
  });
  await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
};
const output = new URL("../visual-review/", import.meta.url);
await mkdir(output, { recursive: true });
const screenshot = async (name) => {
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(new URL(name + ".png", output), Buffer.from(data, "base64"));
};
const report = [];
await send("Runtime.enable");
await send("Emulation.setTouchEmulationEnabled", {
  enabled: true,
  maxTouchPoints: 1,
});
async function inspect(name) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const visible = await evaluate(
      "(()=>{const e=document.getElementById('chain-jam-badge');if(!e)return false;const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.top>=0&&r.bottom<=innerHeight})()",
    );
    if (visible) break;
    await wait(100);
  }
  const result = await evaluate(`(()=>{
    const r=e=>e.getBoundingClientRect();
    const badge=document.getElementById('chain-jam-badge');
    const b=r(badge);
    const controls=[...document.querySelectorAll('.decision button,.decision input')];
    const deck=document.querySelector('.console');
    return {
      viewport:[innerWidth,innerHeight],touch:navigator.maxTouchPoints,
      horizontalOverflow:document.documentElement.scrollWidth>innerWidth,
      pageOverflow:document.documentElement.scrollHeight>innerHeight,
      deckScroll:deck.scrollHeight>deck.clientHeight+1,
      controlsVisible:controls.every(e=>r(e).top>=0&&r(e).bottom<=innerHeight+1),
      minTarget:controls.length?Math.min(...controls.map(e=>r(e).height)):null,
      widgetVisible:b.top>=0&&b.bottom<=innerHeight&&b.width>0,
      widgetRect:[b.left,b.top,b.width,b.height],
      dockRect:(()=>{const d=r(document.querySelector('.jam-dock'));return [d.left,d.top,d.width,d.height]})(),
      widgetOverlap:[...controls,...document.querySelectorAll('.stage-readout,.rule')].some(e=>{const a=r(e);return a.width>0&&a.height>0&&a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top}),
      state:document.querySelector('.stage').className,
      fonts:[document.fonts.check('16px Inter'),document.fonts.check('16px "Instrument Serif"')]
    };
  })()`);
  report.push({ name, ...result });
  if (
    result.horizontalOverflow ||
    result.pageOverflow ||
    (!result.controlsVisible && !result.deckScroll) ||
    result.widgetOverlap ||
    !result.widgetVisible ||
    (result.minTarget && result.minTarget < 44)
  ) {
    await screenshot(name + "-failure");
    throw new Error(name + ": " + JSON.stringify(result));
  }
}
try {
  for (const [w, h] of [
    [1920, 1080],
    [1366, 768],
    [768, 900],
    [390, 844],
    [393, 852],
    [375, 667],
    [430, 932],
    [375, 560],
    [667, 375],
  ]) {
    await send("Emulation.setDeviceMetricsOverride", {
      width: w,
      height: h,
      deviceScaleFactor: 1,
      mobile: w < 760,
    });
    await send("Page.navigate", { url: "http://127.0.0.1:3200/?demo=1" });
    for (let i = 0; i < 80; i++) {
      if (
        await evaluate(
          "!!document.querySelector('.decision .primary') && !!document.querySelector('.jam-dock #chain-jam-badge')",
        )
      )
        break;
      await wait(100);
    }
    await evaluate("document.fonts.ready");
    await wait(450); // Let the presentation-only entrance settle for layout checks.
    const prefix = w + "x" + h;
    await inspect(prefix + "-idle");
    await screenshot(prefix + "-idle");
    // Deterministic demo-only RNG, injected into this browser, never shipped.
    await evaluate("crypto.getRandomValues=a=>{a.fill(0);return a}");
    await tap(".decision .primary");
    await wait(180);
    await inspect(prefix + "-active");
    await screenshot(prefix + "-active");
    for (const grip of ["ease", "steady", "haul"]) {
      await tap(".intensity-" + grip);
      if (grip === "ease") {
        await wait(100);
        await inspect(prefix + "-pending");
        await screenshot(prefix + "-pending");
      }
      await wait(650);
      await inspect(prefix + "-" + grip + "-survived");
    }
    await screenshot(prefix + "-survived");
    await tap(".bank-full");
    await wait(150);
    await inspect(prefix + "-banked");
    await screenshot(prefix + "-banked");
    await tap(".decision .primary");
    await wait(800);
    await tap(".decision .primary");
    await wait(800);
    for (let attempt = 0; attempt < 20; attempt++) {
      if (await evaluate("!!document.querySelector('.intensity-ease')")) break;
      await wait(100);
    }
    if (!(await evaluate("!!document.querySelector('.intensity-ease')"))) {
      await screenshot(prefix + "-restart-failure");
      throw new Error(
        prefix +
          " restart did not reach grip selection: " +
          (await evaluate("document.body.innerText")),
      );
    }
    await evaluate(
      "crypto.getRandomValues=a=>{a.fill(0);a[0]=18;return a}",
    );
    await tap(".intensity-ease");
    await wait(500);
    await inspect(prefix + "-snapping");
    await screenshot(prefix + "-snapping");
    await wait(900);
    await inspect(prefix + "-lost");
    await screenshot(prefix + "-lost");
    console.log(prefix + " states passed");
  }
  await send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  await evaluate("document.documentElement.style.webkitTextSizeAdjust='120%'");
  await inspect("short-text-120-reduced-motion");
  await screenshot("short-text-120-reduced-motion");
  if (errors.length) throw new Error(errors.join("\n"));
} finally {
  await writeFile(
    new URL("report.json", output),
    JSON.stringify({ report, errors }, null, 2),
  );
  socket.close();
}
