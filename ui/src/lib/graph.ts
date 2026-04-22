export type ClientNodeId = string;

export const newClientNodeId = (): ClientNodeId =>
  "nc_" + Math.random().toString(36).slice(2, 10);

export function initialPos(depth: number, idx: number) {
  return { x: depth * 360, y: idx * 320 };
}
