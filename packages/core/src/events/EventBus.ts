import { EventEmitter } from "events";
import {
  ORBIT_EVENT_SCHEMA_VERSION,
  type OrbitEvent,
  OrbitEventEnvelopeSchema,
  OrbitEventSchema,
} from "./EventSchema.js";

export class EventBus extends EventEmitter {
  private sequence = 0;

  public emitEvent<T extends OrbitEvent["type"]>(
    type: T,
    payload: Extract<OrbitEvent, { type: T }>["payload"],
  ): boolean {
    // Validate structure at runtime
    const validation = OrbitEventSchema.safeParse({ type, payload });
    if (!validation.success) {
      return false;
    }
    const envelope = OrbitEventEnvelopeSchema.parse({
      ...validation.data,
      schemaVersion: ORBIT_EVENT_SCHEMA_VERSION,
      eventId: `${process.pid}:${Date.now()}:${++this.sequence}`,
      timestamp: new Date().toISOString(),
    });
    if (envelope.type !== "error" || this.listenerCount("error") > 0) {
      this.emit(envelope.type, envelope.payload);
    }
    this.emit("*", envelope);
    return true;
  }
}

export const eventBus = new EventBus();
