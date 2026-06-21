import { EventEmitter } from "events";
import { OrbitEvent, OrbitEventSchema } from "./EventSchema.js";

export class EventBus extends EventEmitter {
  constructor() {
    super();
  }

  public emitEvent<T extends OrbitEvent["type"]>(
    type: T,
    payload: Extract<OrbitEvent, { type: T }>["payload"],
  ): void {
    // Validate structure at runtime
    const validation = OrbitEventSchema.safeParse({ type, payload });
    if (!validation.success) {
      console.error(`[EventBus Validation Error] Type: ${type}`, validation.error);
    }
    this.emit(type, payload);
    this.emit("*", { type, payload });
  }
}

export const eventBus = new EventBus();
