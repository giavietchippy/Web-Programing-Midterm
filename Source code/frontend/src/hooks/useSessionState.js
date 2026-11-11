import { useCallback, useSyncExternalStore } from 'react';
import { initialState } from '../webrtc/RoomSession';

const noop = () => () => {};

export function useSessionState(session) {
  const subscribe = useCallback((cb) => (session ? session.subscribe(cb) : noop()), [session]);
  const getSnapshot = useCallback(() => (session ? session.getState() : initialState), [session]);
  return useSyncExternalStore(subscribe, getSnapshot);
}
