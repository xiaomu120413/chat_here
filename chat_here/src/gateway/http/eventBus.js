export function createGatewayEventBus() {
  const subscribers = new Set();

  return {
    publish(event) {
      const envelope = createEnvelope(event);
      for (const subscriber of subscribers) {
        subscriber(envelope);
      }
      return envelope;
    },

    subscribe(subscriber) {
      if (typeof subscriber !== "function") {
        throw new Error("event bus subscriber must be a function");
      }
      subscribers.add(subscriber);
      return () => subscribers.delete(subscriber);
    },

    subscriberCount() {
      return subscribers.size;
    },
  };
}

export function formatSseEvent(envelope) {
  return [
    `id: ${envelope.id}`,
    `event: ${envelope.type}`,
    `data: ${JSON.stringify(envelope.data)}`,
    "",
    "",
  ].join("\n");
}

function createEnvelope(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw new Error("event bus publish requires an event object");
  }

  const id = event.threadId && event.cursor ? `${event.threadId}:${event.cursor}` : event.id;
  if (typeof id !== "string" || id.trim().length === 0) {
    throw new Error("event bus event requires id or thread cursor");
  }

  return {
    id,
    type: event.type ?? "gateway.event",
    data: event,
  };
}
