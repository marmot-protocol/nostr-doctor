import {
  validatePublicKeyPackage,
  unverifiedPackage,
} from "./key-package-validation.ts";
import type { ValidationRequest } from "./validation-types.ts";

self.onmessage = async (message: MessageEvent<ValidationRequest>) => {
  const { event, pubkey, now } = message.data;
  try {
    self.postMessage(await validatePublicKeyPackage(event, pubkey, now));
  } catch {
    self.postMessage(
      unverifiedPackage(
        "The validator could not finish inspecting this package.",
      ),
    );
  }
};
