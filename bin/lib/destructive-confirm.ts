import { createInterface } from "readline/promises";

export async function confirmDestructiveAction(
  message: string,
  yes: boolean,
): Promise<boolean> {
  if (yes) return true;
  if (!process.stdin.isTTY) {
    throw new Error("destructive action requires --yes in non-interactive mode");
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const ans = await rl.question(`${message} [y/N] `);
    return ans.trim().toLowerCase().startsWith("y");
  } finally {
    rl.close();
  }
}
