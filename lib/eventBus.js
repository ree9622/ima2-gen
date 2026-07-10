import { EventEmitter } from "node:events";

export const EVENT_RING_SIZE = 2000;
export const MAX_EVENT_STREAMS = 256;

const emitter = new EventEmitter();
emitter.setMaxListeners(MAX_EVENT_STREAMS);

let sequence = 0;
const ring = [];

function stripLargeImages(data) {
  let omitted = false;
  const next = { ...data };
  if (typeof next.image === "string" && next.image.length > 1000) {
    delete next.image;
    omitted = true;
  }
  if (Array.isArray(next.images)) {
    next.images = next.images.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return item;
      if (typeof item.image !== "string" || item.image.length <= 1000) return item;
      const { image: _image, ...rest } = item;
      omitted = true;
      return { ...rest, _imageOmitted: true };
    });
  }
  if (omitted) next._imageOmitted = true;
  return next;
}

export function publishJobEvent(owner, jobId, event, data = {}) {
  if (!jobId) return null;
  const entry = {
    id: ++sequence,
    owner: typeof owner === "string" && owner ? owner : null,
    jobId,
    event,
    data,
  };
  ring.push({ ...entry, data: stripLargeImages(data) });
  if (ring.length > EVENT_RING_SIZE) ring.shift();
  emitter.emit("event", entry);
  return entry.id;
}

export function subscribeJobEvents(listener) {
  emitter.on("event", listener);
  return () => emitter.off("event", listener);
}

export function replayJobEvents(lastEventId, owner = null) {
  return ring.filter((event) =>
    event.id > lastEventId && (!owner || event.owner === owner),
  );
}

export function oldestJobEventId(owner = null) {
  const first = owner ? ring.find((event) => event.owner === owner) : ring[0];
  return first?.id ?? null;
}

export function hasJobEventReplayGap(lastEventId, owner = null) {
  if (!Number.isFinite(lastEventId) || lastEventId <= 0) return false;
  const oldest = oldestJobEventId(owner);
  return oldest !== null && lastEventId < oldest - 1;
}

export function resetJobEventsForTests() {
  sequence = 0;
  ring.length = 0;
  emitter.removeAllListeners();
}
