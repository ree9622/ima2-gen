const orig = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  info: console.info.bind(console),
};

const ts = () => new Date().toISOString();

console.log = (...args) => orig.log(ts(), ...args);
console.warn = (...args) => orig.warn(ts(), ...args);
console.error = (...args) => orig.error(ts(), ...args);
console.info = (...args) => orig.info(ts(), ...args);
