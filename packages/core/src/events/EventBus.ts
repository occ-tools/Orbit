import { EventEmitter } from "events";
import { OrbitEvent, OrbitEventSchema } from "./EventSchema.js";

export class EventBus extends EventEmitter {
  constructor() {
    super();
  }

  public emitEvent<T extends OrbitEvent["type"]>(
    type: T,
    payload: Extract<OrbitEvent, { type: T }>["payload"],
  ): boolean {
    // Validate structure at runtime
    const validation = OrbitEventSchema.safeParse({ type, payload });
    if (!validation.success) {
      return false;
    }
    if (validation.data.type !== "error" || this.listenerCount("error") > 0) {
      this.emit(validation.data.type, validation.data.payload);
    }
    this.emit("*", validation.data);
    return true;
  }
}

export const eventBus = new EventBus();
