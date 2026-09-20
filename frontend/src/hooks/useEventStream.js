import { useEffect, useRef, useState } from 'react';
import { reduceEvents } from '../lib/callState.js';

export function useEventStream() {
  const [calls, setCalls] = useState({});
  const [feed, setFeed] = useState([]);
  const [connected, setConnected] = useState(false);
  const lastId = useRef(0);

  useEffect(() => {
    let source;
    let retry;
    const open = () => {
      const since = lastId.current ? `?since=${lastId.current}` : '';
      source = new EventSource(`/events${since}`);
      source.onopen = () => setConnected(true);
      source.addEventListener('snapshot', (msg) => {
        const { events = [] } = JSON.parse(msg.data);
        if (!events.length) return;
        lastId.current = events[events.length - 1].id;
        setCalls((c) => reduceEvents(c, events));
        setFeed((f) => [...f, ...events].slice(-400));
      });
      source.addEventListener('event', (msg) => {
        const event = JSON.parse(msg.data);
        lastId.current = event.id;
        setCalls((c) => reduceEvents(c, [event]));
        setFeed((f) => [...f, event].slice(-400));
      });
      source.onerror = () => {
        setConnected(false);
        source.close();
        retry = setTimeout(open, 2000);
      };
    };
    open();
    return () => {
      clearTimeout(retry);
      source?.close();
    };
  }, []);

  return { calls, feed, connected };
}
