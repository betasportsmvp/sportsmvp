export type Unit = "can" | "tube" | "ball" | "pack";

export const units: Unit[] = ["can", "tube", "ball", "pack"];

/** "1 can", "3 cans", "-2 tubes". */
export function quantityLabel(quantity: number, unit: Unit): string {
  return `${quantity} ${unit}${Math.abs(quantity) === 1 ? "" : "s"}`;
}
