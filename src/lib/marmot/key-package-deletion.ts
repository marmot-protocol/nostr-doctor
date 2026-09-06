import { setDeleteEvents } from "applesauce-core/operations/delete";
import { factory } from "../factory.ts";

/** Exact event ids only; an address deletion can remove a valid replacement. */
export function buildKeyPackageDeletion(ids: string[]) {
  return factory.build({ kind: 5 }, setDeleteEvents(ids));
}
