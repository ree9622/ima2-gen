const orig = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  info: console.info.bind(console),
};

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const ts = () => {
  const kst = new Date(Date.now() + KST_OFFSET_MS);
  return kst.toISOString().replace("Z", "+09:00");
};

console.log = (...args) => orig.log(ts(), ...args);
console.warn = (...args) => orig.warn(ts(), ...args);
console.error = (...args) => orig.error(ts(), ...args);
console.info = (...args) => orig.info(ts(), ...args);
