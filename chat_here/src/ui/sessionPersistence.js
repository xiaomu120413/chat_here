const SESSION_STATE_VERSION = 1;

export function serializeSessionState(sessions, currentSessionId) {
  return JSON.stringify({
    version: SESSION_STATE_VERSION,
    currentSessionId,
    sessions: sessions.map((session) => ({
      ...session,
      members: undefined,
      run: null,
      activeRunId: "",
      gatewayMirroredMessageIds: Array.from(session.gatewayMirroredMessageIds ?? []),
    })),
  });
}

export function restoreSessionState(raw, options) {
  const fallback = () => {
    const session = options.createFallbackSession();
    return { sessions: [session], currentSessionId: session.id };
  };

  if (!raw) {
    return fallback();
  }

  try {
    const parsed = JSON.parse(raw);
    if (parsed?.version !== SESSION_STATE_VERSION || !Array.isArray(parsed.sessions)) {
      return fallback();
    }

    const sessions = parsed.sessions
      .filter((session) => session && typeof session.id === "string" && typeof session.name === "string")
      .map((session) => ({
        ...session,
        members: options.members,
        run: null,
        activeRunId: "",
        gatewayMirroredMessageIds: new Set(session.gatewayMirroredMessageIds ?? []),
      }));

    if (!sessions.length) {
      return fallback();
    }

    const currentSessionId = sessions.some((session) => session.id === parsed.currentSessionId)
      ? parsed.currentSessionId
      : sessions[0].id;
    return { sessions, currentSessionId };
  } catch {
    return fallback();
  }
}
